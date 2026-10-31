import { splitFactorAfter, type SplitEvent } from "./splits";
import { D, DAY_MS, ZERO, toIsoDate, type Decimal, type IsoDate, type Numeric } from "./types";

/** One holding to estimate: what's held now and what it paid per share. */
export interface DividendHolding {
  key: string;
  /** Units held now (all accounts). */
  quantity: Numeric;
  /** Market value now; null when unpriced. */
  value: Numeric | null;
  costBasis: Numeric;
  /** Cash per share by ex-dividend date, in the units of that date (unadjusted). */
  payments: { date: IsoDate; amount: Numeric }[];
  /** Splits for the asset, so a pre-split payment counts per present share. */
  splits?: SplitEvent[];
}

export interface DividendHoldingEstimate {
  key: string;
  quantity: number;
  /** Cash per present share over the trailing year. */
  perShareYearly: number;
  /** Payments (ex-dates) in the trailing year: 4 = quarterly, 12 = monthly. */
  paymentsPerYear: number;
  /** Units held now × per share paid over the trailing year. */
  yearlyUsd: number;
  yieldOnValuePct: number | null;
  yieldOnCostPct: number | null;
  lastExDate: IsoDate;
  /** Months (1–12) it went ex-dividend in the trailing year. */
  months: number[];
}

export interface DividendIncomeEstimate {
  yearlyUsd: number;
  monthlyAverageUsd: number;
  /** Over the value / cost of every holding passed in, payers or not. */
  yieldOnValuePct: number | null;
  yieldOnCostPct: number | null;
  /** Jan..Dec: what the units held now would have received in each month of
   *  the trailing year, by ex-dividend month. Always 12 entries. */
  byMonth: { month: number; usd: number }[];
  /** Payers, biggest yearly amount first. */
  holdings: DividendHoldingEstimate[];
  /** Holdings with no payment in the trailing year. */
  noPayments: string[];
}

const cents = (d: Decimal) => d.toDecimalPlaces(2).toNumber();
const pct = (num: Decimal, den: Decimal) =>
  den.gt(0) ? num.div(den).mul(100).toDecimalPlaces(2).toNumber() : null;

/**
 * Yearly dividend income from what is held now: each holding's cash per share
 * over the year to `asOf` (ex-dates in (asOf − 365 days, asOf]), split-adjusted
 * to present shares, times the units held now. A trailing figure, not a
 * forecast: a cut, a raise or a one-off special payout in that year shows as is.
 */
export function estimateDividendIncome(
  holdings: DividendHolding[],
  asOf: IsoDate,
): DividendIncomeEstimate {
  const from = toIsoDate(new Date(Date.parse(asOf) - 365 * DAY_MS));
  const byMonth = Array.from({ length: 12 }, () => ZERO);
  const payers: DividendHoldingEstimate[] = [];
  const noPayments: string[] = [];
  let yearly = ZERO;
  let totalValue = ZERO;
  let totalCost = ZERO;

  for (const h of holdings) {
    const qty = D(h.quantity);
    const value = h.value === null ? null : D(h.value);
    const cost = D(h.costBasis);
    if (value !== null) totalValue = totalValue.add(value);
    totalCost = totalCost.add(cost);

    const inWindow = h.payments
      .filter((p) => p.date > from && p.date <= asOf && D(p.amount).gt(0))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (inWindow.length === 0) {
      noPayments.push(h.key);
      continue;
    }
    let perShare = ZERO;
    const months = new Set<number>();
    for (const p of inWindow) {
      const amount = D(p.amount).div(splitFactorAfter(h.splits ?? [], p.date));
      perShare = perShare.add(amount);
      const month = Number(p.date.slice(5, 7));
      months.add(month);
      byMonth[month - 1] = byMonth[month - 1]!.add(amount.mul(qty));
    }
    const holdingYearly = perShare.mul(qty);
    yearly = yearly.add(holdingYearly);
    payers.push({
      key: h.key,
      quantity: qty.toNumber(),
      perShareYearly: perShare.toDecimalPlaces(4).toNumber(),
      paymentsPerYear: inWindow.length,
      yearlyUsd: cents(holdingYearly),
      yieldOnValuePct: value === null ? null : pct(holdingYearly, value),
      yieldOnCostPct: pct(holdingYearly, cost),
      lastExDate: inWindow[inWindow.length - 1]!.date,
      months: [...months].sort((a, b) => a - b),
    });
  }

  payers.sort((a, b) => b.yearlyUsd - a.yearlyUsd || a.key.localeCompare(b.key));
  return {
    yearlyUsd: cents(yearly),
    monthlyAverageUsd: cents(yearly.div(12)),
    yieldOnValuePct: pct(yearly, totalValue),
    yieldOnCostPct: pct(yearly, totalCost),
    byMonth: byMonth.map((usd, i) => ({ month: i + 1, usd: cents(usd) })),
    holdings: payers,
    noPayments,
  };
}
