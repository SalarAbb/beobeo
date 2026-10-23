import { ZERO, type Decimal, type RealizedGain } from "./types";

export interface YearlyRealized {
  year: number;
  shortTerm: Decimal;
  longTerm: Decimal;
  total: Decimal;
  /** Individual sale slices for drill-down. */
  entries: RealizedGain[];
}

/** Group realized gains by calendar year of the sale (UTC). */
export function realizedByYear(gains: RealizedGain[]): YearlyRealized[] {
  const byYear = new Map<number, YearlyRealized>();
  for (const g of gains) {
    const year = g.soldAt.getUTCFullYear();
    let bucket = byYear.get(year);
    if (!bucket) {
      bucket = { year, shortTerm: ZERO, longTerm: ZERO, total: ZERO, entries: [] };
      byYear.set(year, bucket);
    }
    if (g.longTerm) {
      bucket.longTerm = bucket.longTerm.add(g.gain);
    } else {
      bucket.shortTerm = bucket.shortTerm.add(g.gain);
    }
    bucket.total = bucket.total.add(g.gain);
    bucket.entries.push(g);
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}
