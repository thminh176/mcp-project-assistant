import path from 'node:path';
import { lstat, realpath, readdir, readFile } from 'node:fs/promises';
import type { Workspace } from './config.js';
import { ReadBudget, DeadlineError } from './budget.js';

const blocked = /^(?:\.git|node_modules|dist|coverage|\.next|\.nuxt|\.turbo|\.venv|__pycache__|\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.docker|\.env.*|\.npmrc|\.pypirc|\.netrc|credentials.*|secrets?(?:\..*)?|service[-_]account.*|id_rsa.*|id_ed25519.*)$/i;
const extension = /\.(?:pem|key|p12|pfx|jks|keystore)$/i;
export class Guard {
  constructor(readonly workspace: Workspace) {}
  normalize(input: string): string {
    if (!input || input.length > 512 || /[\x00-\x1f:*?"<>|]/.test(input) || path.isAbsolute(input)) throw new Error('Invalid relative path');
    const pieces = input.replaceAll('\\', '/').split('/');
    if (pieces.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Unsafe path component');
    const normalized = pieces.join('/');
    if (pieces.some(p => blocked.test(p) || extension.test(p)) || this.workspace.denyPaths.some(p => this.matches(normalized, p))) throw new Error('Path denied');
    return normalized;
  }
  private matches(file: string, rule: string) {
    const r = rule.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
    return file.toLowerCase() === r || file.toLowerCase().startsWith(r + '/');
  }
  async resolve(input: string, allowMissing = false, budget = new ReadBudget()): Promise<string> {
    const relative = this.normalize(input);
    let current = this.workspace.root;
    // Reject junctions/symlinks instead of following them, including internal links.
    if (await budget.wait(realpath(current)) !== this.workspace.root) throw new Error('Workspace root changed');
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      try {
        budget.check();
        const stat = await budget.wait(lstat(current));
        if (stat.isSymbolicLink() || stat.nlink > 1 && stat.isFile()) throw new Error('Links are denied');
        const real = await budget.wait(realpath(current));
        const rel = path.relative(this.workspace.root, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path escapes workspace');
      } catch (error) {
        if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
    }
    return current;
  }
  writable(input: string) {
    const normalized = this.normalize(input);
    if (!this.workspace.writable) throw new Error('Workspace is read-only');
    if (this.workspace.protectedPaths.some(p => this.matches(normalized, p))) throw new Error('Path is protected from editing');
  }
  async read(input: string, budget = new ReadBudget()) {
    const file = await this.resolve(input, false, budget);
    const stat = await budget.wait(lstat(file));
    if (!stat.isFile() || stat.size > 512 * 1024) throw new Error('Expected text file under 512 KiB');
    const bytes = await budget.wait(readFile(file));
    if (bytes.length > 512 * 1024) throw new Error('File grew beyond size limit');
    if (bytes.includes(0)) throw new Error('Binary file denied');
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new Error('File must contain valid UTF-8'); }
  }
  async files(maxFiles = 2000, budget = new ReadBudget()): Promise<{ files: string[]; truncated: boolean }> {
    const files: string[] = [];
    let visited = 0;
    let truncated = false;
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 12) { truncated = true; return; }
      budget.check();
      const entries = await budget.wait(readdir(dir ? await this.resolve(dir, false, budget) : this.workspace.root, { withFileTypes: true }));
      for (const e of entries.sort((a,b) => a.name.localeCompare(b.name))) {
        if (++visited > 10000 || files.length >= maxFiles) { truncated = true; return; }
        const rel = dir ? `${dir}/${e.name}` : e.name;
        budget.check();
        try { await this.resolve(rel, false, budget); } catch (error) { if (error instanceof DeadlineError) throw error; continue; }
        if (e.isDirectory()) await walk(rel, depth + 1);
        else if (e.isFile()) files.push(rel);
      }
    };
    await walk('', 0);
    return { files, truncated };
  }
}
