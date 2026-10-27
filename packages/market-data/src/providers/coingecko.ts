import { z } from "zod";
import { Throttle, providerSignal } from "../rate-limit";
import {
  ProviderError,
  type AssetRef,
  type DailyClose,
  type PriceProvider,
  type SearchResult,
} from "../types";

const chartSchema = z.object({
  // [unix_ms, price][]
  prices: z.array(z.tuple([z.number(), z.number()])),
});

const searchSchema = z.object({
  coins: z.array(
    z.object({
      id: z.string(),
      symbol: z.string(),
      name: z.string(),
    }),
  ),
});

/**
 * CoinGecko — crypto prices. Works keyless on the free tier (throttled);
 * a demo API key raises the limits. `providerRef` = CoinGecko coin id.
 */
export class CoinGeckoProvider implements PriceProvider {
  readonly name = "coingecko";
  private throttle = new Throttle(2500);

  constructor(
    private readonly apiKey?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getDailyCloses(asset: AssetRef, from: string, to: string): Promise<DailyClose[]> {
    const coinId = asset.providerRef;
    if (!coinId) {
      throw new ProviderError(
        this.name,
        "NOT_FOUND",
        `asset ${asset.symbol} has no CoinGecko id (providerRef)`,
      );
    }
    const fromTs = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
    const toTs = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000);
    const url =
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart/range` +
      `?vs_currency=usd&from=${fromTs}&to=${toTs}`;
    const raw = chartSchema.parse(await this.request(url));

    // Range endpoint returns daily points for spans > 90 days, hourly below.
    // Collapse to one close per UTC day (last point of the day).
    const byDay = new Map<string, number>();
    for (const [ts, price] of raw.prices) {
      byDay.set(new Date(ts).toISOString().slice(0, 10), price);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, close]) => ({ date, close: String(close) }));
  }

  async search(query: string): Promise<SearchResult[]> {
    const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`;
    const raw = searchSchema.parse(await this.request(url));
    return raw.coins.slice(0, 10).map((c) => ({
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      class: "crypto" as const,
      providerRef: c.id,
    }));
  }

  private async request(url: string): Promise<unknown> {
    return this.throttle.run(async () => {
      const headers: Record<string, string> = {};
      if (this.apiKey) headers["x-cg-demo-api-key"] = this.apiKey;
      const res = await this.fetchImpl(url, { headers, signal: providerSignal() });
      if (res.status === 429)
        throw new ProviderError(this.name, "RATE_LIMITED", "rate limited");
      if (res.status === 404)
        throw new ProviderError(this.name, "NOT_FOUND", "unknown coin id");
      if (!res.ok)
        throw new ProviderError(this.name, "UPSTREAM", `HTTP ${res.status}`);
      return res.json();
    });
  }
}
