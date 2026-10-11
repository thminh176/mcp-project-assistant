import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { run } from './process.js';

export function wslLocation(root: string): { distro: string; linuxRoot: string } | undefined {
  if (process.platform !== 'win32') return undefined;
  const match = /^\/\/(?:wsl\.localhost|wsl\$)\/([a-zA-Z0-9._-]+)(\/.*)$/i.exec(root.replaceAll('\\', '/'));
  return match ? { distro: match[1]!, linuxRoot: match[2]! } : undefined;
}
export async function gitDiff(root: string, file: string, staged: boolean) {
  const wsl = wslLocation(root);
  const execute = (args: string[]) => wsl
    ? run(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe'),
      ['--distribution', wsl.distro, '--exec', '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin',
        'GIT_CONFIG_NOSYSTEM=1', 'GIT_CONFIG_GLOBAL=/dev/null', 'GIT_TERMINAL_PROMPT=0', 'GIT_OPTIONAL_LOCKS=0',
        '/usr/bin/git', '-C', wsl.linuxRoot, '-c', 'core.fsmonitor=false', ...args], root)
    : run('git', ['-C', root, '-c', 'core.fsmonitor=false', ...args], root);
  const repo = await execute(['rev-parse', '--show-toplevel']);
  if (repo.exitCode !== 0) throw new Error('Cannot inspect Git repository with selected runtime');
  const top = repo.output.trim();
  const matches = wsl ? top === wsl.linuxRoot : await realpath(top) === root;
  if (!matches) throw new Error('Workspace must be the Git repository root');
  return execute(['--no-pager', '-c', 'diff.external=', 'diff', '--no-ext-diff', '--no-textconv',
    '--no-renames', ...(staged ? ['--cached'] : []), '--', `:(literal)${file}`]);
}
