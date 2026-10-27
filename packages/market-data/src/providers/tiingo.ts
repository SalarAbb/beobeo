import { z } from "zod";
import { Throttle, providerSignal } from "../rate-limit";
import {
  ProviderError,
  type AssetRef,
  type DailyClose,
  type PriceProvider,
  type SearchResult,
} from "../types";

const pricesSchema = z.array(
  z.object({
    date: z.string(),
    close: z.number(),
    // 1.0 on normal days; the split ratio on split dates (4 = 4-for-1).
    splitFactor: z.number().optional(),
  }),
);

const searchSchema = z.array(
  z.object({
    ticker: z.string(),
    name: z.string(),
    assetType: z.string().optional(),
  }),
);

/** Tiingo — primary provider for stocks/ETFs/funds. Free tier: 1000 req/day. */
export class TiingoProvider implements PriceProvider {
  readonly name = "tiingo";
  private throttle = new Throttle(1200);
  // Search and quotes are interactive (typed by a user waiting on a dropdown/
  // form) — don't queue them behind slow historical backfills.
  private interactiveThrottle = new Throttle(250);

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getDailyCloses(asset: AssetRef, from: string, to: string): Promise<DailyClose[]> {
    const url =
      `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(asset.symbol.toLowerCase())}/prices` +
      `?startDate=${from}&endDate=${to}&columns=date,close,splitFactor&token=${this.apiKey}`;
    const raw = await this.request(url);
    const rows = pricesSchema.parse(raw);
    return rows.map((r) => ({
      date: r.date.slice(0, 10),
      close: String(r.close),
      ...(r.splitFactor !== undefined && r.splitFactor !== 1
        ? { splitFactor: String(r.splitFactor) }
        : {}),
    }));
  }

  async search(query: string): Promise<SearchResult[]> {
    const url = `https://api.tiingo.com/tiingo/utilities/search?query=${encodeURIComponent(query)}&token=${this.apiKey}`;
    const rows = searchSchema.parse(await this.request(url, this.interactiveThrottle));
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const r of rows) {
      const cls = r.assetType === "ETF" ? ("etf" as const) : ("stock" as const);
      const key = `${r.ticker.toUpperCase()}:${cls}`;
      // Tiingo lists share classes separately (e.g. META twice) — keep the first.
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ symbol: r.ticker.toUpperCase(), name: r.name, class: cls });
    }
    return results;
  }

  /** Last trade price from the IEX endpoint (real-time-ish during market hours). */
  async getIntradayQuote(asset: AssetRef): Promise<string | null> {
    const url = `https://api.tiingo.com/iex/?tickers=${encodeURIComponent(asset.symbol.toLowerCase())}&token=${this.apiKey}`;
    const raw = await this.request(url, this.interactiveThrottle);
    const rows = z
      .array(z.object({ last: z.number().nullable(), tngoLast: z.number().nullable() }))
      .parse(raw);
    const price = rows[0]?.last ?? rows[0]?.tngoLast ?? null;
    return price === null ? null : String(price);
  }

  private async request(
    url: string,
    throttle: Throttle = this.throttle,
  ): Promise<unknown> {
    return throttle.run(async () => {
      const res = await this.fetchImpl(url, {
        headers: { "content-type": "application/json" },
        signal: providerSignal(),
      });
      if (res.status === 429)
        throw new ProviderError(this.name, "RATE_LIMITED", "rate limited");
      if (res.status === 401 || res.status === 403)
        throw new ProviderError(this.name, "AUTH", "invalid API key");
      if (res.status === 404)
        throw new ProviderError(this.name, "NOT_FOUND", "unknown ticker");
      if (!res.ok)
        throw new ProviderError(this.name, "UPSTREAM", `HTTP ${res.status}`);
      return res.json();
    });
  }
}
