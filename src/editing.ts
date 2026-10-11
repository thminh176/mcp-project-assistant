import { randomBytes, createHash } from 'node:crypto';
import { open, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { applyPatch, parsePatch, createTwoFilesPatch } from 'diff';
import { Guard } from './security.js';

export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
type Proposal = { file: string; before: string | null; after: string; expires: number };
export class Editor {
  private proposals = new Map<string, Proposal>();
  constructor(private guard: Guard) {}
  async preview(file: string, mode: 'create' | 'replace' | 'patch', content: string, expectedHash?: string) {
    this.guard.writable(file);
    await this.guard.resolve(file, true);
    let before: string | null = null;
    try { before = await this.guard.read(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (mode === 'create' && before !== null) throw new Error('File already exists');
    if (mode !== 'create' && (before === null || !expectedHash || hash(before) !== expectedHash)) throw new Error('Expected hash does not match');
    let after = content;
    if (mode === 'patch') {
      const patches = parsePatch(content);
      if (patches.length !== 1) throw new Error('Patch must contain exactly one file');
      const p = patches[0]!;
      const clean = (s?: string) => s?.replace(/^[ab]\//, '');
      if (clean(p.oldFileName) !== file || clean(p.newFileName) !== file) throw new Error('Patch paths must match the target');
      const originalLines = before!.split('\n');
      if (before!.endsWith('\n')) originalLines.pop();
      let end = 0;
      let delta = 0;
      for (const hunk of p.hunks) {
        // parsePatch normalizes even zero-length insertion/deletion starts to 1-based.
        let position = hunk.oldStart - 1;
        const newPosition = hunk.newStart - 1;
        if (newPosition !== position + delta) throw new Error('Inconsistent patch line coordinates');
        if (position < end || position < 0 || position > originalLines.length) throw new Error('Invalid patch hunk position');
        for (const line of hunk.lines) {
          if (line.startsWith(' ') || line.startsWith('-')) {
            if (originalLines[position] !== line.slice(1)) throw new Error('Patch must match at the declared line position');
            position++;
          }
        }
        end = position;
        delta += hunk.newLines - hunk.oldLines;
      }
      const result = applyPatch(before!, p, { fuzzFactor: 0 });
      if (result === false) throw new Error('Patch does not apply exactly');
      after = result;
    }
    if (Buffer.byteLength(after) > 512 * 1024 || after.includes('\0') || Buffer.from(after).toString('utf8') !== after) throw new Error('Invalid UTF-8 text or size');
    for (const [key, p] of this.proposals) if (p.expires < Date.now()) this.proposals.delete(key);
    if (this.proposals.size >= 100) throw new Error('Too many pending previews');
    const token = randomBytes(24).toString('hex');
    this.proposals.set(token, { file, before, after, expires: Date.now() + 300000 });
    return { token, expiresInSeconds: 300, diff: createTwoFilesPatch(file, file, before ?? '', after), sha256: hash(after) };
  }
  async apply(token: string) {
    const p = this.proposals.get(token);
    this.proposals.delete(token);
    if (!p || p.expires < Date.now()) throw new Error('Invalid or expired preview token');
    this.guard.writable(p.file);
    const target = await this.guard.resolve(p.file, true);
    let current: string | null = null;
    try { current = await this.guard.read(p.file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current !== p.before) throw new Error('File changed since preview');
    await mkdir(path.dirname(target), { recursive: true });
    await this.guard.resolve(p.file, true);
    if (p.before === null) {
      const handle = await open(target, 'wx');
      try { await handle.writeFile(p.after, 'utf8'); } finally { await handle.close(); }
    } else {
      // Update the same file object: preserve Windows ACLs and Linux/WSL mode/ownership.
      // This is intentionally not an atomic rename; callers must avoid concurrent writers.
      const handle = await open(target, 'r+');
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink > 1) throw new Error('Unsafe file object');
        const bytes = await handle.readFile();
        if (!bytes.equals(Buffer.from(p.before))) throw new Error('Concurrent file change');
        const next = Buffer.from(p.after);
        let written = 0;
        while (written < next.length) {
          const result = await handle.write(next, written, next.length - written, written);
          if (!result.bytesWritten) throw new Error('Incomplete file write');
          written += result.bytesWritten;
        }
        await handle.truncate(next.length);
        await handle.sync();
      } finally { await handle.close(); }
    }
    return { file: p.file, sha256: hash(p.after), applied: true };
  }
}
