import { db } from "@beobeo/db";
import { DAY_MS, ZERO, estimateDividendIncome, toIsoDate } from "@beobeo/core";
import { cached, userCacheKey } from "./cache";
import { getMarketData } from "./market-data";
import { computeOverview, loadEngineTransactions } from "./portfolio";

/** Provider answers are memoized for 12h in the market-data service, so this
 *  only saves the assembly; kept short so a rate-limited miss heals soon. */
const TTL = 300;

/**
 * "What do my shares pay me?" (olenna): each holding's cash per share over
 * the last 12 months (the provider's ex-dates, split-adjusted) times the
 * units held now, plus the dividends the user recorded over the same year.
 * A trailing estimate, not a forecast; crypto pays none.
 */
export function computeDividendEstimate(userId: string, portfolioId?: string) {
  return cached(userCacheKey(userId, "dividends",portfolioId ?? "all"), TTL, () =>
    computeDividendEstimateUncached(userId, portfolioId),
  );
}

async function computeDividendEstimateUncached(userId: string, portfolioId?: string) {
  const [overview, { txns, assets }] = await Promise.all([
    computeOverview(userId, portfolioId),
    loadEngineTransactions(db, userId, undefined, undefined, portfolioId),
  ]);
  const asOf = toIsoDate(new Date());
  const yearAgo = new Date(Date.parse(asOf) - 365 * DAY_MS);

  const held = overview.holdings.filter((h) => h.quantity > 0 && h.class !== "crypto");
  const refs = held.flatMap((h) => assets.get(h.assetId) ?? []);
  const market = getMarketData();
  const [payments, splits] = await Promise.all([
    market.getRecentDividends(refs, asOf),
    market
      .getSplits(refs.map((a) => a.id))
      .catch(() => new Map<string, { date: string; ratio: string }[]>()),
  ]);

  const unavailable = held.filter((h) => payments.get(h.assetId) === null).map((h) => h.symbol);
  const estimate = estimateDividendIncome(
    held
      .filter((h) => payments.get(h.assetId) != null)
      .map((h) => ({
        key: h.symbol,
        quantity: h.quantity,
        value: h.marketValue,
        costBasis: h.costBasis,
        payments: payments.get(h.assetId)!,
        splits: splits.get(h.assetId) ?? [],
      })),
    asOf,
  );

  // What the user typed in or imported over the same year, to set beside it.
  let recorded = ZERO;
  for (const t of txns) {
    if (t.type === "dividend" && t.tradedAt > yearAgo) {
      recorded = recorded.add(t.quantity.mul(t.pricePerUnit ?? ZERO));
    }
  }

  const { value } = overview.totals;
  return {
    asOf,
    ...estimate,
    /** Yearly estimate over the whole portfolio's value, crypto included. */
    yieldOnPortfolioPct:
      value > 0 ? Math.round((estimate.yearlyUsd / value) * 10_000) / 100 : null,
    recordedLast12MonthsUsd: recorded.toDecimalPlaces(2).toNumber(),
    /** Holdings the price provider couldn't give dividends for. */
    unavailable,
  };
}

export type DividendEstimate = Awaited<ReturnType<typeof computeDividendEstimate>>;
