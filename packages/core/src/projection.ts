/**
 * Growth projection over plain numbers (like metrics.ts; a projection is an
 * estimate, so floats are fine): a starting value plus the same amount every
 * month (negative = a withdrawal), grown at an assumed yearly return
 * compounded monthly. Powers the chat's "am I on track for $1M?" and "how
 * long does my money last?" answers, so the model states assumptions it was
 * handed instead of inventing rates and compounding in its head.
 */
export interface ProjectionInput {
  startValue: number;
  /** Added at the end of every month; negative = taken out. */
  monthly: number;
  /** Assumed yearly return in percent (7 = 7%). */
  yearlyReturnPct: number;
  /** Horizon for the yearly path and the end value. */
  years: number;
  /** Yearly returns (percent) for the first years instead of
   *  `yearlyReturnPct`, e.g. [-20, -10] for a bad start. */
  firstYearsPct?: number[];
  /** The monthly amount grows by this much each year (percent), e.g. 3 to
   *  keep a withdrawal level with inflation. */
  yearlyRaisePct?: number;
  /** Value to reach; the month it's first reached is searched up to 100 years. */
  target?: number;
}

export interface ProjectionYear {
  /** 1 = the end of the first year. */
  year: number;
  value: number;
  /** Net amount added so far by the monthly deposits (negative = taken out). */
  putIn: number;
}

export interface Projection {
  yearly: ProjectionYear[];
  endValue: number;
  /** Net amount the monthly deposits added over the horizon. */
  putIn: number;
  /** endValue − startValue − putIn: what the returns did. */
  growth: number;
  /** Months until the value first reaches `target` (0 = already there);
   *  null when not asked or not within 100 years. */
  targetInMonths: number | null;
  /** Months until withdrawals empty it (searched up to 100 years); null when
   *  it lasts that long or nothing is withdrawn. */
  runsOutInMonths: number | null;
}

const MAX_MONTHS = 1200;

export function projectGrowth(input: ProjectionInput): Projection {
  const { startValue, monthly, yearlyReturnPct, years, target } = input;
  const horizon = Math.min(MAX_MONTHS, Math.max(0, Math.round(years * 12)));
  const raise = 1 + (input.yearlyRaisePct ?? 0) / 100;
  const monthlyRate = (yearIdx: number) =>
    Math.pow(1 + (input.firstYearsPct?.[yearIdx] ?? yearlyReturnPct) / 100, 1 / 12) - 1;

  let value = startValue;
  let putIn = 0;
  let targetInMonths = target !== undefined && startValue >= target ? 0 : null;
  let runsOutInMonths: number | null = null;
  const yearly: ProjectionYear[] = [];
  let endValue = horizon === 0 ? startValue : 0;
  let endPutIn = 0;

  for (let m = 1; m <= MAX_MONTHS; m++) {
    const yearIdx = Math.floor((m - 1) / 12);
    const searching =
      (target !== undefined && targetInMonths === null) ||
      (monthly < 0 && runsOutInMonths === null);
    if (m > horizon && !searching) break;

    if (runsOutInMonths === null) {
      const amount = monthly * Math.pow(raise, yearIdx);
      value = value * (1 + monthlyRate(yearIdx)) + amount;
      putIn += amount;
      if (monthly < 0 && value <= 0) {
        // The last withdrawal only took what was left.
        putIn -= value;
        value = 0;
        runsOutInMonths = m;
      }
      if (target !== undefined && targetInMonths === null && value >= target) targetInMonths = m;
    }
    if (m <= horizon && m % 12 === 0) yearly.push({ year: m / 12, value, putIn });
    if (m === horizon) {
      endValue = value;
      endPutIn = putIn;
    }
  }

  return {
    yearly,
    endValue,
    putIn: endPutIn,
    growth: endValue - startValue - endPutIn,
    targetInMonths,
    runsOutInMonths,
  };
}
