import { Guard } from './security.js';
import { Editor } from './editing.js';
import type { Workspace } from './config.js';
export class Context {
  readonly guard: Guard;
  readonly editor: Editor;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  constructor(readonly workspace: Workspace) {
    this.guard = new Guard(workspace); this.editor = new Editor(this.guard);
  }
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.pending >= 64) throw new Error('Server is busy');
    this.pending++;
    const result = this.tail.then(fn);
    this.tail = result.catch(() => undefined);
    try { return await result; } finally { this.pending--; }
  }
}
