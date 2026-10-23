import { db } from "@beobeo/db";
import { MarketDataService } from "@beobeo/market-data";

let instance: MarketDataService | null = null;

/** Process-wide MarketDataService (throttles are per-provider and must be shared). */
export function getMarketData(): MarketDataService {
  instance ??= new MarketDataService(db, {
    tiingoApiKey: process.env.TIINGO_API_KEY || undefined,
    alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || undefined,
    coinGeckoApiKey: process.env.COINGECKO_API_KEY || undefined,
  });
  return instance;
}
