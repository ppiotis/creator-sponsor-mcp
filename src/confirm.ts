import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { UserError } from "./result.js";

const SECRET = randomBytes(32);
const TTL_MS = 10 * 60 * 1000;
const used = new Set<string>();

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function sign(tool: string, args: unknown, revision: number, exp: number): string {
  return createHmac("sha256", SECRET).update(`${tool}\n${revision}\n${exp}\n${canonical(args)}`).digest("base64url");
}

/** Token binds the exact tool, arguments and store revision; expires in 10 minutes; single use. */
export function issueToken(tool: string, args: unknown, revision: number): string {
  const exp = Date.now() + TTL_MS;
  return `${exp}.${sign(tool, args, revision, exp)}`;
}

export function verifyToken(token: string, tool: string, args: unknown, revision: number): void {
  const [expStr, mac] = token.split(".");
  const exp = Number(expStr);
  if (!mac || !Number.isFinite(exp)) throw new UserError("Malformed confirm_token. Call the tool again without confirm_token to get a fresh preview.");
  if (used.has(token)) throw new UserError("This confirm_token was already used. Request a new preview.");
  if (Date.now() > exp) throw new UserError("confirm_token expired (10 min). Request a new preview.");
  const expected = Buffer.from(sign(tool, args, revision, exp));
  const got = Buffer.from(mac);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new UserError("confirm_token does not match these arguments or the data changed since the preview. Re-run without confirm_token and show the user the new preview.");
  }
  used.add(token);
}
