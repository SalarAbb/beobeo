import { D, type Numeric, type IsoDate } from "./types";
import type { PriceSeries } from "./timeseries";

/** A corporate-action split known for an asset. */
export interface SplitEvent {
  date: IsoDate;
  /** Transaction convention: 4 = 4-for-1, 0.25 = 1-for-4 reverse.
   *  The close ON `date` is already post-split. */
  ratio: Numeric;
}

/**
 * Split-adjust an unadjusted close series into present-day units: every close
 * strictly before a split date is divided by that split's ratio (compounded
 * across multiple splits). This makes a series safe for synthetic replays
 * (DCA benchmarks) and display overlays where no split transaction exists to
 * multiply the unit count — without it, units bought at pre-split prices get
 * marked at post-split prices and the value cliffs by the ratio.
 */
export function adjustForSplits(
  prices: PriceSeries,
  splits: SplitEvent[],
): PriceSeries {
  if (splits.length === 0) return prices;
  const sorted = [...splits]
    .map((s) => ({ date: s.date, ratio: D(s.ratio) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: PriceSeries = new Map();
  for (const [date, close] of prices) {
    let factor = D(1);
    for (const s of sorted) {
      if (date < s.date) factor = factor.mul(s.ratio);
    }
    out.set(date, factor.eq(1) ? close : close.div(factor));
  }
  return out;
}

/**
 * Compound ratio of all splits strictly after `date` — the factor to divide a
 * historical per-unit figure (trade price, avg cost) by to express it in
 * present-day units.
 */
export function splitFactorAfter(splits: SplitEvent[], date: IsoDate) {
  let factor = D(1);
  for (const s of splits) {
    if (date < s.date) factor = factor.mul(D(s.ratio));
  }
  return factor;
}
