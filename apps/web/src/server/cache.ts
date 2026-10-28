/**
 * Pluggable server-side computation cache.
 *
 * The default backend is in-process memory, which is correct for a single
 * server (this laptop, or one Node instance). When the app is hosted across
 * multiple instances / serverless workers, swap the backend for a shared
 * store (Redis, Vercel KV, …) by calling `setAppCache()` once at boot with
 * an adapter that implements `AppCache` — nothing else changes.
 *
 * Values are JSON strings on purpose: that is the contract every remote
 * store speaks, so the in-memory default can't accidentally depend on
 * object identity.
 */
export interface AppCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Drop every key starting with `prefix` (used for per-user invalidation). */
  deleteByPrefix(prefix: string): Promise<void>;
}

const MAX_ENTRIES = 500;

class InMemoryCache implements AppCache {
  private store = new Map<string, { value: string; expires: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expires <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    // Bounded: evict the oldest insertion when full (Map preserves order).
    this.store.delete(key);
    if (this.store.size >= MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
}

// globalThis singleton so Next.js dev HMR doesn't reset the cache on every
// server-file edit (module scope is re-evaluated; globalThis survives).
const globalForCache = globalThis as unknown as { __beobeoAppCache?: AppCache };

export function getAppCache(): AppCache {
  return (globalForCache.__beobeoAppCache ??= new InMemoryCache());
}

/** Swap the backend (e.g. a Redis adapter) — call once at boot. */
export function setAppCache(cache: AppCache): void {
  globalForCache.__beobeoAppCache = cache;
}

/** Every user-scoped key goes through this so invalidation-by-prefix works. */
export const userCacheKey = (
  userId: string,
  ...parts: (string | number)[]
): string => `u:${userId}:${parts.join(":")}`;

/**
 * Computations running right now, per key, so concurrent requests for the
 * same cold key share one run. The dashboard's first batch asks for the
 * overview, the timeseries and the metrics (which reads the timeseries) at
 * once: without this, the timeseries was computed twice in parallel, and on
 * the Neon HTTP driver every duplicate query queues behind the others.
 * In-process only (a shared backend still dedupes per instance). Bumping
 * `generation` on invalidation stops a run that started before a write from
 * caching its now-stale result.
 */
const globalForInflight = globalThis as unknown as {
  __beobeoInflight?: { runs: Map<string, Promise<string>>; generation: number };
};
const inflight = (globalForInflight.__beobeoInflight ??= {
  runs: new Map(),
  generation: 0,
});
const globalForShared = globalThis as unknown as {
  __beobeoSharedRuns?: Map<string, Promise<unknown>>;
};
const sharedRuns = (globalForShared.__beobeoSharedRuns ??= new Map());

/**
 * Share one in-flight run among concurrent callers with the same key, for
 * uncached intermediate loads (the overview and the timeseries both read the
 * user's transactions at the same moment). Nothing is kept after it settles.
 * Callers receive the same object, so they must treat it as read-only. Keys
 * go through `userCacheKey` so invalidation drops them.
 */
export function sharedRun<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = sharedRuns.get(key);
  if (running) return running as Promise<T>;
  const run = fn().finally(() => {
    if (sharedRuns.get(key) === run) sharedRuns.delete(key);
  });
  sharedRuns.set(key, run);
  return run;
}

/**
 * JSON read-through helper. Cache failures are never allowed to break the
 * computation — a broken backend degrades to "no cache".
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const cache = getAppCache();
  const hit = await cache.get(key).catch(() => null);
  if (hit !== null) return JSON.parse(hit) as T;
  // Joiners get their own parsed copy, like a cache hit, so no caller can
  // mutate another's result.
  const running = inflight.runs.get(key);
  if (running) return JSON.parse(await running) as T;

  const generation = inflight.generation;
  let settle!: { resolve: (s: string) => void; reject: (e: unknown) => void };
  const shared = new Promise<string>((resolve, reject) => (settle = { resolve, reject }));
  shared.catch(() => {}); // a failure is rethrown to the caller below; joiners see it too
  inflight.runs.set(key, shared);
  try {
    const value = await fn();
    const json = JSON.stringify(value);
    settle.resolve(json);
    if (inflight.generation === generation)
      await cache.set(key, json, ttlSeconds).catch(() => {});
    return value;
  } catch (e) {
    settle.reject(e);
    throw e;
  } finally {
    if (inflight.runs.get(key) === shared) inflight.runs.delete(key);
  }
}

/**
 * Warm a cached computation without waiting for it (e.g. while the page
 * that will ask for it is still loading). Failures are dropped: the real
 * request runs the computation again and reports its own error.
 */
export function warm(run: () => Promise<unknown>): void {
  void run().catch(() => {});
}

/** Call after any mutation that changes a user's transactions/accounts. */
export async function invalidateUserComputations(userId: string): Promise<void> {
  const prefix = `u:${userId}:`;
  inflight.generation++;
  for (const key of inflight.runs.keys()) {
    if (key.startsWith(prefix)) inflight.runs.delete(key);
  }
  for (const key of sharedRuns.keys()) {
    if (key.startsWith(prefix)) sharedRuns.delete(key);
  }
  await getAppCache()
    .deleteByPrefix(prefix)
    .catch(() => {});
}
