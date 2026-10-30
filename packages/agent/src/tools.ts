import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type {
  BuysVsBenchmarkRequest,
  PortfolioApi,
  ProjectionRequest,
  RaiseCashRequest,
  TaxLotFilter,
} from "./api";

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
        "Sales grouped by calendar year across the whole portfolio: totals for proceeds (cash taken out by selling), cost basis and realized gain, split short-/long-term, a month-by-month breakdown, and every sale (proceeds, basis, gain, term). Use it for 'how much have I sold / taken out this year and how much was gain?' instead of adding up get_transactions rows. Optionally a single year.",
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
      name: "compare_buys_to_benchmark",
      description:
        "Every buy set against the same dollars put into a benchmark on the same day: what the buy cost, what it's worth now (as if still held, later splits applied), what the benchmark would be worth now, and the edge (negative = the benchmark would have done better), worst edge first, with totals. Use for 'which buy was my worst/best vs VOO?', 'did my dip buys beat just buying SPY?'. Never work this out from get_transactions and get_price_history yourself.",
      inputSchema: z.object({
        benchmarkSymbol: z.string().describe("Benchmark ticker, e.g. VOO, SPY, QQQ or BTC"),
        symbols: z
          .array(z.string())
          .optional()
          .describe("Only buys of these ticker symbols; omit for every buy"),
        since: z.string().optional().describe("ISO date: only buys on or after it"),
      }),
      run: timed("compare_buys_to_benchmark", async (request: BuysVsBenchmarkRequest) =>
        json(await api.compareBuysToBenchmark(request)),
      ),
    }),
    betaZodTool({
      name: "get_price_history",
      description:
        "Price moves for an asset the user holds: 'is it down 5% over 5 days?', 'how far off its high?', 'why did it drop?'. Returns the latest price (today's quote when markets have one, else the last close), the % change over 1 and 5 trading days, 1 month, 3 months and 1 year already computed with the reference close and its date, the high and low in the window, and the daily closes (split-adjusted) for the last `days` calendar days. Ask for days ≥ 100 for a 3-month change, ≥ 370 for a year. Quote the computed changes; never work percentages out of the closes yourself.",
      inputSchema: z.object({
        symbol: z.string().describe("Ticker symbol"),
        days: z.number().int().min(7).max(730).default(90),
      }),
      run: timed("get_price_history", async ({ symbol, days }: { symbol: string; days: number }) =>
        json(await api.getPriceHistory(symbol, days)),
      ),
    }),
    betaZodTool({
      name: "project_growth",
      description:
        "'Am I on track for $1M by 55?', 'what will I have in 20 years?', 'how long does my money last if I take $3,500 a month?'. Projects the portfolio (or one account) forward with a monthly deposit or withdrawal at 4%, 6% and 8% a year (or one rate the user gives), compounded monthly; for withdrawals it adds a bad start (−20% then −10% in the first two years). Returns the assumptions it used (start value, monthly amount and where it came from, the portfolio's own past yearly rate) and per rate: value at the horizon, amount put in, growth, when the target is reached, when withdrawals run out. Never project or compound yourself.",
      inputSchema: z.object({
        targetUsd: z.number().positive().optional().describe("Value to reach, e.g. 1000000"),
        years: z
          .number()
          .positive()
          .max(60)
          .optional()
          .describe("Horizon in years (e.g. 55 minus their age); default 20"),
        monthlyUsd: z
          .number()
          .optional()
          .describe("Monthly amount added, negative to take out; omit to use their own pace over the last 12 months"),
        yearlyReturnPct: z
          .number()
          .min(-20)
          .max(20)
          .optional()
          .describe("Only when the user names a return; otherwise omit for the 4/6/8% range"),
        yearlyRaisePct: z
          .number()
          .min(0)
          .max(10)
          .optional()
          .describe("Yearly raise of the monthly amount; default 3 for withdrawals (inflation), 0 for deposits"),
        account: z
          .string()
          .optional()
          .describe("Start from this account's value only (name or part of it), e.g. when they leave the IRA out"),
      }),
      run: timed("project_growth", async (request: ProjectionRequest) =>
        json(await api.projectGrowth(request)),
      ),
    }),
    betaZodTool({
      name: "pick_next_buy",
      description:
        "'I have $n, where should it go?' Ranks 1–5 candidate symbols for one buy of the whole amount, deterministically: 60% fit with what the user holds (lower weight after the buy wins; a single stock or coin's weight counts double, since a fund of many companies is already spread out),40% how far each sits below its 1-year high and the user's average cost; with a target mix, 90% how far short of its target each is and 10% the dip (close calls only). Returns picks best first, each with a one-sentence reason and the account it belongs in. The first pick is the answer; the second is 'another option'.",
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
