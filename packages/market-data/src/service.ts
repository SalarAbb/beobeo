import { and, desc, gte, inArray, lte, max, min } from "drizzle-orm";
import { schema, type Db } from "@beobeo/db";
import { D, type IsoDate, type PriceSeries } from "@beobeo/core";
import { planFetch, type Coverage } from "./cache";
import { searchPopular } from "./popular";
import { AlphaVantageProvider } from "./providers/alphavantage";
import { CoinGeckoProvider } from "./providers/coingecko";
import { CoinbaseExchangeProvider } from "./providers/coinbase-exchange";
import { TiingoProvider } from "./providers/tiingo";
import {
  ProviderError,
  type AssetRef,
  type PriceProvider,
  type SearchResult,
} from "./types";

export interface MarketDataConfig {
  tiingoApiKey?: string;
  alphaVantageApiKey?: string;
  coinGeckoApiKey?: string;
}

interface DbAsset extends AssetRef {
  id: string;
  /** Optional per-asset window start. An asset only needs prices from its own
   *  first transaction — without this, a portfolio-wide window makes every
   *  post-window IPO (no data before listing) a permanent head gap that gets
   *  re-fetched on each load. */
  seriesFrom?: IsoDate;
}

/**
 * Cached market-data access. All reads go through price_history; providers
 * are hit only for date spans the cache doesn't cover yet.
 */
export class MarketDataService {
  private equity: PriceProvider[] = [];
  private crypto: PriceProvider[] = [];
  /** In-flight ensure() calls keyed by asset+range — concurrent dashboard
   *  queries must not trigger duplicate provider fetches. */
  private inflight = new Map<string, Promise<void>>();
  /** Short-lived per-asset coverage memo. Overview, timeseries, and compare
   *  land as one burst of requests; only the first should pay the coverage
   *  query. Entries are dropped after provider upserts. */
  private coverageMemo = new Map<string, { value: Coverage | null; expires: number }>();
  private static readonly COVERAGE_TTL_MS = 30_000;
  /** Negative cache: ranges a provider confirmed empty (pre-listing history)
   *  or that recently failed. Without it every read re-fetches the same
   *  unfillable gap, serialized behind provider throttles. Value = epoch ms
   *  after which the range may be retried. */
  private skipRanges = new Map<string, number>();
  private static readonly EMPTY_RANGE_TTL_MS = 12 * 3_600_000;
  private static readonly FAILED_RANGE_TTL_MS = 5 * 60_000;

  constructor(
    private readonly db: Db,
    config: MarketDataConfig,
  ) {
    if (config.tiingoApiKey) this.equity.push(new TiingoProvider(config.tiingoApiKey));
    if (config.alphaVantageApiKey)
      this.equity.push(new AlphaVantageProvider(config.alphaVantageApiKey));
    // Coinbase Exchange is keyless — primary for crypto. CoinGecko becomes a
    // fallback (and provides crypto search) when a key is configured.
    this.crypto.push(new CoinbaseExchangeProvider());
    this.crypto.push(new CoinGeckoProvider(config.coinGeckoApiKey));
  }

  /** Daily closes for one asset, cache-first. Returns a PriceSeries for the core engine. */
  async getPrices(asset: DbAsset, from: IsoDate, to: IsoDate): Promise<PriceSeries> {
    const series = await this.getPricesBulk([asset], from, to);
    return series.get(asset.id) ?? new Map();
  }

