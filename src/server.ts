import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { safe, UserError } from "./result.js";
import * as st from "./store.js";
import { issueToken, verifyToken } from "./confirm.js";
import { analyze, narrativePrompt, NICHES, ASSUMPTIONS, type Post, type Profile } from "./analysis.js";
import { fetchCreator, fetchPost, normUsername, parsePostRef, sourceMode, X_API_BASE, type FetchedPost } from "./xsource.js";
import { checkPost, DEFAULT_DISCLOSURES } from "./verify.js";
import { rank } from "./match.js";
import { getProvider, PROVIDERS } from "./payout.js";

export const VERSION = "1.0.0";

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const RO_X = { ...RO, openWorldHint: true } as const;
const dealId = z.string().regex(/^deal_[a-f0-9]{10}$/, "Expected an id like deal_0123456789");
const username = z.string().trim().min(1).max(16).describe("X handle, with or without @");
const currency = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. USD").default("USD");
const confirm_token = z.string().max(200).optional().describe("Omit on the first call to get a preview. Pass the token from the preview (with identical arguments) to apply the change.");

const manualInput = z.object({
  profile: z.object({
    username,
    name: z.string().max(100).optional(),
    description: z.string().max(500).optional(),
    location: z.string().max(100).optional(),
    verified: z.boolean().optional(),
    followers: z.number().int().min(0),
    following: z.number().int().min(0).optional(),
  }),
  posts: z.array(z.object({
    id: z.string().max(30).optional(),
    text: z.string().max(25_000),
    created_at: z.string().datetime().optional(),
    likes: z.number().int().min(0),
    reposts: z.number().int().min(0),
    replies: z.number().int().min(0),
    quotes: z.number().int().min(0).default(0),
    impressions: z.number().int().min(0).optional(),
    has_media: z.boolean().optional(),
    lang: z.string().max(10).optional(),
  })).min(1).max(100),
}).describe("Manual mode: profile and recent posts supplied by the user (e.g. copied from their X analytics). No network.");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArgs = Record<string, any>;

interface Plan { summary: string; changes: unknown; apply: (s: st.Store) => unknown }

function writeTool(
  server: McpServer,
  name: string,
  cfg: { title: string; description: string; inputSchema: ZodRawShape; destructive: boolean; idempotent?: boolean; openWorld?: boolean },
  plan: (s: st.Store, args: AnyArgs, phase: "preview" | "confirm") => Promise<Plan | { blocked: unknown }>,
) {
  server.registerTool(
    name,
    {
      title: cfg.title,
      description: `${cfg.description} TWO-STEP: the first call (no confirm_token) only returns a preview and a confirm_token; nothing is written. Show the preview to the user, and only after they approve call again with the same arguments plus confirm_token.`,
      inputSchema: { ...cfg.inputSchema, confirm_token },
      annotations: { readOnlyHint: false, destructiveHint: cfg.destructive, idempotentHint: cfg.idempotent ?? false, openWorldHint: cfg.openWorld ?? false },
    },
    safe(async (all: AnyArgs) => {
      const { confirm_token: token, ...args } = all;
      const store = await st.load();
      if (token) verifyToken(String(token), name, args, store.revision);
      const p = await plan(store, args, token ? "confirm" : "preview");
      if ("blocked" in p) {
        if (token) throw new UserError(`Cannot apply: the checks no longer pass. ${JSON.stringify(p.blocked)}`);
        return p.blocked;
      }
      if (!token) {
        return {
          status: "preview",
          summary: p.summary,
          changes: p.changes,
          confirm_token: issueToken(name, args, store.revision),
          next_step: `Nothing has been saved. Show this preview to the user. If they approve, call ${name} again with identical arguments plus this confirm_token (valid 10 minutes, single use).`,
        };
      }
      const result = p.apply(store);
      store.revision += 1;
      await st.save(store);
      return { status: "applied", summary: p.summary, result };
    }) as never,
  );
}

