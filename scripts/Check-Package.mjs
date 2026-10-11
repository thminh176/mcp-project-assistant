import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const entry = process.argv[2];
if (!entry) throw new Error('Usage: node scripts/Check-Package.mjs <installed-dist/index.js>');
await mkdir('.release-check', { recursive: true });
const root = await mkdtemp(path.resolve('.release-check/package-workspace-'));
await writeFile(path.join(root, 'source.ts'), 'export const ready = true;\n');
const config = path.join(root, 'workspace.json');
await writeFile(config, JSON.stringify({ workspaces: [{ id: 'package-test', root, denyPaths: ['workspace.json'] }] }));
const client = new Client({ name: 'package-check', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath,
  args: [path.resolve(entry), '--config', config, '--workspace', 'package-test'], stderr: 'pipe' }));
try {
  const tools = await client.listTools(); assert.equal(tools.tools.length, 9);
  const read = await client.callTool({ name: 'read_file', arguments: { path: 'source.ts' } });
  assert.ok(!read.isError);
  const denied = await client.callTool({ name: 'preview_edit', arguments: { path: 'never-created.ts', mode: 'create', content: 'x' } });
  assert.equal(denied.isError, true);
  assert.equal(await readFile(path.join(root, 'source.ts'), 'utf8'), 'export const ready = true;\n');
  console.log('Installed package MCP handshake, 9 tools, read and read-only guard: passed');
} finally { await client.close(); }