  /**
   * Daily closes for MANY assets in one round trip each for coverage and
   * rows. The per-asset variant used to cost 2+ serialized HTTP queries per
   * asset on the Neon driver — a 16-asset dashboard paid ~35 round trips.
   * Best-effort refresh: rate-limited/down providers must not hide the
   * closes we already have cached.
   */
  async getPricesBulk(
    assets: DbAsset[],
    from: IsoDate,
    to: IsoDate,
  ): Promise<Map<string, PriceSeries>> {
    const out = new Map<string, PriceSeries>(assets.map((a) => [a.id, new Map()]));
    if (assets.length === 0) return out;
    await this.ensureCachedBulk(assets, from, to);
    const rows = await this.db
      .select({
        assetId: schema.priceHistory.assetId,
        date: schema.priceHistory.date,
        close: schema.priceHistory.close,
      })
      .from(schema.priceHistory)
      .where(
        and(
          inArray(schema.priceHistory.assetId, assets.map((a) => a.id)),
          gte(schema.priceHistory.date, from),
          lte(schema.priceHistory.date, to),
        ),
      );
    for (const r of rows) out.get(r.assetId)?.set(r.date as IsoDate, D(r.close));
    return out;
  }

  /** Latest cached close on or before `to` (marking positions to market). */
  async getLatestPrice(
    asset: DbAsset,
    to: IsoDate,
  ): Promise<{ date: IsoDate; close: string } | null> {
    const latest = await this.getLatestPrices([asset], to);
    return latest.get(asset.id) ?? null;
  }

  /** Latest close on or before `to` for MANY assets — one DISTINCT ON query. */
  async getLatestPrices(
    assets: DbAsset[],
    to: IsoDate,
  ): Promise<Map<string, { date: IsoDate; close: string }>> {
    if (assets.length === 0) return new Map();
    // Refresh a trailing window, not the single day — `to` may be a weekend
    // or holiday (and a lone-day fetch on a fresh asset caches nothing).
    const windowStart = new Date(Date.parse(`${to}T00:00:00Z`) - 10 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await this.ensureCachedBulk(assets, windowStart, to);
    const rows = await this.db
      .selectDistinctOn([schema.priceHistory.assetId], {
        assetId: schema.priceHistory.assetId,
        date: schema.priceHistory.date,
        close: schema.priceHistory.close,
      })
      .from(schema.priceHistory)
      .where(
        and(
          inArray(schema.priceHistory.assetId, assets.map((a) => a.id)),
          lte(schema.priceHistory.date, to),
        ),
      )
      .orderBy(schema.priceHistory.assetId, desc(schema.priceHistory.date));
    return new Map(
      rows.map((r) => [r.assetId, { date: r.date as IsoDate, close: r.close }]),
    );
  }

  /**
   * Known splits for many assets in one query (ratio as decimal string,
   * ascending by date). Assets with no splits are simply absent from the map.
   */
  async getSplits(
    assetIds: string[],
  ): Promise<Map<string, { date: IsoDate; ratio: string }[]>> {
    if (assetIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        assetId: schema.assetSplits.assetId,
        date: schema.assetSplits.date,
        ratio: schema.assetSplits.ratio,
      })
      .from(schema.assetSplits)
      .where(inArray(schema.assetSplits.assetId, assetIds))
      .orderBy(schema.assetSplits.date);
    const out = new Map<string, { date: IsoDate; ratio: string }[]>();
    for (const r of rows) {
      const list = out.get(r.assetId) ?? [];
      list.push({ date: r.date as IsoDate, ratio: r.ratio });
      out.set(r.assetId, list);
    }
    return out;
  }

  /**
   * Re-fetch an asset's full range to capture corporate actions the gap-based
   * cache never revisits — a split inside an already-covered span is invisible
   * to planFetch. Upserts splits (and any missing closes) idempotently.
   * Used by the backfill script; new assets don't need it (their first full
   * fetch captures splits). Returns the number of split events seen.
   */
  async syncCorporateActions(asset: DbAsset, from: IsoDate, to: IsoDate): Promise<number> {
    if (asset.class === "crypto") return 0; // no corporate actions
    if (this.equity.length === 0) return 0;
    const closes = await this.fetchWithFallback(this.equity, asset, from, to);
    if (closes.length === 0) return 0;
    await this.db
      .insert(schema.priceHistory)
      .values(closes.map((c) => ({ assetId: asset.id, date: c.date, close: c.close })))
      .onConflictDoNothing();
    const splits = closes.filter((c) => c.splitFactor !== undefined);
    if (splits.length > 0) {
      await this.db
        .insert(schema.assetSplits)
        .values(
          splits.map((c) => ({ assetId: asset.id, date: c.date, ratio: c.splitFactor! })),
        )
        .onConflictDoNothing();
    }
    this.coverageMemo.delete(asset.id);
    return splits.length;
  }

