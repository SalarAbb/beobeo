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
 * `staleDays` tolerates the trailing gap of non-trading days (weekends,
 * holidays) so we don't re-fetch every request: the cache is considered
 * current if its max date is within `staleDays` of the requested `to`.
 */
export function planFetch(
  coverage: Coverage | null,
  from: IsoDate,
  to: IsoDate,
  staleDays = 4,
): FetchRange[] {
  if (!coverage) return [{ from, to }];

  const ranges: FetchRange[] = [];
  if (coverage.min > from) {
    ranges.push({ from, to: dayBefore(coverage.min) });
  }
  const staleCutoff = addDays(coverage.max, staleDays);
  if (staleCutoff < to) {
    ranges.push({ from: dayAfter(coverage.max), to });
  }
  return ranges;
}

const addDays = (d: IsoDate, n: number): IsoDate =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);

const dayBefore = (d: IsoDate): IsoDate => addDays(d, -1);
const dayAfter = (d: IsoDate): IsoDate => addDays(d, 1);
