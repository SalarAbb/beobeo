export interface TaxLotFilter {
  symbols?: string[];
  onlyLosses?: boolean;
  term?: "short" | "long";
  /** ISO date: short-term lots that turn long-term on or before it. */
  turnsLongTermBy?: string;
}

/**
 * Data-access surface the agent's tools run against. The web app supplies an
 * implementation bound to the authenticated user — the agent package never
 * touches the database directly, and every method is read-only by design.
 */
export interface PortfolioApi {
  /** Compact snapshot (holdings, totals, accounts, saved tax rates) that is
   *  preloaded into every turn, so most questions need no tool round trip. */
  getContextSnapshot(): Promise<unknown>;
  getPortfolioSummary(): Promise<unknown>;
  getPositionDetails(symbol: string): Promise<unknown>;
  /** Open lots in taxable accounts, every holding at once (narrowed by the
   *  filter): the same lots the Tax Center lists. */
  getTaxLots(filter: TaxLotFilter): Promise<unknown>;
  getTransactions(filter: { symbol?: string; limit?: number }): Promise<unknown>;
  getRealizedGains(year?: number): Promise<unknown>;
  runDcaComparison(benchmarkSymbol: string): Promise<unknown>;
  getPriceHistory(symbol: string, days: number): Promise<unknown>;
  /** "I have $n — where should it go?": the same ranked picks as the
   *  dashboard's next-buy section, for 1–5 symbols. */
  pickNextBuy(amountUsd: number, symbols: string[]): Promise<unknown>;
}
