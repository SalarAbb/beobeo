/**
 * The market as personas see it. A PriceBook holds daily closes per symbol;
 * every read takes an `asOf` date and NEVER returns data after it — personas
 * must not trade on tomorrow's prices.
 *
 * Floats are deliberate here: personas are humans typing numbers into the
 * app, not the ledger. Exact money math stays in @beobeo/core; quantities
 * cross into the app as fixed-precision strings (see `fmtQty`).
 */
export type IsoDate = string;

export interface Close {
  date: IsoDate;
  close: number;
}

export class PriceBook {
  private dates = new Map<string, IsoDate[]>();
  private closes = new Map<string, Map<IsoDate, number>>();

  constructor(series: Map<string, Map<IsoDate, number>>) {
    for (const [symbol, s] of series) {
      this.closes.set(symbol, s);
      this.dates.set(symbol, [...s.keys()].sort());
    }
  }

  /** Record a price for `date` (today's live quote, before the close exists). */
  setClose(symbol: string, date: IsoDate, close: number): void {
    const s = this.closes.get(symbol) ?? new Map<IsoDate, number>();
    s.set(date, close);
    this.closes.set(symbol, s);
    this.dates.set(symbol, [...s.keys()].sort());
  }

  symbols(): string[] {
    return [...this.closes.keys()];
  }

  /** True when the symbol printed a close exactly on `date` (a trading day for it). */
  tradesOn(symbol: string, date: IsoDate): boolean {
    return this.closes.get(symbol)?.has(date) ?? false;
  }

  /** Latest close on or before `asOf`, or null if none (pre-listing / unknown). */
  closeAsOf(symbol: string, asOf: IsoDate): Close | null {
    const ds = this.dates.get(symbol);
    if (!ds || ds.length === 0) return null;
    let lo = 0;
    let hi = ds.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ds[mid]! <= asOf) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) return null;
    const date = ds[found]!;
    return { date, close: this.closes.get(symbol)!.get(date)! };
  }

  /** % change from the close `lookbackDays` calendar days before asOf to asOf. */
  changePct(symbol: string, asOf: IsoDate, lookbackDays: number): number | null {
    const now = this.closeAsOf(symbol, asOf);
    const then = this.closeAsOf(symbol, addDays(asOf, -lookbackDays));
    if (!now || !then || then.close === 0) return null;
    return (now.close / then.close - 1) * 100;
  }

  /** Closes in (asOf - days, asOf], oldest first — for the mind's market brief. */
  window(symbol: string, asOf: IsoDate, days: number): Close[] {
    const from = addDays(asOf, -days);
    const ds = this.dates.get(symbol) ?? [];
    const s = this.closes.get(symbol)!;
    return ds.filter((d) => d > from && d <= asOf).map((d) => ({ date: d, close: s.get(d)! }));
  }
}

export function addDays(date: IsoDate, n: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function todayIso(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

/** Quantity as the string the app expects: crypto to 8 dp, everything else 6. */
export function fmtQty(qty: number, isCrypto: boolean): string {
  return qty.toFixed(isCrypto ? 8 : 6).replace(/\.?0+$/, "");
}
