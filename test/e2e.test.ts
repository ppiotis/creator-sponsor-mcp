import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { cases, e2eEnv, setupE2E, teardownE2E, expectedTools } from "./e2e-cases.js";

type Text = { type: string; text: string };

async function runCases(client: Client) {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual([...expectedTools].sort());
  for (const c of cases) {
    const res = await client.callTool({ name: c.tool, arguments: c.args(ctx) });
    const text = (res.content as Text[]).map((x) => x.text).join("\n");
    expect(Boolean(res.isError), `${c.tool}: ${text}`).toBe(Boolean(c.isError));
    c.check?.(text, ctx);
  }
}

const ctx: Record<string, unknown> = {};

describe("e2e over MCP", () => {
  let env: Record<string, string>;
  let http: ChildProcess | undefined;
  beforeAll(async () => {
    env = { ...(process.env as Record<string, string>), ...(await setupE2E()), ...e2eEnv };
  });
  afterAll(async () => {
    http?.kill();
    await teardownE2E();
  });

  it("stdio transport: lists and calls every tool", async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/stdio.js"], env });
    const client = new Client({ name: "e2e", version: "1.0.0" });
    await client.connect(transport);
    try {
      await runCases(client);
    } finally {
      await client.close();
    }
  }, 60_000);

  it("Streamable HTTP transport: lists and calls every tool", async () => {
    const port = 39000 + Math.floor(Math.random() * 1000);
    http = spawn(process.execPath, ["dist/serve-http.js"], { env: { ...env, PORT: String(port), MCP_AUTH_TOKEN: "test-token" }, stdio: ["ignore", "ignore", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      http!.stderr!.on("data", (d) => String(d).includes("listening") && resolve());
      http!.on("exit", (code) => reject(new Error(`http server exited ${code}`)));
    });
    const base = `http://127.0.0.1:${port}`;
    const unauth = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    expect(unauth.status).toBe(401);
    expect((await fetch(`${base}/health`)).status).toBe(200);
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: "Bearer test-token" } },
    });
    const client = new Client({ name: "e2e", version: "1.0.0" });
    await client.connect(transport);
    try {
      await runCases(client);
    } finally {
      await client.close();
    }
  }, 60_000);
});
