import { z } from "zod";
import { Throttle, providerSignal } from "../rate-limit";
import {
  ProviderError,
  type AssetRef,
  type DailyClose,
  type DividendPayment,
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
  // A dashboard asks dividends for every holding at once, one request each:
  // one at a time, 10 holdings kept the page loading ~2.5s, and live quotes
  // and searches queued behind them. Same number of requests, a few at a time.
  private dividendThrottle = new Throttle(100, 4);
  /** After a 429, every call (the cap is one per key, shared by prices,
   *  quotes, search and dividends) fails at once for a minute instead of
   *  queueing for its own refusal: a rate-limited dashboard spent ~2s
   *  collecting one 429 per holding. */
  static readonly RATE_LIMIT_PAUSE_MS = 60_000;
  private limitedUntil = 0;

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

  /** Cash dividends from the same EOD endpoint (`divCash` is per share on the
   *  ex-date, 0 on other days). Its own throttle: someone is waiting on it, it
   *  comes in bursts, and the service memoizes the answer for hours. */
  async getDividends(asset: AssetRef, from: string, to: string): Promise<DividendPayment[]> {
    const url =
      `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(asset.symbol.toLowerCase())}/prices` +
      `?startDate=${from}&endDate=${to}&columns=date,divCash&token=${this.apiKey}`;
    const rows = z
      .array(z.object({ date: z.string(), divCash: z.number().nullish() }))
      .parse(await this.request(url, this.dividendThrottle));
    return rows
      .filter((r) => (r.divCash ?? 0) > 0)
      .map((r) => ({ date: r.date.slice(0, 10), amount: String(r.divCash) }));
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
    return (await this.getIntradayQuotes([asset])).get(asset.symbol.toUpperCase()) ?? null;
  }

  /** IEX takes a comma-separated ticker list, so a whole portfolio costs one request. */
  async getIntradayQuotes(assets: AssetRef[]): Promise<Map<string, string>> {
    if (assets.length === 0) return new Map();
    const tickers = assets.map((a) => encodeURIComponent(a.symbol.toLowerCase())).join(",");
    const url = `https://api.tiingo.com/iex/?tickers=${tickers}&token=${this.apiKey}`;
    const raw = await this.request(url, this.interactiveThrottle);
    const rows = z
      .array(
        z.object({
          ticker: z.string(),
          last: z.number().nullable().optional(),
          tngoLast: z.number().nullable().optional(),
        }),
      )
      .parse(raw);
    const out = new Map<string, string>();
    for (const r of rows) {
      const price = r.last ?? r.tngoLast ?? null;
      if (price !== null) out.set(r.ticker.toUpperCase(), String(price));
    }
    return out;
  }

  private async request(
    url: string,
    throttle: Throttle = this.throttle,
  ): Promise<unknown> {
    const limited = () => Date.now() < this.limitedUntil;
    return throttle.run(async () => {
      if (limited()) throw new ProviderError(this.name, "RATE_LIMITED", "rate limited (pausing)");
      const res = await this.fetchImpl(url, {
        headers: { "content-type": "application/json" },
        signal: providerSignal(),
      });
      if (res.status === 429) {
        this.limitedUntil = Date.now() + TiingoProvider.RATE_LIMIT_PAUSE_MS;
        throw new ProviderError(this.name, "RATE_LIMITED", "rate limited");
      }
      if (res.status === 401 || res.status === 403)
        throw new ProviderError(this.name, "AUTH", "invalid API key");
      if (res.status === 404)
        throw new ProviderError(this.name, "NOT_FOUND", "unknown ticker");
      if (!res.ok)
        throw new ProviderError(this.name, "UPSTREAM", `HTTP ${res.status}`);
      return res.json();
    }, limited);
  }
}
