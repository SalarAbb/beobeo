import type { IsoDate } from "@beobeo/core";

export interface Coverage {
  min: IsoDate;
  max: IsoDate;
}

export interface FetchRange {
  from: IsoDate;
  to: IsoDate;
}

/**
 * Decide which date span(s) must be fetched from a provider given what the
 * cache already covers. Pure function — unit-tested independently of the DB.
 *
 * The tail is behind when a trading day falls strictly between the cache's
 * last close and `to` (`to` itself is left out: its close may not be
 * published yet). `calendar` says which days trade: crypto every day,
 * equities on weekdays, so a weekend never refetches. A market holiday asks
 * once and the empty answer is negative-cached by the caller. A fixed 4-day
 * tolerance used to serve Tuesday's close until Saturday.
 */
export function planFetch(
  coverage: Coverage | null,
  from: IsoDate,
  to: IsoDate,
  calendar: "weekdays" | "daily" = "weekdays",
): FetchRange[] {
  if (!coverage) return [{ from, to }];

  const ranges: FetchRange[] = [];
  if (coverage.min > from) {
    ranges.push({ from, to: dayBefore(coverage.min) });
  }
  if (tradingDayBetween(coverage.max, to, calendar)) {
    ranges.push({ from: dayAfter(coverage.max), to });
  }
  return ranges;
}

const addDays = (d: IsoDate, n: number): IsoDate =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** Is there a trading day strictly after `after` and strictly before `before`? */
function tradingDayBetween(
  after: IsoDate,
  before: IsoDate,
  calendar: "weekdays" | "daily",
): boolean {
  for (let d = dayAfter(after); d < before; d = dayAfter(d)) {
    if (calendar === "daily") return true;
    const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return true;
  }
  return false;
}

const dayBefore = (d: IsoDate): IsoDate => addDays(d, -1);
const dayAfter = (d: IsoDate): IsoDate => addDays(d, 1);
