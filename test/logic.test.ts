import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { analyze, classify, engagementMetrics, priceEstimate } from "../src/analysis.js";
import { checkPost } from "../src/verify.js";
import { rank } from "../src/match.js";
import { parsePostRef, normUsername, fetchCreator, fetchPost, sourceMode } from "../src/xsource.js";
import { getProvider } from "../src/payout.js";
import type { Deal, Creator } from "../src/store.js";

const posts = (n: number, o: Partial<{ likes: number; reposts: number; replies: number; quotes: number; impressions: number | null; text: string }> = {}) =>
  Array.from({ length: n }, (_, i) => ({ text: o.text ?? `post ${i}`, likes: o.likes ?? 100, reposts: o.reposts ?? 10, replies: o.replies ?? 5, quotes: o.quotes ?? 5, impressions: o.impressions === undefined ? 10000 : o.impressions, created_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));

describe("engagement metrics", () => {
  it("computes averages and impression-based engagement rate exactly", () => {
    const m = engagementMetrics({ username: "a", followers: 5000 }, posts(10));
    expect(m).toMatchObject({ posts_analyzed: 10, avg_likes: 100, avg_reposts: 10, avg_replies: 5, avg_quotes: 5, median_impressions: 10000, engagement_rate: 0.012, engagement_rate_basis: "interactions / impressions", posts_per_week: 7 });
  });
  it("falls back to followers when no impressions", () => {
    const m = engagementMetrics({ username: "a", followers: 12000 }, posts(4, { impressions: null }));
    expect(m.median_impressions).toBeNull();
    expect(m.engagement_rate).toBe(0.01);
    expect(m.engagement_rate_basis).toMatch(/followers/);
  });
  it("handles zero posts", () => {
    expect(engagementMetrics({ username: "a", followers: 0 }, []).engagement_rate).toBe(0);
  });
});

describe("pricing formula", () => {
  it("price = impressions/1000 x CPM x multiplier, shown transparently", () => {
    const p = { username: "a", followers: 5000 };
    const m = engagementMetrics(p, posts(10)); // ER 1.2% -> sqrt(1.2)=1.1
    const e = priceEstimate(p, m, "ai_tech");
    expect(e.inputs.expected_impressions).toBe(8000);
    expect(e.inputs.engagement_multiplier).toBe(1.1);
    expect(e.low).toBe(Math.round(8 * 12 * 1.1));
    expect(e.high).toBe(Math.round(8 * 25 * 1.1));
    expect(e.formula).toContain("CPM");
    expect(e.assumptions.length).toBeGreaterThan(2);
  });
  it("clamps the multiplier and uses follower reach without impressions", () => {
    const p = { username: "a", followers: 100000 };
    const e = priceEstimate(p, engagementMetrics(p, posts(5, { impressions: null, likes: 0, reposts: 0, replies: 0, quotes: 0 })), null);
    expect(e.inputs.engagement_multiplier).toBe(0.5);
    expect(e.inputs.expected_impressions).toBe(4000);
    expect(e.inputs.niche_used).toBe("general");
    expect(e.low).toBe(8);
  });
});

describe("classification", () => {
  it("detects niches from keywords and phrases", () => {
    expect(classify(["shipping an ai agent in typescript", "open source llm"])[0].niche).toBe("ai_tech");
    expect(classify(["marathon training and protein"])[0].niche).toBe("fitness_health");
    expect(classify(["hello world"])).toEqual([]);
  });
  it("flags low-confidence data", () => {
    const a = analyze({ username: "a", followers: 10, description: "" }, posts(3));
    expect(a.data_quality.join(" ")).toMatch(/Only 3 posts/);
    expect(a.best_fit_product_categories.length).toBeGreaterThan(0);
  });
});

const deal = (o: Partial<Deal> = {}): Deal => ({ id: "deal_0000000000", creator_username: "devdana", brand: "B", product: "P", amount: 100, currency: "USD", requirement: { must_include_phrases: ["AgentLens"], must_include_link: "https://agentlens.dev/try", disclosure: ["#ad", "paid partnership"] }, status: "accepted", history: [], created_at: "", updated_at: "", ...o });
const post = (o: object = {}) => ({ id: "1", author_username: "devdana", text: "Love agentlens agentlens.dev/try #ad", urls: [], created_at: "2026-02-01T00:00:00Z", likes: 0, reposts: 0, replies: 0, quotes: 0, ...o });

describe("post verification", () => {
  it("passes when author, phrase, link, disclosure and timing match", () => {
    const r = checkPost(deal(), post(), "2026-01-01T00:00:00Z");
    expect(r.all_pass).toBe(true);
    expect(r.checks.map((c) => c.check)).toEqual(["author", 'phrase: "AgentLens"', "link: https://agentlens.dev/try", "disclosure", "posted after acceptance"]);
  });
  it("fails each check independently", () => {
    expect(checkPost(deal(), post({ author_username: "other" })).checks[0].pass).toBe(false);
    expect(checkPost(deal(), post({ text: "agentlens.dev/try #adventure" })).checks.find((c) => c.check === "disclosure")!.pass).toBe(false);
    expect(checkPost(deal(), post({ text: "#ad AgentLens" })).checks.find((c) => c.check.startsWith("link"))!.pass).toBe(false);
    expect(checkPost(deal(), post(), "2026-03-01T00:00:00Z").all_pass).toBe(false);
  });
  it("matches expanded t.co urls and phrase disclosures", () => {
    expect(checkPost(deal(), post({ text: "AgentLens https://t.co/abc Paid Partnership", urls: ["https://agentlens.dev/try?utm=x"] })).all_pass).toBe(true);
  });
});

describe("matching", () => {
  const creator = (u: string, niche: string, low: number, high: number, followers = 10000): Creator => ({ username: u, source: "manual", profile: { username: u, followers }, posts_analyzed: 20, analysis: { niches: [{ niche, label: niche, share: 1, hits: 5 }], audience: { summary: "", followers, follower_ratio: null, languages: ["en"], verified: false }, price_per_post: { low, high, currency: "USD" } } as never, created_at: "", updated_at: "" });
  it("ranks by niche, audience and budget with reasons", () => {
    const r = rank([creator("fit", "fitness_health", 50, 100), creator("dev", "ai_tech", 100, 200), creator("pricey", "ai_tech", 900, 1500)], { product: "AI coding agent tracer for developers", budget_per_post: { max: 300 } });
    expect(r.results.map((x) => x.username)).toEqual(["dev", "pricey", "fit"]);
    expect(r.results[0].score).toBe(1);
    expect(r.results[0].reasons.join(" ")).toMatch(/niche overlap: ai_tech/);
    expect(r.results[1].components.budget).toBe(0);
    expect(r.results[0].suggested_offer).toBe(150);
  });
  it("penalises follower minimum and language", () => {
    const r = rank([creator("small", "ai_tech", 10, 20, 500)], { product: "x", target_niches: ["ai_tech"], budget_per_post: { max: 100 }, min_followers: 1000, languages: ["de"] });
    expect(r.results[0].components.audience).toBe(0);
  });
});

describe("input parsing", () => {
  it("parses post refs safely", () => {
    expect(parsePostRef("https://x.com/devdana/status/1950000000000000001?s=20")).toBe("1950000000000000001");
    expect(parsePostRef("https://twitter.com/a/status/123")).toBe("123");
    expect(parsePostRef("123")).toBe("123");
    expect(() => parsePostRef("https://evil.com/a/status/1")).toThrow(/x.com/);
    expect(() => parsePostRef("../etc")).toThrow();
  });
  it("validates usernames", () => {
    expect(normUsername("@DevDana")).toBe("devdana");
    expect(() => normUsername("bad/../name")).toThrow();
  });
});

describe("payout providers", () => {
  it("manual needs a reference; x_money stub always refuses", () => {
    expect(() => getProvider("manual").validate(deal(), {})).toThrow(/reference/);
    expect(() => getProvider("manual").validate(deal(), { reference: "TX1" })).not.toThrow();
    expect(() => getProvider("x_money").validate(deal(), { reference: "TX1" })).toThrow(/no public X Money payouts API/);
    expect(() => getProvider("stripe")).toThrow(/Unknown/);
  });
});

describe("X API client (mocked fetch)", () => {
  const TOKEN = "SECRET-test-token-123";
  let calls: Array<{ url: string; init: RequestInit }>;
  beforeEach(() => {
    calls = [];
    delete process.env.CREATOR_SPONSOR_FIXTURES;
    process.env.X_BEARER_TOKEN = TOKEN;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.X_BEARER_TOKEN;
  });
  const stub = (responder: (url: string) => { status?: number; body: unknown }) =>
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), init });
      const r = responder(String(url));
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
    }));

  it("only calls api.x.com with GET + bearer, maps the profile and posts", async () => {
    stub((u) => u.includes("/users/by/username/")
      ? { body: { data: { id: "42", username: "DevDana", description: "ai", public_metrics: { followers_count: 1000, following_count: 10, tweet_count: 5 } } } }
      : { body: { data: [{ id: "7", text: "hello ai", created_at: "2026-01-01T00:00:00Z", public_metrics: { like_count: 3, retweet_count: 1, reply_count: 1, quote_count: 0, impression_count: 200 }, entities: { urls: [{ expanded_url: "https://a.b" }] } }] } });
    expect(sourceMode()).toBe("x_api");
    const r = await fetchCreator("@DevDana", 20);
    expect(r.profile).toMatchObject({ id: "42", username: "devdana", followers: 1000 });
    expect(r.posts[0]).toMatchObject({ id: "7", likes: 3, impressions: 200, urls: ["https://a.b"] });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(new URL(c.url).origin).toBe("https://api.x.com");
      expect(c.init.method).toBe("GET");
      expect((c.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    }
    expect(calls[1].url).toContain("/2/users/42/tweets");
    expect(calls[1].url).toContain("exclude=replies%2Cretweets");
  });

  it("never leaks the token in errors", async () => {
    stub(() => ({ status: 401, body: { title: "Unauthorized", detail: "Unauthorized" } }));
    const err = await fetchPost("123").catch((e) => e as Error);
    expect(String(err.message)).toMatch(/401/);
    expect(String(err.message)).not.toContain(TOKEN);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });

  it("resolves the post author via expansions", async () => {
    stub(() => ({ body: { data: { id: "9", author_id: "42", text: "#ad hi", created_at: "2026-01-01T00:00:00Z" }, includes: { users: [{ id: "42", username: "DevDana" }] } } }));
    expect((await fetchPost("9")).post.author_username).toBe("devdana");
  });

  it("treats an unexpanded placeholder as no token", () => {
    process.env.X_BEARER_TOKEN = "${X_BEARER_TOKEN}";
    expect(sourceMode()).toBe("none");
  });
  it("makes no network call without a token", async () => {
    delete process.env.X_BEARER_TOKEN;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(fetchCreator("devdana")).rejects.toThrow(/No X data source/);
    expect(f).not.toHaveBeenCalled();
  });
});
