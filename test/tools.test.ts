import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { makeSandbox, removeSandbox, FIXTURES } from "./helpers.js";

type Text = { type: string; text: string };
let sandbox: { dir: string; file: string };
let client: Client;
const fetchSpy = vi.fn();

async function call(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Text[])[0].text;
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* error text */ }
  return { isError: Boolean(res.isError), text, json };
}
async function commit(name: string, args: Record<string, unknown>) {
  const p = await call(name, args);
  expect(p.isError, p.text).toBe(false);
  expect(p.json.status, p.text).toBe("preview");
  const a = await call(name, { ...args, confirm_token: p.json.confirm_token });
  expect(a.isError, a.text).toBe(false);
  expect(a.json.status).toBe("applied");
  return a.json.result;
}
const disk = () => JSON.parse(readFileSync(sandbox.file, "utf8"));
const offerArgs = { creator: "devdana", brand: "AgentLens", product: "AgentLens tracer", amount: 200, must_include_phrases: ["AgentLens"], must_include_link: "https://agentlens.dev/try" };

beforeEach(async () => {
  sandbox = makeSandbox();
  process.env.CREATOR_SPONSOR_PATH = sandbox.file;
  process.env.CREATOR_SPONSOR_FIXTURES = FIXTURES;
  delete process.env.X_BEARER_TOKEN;
  vi.stubGlobal("fetch", fetchSpy);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(a);
  client = new Client({ name: "unit", version: "1" });
  await client.connect(b);
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled(); // fixture/manual modes never touch the network
  vi.unstubAllGlobals();
  removeSandbox(sandbox.dir);
});

async function acceptedDeal() {
  await commit("save_creator_profile", { username: "devdana" });
  const o = await commit("create_offer", offerArgs);
  await commit("respond_to_offer", { deal_id: o.deal_id, decision: "accept" });
  return o.deal_id as string;
}

describe("tool annotations", () => {
  it("every tool has correct hints", async () => {
    const { tools } = await client.listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(tools).toHaveLength(16);
    for (const r of ["data_source_status", "analyze_creator", "list_creators", "get_creator", "match_creators", "list_deals", "get_deal", "list_payout_providers", "list_payouts"]) expect(by[r]!.readOnlyHint, r).toBe(true);
    for (const w of ["save_creator_profile", "delete_creator", "create_offer", "respond_to_offer", "cancel_deal", "verify_deal_post", "record_payout"]) expect(by[w]!.readOnlyHint, w).toBe(false);
    for (const d of ["save_creator_profile", "delete_creator", "cancel_deal"]) expect(by[d]!.destructiveHint, d).toBe(true);
    for (const d of ["create_offer", "respond_to_offer", "verify_deal_post", "record_payout"]) expect(by[d]!.destructiveHint, d).toBe(false);
    for (const o of ["analyze_creator", "save_creator_profile", "verify_deal_post"]) expect(by[o]!.openWorldHint, o).toBe(true);
    expect(by.create_offer!.openWorldHint).toBe(false);
  });
});

