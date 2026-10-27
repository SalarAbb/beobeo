import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { PortfolioApi, RaiseCashRequest, TaxLotFilter } from "./api";

const json = (v: unknown) => JSON.stringify(v);

/** Read-only tools over the authenticated user's own portfolio data.
 *  `onTimed` hears how long each tool took (for the turn's latency log). */
export function buildPortfolioTools(
  api: PortfolioApi,
  onTimed?: (name: string, ms: number) => void,
) {
  const timed =
    <A,>(name: string, run: (args: A) => Promise<string>) =>
    async (args: A) => {
      const t0 = performance.now();
      try {
        return await run(args);
      } finally {
        onTimed?.(name, Math.round(performance.now() - t0));
      }
    };
  return [
    betaZodTool({
      name: "get_portfolio_summary",
      description:
        "Current portfolio overview: every holding with quantity, cost basis, latest price, market value, and unrealized P/L, plus portfolio-level totals (value, unrealized, realized, dividends). The turn's snapshot already holds this; call it only to refresh.",
      inputSchema: z.object({}),
      run: timed("get_portfolio_summary", async () => json(await api.getPortfolioSummary())),
    }),
    betaZodTool({
      name: "get_position_details",
      description:
        "Deep detail for one position by ticker symbol: open tax lots (acquisition dates, quantities, cost basis), realized gains per year with short/long-term split, individual sales, dividends, and current valuation.",
      inputSchema: z.object({
        symbol: z.string().describe("Ticker symbol, e.g. AAPL or BTC"),
      }),
      run: timed("get_position_details", async ({ symbol }: { symbol: string }) =>
        json(await api.getPositionDetails(symbol)),
      ),
    }),
    betaZodTool({
      name: "get_tax_lots",
      description:
        "Open lots in the user's taxable accounts, every holding in ONE call: account, purchase date, quantity, cost basis, value now, gain if sold now, short/long-term, and the date a short-term lot turns long-term. The same lots the Tax Center shows. Use this for any lot or holding-period question instead of calling get_position_details once per symbol. Long histories have hundreds of lots, so narrow with the filters (e.g. losses only, or short-term lots turning long-term by a date).",
      inputSchema: z.object({
        symbols: z
          .array(z.string())
          .optional()
          .describe("Only these ticker symbols; omit for every holding"),
        onlyLosses: z.boolean().optional().describe("Only lots worth less than they cost"),
        term: z.enum(["short", "long"]).optional().describe("Only short- or long-term lots"),
        turnsLongTermBy: z
          .string()
          .optional()
          .describe("ISO date: only short-term lots that turn long-term on or before it"),
      }),
      run: timed("get_tax_lots", async (filter: TaxLotFilter) => json(await api.getTaxLots(filter))),
    }),
    betaZodTool({
      name: "plan_raise_cash",
      description:
        "'I need $n, what should I sell for the least tax?' Runs the Tax Center's Raise Cash optimizer over the taxable lots: returns the exact purchases to sell (account, purchase date, units, proceeds, gain, short/long-term, tax), the plan's totals, and how much more the broker's default (oldest first, FIFO) would cost. Use it for any sell-to-raise-cash or 'which lots have the least tax per dollar' question; never rank lots yourself.",
      inputSchema: z.object({
        amountUsd: z.number().positive().describe("Cash to raise, in dollars"),
        symbols: z
          .array(z.string())
          .optional()
          .describe("Only sell these ticker symbols; omit to consider every holding"),
        account: z
          .string()
          .optional()
          .describe("Only sell from this account (name or part of it)"),
      }),
      run: timed("plan_raise_cash", async (request: RaiseCashRequest) =>
        json(await api.planRaiseCash(request)),
      ),
    }),
    betaZodTool({
      name: "get_transactions",
      description:
        "The user's transaction history (buys, sells, dividends, splits, transfers), newest first. Optionally filtered to one symbol.",
      inputSchema: z.object({
        symbol: z.string().optional().describe("Filter to one ticker symbol"),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      run: timed("get_transactions", async ({ symbol, limit }: { symbol?: string; limit: number }) =>
        json(await api.getTransactions({ symbol, limit })),
      ),
    }),
    betaZodTool({
      name: "get_realized_gains",
      description:
        "Realized capital gains/losses grouped by calendar year across the whole portfolio, split into short-term and long-term. Optionally a single year.",
      inputSchema: z.object({
        year: z.number().int().optional().describe("Calendar year, e.g. 2025"),
      }),
      run: timed("get_realized_gains", async ({ year }: { year?: number }) =>
        json(await api.getRealizedGains(year)),
      ),
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
      run: timed("run_dca_comparison", async ({ benchmarkSymbol }: { benchmarkSymbol: string }) =>
        json(await api.runDcaComparison(benchmarkSymbol)),
      ),
    }),
    betaZodTool({
      name: "get_price_history",
      description:
        "Daily closing prices for an asset the user holds, for trend questions. Returns up to `days` most recent closes.",
      inputSchema: z.object({
        symbol: z.string().describe("Ticker symbol"),
        days: z.number().int().min(7).max(730).default(90),
      }),
      run: timed("get_price_history", async ({ symbol, days }: { symbol: string; days: number }) =>
        json(await api.getPriceHistory(symbol, days)),
      ),
    }),
    betaZodTool({
      name: "pick_next_buy",
      description:
        "'I have $n, where should it go?' Ranks 1–5 candidate symbols for one buy of the whole amount, deterministically: 60% fit with what the user holds (lower weight after the buy wins), 40% how far each sits below its 1-year high and the user's average cost. Returns picks best first, each with a one-sentence reason and the account it belongs in. The first pick is the answer; the second is 'another option'.",
      inputSchema: z.object({
        amountUsd: z.number().positive().describe("Dollars to invest"),
        symbols: z.array(z.string()).min(1).max(5).describe("Candidate tickers"),
      }),
      run: timed(
        "pick_next_buy",
        async ({ amountUsd, symbols }: { amountUsd: number; symbols: string[] }) =>
          json(await api.pickNextBuy(amountUsd, symbols)),
      ),
    }),
  ];
}
