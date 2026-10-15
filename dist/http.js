import { createServer as createHttpServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
const MAX_BODY_BYTES = 1_000_000;
function jsonError(res, status, message, headers = {}) {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}
function authorized(req) {
    const token = process.env.MCP_AUTH_TOKEN;
    if (!token)
        return true;
    const header = req.headers.authorization ?? "";
    const expected = Buffer.from(`Bearer ${token}`);
    const got = Buffer.from(header);
    return got.length === expected.length && timingSafeEqual(got, expected);
}
async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES)
            throw Object.assign(new Error("Request body too large"), { status: 413 });
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch {
        throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
    }
}
/** Stateless Streamable HTTP handler: one MCP server + transport per request. */
export async function handleMcp(req, res) {
    if (!authorized(req))
        return jsonError(res, 401, "Unauthorized", { "www-authenticate": "Bearer" });
    if (req.method !== "POST")
        return jsonError(res, 405, "Method not allowed (stateless server: use POST)", { allow: "POST" });
    let body;
    try {
        body = await readBody(req);
    }
    catch (e) {
        const err = e;
        return jsonError(res, err.status ?? 400, err.message);
    }
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
        void transport.close();
        void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
}
export function startHttpServer(port, host) {
    const httpServer = createHttpServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/health") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        if (url.pathname !== "/mcp")
            return jsonError(res, 404, "Not found. MCP endpoint is /mcp");
        handleMcp(req, res).catch((e) => {
            if (!res.headersSent)
                jsonError(res, 500, e instanceof Error ? e.message : "Internal error");
        });
    });
    httpServer.listen(port, host);
    return httpServer;
}
