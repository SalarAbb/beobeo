import type { IsoDate } from "./types";

/**
 * Portfolio quality metrics derived from a daily {value, invested} series
 * (the output shape of portfolioTimeSeries). Everything here is a *rate* —
 * like xirr, floats are fine; the precision-sensitive Decimal work already
 * happened when the series was built.
 */

/** One day of a value series. Plain numbers so the cached/JSON timeseries
 *  output can be fed in directly. */
export interface MetricSeriesPoint {
  date: IsoDate;
  /** Mark-to-market portfolio value. */
  value: number;
  /** Cumulative net cash contributed (buys + fees − sell proceeds). */
  invested: number;
}

export interface DailyReturn {
  date: IsoDate;
  /** Flow-adjusted simple return for the day (0.01 = +1%). */
  r: number;
  /** Capital at risk that day (the return's denominator). Used to weight
   *  risk statistics by how much money the day actually involved — a tiny
   *  early portfolio must not dominate the stats of a large later one.
   *  Optional: absent means weight 1 (unweighted). */
  base?: number;
}

/** Trading days per year for annualizing daily volatility. */
const TRADING_DAYS = 252;

/** Annualizing over less than ~2 days amplifies noise into absurd rates —
 *  same guard as xirr. */
const MIN_ANNUALIZE_DAYS = 2;

/** A day whose net flow exceeds this share of the prior value is
 *  "flow-dominated" — its implied return is mostly valuation noise. */
const FLOW_DOMINANCE = 0.25;
/** An extreme implied move on a flow-dominated day is treated as a data
 *  artifact, not a market move. */
const ARTIFACT_RETURN = 0.25;

/**
 * Flow-adjusted daily returns: r_t = V_t / (V_{t−1} + ΔI_t) − 1.
 * Transactions apply at the start of the day in portfolioTimeSeries, so the
 * day's net flow (ΔI, the invested delta) sits in the denominator. Days where
 * the denominator is ≤ 0 (empty portfolio, full same-day withdrawal) are
 * skipped — there is no capital at risk to earn a return on.
 *
 * Artifact guard: an extreme "return" on a day dominated by a deposit or
 * withdrawal is almost always a valuation mismatch (an asset bought before
 * its first cached close, an import priced far from market), not a market
 * move. One such fake ±40% day permanently poisons volatility, drawdown and
 * peak tracking, so those days are dropped. A genuine crash on a day
 * without large flows is untouched.
 */
export function dailyReturns(series: MetricSeriesPoint[]): DailyReturn[] {
  const returns: DailyReturn[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!;
    const cur = series[i]!;
    const flow = cur.invested - prev.invested;
    const base = prev.value + flow;
    if (base <= 0) continue;
    const r = cur.value / base - 1;
    if (
      Math.abs(flow) > FLOW_DOMINANCE * prev.value &&
      Math.abs(r) > ARTIFACT_RETURN
    )
      continue;
    returns.push({ date: cur.date, r, base });
  }
  return returns;
}

/** Cumulative time-weighted return: chained (1+r) − 1. */
export function chainReturns(returns: DailyReturn[]): number {
  let index = 1;
  for (const { r } of returns) index *= 1 + r;
  return index - 1;
}

/** Annualize a cumulative return over a span. Null under ~2 days (noise). */
export function annualize(cumulative: number, spanDays: number): number | null {
  if (spanDays < MIN_ANNUALIZE_DAYS || cumulative <= -1) return null;
  return Math.pow(1 + cumulative, 365 / spanDays) - 1;
}

