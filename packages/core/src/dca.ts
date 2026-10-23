import { xirr } from "./xirr";
import type { DailyPoint, PriceSeries } from "./timeseries";
import {
  D,
  DAY_MS,
  ZERO,
  toIsoDate,
  type Decimal,
  type EngineTransaction,
  type IsoDate,
} from "./types";

/** A dated net cash movement into (+) or out of (−) the portfolio. */
export interface CashFlow {
  date: Date;
  amount: Decimal;
}

/**
 * Extract the user's investable cash flows from their transaction history.
 * Buys (cost + fees) are inflows; sell proceeds (net of fees) are outflows.
 * Transfers count at their recorded price (0 if none). Dividends are internal
 * income, not contributed capital — excluded.
 */
export function extractCashFlows(txns: EngineTransaction[]): CashFlow[] {
  const flows: CashFlow[] = [];
  for (const txn of txns) {
    const price = txn.pricePerUnit ?? ZERO;
    let amount: Decimal | null = null;
    switch (txn.type) {
      case "buy":
      case "transfer_in":
        amount = txn.quantity.mul(price).add(txn.fees);
        break;
      case "sell":
      case "transfer_out":
        amount = txn.quantity.mul(price).sub(txn.fees).neg();
        break;
      case "fee":
        amount = txn.fees;
        break;
      case "dividend":
      case "split":
        break;
    }
    if (amount !== null && !amount.isZero()) {
      flows.push({ date: txn.tradedAt, amount });
    }
  }
  return flows;
}

/** One asset in the benchmark basket. Weights must sum to 1. */
export interface BenchmarkComponent {
  prices: PriceSeries;
  weight: Decimal;
}

export interface DcaReplayResult {
  /** Daily value/invested series for the simulated benchmark portfolio. */
  series: DailyPoint[];
  /** Units held per basket component at the end. */
  finalUnits: Decimal[];
  /** Annualized money-weighted return (XIRR), null if not computable. */
  moneyWeightedReturn: number | null;
}

/**
 * Replay the user's cash flows against a benchmark basket: every inflow buys
 * the basket at that date's price (next trading day if markets were closed),
 * every outflow sells proportionally. Produces a value curve directly
 * comparable with the real portfolio's.
 */
export function replayDca(opts: {
  /** Sorted by date ascending. */
  flows: CashFlow[];
  benchmark: BenchmarkComponent[];
  to: IsoDate;
}): DcaReplayResult {
  const { flows, benchmark, to } = opts;
  if (flows.length === 0 || benchmark.length === 0) {
    return { series: [], finalUnits: [], moneyWeightedReturn: null };
  }

  const lookups = benchmark.map((c) => makePriceLookup(c.prices));
  const units: Decimal[] = benchmark.map(() => ZERO);

  const series: DailyPoint[] = [];
  let invested = ZERO;
  let flowIdx = 0;

  const startMs = Date.parse(`${toIsoDate(flows[0]!.date)}T00:00:00Z`);
  const endMs = Date.parse(`${to}T00:00:00Z`);

  for (let dayMs = startMs; dayMs <= endMs; dayMs += DAY_MS) {
    const day = toIsoDate(new Date(dayMs));

    while (flowIdx < flows.length && toIsoDate(flows[flowIdx]!.date) <= day) {
      const flow = flows[flowIdx]!;
      for (let i = 0; i < benchmark.length; i++) {
        const slice = flow.amount.mul(benchmark[i]!.weight);
        const price = lookups[i]!.onOrAfter(toIsoDate(flow.date));
        if (price !== null && price.gt(0)) {
          const bought = slice.div(price);
          const next = units[i]!.add(bought);
          // Withdrawals can't sell more than is held.
          units[i] = next.lt(0) ? ZERO : next;
        }
      }
      invested = invested.add(flow.amount);
      flowIdx++;
    }

    let value = ZERO;
    for (let i = 0; i < benchmark.length; i++) {
      const price = lookups[i]!.forwardFill(day);
      if (price !== null) value = value.add(units[i]!.mul(price));
    }
    series.push({ date: day, value, invested });
  }

  // XIRR: contributions are negative (money out of pocket), final value positive.
  const xirrFlows = flows.map((f) => ({ date: f.date, amount: f.amount.neg() }));
  const last = series[series.length - 1]!;
  xirrFlows.push({
    date: new Date(`${last.date}T00:00:00Z`),
    amount: last.value,
  });

  return {
    series,
    finalUnits: units,
    moneyWeightedReturn: xirr(xirrFlows),
  };
}

interface PriceLookup {
  /** First close on or after `date` (execution price for a queued order); falls back to the last close before it. */
  onOrAfter(date: IsoDate): Decimal | null;
  /** Last close on or before `date` (mark-to-market). Must be called with ascending dates. */
  forwardFill(date: IsoDate): Decimal | null;
}

function makePriceLookup(prices: PriceSeries): PriceLookup {
  const dates = [...prices.keys()].sort();
  let ffIdx = -1;
  let ffPrice: Decimal | null = null;

  return {
    onOrAfter(date) {
      // binary search: first index with dates[i] >= date
      let lo = 0;
      let hi = dates.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (dates[mid]! < date) lo = mid + 1;
        else hi = mid;
      }
      const key = dates[lo] ?? dates[dates.length - 1];
      return key !== undefined ? D(prices.get(key)!) : null;
    },
    forwardFill(date) {
      while (ffIdx + 1 < dates.length && dates[ffIdx + 1]! <= date) {
        ffIdx++;
        ffPrice = prices.get(dates[ffIdx]!)!;
      }
      return ffPrice;
    },
  };
}
