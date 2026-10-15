#!/usr/bin/env node
import { startHttpServer } from "./http.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const server = startHttpServer(port, host);
server.on("listening", () => {
  console.error(`MCP Streamable HTTP server listening on http://${host}:${port}/mcp`);
});
