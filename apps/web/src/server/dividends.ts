import { db } from "@beobeo/db";
import {
  DAY_MS,
  ZERO,
  estimateDividendIncome,
  toIsoDate,
  type Decimal,
  type EngineTransaction,
} from "@beobeo/core";
import { cached, userCacheKey } from "./cache";
import { getMarketData } from "./market-data";
import { computeOverview, loadEngineTransactions, type AssetRow } from "./portfolio";

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
  const overviewRun = computeOverview(userId, portfolioId);
  const { txns, assets } = await loadEngineTransactions(db, userId, undefined, undefined, portfolioId);
  const asOf = toIsoDate(new Date());
  const yearAgo = new Date(Date.parse(asOf) - 365 * DAY_MS);
  const market = getMarketData();
  // Ask the provider now, for what the transactions say is still held, rather
  // than after the overview: cold, the overview took ~1s and the dividend calls
  // ~0.8s more after it (hermione's dashboard, 2.7s to settle). The call below
  // joins these through the market-data memo.
  void market.getRecentDividends(probablyHeld(txns, assets), asOf).catch(() => undefined);
  const overview = await overviewRun;

  const held = overview.holdings.filter((h) => h.quantity > 0 && h.class !== "crypto");
  const refs = held.flatMap((h) => assets.get(h.assetId) ?? []);
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

/** Non-crypto assets with units left by a plain count (buys and transfers in
 *  minus sales and transfers out, splits multiplied in). It only decides which
 *  provider calls start early; the overview's holdings decide the answer. */
function probablyHeld(txns: EngineTransaction[], assets: Map<string, AssetRow>): AssetRow[] {
  const units = new Map<string, Decimal>();
  for (const t of txns) {
    const held = units.get(t.assetId) ?? ZERO;
    if (t.type === "buy" || t.type === "transfer_in") units.set(t.assetId, held.add(t.quantity));
    else if (t.type === "sell" || t.type === "transfer_out") units.set(t.assetId, held.sub(t.quantity));
    else if (t.type === "split") units.set(t.assetId, held.mul(t.quantity));
  }
  return [...units]
    .filter(([, n]) => n.gt(0))
    .flatMap(([id]) => assets.get(id) ?? [])
    .filter((a) => a.class !== "crypto" && a.class !== "cash");
}

export type DividendEstimate = Awaited<ReturnType<typeof computeDividendEstimate>>;
