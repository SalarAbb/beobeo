import { z } from "zod";
import { Throttle, providerSignal } from "../rate-limit";
import {
  ProviderError,
  type AssetRef,
  type DailyClose,
  type PriceProvider,
} from "../types";

// [time(unix s), low, high, open, close, volume] — newest first
const candlesSchema = z.array(
  z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
);

const MAX_CANDLES = 300;
const DAY_S = 86_400;

/**
 * Coinbase Exchange public market data — keyless crypto daily candles.
 * Symbols map to <SYMBOL>-USD products (BTC → BTC-USD); paginated in
 * 300-day windows.
 */
export class CoinbaseExchangeProvider implements PriceProvider {
  readonly name = "coinbase-exchange";
  // Public limit: 10 req/s per IP. Candle backfills page slowly; live quotes get
  // their own lane (up to ~6/s, 3 in flight), so a crypto holder's page doesn't
  // wait 350ms per coin, or behind a backfill, for today's prices (fred's Tax
  // Center at 2.2-2.4s, 2026-11-01). Both lanes together stay under 10/s.
  private throttle = new Throttle(350);
  private quoteThrottle = new Throttle(150, 3);

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async getDailyCloses(asset: AssetRef, from: string, to: string): Promise<DailyClose[]> {
    const product = `${asset.symbol.toUpperCase()}-USD`;
    const fromS = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
    const toS = Math.floor(Date.parse(`${to}T00:00:00Z`) / 1000);

    const byDay = new Map<string, string>();
    for (let start = fromS; start <= toS; start += MAX_CANDLES * DAY_S) {
      const end = Math.min(start + (MAX_CANDLES - 1) * DAY_S, toS);
      const url =
        `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles` +
        `?granularity=86400` +
        `&start=${new Date(start * 1000).toISOString()}` +
        `&end=${new Date(end * 1000).toISOString()}`;
      const rows = candlesSchema.parse(await this.request(url, product));
      for (const [time, , , , close] of rows) {
        byDay.set(new Date(time * 1000).toISOString().slice(0, 10), String(close));
      }
    }

    return [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, close]) => ({ date, close }));
  }

  /** Last trade price from the public ticker endpoint (real-time). */
  async getIntradayQuote(asset: AssetRef): Promise<string | null> {
    const product = `${asset.symbol.toUpperCase()}-USD`;
    const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/ticker`;
    const raw = await this.request(url, product, this.quoteThrottle);
    const parsed = z.object({ price: z.string() }).safeParse(raw);
    return parsed.success ? parsed.data.price : null;
  }

  private async request(url: string, product: string, throttle = this.throttle): Promise<unknown> {
    return throttle.run(async () => {
      const res = await this.fetchImpl(url, {
        headers: { "user-agent": "beobeo-portfolio" },
        signal: providerSignal(),
      });
      if (res.status === 429)
        throw new ProviderError(this.name, "RATE_LIMITED", "rate limited");
      if (res.status === 404)
        throw new ProviderError(this.name, "NOT_FOUND", `unknown product ${product}`);
      if (!res.ok)
        throw new ProviderError(this.name, "UPSTREAM", `HTTP ${res.status}`);
      return res.json();
    });
  }
}
