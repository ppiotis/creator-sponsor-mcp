import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const FIXTURES = path.resolve("fixtures/demo.json");
export function makeSandbox(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "creator-sponsor-"));
  return { dir, file: path.join(dir, "data.json") };
}
export function removeSandbox(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}
