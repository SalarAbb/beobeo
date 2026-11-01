import type { Holdings } from "./holdings";
import type { IsoDate } from "./world";

/** symbol → ex-date → cash per share (real provider payouts, unadjusted). */
export type DividendBook = Map<string, Map<IsoDate, number>>;

export interface DividendFill {
  date: IsoDate;
  account: string;
  symbol: string;
  /** Cash paid, rounded to the cent (the app stores it as quantity 1 × this). */
  cash: number;
}

/**
 * Payouts with an ex-date of `date`, for the units held before that day's
 * trades (a buy on the ex-date doesn't qualify). Recorded on the ex-date, the
 * same day the app's dividend estimate keys its months on; a real broker pays
 * a few weeks later. Cash isn't reinvested, so holdings don't change.
 */
export function dividendsOn(holdings: Holdings, book: DividendBook, date: IsoDate): DividendFill[] {
  const out: DividendFill[] = [];
  for (const { account, symbol, pos } of holdings.positions()) {
    const perShare = book.get(symbol)?.get(date);
    if (!perShare) continue;
    const cash = Math.round(pos.qty * perShare * 100) / 100;
    if (cash > 0) out.push({ date, account, symbol, cash });
  }
  return out;
}
