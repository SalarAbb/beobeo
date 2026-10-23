/**
 * Data-access surface the agent's tools run against. The web app supplies an
 * implementation bound to the authenticated user — the agent package never
 * touches the database directly, and every method is read-only by design.
 */
export interface PortfolioApi {
  getPortfolioSummary(): Promise<unknown>;
  getPositionDetails(symbol: string): Promise<unknown>;
  getTransactions(filter: { symbol?: string; limit?: number }): Promise<unknown>;
  getRealizedGains(year?: number): Promise<unknown>;
  runDcaComparison(benchmarkSymbol: string): Promise<unknown>;
  getPriceHistory(symbol: string, days: number): Promise<unknown>;
}
