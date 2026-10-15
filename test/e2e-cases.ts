import { expect } from "vitest";
import { makeSandbox, removeSandbox, FIXTURES } from "./helpers.js";

let dir = "";
export const e2eEnv: Record<string, string> = {};
export async function setupE2E() {
  const s = makeSandbox();
  dir = s.dir;
  return { CREATOR_SPONSOR_PATH: s.file, CREATOR_SPONSOR_FIXTURES: FIXTURES, X_BEARER_TOKEN: "" };
}
export async function teardownE2E() {
  removeSandbox(dir);
}

export const expectedTools = ["data_source_status", "analyze_creator", "list_creators", "get_creator", "match_creators", "list_deals", "get_deal", "list_payout_providers", "list_payouts", "save_creator_profile", "delete_creator", "create_offer", "respond_to_offer", "cancel_deal", "verify_deal_post", "record_payout"];

export interface Case {
  tool: string;
  args: (ctx: Record<string, unknown>) => Record<string, unknown>;
  isError?: boolean;
  check?: (text: string, ctx: Record<string, unknown>) => void;
}

const j = (t: string) => JSON.parse(t);
function write(tool: string, args: (ctx: Record<string, unknown>) => Record<string, unknown>, key: string): Case[] {
  return [
    { tool, args, check: (t, ctx) => { expect(j(t).status).toBe("preview"); ctx[`${key}_token`] = j(t).confirm_token; ctx[`${key}_args`] = args(ctx); } },
    { tool, args: (ctx) => ({ ...(ctx[`${key}_args`] as object), confirm_token: ctx[`${key}_token`] }), check: (t, ctx) => { expect(j(t).status).toBe("applied"); ctx[key] = j(t).result; } },
  ];
}
const deal = (ctx: Record<string, unknown>, k: string) => (ctx[k] as { deal_id: string }).deal_id;
const POST = "https://x.com/devdana/status/1950000000000000001";

export const cases: Case[] = [
  { tool: "data_source_status", args: () => ({}), check: (t) => expect(j(t).x_source).toBe("fixture") },
  { tool: "analyze_creator", args: () => ({ username: "devdana" }), check: (t) => expect(j(t).analysis.price_per_post.low).toBe(136) },
  ...write("save_creator_profile", () => ({ username: "devdana", payout_handle: "@devdana" }), "c1"),
  ...write("save_creator_profile", () => ({ username: "fitfelix" }), "c2"),
  { tool: "list_creators", args: () => ({}), check: (t) => expect(j(t).total).toBe(2) },
  { tool: "get_creator", args: () => ({ username: "devdana" }), check: (t) => expect(j(t).creator.payout_handle).toBe("@devdana") },
  { tool: "match_creators", args: () => ({ product: "AI agent tracer for developers", budget_per_post: { max: 300 } }), check: (t) => expect(j(t).results[0].username).toBe("devdana") },
  ...write("create_offer", () => ({ creator: "devdana", brand: "AgentLens", product: "tracer", amount: 200, must_include_link: "https://agentlens.dev/try" }), "d1"),
  ...write("respond_to_offer", (ctx) => ({ deal_id: deal(ctx, "d1"), decision: "accept" }), "acc"),
  ...write("verify_deal_post", (ctx) => ({ deal_id: deal(ctx, "d1"), post: POST }), "ver"),
  { tool: "list_payout_providers", args: () => ({}), check: (t) => expect(j(t).moves_money).toBe(false) },
  { tool: "record_payout", args: (ctx) => ({ deal_id: deal(ctx, "d1"), provider: "x_money", reference: "r" }), isError: true, check: (t) => expect(t).toMatch(/X Money/) },
  ...write("record_payout", (ctx) => ({ deal_id: deal(ctx, "d1"), reference: "TX-1" }), "pay"),
  { tool: "get_deal", args: (ctx) => ({ deal_id: deal(ctx, "d1") }), check: (t) => expect(j(t).deal.status).toBe("paid") },
  { tool: "list_payouts", args: () => ({}), check: (t) => expect(j(t).totals.USD % 200).toBe(0) },
  ...write("create_offer", () => ({ creator: "fitfelix", brand: "B", product: "p", amount: 50 }), "d2"),
  { tool: "cancel_deal", args: (ctx) => ({ deal_id: deal(ctx, "d2"), confirm_token: "123.bogus" }), isError: true, check: (t) => expect(t).toMatch(/does not match|expired/) },
  ...write("cancel_deal", (ctx) => ({ deal_id: deal(ctx, "d2") }), "can"),
  { tool: "list_deals", args: () => ({}), check: (t) => { expect(j(t).by_status.paid).toBeGreaterThanOrEqual(1); expect(j(t).by_status.cancelled).toBeGreaterThanOrEqual(1); } },
  ...write("delete_creator", () => ({ username: "fitfelix" }), "del"),
];