describe("analysis tools", () => {
  it("analyze_creator from fixture returns metrics, formula and prompt, writes nothing", async () => {
    const r = await call("analyze_creator", { username: "@DevDana" });
    expect(r.isError, r.text).toBe(false);
    expect(r.json.source).toBe("fixture");
    expect(r.json.analysis.niches[0].niche).toBe("ai_tech");
    expect(r.json.analysis.engagement.avg_likes).toBe(158.5);
    expect(r.json.analysis.price_per_post).toMatchObject({ low: 136, high: 283, currency: "USD" });
    expect(r.json.analysis.price_per_post.formula).toMatch(/CPM/);
    expect(r.json.narrative_prompt).toMatch(/Do not invent numbers/);
    expect(existsSync(sandbox.file)).toBe(false);
  });
  it("manual mode works with no source configured", async () => {
    delete process.env.CREATOR_SPONSOR_FIXTURES;
    const r = await call("analyze_creator", { manual: { profile: { username: "solo", followers: 2000, description: "fitness coach" }, posts: [{ text: "gym day", likes: 20, reposts: 2, replies: 3 }] } });
    expect(r.isError, r.text).toBe(false);
    expect(r.json.source).toBe("manual");
    expect(r.json.analysis.niches[0].niche).toBe("fitness_health");
  });
  it("explains how to proceed with no source and rejects both inputs", async () => {
    delete process.env.CREATOR_SPONSOR_FIXTURES;
    expect((await call("analyze_creator", { username: "devdana" })).text).toMatch(/X_BEARER_TOKEN.*manual/);
    expect((await call("analyze_creator", { username: "a", manual: { profile: { username: "a", followers: 1 }, posts: [{ text: "x", likes: 0, reposts: 0, replies: 0 }] } })).text).toMatch(/not both/);
  });
  it("data_source_status never exposes the token", async () => {
    process.env.X_BEARER_TOKEN = "TOPSECRET";
    const r = await call("data_source_status", {});
    expect(r.json.x_source).toBe("x_api");
    expect(r.text).not.toContain("TOPSECRET");
    delete process.env.X_BEARER_TOKEN;
  });
});

describe("preview / confirm", () => {
  it("preview writes nothing; confirm writes a private file", async () => {
    const p = await call("save_creator_profile", { username: "devdana" });
    expect(p.json.status).toBe("preview");
    expect(existsSync(sandbox.file)).toBe(false);
    await call("save_creator_profile", { username: "devdana", confirm_token: p.json.confirm_token });
    expect(disk().creators[0].username).toBe("devdana");
    expect(statSync(sandbox.file).mode & 0o777).toBe(0o600);
  });
  it("rejects reuse, changed args, stale revision and garbage tokens", async () => {
    const p = await call("save_creator_profile", { username: "devdana" });
    const t = p.json.confirm_token;
    expect((await call("save_creator_profile", { username: "fitfelix", confirm_token: t })).text).toMatch(/does not match/);
    await call("save_creator_profile", { username: "devdana", confirm_token: t });
    expect((await call("save_creator_profile", { username: "devdana", confirm_token: t })).text).toMatch(/already used/);
    const p2 = await call("save_creator_profile", { username: "fitfelix" });
    await commit("save_creator_profile", { username: "moneymaya" });
    expect((await call("save_creator_profile", { username: "fitfelix", confirm_token: p2.json.confirm_token })).text).toMatch(/changed since/);
    expect((await call("save_creator_profile", { username: "fitfelix", confirm_token: "nope" })).text).toMatch(/Malformed/);
  });
});

describe("matching", () => {
  it("ranks saved creators for a brief", async () => {
    for (const u of ["devdana", "fitfelix", "moneymaya"]) await commit("save_creator_profile", { username: u });
    const r = await call("match_creators", { product: "AI coding agent observability for developers", budget_per_post: { min: 100, max: 300 } });
    expect(r.json.results[0].username).toBe("devdana");
    expect(r.json.results[0].reasons.join(" ")).toMatch(/fits budget/);
    expect(r.json.formula).toMatch(/0.5 x niche_fit/);
  });
  it("errors helpfully with no creators and bad budget", async () => {
    expect((await call("match_creators", { product: "x y", budget_per_post: { max: 10 } })).text).toMatch(/No saved creators/);
  });
});

