import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, symlink, realpath, link, stat, chmod } from 'node:fs/promises';
import path from 'node:path';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Context } from '../src/context.js';
import { loadWorkspace, configSchema } from '../src/config.js';
import { startHttp } from '../src/http.js';
import { hash } from '../src/editing.js';
import { run } from '../src/process.js';
import { wslLocation } from '../src/git.js';
import { ReadBudget, DeadlineError } from '../src/budget.js';

// All mutations stay under this independent MCP project, never application workspaces.
test('default configuration and every example workspace are read-only without verification', async () => {
  const minimal = configSchema.parse({ workspaces: [{ id: 'minimal', root: 'C:/Code/example' }] });
  assert.equal(minimal.workspaces[0]!.writable, false);
  assert.deepEqual(minimal.workspaces[0]!.verification, {});
  const example = configSchema.parse(JSON.parse(await readFile('config/workspaces.example.json', 'utf8')));
  for (const workspace of example.workspaces) {
    assert.equal(workspace.writable, false);
    assert.deepEqual(workspace.verification, {});
  }
});
async function fixture() {
  await mkdir('.test-runs', { recursive: true });
  const base = await mkdtemp(path.resolve('.test-runs/run-'));
  const root = path.join(base, 'a'); const other = path.join(base, 'b');
  await mkdir(root); await mkdir(other);
  await writeFile(path.join(root, 'hello.ts'), 'export const hello = 1;\n');
  await writeFile(path.join(root, '.env'), 'TOP_SECRET=value');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { zod: '^4' } }));
  await writeFile(path.join(other, 'private.ts'), 'OTHER_PROJECT');
  await link(path.join(other, 'private.ts'), path.join(root, 'hardlink.ts'));
  await symlink(other, path.join(root, 'junction'), process.platform === 'win32' ? 'junction' : 'dir');
  const configFile = path.join(base, 'workspaces.json');
  const tasks = Object.fromEntries(['lint', 'typecheck', 'test', 'build'].map(task => [task, { executable: process.execPath, args: ['-e', `console.log('${task} verified')`], timeoutMs: 1000 }]));
  await writeFile(configFile, JSON.stringify({ workspaces: [
    { id: 'a', root, writable: true, verification: tasks }, { id: 'b', root: other }
  ] }));
  return { root, base, configFile, ctx: new Context(await loadWorkspace(configFile, 'a')) };
}
function decode(result: Awaited<ReturnType<Client['callTool']>>) {
  const blocks = result.content as { type: string; text: string }[];
  return JSON.parse(blocks[0]!.text);
}
test('stdio MCP lifecycle and all tools, isolation, edits and allowlist', async () => {
  const f = await fixture();
  const client = new Client({ name: 'integration-tests', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js', '--config', f.configFile, '--workspace', 'a'], stderr: 'pipe' });
  await client.connect(transport);
  try {
    const listing = await client.listTools(); assert.equal(listing.tools.length, 9);
    const call = (name: string, args = {}) => client.callTool({ name, arguments: args });
    assert.equal(decode(await call('workspace_info')).id, 'a');
    const structure = decode(await call('project_structure'));
    assert.ok(structure.files.includes('hello.ts'));
    const limited = decode(await call('project_structure', { maxFiles: 1 }));
    assert.equal(limited.files.length, 1); assert.equal(limited.truncated, true);
    assert.ok(!structure.files.some((p: string) => /env|junction|private|hardlink/.test(p)));
    for (const p of ['../b/private.ts', '..\\b\\private.ts', f.root, 'hello.ts:stream', 'CON', 'hello.ts.', '.env', '.git/config', 'junction/private.ts', 'hardlink.ts', 'C:hello.ts', '\\\\server\\share']) {
      assert.equal((await call('read_file', { path: p })).isError, true, p);
      assert.equal((await call('preview_edit', { path: p, mode: 'create', content: 'bad' })).isError, true, p);
    }
    assert.equal((await call('read_file', { path: 'hello.ts', workspace: 'b' })).isError, true);
    const read = decode(await call('read_file', { path: 'hello.ts' })); assert.equal(read.sha256, hash('export const hello = 1;\n'));
    assert.equal(decode(await call('search_code', { query: 'hello' })).matches.length, 1);
    assert.equal(decode(await call('analyze_dependencies')).groups.dependencies.zod, '^4');
    assert.equal((await call('preview_edit', { path: 'package.json', mode: 'replace', content: '{}', expectedHash: hash('{}') })).isError, true);
    const preview = decode(await call('preview_edit', { path: 'new.ts', mode: 'create', content: 'const x = 1;\n' }));
    assert.equal((await call('read_file', { path: 'new.ts' })).isError, true);
    assert.equal(decode(await call('apply_edit', { token: preview.token })).applied, true);
    assert.equal((await call('apply_edit', { token: preview.token })).isError, true);
    const replace = decode(await call('preview_edit', { path: 'new.ts', mode: 'replace', content: 'const x = 2;\n', expectedHash: hash('const x = 1;\n') }));
    await call('apply_edit', { token: replace.token });
    const patch = '--- a/new.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-const x = 2;\n+const x = 3;\n';
    const patched = decode(await call('preview_edit', { path: 'new.ts', mode: 'patch', content: patch, expectedHash: hash('const x = 2;\n') }));
    await call('apply_edit', { token: patched.token });
    assert.equal(await readFile(path.join(f.root, 'new.ts'), 'utf8'), 'const x = 3;\n');
    assert.equal((await call('preview_edit', { path: 'new.ts', mode: 'patch', content: patch.replaceAll('new.ts', '../evil.ts'), expectedHash: hash('const x = 3;\n') })).isError, true);
    const stale = decode(await call('preview_edit', { path: 'new.ts', mode: 'replace', content: 'next', expectedHash: hash('const x = 3;\n') }));
    await writeFile(path.join(f.root, 'new.ts'), 'external change');
    assert.equal((await call('apply_edit', { token: stale.token })).isError, true);
    for (const task of ['lint', 'typecheck', 'test', 'build']) assert.equal(decode(await call('run_verification', { task })).exitCode, 0);
    assert.equal((await call('run_verification', { task: 'shell' })).isError, true);
    assert.equal((await call('run_verification', { task: 'test', args: ['malicious'] })).isError, true);
    await run('git', ['init'], f.root);
    await run('git', ['add', '--', 'hello.ts', '.env'], f.root);
    await run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], f.root);
    await writeFile(path.join(f.root, 'hello.ts'), 'export const hello = 2;\n');
    assert.match(decode(await call('git_diff', { path: 'hello.ts' })).output, /hello = 2/);
    await run('git', ['add', '--', 'hello.ts'], f.root);
    assert.match(decode(await call('git_diff', { path: 'hello.ts', staged: true })).output, /hello = 2/);
    assert.equal((await call('git_diff', { path: '.env', staged: true })).isError, true);
  } finally { await client.close(); }
});
test('HTTP MCP connection with authentication, host/origin checks and editing', async () => {
  const f = await fixture(); const token = 'a'.repeat(48);
  const server = startHttp(f.ctx, 0, token);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/mcp`;
  const client = new Client({ name: 'http-test', version: '1' });
  try {
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end('{}');
    });
    assert.equal(badHost, 403);
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    assert.equal((await client.listTools()).tools.length, 9);
    const preview = decode(await client.callTool({ name: 'preview_edit', arguments: { path: 'http.ts', mode: 'create', content: 'hello' } }));
    assert.equal(decode(await client.callTool({ name: 'apply_edit', arguments: { token: preview.token } })).applied, true);
  } finally { await client.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('read-only, custom denylist, missing allowlist and invalid workspace fail closed', async () => {
  const f = await fixture();
  const readonly = new Context({ ...f.ctx.workspace, writable: false, denyPaths: ['hello.ts'] });
  await assert.rejects(readonly.guard.read('hello.ts'), /denied/);
  await assert.rejects(readonly.editor.preview('new.ts', 'create', 'x'), /read-only/);
  await assert.rejects(loadWorkspace(f.configFile, 'unconfigured'), /not configured/);
  assert.equal((await loadWorkspace(f.configFile, 'b')).verification.test, undefined);
  assert.equal(await realpath(f.root), f.ctx.workspace.root);
  await writeFile(f.configFile, JSON.stringify({ workspaces: [{ id: 'unsafe', root: f.root, verification: { test: { executable: process.platform === 'win32' ? 'C:/Windows/System32/cmd.exe' : '/bin/sh', args: ['bad'] } } }] }));
  await assert.rejects(loadWorkspace(f.configFile, 'unsafe'), /Shell interpreters/);
});
test('process timeout and output limit terminate verification', async () => {
  const f = await fixture();
  assert.equal((await run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], f.root, 100)).timedOut, true);
  const bounded = await run(process.execPath, ['-e', "process.stdout.write('x'.repeat(100000))"], f.root);
  assert.equal(bounded.truncated, true); assert.ok(bounded.output.length <= 64000);
});
test('disabled verification is rejected through MCP', async () => {
  const f = await fixture();
  const client = new Client({ name: 'readonly-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js', '--config', f.configFile, '--workspace', 'b'], stderr: 'pipe' }));
  try {
    assert.equal((await client.callTool({ name: 'run_verification', arguments: { task: 'test' } })).isError, true);
    assert.equal((await client.callTool({ name: 'preview_edit', arguments: { path: 'new.ts', mode: 'create', content: 'x' } })).isError, true);
    assert.equal((await client.callTool({ name: 'read_file', arguments: { path: 'hello.ts' } })).isError, true);
  } finally { await client.close(); }
});
test('preview expiry and creation conflict leave current file unchanged', async () => {
  const f = await fixture();
  const preview = await f.ctx.editor.preview('expiry.ts', 'create', 'x');
  const now = Date.now;
  Date.now = () => now() + 301000;
  try { await assert.rejects(f.ctx.editor.apply(preview.token), /expired/); } finally { Date.now = now; }
  const conflict = await f.ctx.editor.preview('conflict.ts', 'create', 'x');
  await writeFile(path.join(f.root, 'conflict.ts'), 'keep me');
  await assert.rejects(f.ctx.editor.apply(conflict.token), /changed/);
  assert.equal(await readFile(path.join(f.root, 'conflict.ts'), 'utf8'), 'keep me');
});
test('PowerShell startup script serves MCP on Windows', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  const client = new Client({ name: 'powershell-test', version: '1' });
  await client.connect(new StdioClientTransport({
    command: `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/Start-Mcp.ps1'), '-Workspace', 'a', '-Config', f.configFile], stderr: 'pipe'
  }));
  try { assert.equal(decode(await client.callTool({ name: 'workspace_info', arguments: {} })).id, 'a'); }
  finally { await client.close(); }
});
test('WSL runtime mapping accepts only configured WSL UNC roots', { skip: process.platform !== 'win32' }, () => {
  const expected = { distro: 'Ubuntu', linuxRoot: '/home/developer/projects/sample-project' };
  assert.deepEqual(wslLocation('\\\\wsl.localhost\\Ubuntu\\home\\developer\\projects\\sample-project'), expected);
  assert.deepEqual(wslLocation('//wsl$/Ubuntu/home/developer/projects/sample-project'), expected);
  assert.equal(wslLocation('//other-server/Ubuntu/home/project'), undefined);
  assert.equal(wslLocation('//wsl.localhost/Ubuntu;bad/home/project'), undefined);
  assert.equal(wslLocation('C:/Code/project'), undefined);
});
test('invalid UTF-8 rejected before editing; BOM and valid bytes round trip', async () => {
  const f = await fixture();
  const target = path.join(f.root, 'invalid.ts');
  const invalid = Buffer.from([0xff, 0x61]); await writeFile(target, invalid);
  await assert.rejects(f.ctx.guard.read('invalid.ts'), /valid UTF-8/);
  await assert.rejects(f.ctx.editor.preview('invalid.ts', 'replace', 'new', hash('�a')), /valid UTF-8/);
  assert.deepEqual(await readFile(target), invalid);
  await assert.rejects(f.ctx.editor.preview('surrogate.ts', 'create', '\ud800'), /Invalid UTF-8/);
  const original = '\ufeffconst text = "Việt";\r\n';
  await writeFile(path.join(f.root, 'bom.ts'), original);
  assert.equal(await f.ctx.guard.read('bom.ts'), original);
  const preview = await f.ctx.editor.preview('bom.ts', 'replace', original, hash(original));
  await f.ctx.editor.apply(preview.token);
  assert.deepEqual(await readFile(path.join(f.root, 'bom.ts')), Buffer.from(original));
});
test('patch rejects relocated context and accepts declared positions, insertions and multiple hunks', async () => {
  const f = await fixture(); const original = 'header\nold\nmiddle\nlast\n';
  await writeFile(path.join(f.root, 'patch.ts'), original);
  const misplaced = '--- a/patch.ts\n+++ b/patch.ts\n@@ -1 +1 @@\n-old\n+new\n';
  await assert.rejects(f.ctx.editor.preview('patch.ts', 'patch', misplaced, hash(original)), /declared line/);
  await assert.rejects(f.ctx.editor.preview('patch.ts', 'patch', misplaced.replace('@@ -1 +1 @@', '@@ -2 +20 @@'), hash(original)), /coordinates/);
  const exact = '--- a/patch.ts\n+++ b/patch.ts\n@@ -2 +2 @@\n-old\n+new\n@@ -4 +4 @@\n-last\n+end\n';
  await f.ctx.editor.apply((await f.ctx.editor.preview('patch.ts', 'patch', exact, hash(original))).token);
  const next = 'header\nnew\nmiddle\nend\n'; assert.equal(await f.ctx.guard.read('patch.ts'), next);
  const insert = '--- a/patch.ts\n+++ b/patch.ts\n@@ -0,0 +1 @@\n+intro\n';
  await f.ctx.editor.apply((await f.ctx.editor.preview('patch.ts', 'patch', insert, hash(next))).token);
  assert.equal(await f.ctx.guard.read('patch.ts'), 'intro\n' + next);
  await writeFile(path.join(f.root, 'no-newline.ts'), 'old');
  const eofPatch = '--- a/no-newline.ts\n+++ b/no-newline.ts\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n';
  await f.ctx.editor.apply((await f.ctx.editor.preview('no-newline.ts', 'patch', eofPatch, hash('old'))).token);
  assert.equal(await f.ctx.guard.read('no-newline.ts'), 'new');
});
test('replacement preserves file identity and permissions while shortening contents', async () => {
  const f = await fixture(); const target = path.join(f.root, 'permissions.ts');
  await writeFile(target, 'original long contents\n');
  if (process.platform !== 'win32') await chmod(target, 0o750);
  const before = await stat(target);
  await f.ctx.editor.apply((await f.ctx.editor.preview('permissions.ts', 'replace', 'new', hash('original long contents\n'))).token);
  const after = await stat(target);
  assert.equal(after.ino, before.ino); assert.equal(after.mode, before.mode); assert.equal(after.uid, before.uid); assert.equal(after.gid, before.gid);
  assert.equal(await readFile(target, 'utf8'), 'new');
});
test('read timeout releases queue and guard fails closed for expired traversal', async () => {
  const f = await fixture();
  const first = f.ctx.exclusive(() => new ReadBudget(10).wait(new Promise<never>(() => {})));
  const next = f.ctx.exclusive(async () => 'queue released');
  await assert.rejects(first, DeadlineError);
  assert.equal(await next, 'queue released');
  await assert.rejects(f.ctx.guard.files(10, new ReadBudget(0)), DeadlineError);
  await assert.rejects(f.ctx.guard.read('hello.ts', new ReadBudget(0)), DeadlineError);
});
