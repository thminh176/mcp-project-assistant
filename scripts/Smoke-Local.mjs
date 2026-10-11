import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [config, workspace] = process.argv.slice(2);
if (!config || !workspace) throw new Error('Usage: node scripts/Smoke-Local.mjs <config> <workspace>');
const client = new Client({ name: 'local-workspace-smoke', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath,
  args: [path.join(project, 'dist/index.js'), '--config', path.resolve(config), '--workspace', workspace], stderr: 'pipe' }));
const call = (name, args = {}) => client.callTool({ name, arguments: args });
const decode = result => JSON.parse(result.content[0].text);
try {
  const info = decode(await call('workspace_info'));
  if (info.writable || info.verification.length) throw new Error('Smoke check requires read-only workspace without verification');
  console.log('workspace_info: read-only, no verification');
  const structure = await call('project_structure', { maxFiles: 20 });
  if (structure.isError) throw new Error('Structure failed: ' + structure.content[0].text);
  const listing = decode(structure);
  console.log(`project_structure: ${listing.files.length} permitted files, truncated=${listing.truncated}`);
  const file = 'package.json';
  if (!file) throw new Error('No text file available for smoke check');
  const read = await call('read_file', { path: file, maxLines: 1 });
  if (read.isError) throw new Error('read_file failed: ' + read.content[0].text);
  console.log(`read_file: ${file}, SHA-256 returned; source content omitted`);
  for (const target of ['.env', '../recovery/package.json']) {
    if (!(await call('read_file', { path: target })).isError) throw new Error('Guard failed');
  }
  if (!(await call('preview_edit', { path: 'mcp-smoke-never-created.txt', mode: 'create', content: 'x' })).isError) throw new Error('Write guard failed');
  if (!(await call('run_verification', { task: 'test' })).isError) throw new Error('Verification guard failed');
  console.log('secrets, traversal, editing, verification: rejected');
  const git = await call('git_diff', { path: file });
  if (git.isError) throw new Error('git_diff failed: ' + git.content[0].text);
  const diff = decode(git);
  if (diff.exitCode !== 0) throw new Error('git_diff process failed: ' + diff.output);
  console.log('git_diff: successful; diff content omitted');
} finally { await client.close(); }
