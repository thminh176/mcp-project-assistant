import { createServer as createHttpServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/node';
import { createServer } from './server.js';
import type { Context } from './context.js';
export function startHttp(ctx: Context, port: number, token: string) {
  if (token.length < 32) throw new Error('MCP_HTTP_TOKEN must be at least 32 characters');
  const mcp = createMcpHandler(() => createServer(ctx));
  const handle = toNodeHandler(mcp, { maxRequestBodySize: 1024 * 1024 });
  const host = localhostHostValidation(); const origin = localhostOriginValidation();
  const server = createHttpServer((req, res) => {
    if (!host(req, res) || !origin(req, res)) return;
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    const supplied = Buffer.from(req.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401).end(); return; }
    void handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  server.listen(port, '127.0.0.1');
  return server;
}
