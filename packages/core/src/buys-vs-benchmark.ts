import type { PriceSeries } from "./timeseries";
import { D, toIsoDate, type Decimal, type EngineTransaction, type IsoDate } from "./types";

/** One buy, set against the same dollars put into a benchmark that day. */
export interface BuyVsBenchmark {
  txnId: string;
  assetId: string;
  date: IsoDate;
  /** Units bought, in present-day units (later splits applied). */
  unitsNow: Decimal;
  /** quantity × price + fees: what the buy took out of pocket. */
  cost: Decimal;
  /** unitsNow × the asset's latest price; null without a price. */
  valueNow: Decimal | null;
  /** cost ÷ the benchmark's close that day (next close if it was shut) × its latest close. */
  benchmarkValueNow: Decimal | null;
  /** valueNow − benchmarkValueNow: negative = the benchmark would have done better. */
  edge: Decimal | null;
}

/**
 * Every buy, valued as if still held, next to the same money in a benchmark
 * bought the same day ("which of my dip buys did worst against VOO?").
 * Sales are ignored on purpose: the question is about the buy decision.
 * `benchmark` must be split-adjusted (`adjustForSplits`); the user's own
 * split transactions (synthetic ones included) scale each buy's units.
 * Rows come back worst edge first; rows without prices sort last.
 */
export function buysVsBenchmark(
  txns: EngineTransaction[],
  latestPrices: Map<string, Decimal>,
  benchmark: PriceSeries,
): BuyVsBenchmark[] {
  const benchDates = [...benchmark.keys()].sort();
  const lastBenchDate = benchDates[benchDates.length - 1];
  const benchNow = lastBenchDate === undefined ? null : D(benchmark.get(lastBenchDate)!);
  const benchOnOrAfter = (date: IsoDate) => {
    const key = benchDates.find((d) => d >= date) ?? lastBenchDate;
    return key === undefined ? null : D(benchmark.get(key)!);
  };

  const splits = txns.filter((t) => t.type === "split");
  const rows = txns
    .filter((t) => t.type === "buy" && t.pricePerUnit !== null)
    .map((t): BuyVsBenchmark => {
      const date = toIsoDate(t.tradedAt);
      const factor = splits
        .filter((s) => s.assetId === t.assetId && toIsoDate(s.tradedAt) > date)
        .reduce((f, s) => f.mul(s.quantity), D(1));
      const unitsNow = t.quantity.mul(factor);
      const cost = t.quantity.mul(t.pricePerUnit!).add(t.fees);
      const price = latestPrices.get(t.assetId);
      const valueNow = price ? unitsNow.mul(price) : null;
      const benchAtBuy = benchOnOrAfter(date);
      const benchmarkValueNow =
        benchAtBuy && benchNow && benchAtBuy.gt(0) ? cost.div(benchAtBuy).mul(benchNow) : null;
      return {
        txnId: t.id,
        assetId: t.assetId,
        date,
        unitsNow,
        cost,
        valueNow,
        benchmarkValueNow,
        edge: valueNow && benchmarkValueNow ? valueNow.sub(benchmarkValueNow) : null,
      };
    });
  return rows.sort((a, b) => {
    if (a.edge === null || b.edge === null) return a.edge === null ? (b.edge === null ? 0 : 1) : -1;
    return a.edge.cmp(b.edge) || a.date.localeCompare(b.date);
  });
}
