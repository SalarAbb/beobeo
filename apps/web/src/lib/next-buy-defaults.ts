/**
 * What "Where should my next buy go?" asks before anything is typed: the
 * three largest holdings (≥ $1, so dust never shows up) and the usual deposit.
 * Shared by the dashboard and its layout's warm-up, so the server gathers
 * exactly the candidates the page is about to ask about.
 */

/** Asked when the history has no deposit to go by. */
export const FALLBACK_NEXT_BUY_USD = 500;

/** The most recent day money went in (a rise in the invested line). */
export function lastDeposit(points: { invested: number }[] | undefined): number | null {
  if (!points) return null;
  for (let i = points.length - 1; i > 0; i--) {
    const step = points[i]!.invested - points[i - 1]!.invested;
    if (step >= 1) return step;
  }
  return null;
}

/** How many recent deposits the usual amount is taken from. */
const USUAL_FROM = 6;

/**
 * What the next-buy box starts at: the median of the last few days money went
 * in (a rise in the invested line), so one bigger buy doesn't set it. luna puts
 * in $100 a month; her last rise was a $150 NVDA buy, and the box said $150
 * ("why would it guess that?", missions 64/66/67). `from` says what it is:
 * `usual` (the median of three or more), `last` (fewer to go by: the last one),
 * or `start` (the only money in is the first day's, the holdings typed in at
 * setup: luna's $300 VOO + $150 NVDA read as "your last deposit was $450",
 * mission 140).
 */
export type DepositFrom = "usual" | "last" | "start";

export function usualDeposit(
  points: { invested: number }[] | undefined,
): { usd: number; from: DepositFrom } | null {
  if (!points) return null;
  const steps: number[] = [];
  for (let i = points.length - 1; i > 0 && steps.length < USUAL_FROM; i--) {
    const step = points[i]!.invested - points[i - 1]!.invested;
    if (step >= 1) steps.push(step);
  }
  // The first day's money is a deposit too.
  const first = points[0]?.invested ?? 0;
  if (steps.length < USUAL_FROM && points.length > 0 && first >= 1) {
    if (steps.length === 0) return { usd: first, from: "start" };
    steps.push(first);
  }
  if (steps.length === 0) return null;
  if (steps.length < 3) return { usd: steps[0]!, from: "last" };
  const sorted = [...steps].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const usd = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { usd, from: "usual" };
}

/** The candidates the section can offer, largest first like the overview. */
export function nextBuyHoldings<H extends { marketValue: number | null }>(holdings: H[]): H[] {
  return holdings.filter((h) => (h.marketValue ?? 0) >= 1);
}

export function defaultNextBuyAmount(deposit: number | null): number {
  return Math.round(deposit ?? FALLBACK_NEXT_BUY_USD);
}

/** The options offered with zero input. */
export function defaultNextBuyIds(
  holdings: { assetId: string; marketValue: number | null }[],
): string[] {
  return nextBuyHoldings(holdings)
    .slice(0, 3)
    .map((h) => h.assetId);
}

/** How many recent withdrawals the usual one is taken from. */
const USUAL_WITHDRAWAL_FROM = 6;

/**
 * Whether money mostly comes out of this portfolio: over the last 365 days of
 * the series, falls in the invested line (sale proceeds) outweigh rises (money
 * put in). barristan sells $3,500 a month to live on, and the dashboard asked
 * where his "usual" $80,000 should go, his one lump deposit (2026-10-31: "I'm
 * not buying, I'm selling"). `usualUsd` is the median of the last few falls,
 * `thisYearUsd` the net taken out since Jan 1 (sales minus money put back),
 * `monthlyUsd` the last 12 months' net out ÷ 12, `byMonth` this year's net out
 * per calendar month, oldest first (negative = more put in than taken out),
 * which sums to `thisYearUsd`: barristan's one $3,500 a month showed up as a
 * VTI and a VXUS sale, and he couldn't tie the year's total to his paper
 * record (mission 107). Null when money goes in.
 */
export type WithdrawalPace = {
  usualUsd: number;
  thisYearUsd: number;
  monthlyUsd: number;
  year: number;
  byMonth: { month: string; outUsd: number }[];
};

export function withdrawalPace(
  points: { date: string; invested: number }[] | undefined,
): WithdrawalPace | null {
  if (!points || points.length < 2) return null;
  const last = points[points.length - 1]!;
  const from = new Date(`${last.date}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 365);
  const cutoff = from.toISOString().slice(0, 10);
  const year = last.date.slice(0, 4);
  let rises = 0;
  let falls = 0;
  const recent: number[] = [];
  // The invested line just before Jan 1 (0 when the series starts this year).
  let yearStart = points[0]!.date < `${year}-01-01` ? points[0]!.invested : 0;
  const months = new Map<string, number>();
  if (points[0]!.date >= `${year}-01-01`) {
    months.set(points[0]!.date.slice(0, 7), -points[0]!.invested);
  }
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const step = p.invested - points[i - 1]!.invested;
    if (p.date < `${year}-01-01`) yearStart = p.invested;
    else if (step !== 0) {
      const month = p.date.slice(0, 7);
      months.set(month, (months.get(month) ?? 0) - step);
    }
    if (p.date <= cutoff) continue;
    if (step >= 1) rises += step;
    else if (step <= -1) {
      falls -= step;
      recent.push(-step);
    }
  }
  if (falls <= rises || recent.length === 0) return null;
  const sorted = recent.slice(-USUAL_WITHDRAWAL_FROM).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const usualUsd = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return {
    usualUsd: Math.round(usualUsd),
    thisYearUsd: Math.max(0, yearStart - last.invested),
    monthlyUsd: (falls - rises) / 12,
    year: Number(year),
    byMonth: [...months]
      .filter(([, out]) => Math.abs(out) >= 0.005)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, outUsd]) => ({ month, outUsd })),
  };
}
