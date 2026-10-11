#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadWorkspace } from './config.js';
import { Context } from './context.js';
import { createServer } from './server.js';
import { startHttp } from './http.js';
try {
  const { values } = parseArgs({ options: { help: { type: 'boolean' }, config: { type: 'string' }, workspace: { type: 'string' }, transport: { type: 'string', default: 'stdio' }, port: { type: 'string', default: '8787' } } });
  if (values.help) {
    console.log('mcp-project-assistant --config <absolute-config-path> --workspace <id> [--transport stdio|http] [--port 8787]');
    process.exit(0);
  }
  if (!values.config || !values.workspace) throw new Error('--config and --workspace are required');
  const ctx = new Context(await loadWorkspace(values.config, values.workspace));
  if (values.transport === 'stdio') serveStdio(() => createServer(ctx));
  else if (values.transport === 'http') {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
    const server = startHttp(ctx, port, process.env.MCP_HTTP_TOKEN ?? '');
    server.on('error', () => { console.error('HTTP startup failed'); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
    console.error(`MCP HTTP listening on loopback port ${port}; workspace=${ctx.workspace.id}`);
  } else throw new Error('Transport must be stdio or http');
} catch (error) { console.error((error as NodeJS.ErrnoException).code ? 'Startup failed: file or configuration unavailable' : (error as Error).message); process.exitCode = 1; }
