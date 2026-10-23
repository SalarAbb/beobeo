import { DAY_MS, type Decimal } from "./types";

export interface DatedCashFlow {
  date: Date;
  /** Standard XIRR sign convention: investments negative, returns positive. */
  amount: Decimal;
}

/**
 * Money-weighted annualized return (Excel-style XIRR). Rate solving is done
 * in floats — the precision-sensitive parts (values, basis) stay in Decimal;
 * a return *rate* does not need 38 digits.
 *
 * Returns null when there's no meaningful solution (all flows same sign,
 * or no convergence).
 */
export function xirr(flows: DatedCashFlow[], guess = 0.1): number | null {
  if (flows.length < 2) return null;
  const amounts = flows.map((f) => f.amount.toNumber());
  const hasNegative = amounts.some((a) => a < 0);
  const hasPositive = amounts.some((a) => a > 0);
  if (!hasNegative || !hasPositive) return null;

  const t0 = flows[0]!.date.getTime();
  const years = flows.map((f) => (f.date.getTime() - t0) / (365 * DAY_MS));

  // Annualizing over less than ~2 days amplifies rounding noise into absurd
  // rates (a +0.1% same-day gain "annualizes" to millions of percent).
  if (Math.max(...years) < 2 / 365) return null;

  const npv = (rate: number): number => {
    let sum = 0;
    for (let i = 0; i < amounts.length; i++) {
      sum += amounts[i]! / Math.pow(1 + rate, years[i]!);
    }
    return sum;
  };

  // Newton's method
  let rate = guess;
  for (let iter = 0; iter < 100; iter++) {
    const f = npv(rate);
    if (Math.abs(f) < 1e-9) return rate;
    const h = 1e-6;
    const derivative = (npv(rate + h) - f) / h;
    if (derivative === 0 || !Number.isFinite(derivative)) break;
    const next = rate - f / derivative;
    if (next <= -0.999999) break;
    if (Math.abs(next - rate) < 1e-10) return next;
    rate = next;
  }

  // Bisection fallback on [-0.9999, 100]
  let lo = -0.9999;
  let hi = 100;
  let fLo = npv(lo);
  if (!Number.isFinite(fLo)) return null;
  if (fLo * npv(hi) > 0) return null;
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-9) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}
