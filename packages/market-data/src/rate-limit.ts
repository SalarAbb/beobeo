/**
 * Deadline for one provider HTTP call, body included. Calls are serialized by
 * the throttle, so a request that never answers used to hold the queue and
 * stall every price read behind it for minutes (a dashboard load took 10.7min).
 * A timeout is an ordinary provider failure: next provider, then the 5-minute
 * backoff, and reads serve what the DB already has.
 */
export const PROVIDER_TIMEOUT_MS = 20_000;

export function providerSignal(): AbortSignal {
  return AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
}

/**
 * Minimal per-provider throttle: calls start in order, at least
 * `minIntervalMs` apart, with at most `concurrency` in flight (default 1 =
 * fully serialized). Free-tier APIs are generous enough that this plus DB
 * caching keeps us well under limits; their caps count requests, not how
 * many overlap.
 */
export class Throttle {
  private last = 0;
  private active = 0;
  private freed: (() => void)[] = [];
  private gate: Promise<void> = Promise.resolve();

  constructor(
    private readonly minIntervalMs: number,
    private readonly concurrency = 1,
  ) {}

  /** `bypass` is asked when a call's turn comes: true runs it at once without
   *  a slot or the interval (a call that will fail without a request, e.g.
   *  while the provider is rate limiting us). */
  run<T>(fn: () => Promise<T>, bypass?: () => boolean): Promise<T> {
    let slot = false;
    const start = this.gate.then(async () => {
      if (bypass?.()) return;
      slot = true;
      while (this.active >= this.concurrency) {
        await new Promise<void>((r) => this.freed.push(r));
      }
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      this.active++;
    });
    this.gate = start;
    return start.then(fn).finally(() => {
      if (!slot) return;
      this.active--;
      this.freed.shift()?.();
    });
  }
}
