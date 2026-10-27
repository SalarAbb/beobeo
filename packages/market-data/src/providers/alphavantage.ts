import { z } from "zod";
import { Throttle, providerSignal } from "../rate-limit";
import {
  ProviderError,
  type AssetRef,
  type DailyClose,
  type PriceProvider,
} from "../types";

const dailySchema = z.object({
  "Time Series (Daily)": z.record(
    z.string(),
    z.object({ "4. close": z.string() }),
  ),
});

/** Alpha Vantage — fallback for stocks/ETFs. Free tier: 25 req/day. */
export class AlphaVantageProvider implements PriceProvider {
  readonly name = "alphavantage";
  private throttle = new Throttle(15_000);

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getDailyCloses(asset: AssetRef, from: string, to: string): Promise<DailyClose[]> {
    const url =
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY` +
      `&symbol=${encodeURIComponent(asset.symbol)}&outputsize=full&apikey=${this.apiKey}`;
    const raw = await this.throttle.run(async () => {
      const res = await this.fetchImpl(url, { signal: providerSignal() });
      if (!res.ok)
        throw new ProviderError(this.name, "UPSTREAM", `HTTP ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      // AV signals errors/limits with HTTP 200 + message fields.
      if (body["Note"] || body["Information"])
        throw new ProviderError(this.name, "RATE_LIMITED", String(body["Note"] ?? body["Information"]));
      if (body["Error Message"])
        throw new ProviderError(this.name, "NOT_FOUND", String(body["Error Message"]));
      return body;
    });
    const parsed = dailySchema.parse(raw);
    return Object.entries(parsed["Time Series (Daily)"])
      .filter(([date]) => date >= from && date <= to)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, row]) => ({ date, close: row["4. close"] }));
  }
}
