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
  const value = await fn();
  await cache.set(key, JSON.stringify(value), ttlSeconds).catch(() => {});
  return value;
}

/** Call after any mutation that changes a user's transactions/accounts. */
export async function invalidateUserComputations(userId: string): Promise<void> {
  await getAppCache()
    .deleteByPrefix(`u:${userId}:`)
    .catch(() => {});
}