function fromManual(m: z.infer<typeof manualInput>): { profile: Profile; posts: Post[] } {
  return {
    profile: { ...m.profile, username: normUsername(m.profile.username) },
    posts: m.posts.map((p) => ({ ...p, quotes: p.quotes ?? 0, impressions: p.impressions ?? null })),
  };
}

async function gather(args: AnyArgs): Promise<{ source: st.Creator["source"]; profile: Profile; posts: Post[] }> {
  if (args.manual && args.username) throw new UserError("Pass either `username` (fetch from X) or `manual`, not both.");
  if (args.manual) return { source: "manual", ...fromManual(args.manual) };
  if (!args.username) throw new UserError("Pass `username` to fetch from X, or `manual` with profile and posts.");
  return fetchCreator(args.username, args.max_posts ?? 50);
}

function transition(d: st.Deal, to: st.DealStatus, note?: string) {
  const at = st.nowIso();
  d.status = to;
  d.updated_at = at;
  d.history.push({ status: to, at, ...(note ? { note } : {}) });
}

function requireStatus(d: st.Deal, allowed: st.DealStatus[], action: string) {
  if (!allowed.includes(d.status)) throw new UserError(`Cannot ${action}: deal ${d.id} is "${d.status}" (needs ${allowed.join(" or ")}).`);
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "creator-sponsor", version: VERSION },
    {
      instructions:
        "Creator sponsorship marketplace: analyse X creators, match them to brand briefs, run deals (offer -> accept -> verify post -> record payout). Data lives in one local JSON file (CREATOR_SPONSOR_PATH). Every write is two-step: preview, show the user, confirm only after approval. The only network access is read-only GETs to api.x.com when X_BEARER_TOKEN is set. This server never posts to X and never moves money; payouts are ledger records of payments made elsewhere. Sponsored posts must carry a clear disclosure such as #ad.",
    },
  );

  // ---------- reads ----------
  server.registerTool("data_source_status", {
    title: "Show X data source and storage",
    description: "Which X data source is active (x_api when X_BEARER_TOKEN is set, fixture, or none = manual input only), the data file path, and pricing assumptions. Never reveals the token.",
    inputSchema: {},
    annotations: RO,
  }, safe(async () => ({
    x_source: sourceMode(),
    x_api_base: X_API_BASE,
    token_configured: sourceMode() === "x_api",
    data_file: st.storePath(),
    payout_providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, available: p.available })),
    pricing_assumptions: ASSUMPTIONS,
    niches: Object.fromEntries(Object.entries(NICHES).map(([k, v]) => [k, { label: v.label, cpm_band_usd: v.cpm_usd }])),
  })));

  server.registerTool("analyze_creator", {
    title: "Analyse an X creator",
    description: "Builds a structured sponsor profile for an X creator: niches, audience, content style, engagement metrics (avg likes/reposts/replies, engagement rate) and an estimated price-per-post range with the exact formula and assumptions. Source: X API (needs X_BEARER_TOKEN) or `manual` profile+posts. Also returns `narrative_prompt` for you to write a human summary. Saves nothing (use save_creator_profile).",
    inputSchema: { username: username.optional(), manual: manualInput.optional(), max_posts: z.number().int().min(5).max(100).optional() },
    annotations: RO_X,
  }, safe(async (args) => {
    const g = await gather(args);
    const analysis = analyze(g.profile, g.posts);
    return { username: g.profile.username, source: g.source, profile: g.profile, analysis, narrative_prompt: narrativePrompt(g.profile.username, analysis) };
  }));

  server.registerTool("list_creators", {
    title: "List saved creators",
    description: "Saved creator profiles with niches, followers, engagement rate and price range. Optional niche filter.",
    inputSchema: { niche: z.enum(Object.keys(NICHES) as [string, ...string[]]).optional() },
    annotations: RO,
  }, safe(async ({ niche }) => {
    const s = await st.load();
    const rows = s.creators.filter((c) => !niche || c.analysis.niches.some((n) => n.niche === niche));
    return { total: rows.length, creators: rows.map((c) => ({ username: c.username, source: c.source, followers: c.profile.followers, niches: c.analysis.niches.map((n) => n.niche), engagement_rate: c.analysis.engagement.engagement_rate, price_per_post: { low: c.analysis.price_per_post.low, high: c.analysis.price_per_post.high, currency: c.analysis.price_per_post.currency }, updated_at: c.updated_at })) };
  }));

  server.registerTool("get_creator", {
    title: "Get saved creator",
    description: "Full saved creator profile and analysis, plus their deals.",
    inputSchema: { username },
    annotations: RO,
  }, safe(async ({ username: u }) => {
    const s = await st.load();
    const c = st.findCreator(s, normUsername(u));
    return { creator: c, deals: s.deals.filter((d) => d.creator_username === c.username), narrative_prompt: narrativePrompt(c.username, c.analysis) };
  }));

  server.registerTool("match_creators", {
    title: "Match creators to a brand brief",
    description: "Ranks saved creators for a product brief by niche fit, audience fit and budget fit, with per-component scores, reasons and a suggested offer. Deterministic and explainable. Saves nothing.",
    inputSchema: {
      product: z.string().trim().min(2).max(200),
      description: z.string().max(2000).optional(),
      target_niches: z.array(z.enum(Object.keys(NICHES) as [string, ...string[]])).max(5).optional().describe("Override niche detection from the brief text"),
      budget_per_post: z.object({ min: z.number().min(0).optional(), max: z.number().positive() }).describe("USD per post"),
      min_followers: z.number().int().min(0).optional(),
      languages: z.array(z.string().min(2).max(10)).max(5).optional().describe("Post language codes, e.g. en"),
      limit: z.number().int().min(1).max(50).optional(),
    },
    annotations: RO,
  }, safe(async ({ limit, ...brief }) => {
    const s = await st.load();
    if (!s.creators.length) throw new UserError("No saved creators yet. Onboard creators with analyze_creator + save_creator_profile.");
    if (brief.budget_per_post.min !== undefined && brief.budget_per_post.min > brief.budget_per_post.max) throw new UserError("budget_per_post.min is greater than max");
    return rank(s.creators, brief, limit ?? 10);
  }));

  server.registerTool("list_deals", {
    title: "List deals",
    description: "Deals with status, filterable by status or creator.",
    inputSchema: { status: z.enum(st.DEAL_STATUSES).optional(), creator: username.optional() },
    annotations: RO,
  }, safe(async ({ status, creator }) => {
    const s = await st.load();
    const u = creator ? normUsername(creator) : undefined;
    const rows = s.deals.filter((d) => (!status || d.status === status) && (!u || d.creator_username === u));
    const byStatus = Object.fromEntries(st.DEAL_STATUSES.map((x) => [x, s.deals.filter((d) => d.status === x).length]));
    return { total: rows.length, by_status: byStatus, deals: rows.map(({ history, verification, ...d }) => ({ ...d, verified: Boolean(verification) })) };
  }));

  server.registerTool("get_deal", {
    title: "Get deal",
    description: "Full deal: requirement, status history, verification checks and payout record.",
    inputSchema: { deal_id: dealId },
    annotations: RO,
  }, safe(async ({ deal_id }) => {
    const s = await st.load();
    const d = st.findDeal(s, deal_id);
    return { deal: d, payout: s.payouts.find((p) => p.deal_id === d.id) ?? null };
  }));

  server.registerTool("list_payout_providers", {
    title: "List payout providers",
    description: "Payout providers and whether they are available. This server never moves money.",
    inputSchema: {},
    annotations: RO,
  }, safe(async () => ({ moves_money: false, providers: Object.values(PROVIDERS).map(({ id, name, available, description }) => ({ id, name, available, description })) })));

  server.registerTool("list_payouts", {
    title: "Payout ledger",
    description: "All recorded payouts with totals per currency.",
    inputSchema: {},
    annotations: RO,
  }, safe(async () => {
    const s = await st.load();
    const totals: Record<string, number> = {};
    for (const p of s.payouts) totals[p.currency] = (totals[p.currency] ?? 0) + p.amount;
    return { total: s.payouts.length, totals, payouts: s.payouts };
  }));

  // ---------- writes ----------
  writeTool(server, "save_creator_profile", {
    title: "Save / refresh creator profile",
    description: "Analyses a creator (X API or `manual`) and saves or refreshes their profile in the marketplace. Overwrites the previous analysis for that handle. With X data, metrics are re-fetched on confirm.",
    inputSchema: { username: username.optional(), manual: manualInput.optional(), max_posts: z.number().int().min(5).max(100).optional(), payout_handle: z.string().trim().max(100).optional().describe("Where the creator wants to be paid, e.g. their X Money handle. Informational only.") },
    destructive: true,
    idempotent: true,
    openWorld: true,
  }, async (s, args) => {
    const g = await gather(args);
    const analysis = analyze(g.profile, g.posts);
    const existing = s.creators.find((c) => c.username === g.profile.username);
    return {
      summary: `${existing ? "Refresh" : "Add"} creator @${g.profile.username} (${g.profile.followers} followers, ${analysis.niches.map((n) => n.label).join(", ") || "General"}, est. $${analysis.price_per_post.low}-${analysis.price_per_post.high}/post).`,
      changes: { username: g.profile.username, source: g.source, niches: analysis.niches, engagement: analysis.engagement, price_per_post: { low: analysis.price_per_post.low, high: analysis.price_per_post.high }, replaces_existing: Boolean(existing) },
      apply: (store) => {
        const now = st.nowIso();
        const rec: st.Creator = { username: g.profile.username, source: g.source, profile: g.profile, posts_analyzed: g.posts.length, analysis, payout_handle: args.payout_handle ?? existing?.payout_handle, created_at: existing?.created_at ?? now, updated_at: now };
        store.creators = [...store.creators.filter((c) => c.username !== rec.username), rec];
        return { username: rec.username, updated_at: now };
      },
    };
  });

  writeTool(server, "delete_creator", {
    title: "Delete creator",
    description: "Permanently removes a saved creator. Refused while they have open deals (offered, accepted or verified-but-unpaid).",
    inputSchema: { username },
    destructive: true,
  }, async (s, { username: u }) => {
    const c = st.findCreator(s, normUsername(u));
    const open = s.deals.filter((d) => d.creator_username === c.username && ["offered", "accepted", "verified"].includes(d.status));
    if (open.length) throw new UserError(`@${c.username} has ${open.length} open deal(s): ${open.map((d) => d.id).join(", ")}. Cancel or complete them first.`);
    return {
      summary: `PERMANENTLY delete creator @${c.username}. Closed deals and payout records are kept for your books.`,
      changes: { delete: c.username },
      apply: (store) => { store.creators = store.creators.filter((x) => x.username !== c.username); return { deleted: c.username }; },
    };
  });

  writeTool(server, "create_offer", {
    title: "Create sponsorship offer",
    description: "Brand creates an offer to a saved creator: amount, product, post requirements (phrases, link) and required disclosure markers. Starts in status `offered`.",
    inputSchema: {
      creator: username,
      brand: z.string().trim().min(1).max(120),
      product: z.string().trim().min(1).max(200),
      amount: z.number().positive().max(1_000_000),
      currency,
      must_include_phrases: z.array(z.string().trim().min(1).max(200)).max(5).optional(),
      must_include_link: z.string().trim().url().max(500).optional(),
      disclosure: z.array(z.string().trim().min(2).max(40)).min(1).max(6).optional().describe(`Accepted disclosure markers; at least one must appear in the post. Default: ${DEFAULT_DISCLOSURES.join(", ")}`),
      post_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
      notes: z.string().max(2000).optional(),
    },
    destructive: false,
  }, async (s, a) => {
    const c = st.findCreator(s, normUsername(a.creator));
    const requirement: st.Requirement = { must_include_phrases: a.must_include_phrases ?? [], must_include_link: a.must_include_link, disclosure: a.disclosure ?? DEFAULT_DISCLOSURES };
    const est = c.analysis.price_per_post;
    const priceNote = a.currency !== "USD" ? "estimate is in USD; compare manually" : a.amount < est.low ? `below estimate ($${est.low}-${est.high})` : a.amount > est.high ? `above estimate ($${est.low}-${est.high})` : `within estimate ($${est.low}-${est.high})`;
    return {
      summary: `Offer ${a.currency} ${a.amount} from ${a.brand} to @${c.username} for "${a.product}" (${priceNote}).`,
      changes: { creator: c.username, brand: a.brand, product: a.product, amount: a.amount, currency: a.currency, requirement, post_by: a.post_by },
      apply: (store) => {
        const now = st.nowIso();
        const d: st.Deal = { id: st.newId("deal"), creator_username: c.username, brand: a.brand, product: a.product, amount: a.amount, currency: a.currency, requirement, post_by: a.post_by, notes: a.notes, status: "offered", history: [{ status: "offered", at: now }], created_at: now, updated_at: now };
        store.deals.push(d);
        return { deal_id: d.id, status: d.status, creator_brief: `Sponsored post for ${a.brand}: ${a.product}. Must include ${[...requirement.must_include_phrases.map((p) => `"${p}"`), requirement.must_include_link].filter(Boolean).join(" and ") || "no specific phrase"}, plus a clear disclosure (${requirement.disclosure.join(" / ")}) in the post text itself, and turn on X's paid-partnership label if available.` };
      },
    };
  });

  writeTool(server, "respond_to_offer", {
    title: "Accept or decline offer",
    description: "Records the creator's decision on an `offered` deal: accept -> `accepted`, decline -> `declined`.",
    inputSchema: { deal_id: dealId, decision: z.enum(["accept", "decline"]), note: z.string().max(500).optional() },
    destructive: false,
  }, async (s, { deal_id, decision, note }) => {
    const d = st.findDeal(s, deal_id);
    requireStatus(d, ["offered"], "respond");
    const to: st.DealStatus = decision === "accept" ? "accepted" : "declined";
    return {
      summary: `@${d.creator_username} ${decision}s ${d.brand}'s offer (${d.currency} ${d.amount}) -> ${to}.`,
      changes: { deal_id, from: d.status, to },
      apply: (store) => { const x = st.findDeal(store, deal_id); transition(x, to, note); return { deal_id, status: x.status }; },
    };
  });

  writeTool(server, "cancel_deal", {
    title: "Cancel deal",
    description: "Cancels an `offered` or `accepted` deal. Cannot be undone.",
    inputSchema: { deal_id: dealId, reason: z.string().max(500).optional() },
    destructive: true,
  }, async (s, { deal_id, reason }) => {
    const d = st.findDeal(s, deal_id);
    requireStatus(d, ["offered", "accepted"], "cancel");
    return {
      summary: `Cancel deal ${deal_id} (${d.brand} x @${d.creator_username}, currently ${d.status}). This cannot be undone.`,
      changes: { deal_id, from: d.status, to: "cancelled" },
      apply: (store) => { const x = st.findDeal(store, deal_id); transition(x, "cancelled", reason); return { deal_id, status: x.status }; },
    };
  });

  writeTool(server, "verify_deal_post", {
    title: "Verify sponsored post",
    description: "Fetches the creator's post (URL or id) from X and checks author, required phrases/link, disclosure, and that it was posted after acceptance. The preview shows every check; it can only be confirmed if all pass, which marks the deal `verified`. Without an X token, pass `manual_attestation` (recorded as such).",
    inputSchema: {
      deal_id: dealId,
      post: z.string().trim().min(1).max(300).describe("Post id or https://x.com/<user>/status/<id> URL"),
      manual_attestation: z.object({ author_username: username, text: z.string().min(1).max(25_000), created_at: z.string().datetime().optional(), attested_by: z.string().trim().min(1).max(120).describe("Who checked the post by hand") }).optional().describe("Only when the X API is unavailable: the post as seen by a human. Marked manual_attestation in the record."),
    },
    destructive: false,
    openWorld: true,
  }, async (s, { deal_id, post, manual_attestation }) => {
    const d = st.findDeal(s, deal_id);
    requireStatus(d, ["accepted"], "verify");
    const postId = parsePostRef(post);
    let p: FetchedPost;
    let source: st.Verification["source"];
    if (manual_attestation) {
      p = { id: postId, author_username: normUsername(manual_attestation.author_username), text: manual_attestation.text, created_at: manual_attestation.created_at, likes: 0, reposts: 0, replies: 0, quotes: 0 };
      source = "manual_attestation";
    } else {
      const r = await fetchPost(postId);
      p = r.post;
      source = r.source;
    }
    const acceptedAt = [...d.history].reverse().find((h) => h.status === "accepted")?.at;
    const result = checkPost(d, p, acceptedAt);
    if (!result.all_pass) {
      return { blocked: { status: "failed", deal_id, post_id: postId, source, checks: result.checks, next_step: "Verification failed; nothing was changed. Tell the user which checks failed. The creator can edit or repost, then verify again." } };
    }
    return {
      summary: `All ${result.checks.length} checks pass for post ${postId} by @${p.author_username}${source === "manual_attestation" ? " (MANUAL attestation, not fetched from X)" : ""}. Mark deal ${deal_id} verified.`,
      changes: { deal_id, from: d.status, to: "verified", source, checks: result.checks },
      apply: (store) => {
        const x = st.findDeal(store, deal_id);
        x.verification = { post_id: postId, source, checked_at: st.nowIso(), checks: result.checks };
        transition(x, "verified", source === "manual_attestation" ? `manual attestation by ${manual_attestation!.attested_by}` : undefined);
        return { deal_id, status: x.status, post_id: postId };
      },
    };
  });

  writeTool(server, "record_payout", {
    title: "Record payout",
    description: "Records that a verified deal was paid, via a payout provider. Default provider `manual` is a ledger entry with your transaction reference; it does NOT move money. Provider `x_money` is a stub pending a public X Money payouts API and always refuses. Marks the deal `paid`.",
    inputSchema: {
      deal_id: dealId,
      provider: z.string().max(40).default("manual"),
      reference: z.string().trim().max(200).optional().describe("Transaction id of the payment you made elsewhere (required for manual)"),
      amount: z.number().positive().max(1_000_000).optional().describe("Defaults to the deal amount"),
      note: z.string().max(500).optional(),
    },
    destructive: false,
  }, async (s, { deal_id, provider, reference, amount, note }) => {
    const d = st.findDeal(s, deal_id);
    requireStatus(d, ["verified"], "record a payout");
    const prov = getProvider(provider ?? "manual");
    prov.validate(d, { reference });
    const amt = amount ?? d.amount;
    return {
      summary: `Record that ${d.currency} ${amt} was paid to @${d.creator_username} for deal ${deal_id} (provider ${prov.id}, ref ${reference}). This only records a payment you already made; no money is moved.${amt !== d.amount ? ` NOTE: differs from the agreed ${d.amount}.` : ""}`,
      changes: { deal_id, from: d.status, to: "paid", provider: prov.id, amount: amt, currency: d.currency, reference },
      apply: (store) => {
        const x = st.findDeal(store, deal_id);
        const pay: st.Payout = { id: st.newId("pay"), deal_id, provider: prov.id, amount: amt, currency: x.currency, reference: reference!, note, recorded_at: st.nowIso() };
        store.payouts.push(pay);
        x.payout_id = pay.id;
        transition(x, "paid", `${prov.id} ref ${reference}`);
        return { deal_id, status: x.status, payout_id: pay.id, money_moved: false };
      },
    };
  });

  return server;
}
