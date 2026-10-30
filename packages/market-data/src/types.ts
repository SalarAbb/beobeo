import type { IsoDate } from "@beobeo/core";

export interface DailyClose {
  date: IsoDate;
  /** Decimal string — never a float. Unadjusted close (splits are modeled as transactions). */
  close: string;
  /** Split ratio effective this date (close is already post-split), e.g. "4"
   *  for 4-for-1. Only present on split dates; providers without corporate-
   *  action data never set it. */
  splitFactor?: string;
}

export interface AssetRef {
  symbol: string;
  class: "stock" | "etf" | "fund" | "crypto" | "cash";
  /** Provider-specific id, e.g. CoinGecko coin id ("bitcoin"). */
  providerRef?: string | null;
}

export interface SearchResult {
  symbol: string;
  name: string;
  class: AssetRef["class"];
  providerRef?: string;
}

export interface PriceProvider {
  readonly name: string;
  /** Inclusive date range of daily closes. May return fewer days (non-trading days). */
  getDailyCloses(asset: AssetRef, from: IsoDate, to: IsoDate): Promise<DailyClose[]>;
  search?(query: string): Promise<SearchResult[]>;
  /** Latest intraday/last-trade price (decimal string), for "today" lookups. */
  getIntradayQuote?(asset: AssetRef): Promise<string | null>;
  /** Many quotes in one request, keyed by upper-case symbol (missing = no quote). */
  getIntradayQuotes?(assets: AssetRef[]): Promise<Map<string, string>>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly kind: "RATE_LIMITED" | "NOT_FOUND" | "AUTH" | "UPSTREAM",
    message: string,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}
