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
 * ("why would it guess that?", missions 64/66/67). `usual` is false when there
 * are fewer than three deposits to go by, and the amount is just the last one.
 */
export function usualDeposit(
  points: { invested: number }[] | undefined,
): { usd: number; usual: boolean } | null {
  if (!points) return null;
  const steps: number[] = [];
  for (let i = points.length - 1; i > 0 && steps.length < USUAL_FROM; i--) {
    const step = points[i]!.invested - points[i - 1]!.invested;
    if (step >= 1) steps.push(step);
  }
  // The first day's money is a deposit too.
  const first = points[0]?.invested ?? 0;
  if (steps.length < USUAL_FROM && points.length > 0 && first >= 1) steps.push(first);
  if (steps.length === 0) return null;
  if (steps.length < 3) return { usd: steps[0]!, usual: false };
  const sorted = [...steps].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const usd = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { usd, usual: true };
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