describe("deal lifecycle", () => {
  it("offer -> accept -> verify -> paid (manual ledger)", async () => {
    const id = await acceptedDeal();
    const v = await call("verify_deal_post", { deal_id: id, post: "https://x.com/devdana/status/1950000000000000001" });
    expect(v.json.status).toBe("preview");
    expect(v.json.changes.checks.every((c: { pass: boolean }) => c.pass)).toBe(true);
    await call("verify_deal_post", { deal_id: id, post: "https://x.com/devdana/status/1950000000000000001", confirm_token: v.json.confirm_token });
    const pay = await commit("record_payout", { deal_id: id, reference: "XMONEY-TX-001" });
    expect(pay.money_moved).toBe(false);
    const d = disk();
    expect(d.deals[0].status).toBe("paid");
    expect(d.deals[0].history.map((h: { status: string }) => h.status)).toEqual(["offered", "accepted", "verified", "paid"]);
    expect(d.payouts[0]).toMatchObject({ provider: "manual", amount: 200, reference: "XMONEY-TX-001" });
    const l = await call("list_payouts", {});
    expect(l.json.totals.USD).toBe(200);
  });
  it("verification failure returns checks, no token, no change", async () => {
    const id = await acceptedDeal();
    const v = await call("verify_deal_post", { deal_id: id, post: "1950000000000000002" });
    expect(v.json.status).toBe("failed");
    expect(v.json.confirm_token).toBeUndefined();
    expect(v.json.checks.find((c: { check: string }) => c.check === "disclosure").pass).toBe(false);
    const wrongAuthor = await call("verify_deal_post", { deal_id: id, post: "1950000000000000003" });
    expect(wrongAuthor.json.checks[0]).toMatchObject({ check: "author", pass: false });
    expect(disk().deals[0].status).toBe("accepted");
  });
  it("manual attestation is recorded as such", async () => {
    const id = await acceptedDeal();
    const att = { author_username: "devdana", text: "AgentLens agentlens.dev/try #ad", attested_by: "Paris" };
    await commit("verify_deal_post", { deal_id: id, post: "123", manual_attestation: att });
    expect(disk().deals[0].verification.source).toBe("manual_attestation");
  });
  it("enforces status transitions and payout rules", async () => {
    const id = await acceptedDeal();
    expect((await call("respond_to_offer", { deal_id: id, decision: "accept" })).text).toMatch(/needs offered/);
    expect((await call("record_payout", { deal_id: id, reference: "x" })).text).toMatch(/needs verified/);
    await commit("verify_deal_post", { deal_id: id, post: "1950000000000000001" });
    expect((await call("record_payout", { deal_id: id })).text).toMatch(/needs a `reference`/);
    expect((await call("record_payout", { deal_id: id, provider: "x_money", reference: "x" })).text).toMatch(/not available/);
    expect((await call("cancel_deal", { deal_id: id })).text).toMatch(/Cannot cancel/);
    expect((await call("delete_creator", { username: "devdana" })).text).toMatch(/open deal/);
  });
  it("decline and cancel paths", async () => {
    await commit("save_creator_profile", { username: "devdana" });
    const a = await commit("create_offer", offerArgs);
    await commit("respond_to_offer", { deal_id: a.deal_id, decision: "decline" });
    const b = await commit("create_offer", { ...offerArgs, amount: 250 });
    await commit("cancel_deal", { deal_id: b.deal_id, reason: "budget cut" });
    expect(disk().deals.map((d: { status: string }) => d.status)).toEqual(["declined", "cancelled"]);
    await commit("delete_creator", { username: "devdana" });
    expect(disk().creators).toHaveLength(0);
    expect(disk().deals).toHaveLength(2);
  });
  it("offer brief includes disclosure; offer needs saved creator", async () => {
    expect((await call("create_offer", offerArgs)).text).toMatch(/No saved creator/);
    await commit("save_creator_profile", { username: "devdana" });
    const o = await commit("create_offer", offerArgs);
    expect(o.creator_brief).toMatch(/#ad/);
    expect(o.creator_brief).toMatch(/paid-partnership/);
  });
  it("rejects non-X post urls and invalid input", async () => {
    const id = await acceptedDeal();
    expect((await call("verify_deal_post", { deal_id: id, post: "https://evil.example/a/status/1" })).text).toMatch(/x.com/);
    expect((await call("create_offer", { ...offerArgs, amount: -5 })).isError).toBe(true);
    expect((await call("get_deal", { deal_id: "../../etc" })).isError).toBe(true);
  });
});
