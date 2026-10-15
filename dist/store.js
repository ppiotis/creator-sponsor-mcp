import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { UserError } from "./result.js";
export const DEAL_STATUSES = ["offered", "accepted", "declined", "cancelled", "verified", "paid"];
export function storePath() {
    const p = process.env.CREATOR_SPONSOR_PATH ?? path.join(os.homedir(), ".creator-sponsor", "data.json");
    if (!p.endsWith(".json"))
        throw new UserError("CREATOR_SPONSOR_PATH must point to a .json file");
    return path.resolve(p);
}
export const emptyStore = () => ({ version: 1, revision: 0, creators: [], deals: [], payouts: [] });
export async function load() {
    const p = storePath();
    if (!existsSync(p))
        return emptyStore();
    let data;
    try {
        data = JSON.parse(await fs.readFile(p, "utf8"));
    }
    catch {
        throw new UserError(`Data file at ${p} is not valid JSON. Fix or move it; nothing was changed.`);
    }
    if (data?.version !== 1 || !Array.isArray(data.creators))
        throw new UserError(`Data file at ${p} has an unknown format`);
    return { ...emptyStore(), ...data };
}
let writeChain = Promise.resolve();
/** Atomic write (temp file + rename), serialised within the process, private permissions. */
export async function save(store) {
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
export const newId = (prefix) => `${prefix}_${randomBytes(5).toString("hex")}`;
export const nowIso = () => new Date().toISOString();
export function findCreator(s, username) {
    const c = s.creators.find((x) => x.username === username.toLowerCase().replace(/^@/, ""));
    if (!c)
        throw new UserError(`No saved creator @${username}. Use list_creators, or analyze_creator + save_creator_profile first.`);
    return c;
}
export function findDeal(s, id) {
    const d = s.deals.find((x) => x.id === id);
    if (!d)
        throw new UserError(`No deal with id ${id}. Use list_deals to find ids.`);
    return d;
}
