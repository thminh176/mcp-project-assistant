export class DeadlineError extends Error {
  constructor() { super('Source operation timed out; narrow the query or check workspace connectivity'); }
}
/** Read-only operations may release their queue slot on timeout; no mutations use this race. */
export class ReadBudget {
  private readonly deadline: number;
  constructor(timeoutMs = 10000) { this.deadline = Date.now() + timeoutMs; }
  check() { if (Date.now() >= this.deadline) throw new DeadlineError(); }
  async wait<T>(operation: Promise<T>): Promise<T> {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) {
      void operation.catch(() => undefined);
      throw new DeadlineError();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeadlineError()), Math.max(0, remaining));
      })]);
    } finally { clearTimeout(timer); }
  }
}
