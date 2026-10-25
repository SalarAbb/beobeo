import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { PortfolioApi } from "./api";

const json = (v: unknown) => JSON.stringify(v);

/** Read-only tools over the authenticated user's own portfolio data. */
export function buildPortfolioTools(api: PortfolioApi) {
  return [
    betaZodTool({
      name: "get_portfolio_summary",
      description:
        "Current portfolio overview: every holding with quantity, cost basis, latest price, market value, and unrealized P/L, plus portfolio-level totals (value, unrealized, realized, dividends). The turn's snapshot already holds this; call it only to refresh.",
      inputSchema: z.object({}),
      run: async () => json(await api.getPortfolioSummary()),
    }),
    betaZodTool({
      name: "get_position_details",
      description:
        "Deep detail for one position by ticker symbol: open tax lots (acquisition dates, quantities, cost basis), realized gains per year with short/long-term split, individual sales, dividends, and current valuation.",
      inputSchema: z.object({
        symbol: z.string().describe("Ticker symbol, e.g. AAPL or BTC"),
      }),
      run: async ({ symbol }) => json(await api.getPositionDetails(symbol)),
    }),
    betaZodTool({
      name: "get_transactions",
      description:
        "The user's transaction history (buys, sells, dividends, splits, transfers), newest first. Optionally filtered to one symbol.",
      inputSchema: z.object({
        symbol: z.string().optional().describe("Filter to one ticker symbol"),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      run: async ({ symbol, limit }) =>
        json(await api.getTransactions({ symbol, limit })),
    }),
    betaZodTool({
      name: "get_realized_gains",
      description:
        "Realized capital gains/losses grouped by calendar year across the whole portfolio, split into short-term and long-term. Optionally a single year.",
      inputSchema: z.object({
        year: z.number().int().optional().describe("Calendar year, e.g. 2025"),
      }),
      run: async ({ year }) => json(await api.getRealizedGains(year)),
    }),
    betaZodTool({
      name: "run_dca_comparison",
      description:
        "Counterfactual: replay every dollar the user actually invested (same dates, same amounts) into a benchmark asset instead, and compare final values and money-weighted annual returns (XIRR). Use when asked 'would I have done better just buying X'.",
      inputSchema: z.object({
        benchmarkSymbol: z
          .string()
          .describe("Benchmark ticker: SPY, VOO, QQQ, or BTC"),
      }),
      run: async ({ benchmarkSymbol }) =>
        json(await api.runDcaComparison(benchmarkSymbol)),
    }),
    betaZodTool({
      name: "get_price_history",
      description:
        "Daily closing prices for an asset the user holds, for trend questions. Returns up to `days` most recent closes.",
      inputSchema: z.object({
        symbol: z.string().describe("Ticker symbol"),
        days: z.number().int().min(7).max(730).default(90),
      }),
      run: async ({ symbol, days }) => json(await api.getPriceHistory(symbol, days)),
    }),
  ];
}
