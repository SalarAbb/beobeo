// The Neon HTTP driver has no request timeout: a stalled request once held a
// page for 8.6 minutes (and a Tax Center load for ~16) before failing, while
// the same query answered in about a second right after. Every query now
// gets a deadline, so a stall becomes an error the page can retry from.
// A plain read that times out is retried once: it's safe to repeat, and the
// retry is what answered fast in practice. Writes and batches never retry,
// because a timed-out write may still have committed.

export interface TimeoutOptions {
  readMs: number;
  writeMs: number;
  onTimeout?: (info: { attempt: number; read: boolean; ms: number }) => void;
}

export const DEFAULT_TIMEOUTS: TimeoutOptions = {
  readMs: 15_000,
  writeMs: 60_000,
};

/** True when the Neon request body is a single SELECT (safe to repeat). */
export function isReadOnlyQuery(body: unknown): boolean {
  if (typeof body !== "string") return false;
  try {
    const parsed = JSON.parse(body) as { query?: unknown };
    return typeof parsed.query === "string" && /^\s*select\b/i.test(parsed.query);
  } catch {
    return false;
  }
}

export function withTimeout(
  fetchImpl: typeof fetch,
  opts: TimeoutOptions = DEFAULT_TIMEOUTS,
): typeof fetch {
  return async (input, init) => {
    const read = isReadOnlyQuery(init?.body);
    const ms = read ? opts.readMs : opts.writeMs;
    const attempts = read ? 2 : 1;
    for (let attempt = 1; ; attempt++) {
      const signal = AbortSignal.timeout(ms);
      try {
        // The signal also covers reading the body, which the driver does after this resolves.
        return await fetchImpl(input, { ...init, signal });
      } catch (err) {
        if (!signal.aborted) throw err;
        opts.onTimeout?.({ attempt, read, ms });
        if (attempt >= attempts) {
          throw new Error(`Database request timed out after ${ms / 1000}s`, { cause: err });
        }
      }
    }
  };
}