/** Worst peak-to-trough decline of the chained return index (≤ 0). */
export function maxDrawdown(returns: DailyReturn[]): number {
  let index = 1;
  let peak = 1;
  let worst = 0;
  for (const { r } of returns) {
    index *= 1 + r;
    if (index > peak) peak = index;
    const dd = index / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst;
}

/** How far the chained return index sits below its running peak at the END
 *  of the series (≤ 0; 0 = at an all-time high right now). The
 *  present-focused sibling of maxDrawdown. */
export function currentDrawdown(returns: DailyReturn[]): number {
  let index = 1;
  let peak = 1;
  for (const { r } of returns) {
    index *= 1 + r;
    if (index > peak) peak = index;
  }
  return index / peak - 1;
}

/** Return days with an actual move. Exact-zero days are forward-fill
 *  artifacts (weekends/holidays for equities); real weekend moves (crypto)
 *  survive because they are non-zero. */
const activeDays = (returns: DailyReturn[]): DailyReturn[] =>
  returns.filter(({ r }) => r !== 0);

/** Capital-weighted mean and variance of the active-day returns. Each day
 *  weighs as much as the money it involved (`base`; 1 when absent), so
 *  risk stats describe what a typical *dollar* experienced — a $2k early
 *  portfolio can't dominate the stats of the $200k it became. */
function weightedMoments(
  active: DailyReturn[],
): { mean: number; variance: number } {
  let sumW = 0;
  let sumWR = 0;
  for (const { r, base } of active) {
    const w = base ?? 1;
    sumW += w;
    sumWR += w * r;
  }
  const mean = sumWR / sumW;
  let sumWD = 0;
  for (const { r, base } of active) {
    const w = base ?? 1;
    sumWD += w * (r - mean) * (r - mean);
  }
  return { mean, variance: sumWD / sumW };
}

/**
 * Annualized volatility: capital-weighted stdev of non-zero daily returns
 * × √252. Null when fewer than 5 usable observations (too noisy).
 */
export function volatility(returns: DailyReturn[]): number | null {
  const active = activeDays(returns);
  if (active.length < 5) return null;
  return Math.sqrt(weightedMoments(active).variance) * Math.sqrt(TRADING_DAYS);
}

/**
 * Sharpe ratio from the same capital-weighted moments as `volatility`:
 * (annualized weighted mean daily return − risk-free) / weighted vol.
 * Both sides are dollar-weighted, so it reads "reward a typical dollar of
 * mine earned per unit of the swings it endured". Null when volatility is
 * unavailable or zero.
 */
export function sharpe(
  returns: DailyReturn[],
  riskFreeAnnual: number,
): number | null {
  const active = activeDays(returns);
  if (active.length < 5) return null;
  const { mean, variance } = weightedMoments(active);
  const vol = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS);
  if (vol === 0) return null;
  const annual = Math.pow(1 + mean, TRADING_DAYS) - 1;
  return (annual - riskFreeAnnual) / vol;
}

/**
 * Drawdowns of the DOLLAR value series — exactly what the portfolio chart
 * shows, so "off your peak" always agrees with the user's eyes. Days
 * before the first positive value are skipped. Deliberately flow-blind
 * (a withdrawal reads as a dip): chart-consistency beats purity here —
 * the time-weighted return index told users at their all-time high they
 * were "58% below peak" because a tiny early position once mooned.
 */
export function valueDrawdown(
  series: MetricSeriesPoint[],
): { max: number; current: number } | null {
  let peak = 0;
  let worst = 0;
  let current = 0;
  for (const { value } of series) {
    if (value <= 0 && peak === 0) continue;
    if (value > peak) peak = value;
    if (peak > 0) {
      current = value / peak - 1;
      if (current < worst) worst = current;
    }
  }
  if (peak === 0) return null;
  return { max: worst, current };
}

/** Invested capital must reach this share of its peak before drawdowns count. */
const MATERIAL_SHARE = 0.1;

/**
 * The drawdown a person recognizes as "my portfolio fell": the worst peak-to-trough decline
 * of the flow-adjusted return index (deposits and sales never look like gains or losses),
 * counted only from the first day invested capital reached 10% of its peak. Before that the
 * portfolio was a different, much smaller thing: a real account showed "−90%" because its
 * first $1k was all LINK in 2021, while ~$227k later came in over 2025–26. Comparisons over
 * the same flows (DCA benchmarks) get the same start date, so columns stay apples to apples.
 */
export function materialDrawdown(
  series: MetricSeriesPoint[],
): { max: number; from: IsoDate } | null {
  const peakInvested = Math.max(0, ...series.map((p) => p.invested));
  if (peakInvested <= 0) return null;
  const start = series.findIndex((p) => p.invested >= MATERIAL_SHARE * peakInvested);
  const slice = series.slice(start);
  if (slice.length < 2) return null;
  return { max: maxDrawdown(dailyReturns(slice)), from: slice[0]!.date };
}

/** Best and worst single days among days with an actual move. */
export function bestWorstDay(
  returns: DailyReturn[],
): { best: DailyReturn; worst: DailyReturn } | null {
  const active = activeDays(returns);
  if (active.length === 0) return null;
  let best = active[0]!;
  let worst = active[0]!;
  for (const day of active) {
    if (day.r > best.r) best = day;
    if (day.r < worst.r) worst = day;
  }
  return { best, worst };
}
