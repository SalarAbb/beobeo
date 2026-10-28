/**
 * What "Where should my next buy go?" asks before anything is typed: the
 * three largest holdings (≥ $1, so dust never shows up) and the last deposit.
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
