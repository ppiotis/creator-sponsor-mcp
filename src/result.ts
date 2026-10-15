import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export class UserError extends Error {}

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
}

/** Wrap a tool implementation so thrown errors become clean MCP tool errors. */
export function safe<A>(fn: (args: A) => unknown | Promise<unknown>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      if (e instanceof UserError) return fail(e.message);
      return fail(e instanceof Error ? e.message : String(e));
    }
  };
}
