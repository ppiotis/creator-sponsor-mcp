import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { UserError } from "./result.js";
import type { CreatorAnalysis, Post, Profile } from "./analysis.js";

export const DEAL_STATUSES = ["offered", "accepted", "declined", "cancelled", "verified", "paid"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export interface Creator {
  username: string; // lowercase handle, unique key
  source: "x_api" | "fixture" | "manual";
  profile: Profile;
  posts_analyzed: number;
  analysis: CreatorAnalysis;
  payout_handle?: string; // where the creator wants to be paid (e.g. X Money handle); informational only
  created_at: string;
  updated_at: string;
}

export interface Requirement {
  must_include_phrases: string[];
  must_include_link?: string;
  disclosure: string[]; // accepted disclosure markers, at least one must appear
}

export interface Verification {
  post_id: string;
  source: "x_api" | "fixture" | "manual_attestation";
  checked_at: string;
  checks: Array<{ check: string; pass: boolean; detail: string }>;
}

export interface Deal {
  id: string;
  creator_username: string;
  brand: string;
  product: string;
  amount: number;
  currency: string;
  requirement: Requirement;
  post_by?: string;
  notes?: string;
  status: DealStatus;
  history: Array<{ status: DealStatus; at: string; note?: string }>;
  verification?: Verification;
  payout_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Payout {
  id: string;
  deal_id: string;
  provider: string;
  amount: number;
  currency: string;
  reference: string;
  note?: string;
  recorded_at: string;
}

export interface Store { version: 1; revision: number; creators: Creator[]; deals: Deal[]; payouts: Payout[] }

export function storePath(): string {
  const p = process.env.CREATOR_SPONSOR_PATH ?? path.join(os.homedir(), ".creator-sponsor", "data.json");
  if (!p.endsWith(".json")) throw new UserError("CREATOR_SPONSOR_PATH must point to a .json file");
  return path.resolve(p);
}

export const emptyStore = (): Store => ({ version: 1, revision: 0, creators: [], deals: [], payouts: [] });

export async function load(): Promise<Store> {
  const p = storePath();
  if (!existsSync(p)) return emptyStore();
  let data: Store;
  try {
    data = JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    throw new UserError(`Data file at ${p} is not valid JSON. Fix or move it; nothing was changed.`);
  }
  if (data?.version !== 1 || !Array.isArray(data.creators)) throw new UserError(`Data file at ${p} has an unknown format`);
  return { ...emptyStore(), ...data };
}

let writeChain: Promise<unknown> = Promise.resolve();

/** Atomic write (temp file + rename), serialised within the process, private permissions. */
export async function save(store: Store): Promise<void> {
  const p = storePath();
  const run = async () => {
    await fs.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    const tmp = `${p}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    await fs.rename(tmp, p);
  };
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => undefined);
  await next;
}

export const newId = (prefix: string) => `${prefix}_${randomBytes(5).toString("hex")}`;
export const nowIso = () => new Date().toISOString();

export function findCreator(s: Store, username: string): Creator {
  const c = s.creators.find((x) => x.username === username.toLowerCase().replace(/^@/, ""));
  if (!c) throw new UserError(`No saved creator @${username}. Use list_creators, or analyze_creator + save_creator_profile first.`);
  return c;
}
export function findDeal(s: Store, id: string): Deal {
  const d = s.deals.find((x) => x.id === id);
  if (!d) throw new UserError(`No deal with id ${id}. Use list_deals to find ids.`);
  return d;
}
