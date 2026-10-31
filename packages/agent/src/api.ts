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
  /** Each buy, valued now, next to the same dollars put into a benchmark
   *  that day, worst first ("which buy lost the most vs VOO?"). */
  compareBuysToBenchmark(request: BuysVsBenchmarkRequest): Promise<unknown>;
  getPriceHistory(symbol: string, days: number): Promise<unknown>;
  /** "I have $n — where should it go?": the same ranked picks as the
   *  dashboard's next-buy section, for 1–5 symbols. */
  pickNextBuy(amountUsd: number, symbols: string[]): Promise<unknown>;
  /** "Raise $n with the least tax": the Tax Center's Raise Cash plan (the
   *  exact optimizer, not a model's ranking), optionally limited to some
   *  symbols or one account. */
  planRaiseCash(request: RaiseCashRequest): Promise<unknown>;
  /** "Am I on track for $1M?" / "how long does my money last?": the value
   *  projected at a few stated yearly returns, with every assumption named. */
  projectGrowth(request: ProjectionRequest): Promise<unknown>;
  /** "What do my shares pay me a year / a month?": last 12 months' dividends
   *  per share times the units held now, per holding and by month. */
  estimateDividendIncome(): Promise<unknown>;
}

export interface ProjectionRequest {
  /** Value to reach, e.g. 1,000,000. */
  targetUsd?: number;
  /** Horizon in years (default 20, or the years to a target age the user gave). */
  years?: number;
  /** Monthly amount added; negative = taken out. Default: the user's own pace
   *  over the last 12 months. */
  monthlyUsd?: number;
  /** One yearly return to use instead of the default 4% / 6% / 8% range. */
  yearlyReturnPct?: number;
  /** Raise the monthly amount this much a year (default 3 for withdrawals,
   *  to keep up with inflation; 0 for deposits). */
  yearlyRaisePct?: number;
  /** Start from this account's value only (name or part of it). */
  account?: string;
}

export interface RaiseCashRequest {
  amountUsd: number;
  /** Only sell these ticker symbols. */
  symbols?: string[];
  /** Only sell from the account whose name contains this. */
  account?: string;
}

export interface BuysVsBenchmarkRequest {
  benchmarkSymbol: string;
  /** Only buys of these ticker symbols. */
  symbols?: string[];
  /** ISO date: only buys on or after it. */
  since?: string;
}
