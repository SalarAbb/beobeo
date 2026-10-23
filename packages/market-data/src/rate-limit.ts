/**
 * Minimal per-provider throttle: serializes calls and enforces a minimum
 * interval between them. Free-tier APIs are generous enough that this plus
 * DB caching keeps us well under limits.
 */
export class Throttle {
  private last = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly minIntervalMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
