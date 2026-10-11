import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const command = z.object({
  executable: z.string(), args: z.array(z.string()).max(32),
  timeoutMs: z.number().int().min(100).max(300000).default(60000)
}).strict();
export const configSchema = z.object({
  workspaces: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]+$/), root: z.string(),
    writable: z.boolean().default(false),
    denyPaths: z.array(z.string()).default([]),
    protectedPaths: z.array(z.string()).default(['package.json', 'package-lock.json']),
    verification: z.object({ lint: command.optional(), typecheck: command.optional(),
      test: command.optional(), build: command.optional() }).strict().default({})
  }).strict()).min(1)
}).strict();
export type Workspace = z.infer<typeof configSchema>['workspaces'][number];
export async function loadWorkspace(configFile: string, selected: string): Promise<Workspace> {
  const config = configSchema.parse(JSON.parse(await readFile(configFile, 'utf8')));
  if (new Set(config.workspaces.map(w => w.id)).size !== config.workspaces.length) throw new Error('Duplicate workspace id');
  const workspace = config.workspaces.find(w => w.id === selected);
  if (!workspace) throw new Error('Selected workspace is not configured');
  if (!path.isAbsolute(workspace.root)) throw new Error('Workspace root must be absolute');
  for (const c of Object.values(workspace.verification)) {
    if (!path.isAbsolute(c.executable) || !/\.(exe)$/i.test(c.executable) && process.platform === 'win32')
      throw new Error('Verification executable must be an absolute native executable');
    if (/(?:^|[/\\])(cmd|powershell|pwsh|wscript|cscript|bash|sh)(?:\.exe)?$/i.test(c.executable))
      throw new Error('Shell interpreters are not allowed');
  }
  return { ...workspace, root: await realpath(workspace.root) };
}