  /**
   * Popular-ticker fast path first (instant, no network), then provider
   * search for the rest. Deduped on symbol+class — providers list share
   * classes separately (e.g. META twice), which broke React keys upstream.
   */
  async search(query: string): Promise<SearchResult[]> {
    const popular = searchPopular(query);
    // A confident popular hit answers the query without any network.
    if (popular.length >= 5) return popular;

    const providers = [...this.equity, ...this.crypto].filter((p) => p.search);
    const settled = await Promise.allSettled(
      providers.map((p) => p.search!(query)),
    );
    const remote = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

    const seen = new Set<string>();
    const out: SearchResult[] = [];
    for (const r of [...popular, ...remote]) {
      const key = `${r.symbol}:${r.class}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }

  /**
   * Best price for a transaction on `date`: an intraday quote when `date` is
   * today (live during trading hours), otherwise the last close on or before
   * the date (handles weekends/holidays).
   */
  async getPriceForDate(
    asset: DbAsset,
    date: IsoDate,
  ): Promise<{ price: string; asOf: IsoDate; source: "quote" | "close" } | null> {
    const today = new Date().toISOString().slice(0, 10);
    if (date >= today) {
      const providers = asset.class === "crypto" ? this.crypto : this.equity;
      for (const provider of providers) {
        if (!provider.getIntradayQuote) continue;
        try {
          const quote = await provider.getIntradayQuote(asset);
          if (quote !== null) return { price: quote, asOf: today, source: "quote" };
        } catch {
          // fall through to cached close
        }
      }
    }
    const latest = await this.getLatestPrice(asset, date > today ? today : date);
    return latest ? { price: latest.close, asOf: latest.date, source: "close" } : null;
  }

  /**
   * Cached price coverage per asset: one grouped query for every asset that
   * isn't already memoized. The memo is short-lived (30s) and cleared for an
   * asset whenever a provider fetch inserts new rows.
   */
  private async coverageFor(assets: DbAsset[]): Promise<Map<string, Coverage | null>> {
    const now = Date.now();
    const result = new Map<string, Coverage | null>();
    const missing: DbAsset[] = [];
    for (const asset of assets) {
      const memo = this.coverageMemo.get(asset.id);
      if (memo && memo.expires > now) result.set(asset.id, memo.value);
      else missing.push(asset);
    }
    if (missing.length > 0) {
      const rows = await this.db
        .select({
          assetId: schema.priceHistory.assetId,
          min: min(schema.priceHistory.date),
          max: max(schema.priceHistory.date),
        })
        .from(schema.priceHistory)
        .where(inArray(schema.priceHistory.assetId, missing.map((a) => a.id)))
        .groupBy(schema.priceHistory.assetId);
      const byId = new Map(rows.map((r) => [r.assetId, r]));
      const expires = now + MarketDataService.COVERAGE_TTL_MS;
      for (const asset of missing) {
        const row = byId.get(asset.id);
        const value =
          row?.min && row.max
            ? { min: row.min as IsoDate, max: row.max as IsoDate }
            : null;
        this.coverageMemo.set(asset.id, { value, expires });
        result.set(asset.id, value);
      }
    }
    return result;
  }

  /**
   * Make sure the cache covers [from, to] for every asset, fetching only the
   * gaps. Best-effort by design: a rate-limited or down provider must never
   * block reads of rows the cache already has, so per-asset failures are
   * swallowed here (the read that follows serves whatever is cached).
   */
  private async ensureCachedBulk(assets: DbAsset[], from: IsoDate, to: IsoDate): Promise<void> {
    let coverage: Map<string, Coverage | null>;
    try {
      coverage = await this.coverageFor(assets);
    } catch {
      return; // coverage unreadable — let the read itself surface DB errors
    }

    await Promise.all(
      assets.map((asset) => {
        // An asset only needs coverage from its own start (first transaction),
        // not the portfolio-wide window.
        const assetFrom =
          asset.seriesFrom && asset.seriesFrom > from ? asset.seriesFrom : from;
        const ranges = planFetch(coverage.get(asset.id) ?? null, assetFrom, to);
        if (ranges.length === 0) return;

        const providers = asset.class === "crypto" ? this.crypto : this.equity;
        if (providers.length === 0) return; // no keys configured — serve cache only

        const key = `${asset.id}:${assetFrom}:${to}`;
        const pending = this.inflight.get(key);
        if (pending) return pending.catch(() => {});
        const run = this.fetchRanges(asset, providers, ranges).finally(() =>
          this.inflight.delete(key),
        );
        this.inflight.set(key, run);
        return run.catch(() => {});
      }),
    );
  }

  private async fetchRanges(
    asset: DbAsset,
    providers: PriceProvider[],
    ranges: { from: IsoDate; to: IsoDate }[],
  ): Promise<void> {
    const now = Date.now();
    for (const range of ranges) {
      const skipKey = `${asset.id}:${range.from}:${range.to}`;
      const retryAfter = this.skipRanges.get(skipKey);
      if (retryAfter !== undefined) {
        if (retryAfter > now) continue;
        this.skipRanges.delete(skipKey);
      }
      try {
        const closes = await this.fetchWithFallback(providers, asset, range.from, range.to);
        if (closes.length === 0) {
          // Provider answered and has nothing here (pre-listing history) —
          // the gap can't fill, so stop asking for a while.
          this.setSkip(skipKey, MarketDataService.EMPTY_RANGE_TTL_MS);
          continue;
        }
        await this.db
          .insert(schema.priceHistory)
          .values(closes.map((c) => ({ assetId: asset.id, date: c.date, close: c.close })))
          .onConflictDoNothing();
        const splits = closes.filter((c) => c.splitFactor !== undefined);
        if (splits.length > 0) {
          await this.db
            .insert(schema.assetSplits)
            .values(
              splits.map((c) => ({
                assetId: asset.id,
                date: c.date,
                ratio: c.splitFactor!,
              })),
            )
            .onConflictDoNothing();
        }
        this.coverageMemo.delete(asset.id);
      } catch {
        // Rate-limited/down provider — back off briefly instead of stalling
        // every subsequent read behind the throttle.
        this.setSkip(skipKey, MarketDataService.FAILED_RANGE_TTL_MS);
      }
    }
  }

  private setSkip(key: string, ttlMs: number): void {
    // Keys embed dates and rotate daily; purge expired entries at a size cap
    // so the map stays bounded.
    if (this.skipRanges.size >= 2000) {
      const now = Date.now();
      for (const [k, expires] of this.skipRanges) {
        if (expires <= now) this.skipRanges.delete(k);
      }
    }
    this.skipRanges.set(key, Date.now() + ttlMs);
  }

  private async fetchWithFallback(
    providers: PriceProvider[],
    asset: DbAsset,
    from: IsoDate,
    to: IsoDate,
  ) {
    let lastError: unknown;
    for (const provider of providers) {
      try {
        return await provider.getDailyCloses(asset, from, to);
      } catch (e) {
        lastError = e;
        if (e instanceof ProviderError && e.kind === "NOT_FOUND") throw e;
        // rate-limit/auth/upstream → try the next provider
      }
    }
    throw lastError;
  }
}
