import { and, asc, eq, inArray } from "drizzle-orm";
import { db as database, schema, type Db } from "@beobeo/db";
import {
  adjustForSplits,
  annualize,
  buildLots,
  buildLotsByAccount,
  chainReturns,
  D,
  dailyReturns,
  extractCashFlows,
  isLongTerm,
  materialDrawdown,
  portfolioTimeSeries,
  positionFromLots,
  realizedByYear,
  sharpeInputs,
  splitFactorAfter,
  toIsoDate,
  volatility,
  xirr,
  type DatedCashFlow,
  type EngineTransaction,
  type IsoDate,
  type MetricSeriesPoint,
  type PriceSeries,
  type SplitEvent,
} from "@beobeo/core";
import { getMarketData } from "./market-data";
import { cached, sharedRun, userCacheKey } from "./cache";
import { loadScopedRows } from "./scoped-rows";

/**
 * Short TTLs for the heavy per-request computations (full txn replay +
 * price loads). Invalidation on transaction/account mutations makes the
 * user's own edits show instantly; the TTL only bounds staleness of
 * background price refreshes. All results are plain JSON (Decimal→number
 * happens inside), so they round-trip through any cache backend.
 */
const TTL = { overview: 60, timeseries: 300, position: 60, sales: 60, dca: 300, metrics: 300 } as const;

/**
 * Flat annual risk-free rate for Sharpe ratios (≈ 3-month T-bill, mid-2026).
 * Single source for the dashboard metrics card and the compare table — every
 * column uses the same rate, so *rankings* are insensitive to the exact
 * value. Swap for a real rate series if precision ever matters.
 */
const RISK_FREE_RATE = 0.045;

const scopeKey = (ids?: string[]): string =>
  ids && ids.length > 0 ? [...ids].sort().join(",") : "all";

export interface AssetRow {
  id: string;
  symbol: string;
  name: string;
  class: "stock" | "etf" | "fund" | "crypto" | "cash";
  currency: string;
  providerRef: string | null;
}

/** The account's matching method for this kind of asset. */
export function lotMethodFor(
  account: { lotMethod: "fifo" | "hifo"; cryptoLotMethod: "fifo" | "hifo" },
  assetClass: string,
): "fifo" | "hifo" {
  return assetClass === "crypto" ? account.cryptoLotMethod : account.lotMethod;
}

/** Load a user's transactions as engine inputs, sorted, with their assets.
 *  Concurrent identical loads share one pair of queries (the dashboard's
 *  overview and timeseries ask at the same moment), so the result is
 *  read-only to callers. */
export function loadEngineTransactions(
  db: Db,
  userId: string,
  assetId?: string,
  /** Restrict to a subset of assets (scope for partial-portfolio comparisons). */
  assetIds?: string[],
  /** Restrict to one named portfolio (undefined = all portfolios). */
  portfolioId?: string,
): Promise<{ txns: EngineTransaction[]; assets: Map<string, AssetRow> }> {
  return sharedRun(
    userCacheKey(userId, "engine-txns", assetId ?? "-", portfolioId ?? "all", scopeKey(assetIds)),
    () => loadEngineTransactionsUncached(db, userId, assetId, assetIds, portfolioId),
  );
}

async function loadEngineTransactionsUncached(
  db: Db,
  userId: string,
  assetId?: string,
  assetIds?: string[],
  portfolioId?: string,
): Promise<{ txns: EngineTransaction[]; assets: Map<string, AssetRow> }> {
  const narrowed = Boolean(assetId) || (assetIds !== undefined && assetIds.length > 0);
  let rows: {
    txn: typeof schema.transactions.$inferSelect;
    asset: AssetRow;
    account: { lotMethod: "fifo" | "hifo"; cryptoLotMethod: "fifo" | "hifo" };
  }[];
  if (!narrowed && db === database) {
    // A whole scope reads the same rows as the Tax Center's lots, so both share
    // one query (a cold tax.now needs the overview and the lots at once).
    rows = await loadScopedRows(userId, portfolioId ?? "all");
  } else {
    const conditions = [eq(schema.transactions.userId, userId)];
    if (assetId) conditions.push(eq(schema.transactions.assetId, assetId));
    if (assetIds && assetIds.length > 0)
      conditions.push(inArray(schema.transactions.assetId, assetIds));
    if (portfolioId) conditions.push(eq(schema.accounts.portfolioId, portfolioId));

    rows = await db
      .select({
        txn: schema.transactions,
        asset: schema.assets,
        account: {
          lotMethod: schema.accounts.lotMethod,
          cryptoLotMethod: schema.accounts.cryptoLotMethod,
        },
      })
      .from(schema.transactions)
      .innerJoin(schema.assets, eq(schema.transactions.assetId, schema.assets.id))
      .innerJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
      .where(and(...conditions))
      .orderBy(asc(schema.transactions.tradedAt), asc(schema.transactions.createdAt));
  }

  const assets = new Map<string, AssetRow>();
  const txns: EngineTransaction[] = rows.map(({ txn, asset, account }) => {
    if (!assets.has(asset.id)) assets.set(asset.id, asset);
    return {
      id: txn.id,
      assetId: txn.assetId,
      type: txn.type,
      quantity: D(txn.quantity),
      pricePerUnit: txn.pricePerUnit === null ? null : D(txn.pricePerUnit),
      fees: D(txn.fees),
      tradedAt: txn.tradedAt,
      accountId: txn.accountId,
      lotMethod: lotMethodFor(account, asset.class),
    };
  });

  return { txns: await injectKnownSplits(db, txns, assets), assets };
}

/** Days of slack when matching a user-recorded split against a provider one —
 *  brokers and providers disagree on announcement vs effective date. */
const SPLIT_MATCH_SLACK_MS = 5 * 86_400_000;

/**
 * Merge provider-known splits (asset_splits, captured from Tiingo) into a
 * user's engine transactions as synthetic split entries. Users who record
 * their own splits (e.g. Robinhood SPL imports) are left alone — a provider
 * split within ±5 days of a user split for the same asset is skipped. Without
 * this, a manually-entered position silently keeps its pre-split quantity
 * while prices continue post-split (the VGT cliff). Synthetic entries never
 * touch the DB — user data stays exactly what the user entered.
 */
async function injectKnownSplits(
  db: Db,
  txns: EngineTransaction[],
  assets: Map<string, AssetRow>,
): Promise<EngineTransaction[]> {
  return mergeKnownSplits(txns, await loadKnownSplits(db, [...assets.keys()]));
}

export interface KnownSplit {
  assetId: string;
  date: string;
  ratio: string;
}

/** Provider-known splits for these assets. On the app's own database they
 *  come from the market-data service's in-process copy of the table (one
 *  query per 10 minutes instead of one per cold load); another db is asked. */
export async function loadKnownSplits(db: Db, assetIds: string[]): Promise<KnownSplit[]> {
  if (assetIds.length === 0) return [];
  if (db === database) {
    const byAsset = await getMarketData().getSplits(assetIds);
    return [...byAsset].flatMap(([assetId, list]) => list.map((s) => ({ assetId, ...s })));
  }
  return db
    .select({
      assetId: schema.assetSplits.assetId,
      date: schema.assetSplits.date,
      ratio: schema.assetSplits.ratio,
    })
    .from(schema.assetSplits)
    .where(inArray(schema.assetSplits.assetId, assetIds));
}

/** The pure half of `injectKnownSplits`. Works on any sorted slice of one
 *  user's history (all assets, or one account's one asset as the Tax Center
 *  groups it): "held before the split" is judged within the slice. */
export function mergeKnownSplits(
  txns: EngineTransaction[],
  splitRows: KnownSplit[],
): EngineTransaction[] {
  if (splitRows.length === 0) return txns;

  const firstTxnAt = new Map<string, number>();
  const userSplitTimes = new Map<string, number[]>();
  for (const t of txns) {
    const at = t.tradedAt.getTime();
    if (!firstTxnAt.has(t.assetId)) firstTxnAt.set(t.assetId, at); // txns sorted
    if (t.type === "split") {
      const list = userSplitTimes.get(t.assetId) ?? [];
      list.push(at);
      userSplitTimes.set(t.assetId, list);
    }
  }

  const synthetic: EngineTransaction[] = [];
  for (const s of splitRows) {
    const splitAt = Date.parse(`${s.date}T00:00:00Z`);
    const first = firstTxnAt.get(s.assetId);
    if (first === undefined || first >= splitAt) continue; // not held yet — irrelevant
    const recorded = (userSplitTimes.get(s.assetId) ?? []).some(
      (t) => Math.abs(t - splitAt) <= SPLIT_MATCH_SLACK_MS,
    );
    if (recorded) continue;
    synthetic.push({
      id: `synthetic-split:${s.assetId}:${s.date}`,
      assetId: s.assetId,
      type: "split",
      quantity: D(s.ratio),
      pricePerUnit: null,
      fees: D(0),
      tradedAt: new Date(splitAt),
    });
  }
  if (synthetic.length === 0) return txns;
  // Stable sort keeps the createdAt tiebreak order among equal timestamps.
  return [...txns, ...synthetic].sort(
    (a, b) => a.tradedAt.getTime() - b.tradedAt.getTime(),
  );
}

/**
 * One asset's lots with each sale matched inside its own account, as brokers,
 * the Tax Center and the exports do (`buildLotsByAccount`). When an account
 * sells more than it ever held (a trade recorded under the wrong account), the
 * whole asset falls back to one FIFO queue across accounts rather than
 * dropping off the dashboard; that still throws on a true oversell.
 */
export function replayAsset(txns: EngineTransaction[]) {
  try {
    return buildLotsByAccount(txns);
  } catch {
    return buildLots(txns);
  }
}

const byAsset = (txns: EngineTransaction[]): Map<string, EngineTransaction[]> => {
  const groups = new Map<string, EngineTransaction[]>();
  for (const t of txns) {
    const g = groups.get(t.assetId);
    if (g) g.push(t);
    else groups.set(t.assetId, [t]);
  }
  return groups;
};

/** Time window the dashboard P/L figures are computed over. "all" = since
 *  inception (unrealized vs cost basis, all-time realized/dividends). */
export type PnlWindow = "1d" | "1w" | "1m" | "ytd" | "1y" | "all";

/** Baseline date for a window: P/L is measured from this date's close.
 *  Returns null for "all" (no baseline — measure against cost basis). */
const windowStart = (window: PnlWindow, today: IsoDate): IsoDate | null => {
  if (window === "all") return null;
  const d = new Date(`${today}T00:00:00Z`);
  switch (window) {
    case "1d":
      d.setUTCDate(d.getUTCDate() - 1);
      break;
    case "1w":
      d.setUTCDate(d.getUTCDate() - 7);
      break;
    case "1m":
      d.setUTCMonth(d.getUTCMonth() - 1);
      break;
    case "ytd":
      // YTD baseline is the last close of the previous year.
      return `${d.getUTCFullYear() - 1}-12-31` as IsoDate;
    case "1y":
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      break;
  }
  return d.toISOString().slice(0, 10) as IsoDate;
};

export function computeOverview(
  userId: string,
  portfolioId?: string,
  window: PnlWindow = "all",
) {
  return cached(
    userCacheKey(userId, "overview", portfolioId ?? "all", window),
    TTL.overview,
    () => computeOverviewUncached(userId, portfolioId, window),
  );
}

async function computeOverviewUncached(
  userId: string,
  portfolioId?: string,
  window: PnlWindow = "all",
) {
  const { txns, assets } = await loadEngineTransactions(
    database, userId, undefined, undefined, portfolioId,
  );
  const today = toIsoDate(new Date());
  const market = getMarketData();

  const holdings: {
    assetId: string;
    symbol: string;
    name: string;
    class: string;
    quantity: number;
    costBasis: number;
    avgCost: number | null;
    price: number | null;
    priceDate: string | null;
    marketValue: number | null;
    unrealizedGain: number | null;
    unrealizedGainPct: number | null;
    /** Flow-adjusted gain since the window baseline (null when window="all"
     *  or the asset had no baseline price). */
    periodGain: number | null;
    periodGainPct: number | null;
  }[] = [];

  let totalValue = 0;
  let totalCost = 0;
  let totalRealized = 0;
  let realizedThisYear = 0;
  let totalDividends = 0;
  const thisYear = today.slice(0, 4);
  const dataIssues: { symbol: string; message: string }[] = [];

  // One bulk query for every asset's latest close — the per-asset variant
  // cost 2 serialized round trips per asset on the Neon HTTP driver.
  const latestByAsset = await market
    .getLatestPrices([...assets.values()], today)
    .catch(() => new Map<string, { date: IsoDate; close: string }>());

  // Windowed P/L baseline: each asset's close at the window start.
  const baseline = windowStart(window, today);
  const baselineByAsset = baseline
    ? await market
        .getLatestPrices([...assets.values()], baseline)
        .catch(() => new Map<string, { date: IsoDate; close: string }>())
    : new Map<string, { date: IsoDate; close: string }>();

  const perAsset = [...byAsset(txns).entries()].map(([assetId, assetTxns]) => {
    const asset = assets.get(assetId)!;
    const latest = latestByAsset.get(assetId) ?? null;
    try {
      return {
        assetId,
        asset,
        latest,
        txns: assetTxns,
        lots: replayAsset(assetTxns),
        error: null,
      };
    } catch (e) {
      // Inconsistent history (e.g. partial export selling more than it
      // bought) flags the asset instead of taking down the whole dashboard.
      return {
        assetId,
        asset,
        latest,
        txns: assetTxns,
        lots: null,
        error: e instanceof Error ? e.message : "invalid transaction history",
      };
    }
  });

  let periodGainTotal = D(0);
  let periodInvestedTotal = D(0);

  for (const { assetId, asset, latest, txns: assetTxns, lots, error } of perAsset) {
    if (!lots) {
      dataIssues.push({ symbol: asset.symbol, message: error! });
      continue;
    }
    const { openLots, realized, dividendIncome } = lots;
    // Calendar-year (UTC) total, the scope the Tax Center and chat's
    // get_realized_gains use, so the all-time tile can show both.
    realizedThisYear += realized
      .filter((g) => toIsoDate(g.soldAt).startsWith(thisYear))
      .reduce((s, g) => s + g.gain.toNumber(), 0);
    if (baseline) {
      // Realized gains and dividend cash restricted to the window.
      totalRealized += realized
        .filter((g) => toIsoDate(g.soldAt) > baseline)
        .reduce((s, g) => s + g.gain.toNumber(), 0);
      totalDividends += assetTxns
        .filter((t) => t.type === "dividend" && toIsoDate(t.tradedAt) > baseline)
        .reduce((s, t) => s + t.quantity.mul(t.pricePerUnit ?? 0).toNumber(), 0);
    } else {
      totalRealized += realized.reduce((s, g) => s + g.gain.toNumber(), 0);
      totalDividends += dividendIncome.toNumber();
    }

    const pos = positionFromLots(openLots, latest ? D(latest.close) : undefined);

    // Period gain is computed before the zero-quantity skip: a position fully
    // closed during the window still contributed gains to the period totals.
    let period: { gain: ReturnType<typeof D>; invested: ReturnType<typeof D> } | null =
      null;
    if (baseline) {
      const baseClose = baselineByAsset.get(assetId);
      period = periodStats({
        assetTxns,
        baseline,
        baselineClose: baseClose ? D(baseClose.close) : null,
        valueNow: pos.marketValue ?? (pos.quantity.isZero() ? D(0) : null),
      });
      if (period) {
        periodGainTotal = periodGainTotal.add(period.gain);
        periodInvestedTotal = periodInvestedTotal.add(period.invested);
      }
    }

    if (pos.quantity.isZero()) continue;

    const marketValue = pos.marketValue?.toNumber() ?? null;
    totalValue += marketValue ?? 0;
    totalCost += pos.costBasis.toNumber();

    holdings.push({
      assetId,
      symbol: asset.symbol,
      name: asset.name,
      class: asset.class,
      quantity: pos.quantity.toNumber(),
      costBasis: pos.costBasis.toNumber(),
      avgCost: pos.avgCostPerUnit?.toNumber() ?? null,
      price: latest ? Number(latest.close) : null,
      priceDate: latest?.date ?? null,
      marketValue,
      unrealizedGain: pos.unrealizedGain?.toNumber() ?? null,
      unrealizedGainPct: pos.unrealizedGainPct?.toNumber() ?? null,
      periodGain: period ? period.gain.toNumber() : null,
      periodGainPct:
        period && period.invested.gt(0)
          ? period.gain.div(period.invested).mul(100).toNumber()
          : null,
    });
  }

  holdings.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

  return {
    holdings,
    dataIssues,
    window,
    totals: {
      value: totalValue,
      cost: totalCost,
      unrealized: totalValue - totalCost,
      unrealizedPct: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : null,
      realized: totalRealized,
      /** Realized gains in this calendar year, whatever the window. */
      realizedThisYear,
      dividends: totalDividends,
      /** Flow-adjusted portfolio gain over the window (includes positions
       *  closed during it); null when window="all". */
      periodGain: baseline ? periodGainTotal.toNumber() : null,
      periodGainPct:
        baseline && periodInvestedTotal.gt(0)
          ? periodGainTotal.div(periodInvestedTotal).mul(100).toNumber()
          : null,
    },
  };
}

/**
 * Flow-adjusted P/L for one asset since the baseline close: what the position
 * gained beyond the cash that entered or left it during the window.
 * gain = valueNow − valueAtBaseline − netFlows. Comparing values (not prices)
 * makes splits a no-op; dividends are cash income, not position value, and
 * stay in the separate dividends figure. Returns null when the gain can't be
 * computed (position held but unpriced at either endpoint).
 */
function periodStats(opts: {
  assetTxns: EngineTransaction[];
  baseline: IsoDate;
  baselineClose: ReturnType<typeof D> | null;
  /** Current market value; null = open position with no price known. */
  valueNow: ReturnType<typeof D> | null;
}): { gain: ReturnType<typeof D>; invested: ReturnType<typeof D> } | null {
  const before: EngineTransaction[] = [];
  let flows = D(0);
  let inflows = D(0);
  for (const t of opts.assetTxns) {
    if (toIsoDate(t.tradedAt) <= opts.baseline) {
      before.push(t);
      continue;
    }
    const value = t.pricePerUnit ? t.quantity.mul(t.pricePerUnit) : D(0);
    switch (t.type) {
      case "buy": {
        const cost = value.add(t.fees);
        flows = flows.add(cost);
        inflows = inflows.add(cost);
        break;
      }
      case "sell":
        flows = flows.sub(value.sub(t.fees));
        break;
      case "transfer_in":
        flows = flows.add(value);
        inflows = inflows.add(value);
        break;
      case "transfer_out":
        flows = flows.sub(value);
        break;
      // split / dividend / fee: no position cash flow
    }
  }
  // Prefix replay can't oversell if the full history didn't (fewer sells).
  const qtyAt = positionFromLots(replayAsset(before).openLots).quantity;
  let valueAt = D(0);
  if (!qtyAt.isZero()) {
    if (!opts.baselineClose) return null;
    valueAt = qtyAt.mul(opts.baselineClose);
  }
  if (opts.valueNow === null) return null;
  return {
    gain: opts.valueNow.sub(valueAt).sub(flows),
    invested: valueAt.add(inflows),
  };
}

/** Two-week lead-in so forward-fill has a seed close before the window
 *  (a position opened today has no close of its own yet). */
const PRICE_LEAD_DAYS = 14;

export const leadIn = (date: IsoDate): IsoDate =>
  new Date(Date.parse(`${date}T00:00:00Z`) - PRICE_LEAD_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

export async function loadPriceSeriesForAssets(
  assets: AssetRow[],
  from: IsoDate,
  to: IsoDate,
  /** Per-asset first-transaction dates: an asset only needs provider coverage
   *  from its own start, not the portfolio-wide window (a post-window IPO
   *  would otherwise be an unfillable head gap re-fetched on every load). */
  firstTxnByAsset?: Map<string, IsoDate>,
): Promise<Map<string, PriceSeries>> {
  const market = getMarketData();
  const withWindows = assets.map((a) => {
    const first = firstTxnByAsset?.get(a.id);
    return first ? { ...a, seriesFrom: leadIn(first) } : a;
  });
  try {
    // Bulk read: one coverage query + one rows query for all assets.
    return await market.getPricesBulk(withWindows, leadIn(from), to);
  } catch {
    return new Map(assets.map((a) => [a.id, new Map()]));
  }
}

export function computeTimeseries(
  userId: string,
  scopeAssetIds?: string[],
  portfolioId?: string,
) {
  return cached(
    userCacheKey(userId, "timeseries", portfolioId ?? "all", scopeKey(scopeAssetIds)),
    TTL.timeseries,
    () => computeTimeseriesUncached(userId, scopeAssetIds, portfolioId),
  );
}

async function computeTimeseriesUncached(
  userId: string,
  scopeAssetIds?: string[],
  portfolioId?: string,
) {
  const { txns, assets } = await loadEngineTransactions(
    database,
    userId,
    undefined,
    scopeAssetIds,
    portfolioId,
  );
  if (txns.length === 0) return [];
  const from = toIsoDate(txns[0]!.tradedAt);
  const to = toIsoDate(new Date());
  const firstTxnByAsset = new Map<string, IsoDate>();
  for (const t of txns) {
    if (!firstTxnByAsset.has(t.assetId))
      firstTxnByAsset.set(t.assetId, toIsoDate(t.tradedAt));
  }
  const prices = await loadPriceSeriesForAssets(
    [...assets.values()],
    from,
    to,
    firstTxnByAsset,
  );
  // An asset with no price data at all (unsupported symbol, dead token,
  // import mapped to something providers don't know) would count its cost
  // in `invested` while contributing $0 to value forever — wedging the
  // chart apart and poisoning the daily returns every metric is built on
  // (fake crash on the buy day, phantom volatility/drawdown). Exclude such
  // assets from the replay entirely.
  const priced = new Set(
    [...prices.entries()].filter(([, s]) => s.size > 0).map(([id]) => id),
  );
  const pricedTxns = txns.filter((t) => priced.has(t.assetId));
  if (pricedTxns.length === 0) return [];
  return portfolioTimeSeries({ txns: pricedTxns, prices, to }).map((p) => ({
    date: p.date,
    value: p.value.toNumber(),
    invested: p.invested.toNumber(),
  }));
}

/** Percent (or null) from a fraction — metrics leave the server as percents,
 *  matching the fmtPct convention everywhere else in the UI. */
const pct = (v: number | null): number | null => (v === null ? null : v * 100);

/**
 * Metric bundle for one daily {value, invested} series (portfolio or
 * benchmark replay). All figures are flow-adjusted — deposits/withdrawals
 * never masquerade as returns. Percents except sharpe (a ratio).
 */
function seriesMetrics(points: MetricSeriesPoint[]) {
  const returns = dailyReturns(points);
  const first = points[0];
  const last = points[points.length - 1];
  const spanDays =
    first && last
      ? (Date.parse(`${last.date}T00:00:00Z`) -
          Date.parse(`${first.date}T00:00:00Z`)) /
        86_400_000
      : 0;
  const twr = chainReturns(returns);
  // Drawdown = core `materialDrawdown`: flow-adjusted (selling isn't a fall) and counted only
  // once invested capital reached 10% of its peak. Both earlier measures misled a real user:
  // the chained index from day one said "58% below peak" at an all-time high (a tiny early
  // LINK boom), and the dollar series said "−90%" (that same $1k of LINK crashing in 2022,
  // plus every sale counted as a loss).
  const dd = materialDrawdown(points);
  // Every input of the Sharpe ratio, so Compare can show it worked out
  // (hermione: "what's the risk-free rate, daily or monthly returns,
  // annualization? I can't tie this to my notebook").
  const sharpeIn = sharpeInputs(returns, RISK_FREE_RATE);
  return {
    spanDays,
    from: first?.date ?? null,
    to: last?.date ?? null,
    returnDays: returns.length,
    twr: pct(returns.length > 0 ? twr : null),
    twrAnnualized: pct(returns.length > 0 ? annualize(twr, spanDays) : null),
    volatility: pct(volatility(returns)),
    maxDrawdown: dd ? pct(dd.max) : null,
    maxDrawdownFrom: dd?.from ?? null,
    sharpe: sharpeIn?.sharpe ?? null,
    sharpeInputs: sharpeIn
      ? {
          meanDaily: sharpeIn.meanDaily * 100,
          annualReturn: sharpeIn.annualReturn * 100,
          riskFree: sharpeIn.riskFree * 100,
          volatility: sharpeIn.volatility * 100,
          days: sharpeIn.days,
        }
      : null,
  };
}

/**
 * Money-weighted annualized return over a series window, from the series
 * itself: the invested deltas are the dated net cash flows, the first point
 * is a virtual opening buy (position value at the window start — or the
 * actual cash put in, for since-inception), the last point liquidates.
 */
function seriesXirr(
  points: MetricSeriesPoint[],
  opening: "value" | "invested",
): number | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || first === last) return null;
  const flows: DatedCashFlow[] = [];
  const openingAmount = opening === "value" ? first.value : first.invested;
  if (openingAmount !== 0)
    flows.push({ date: new Date(`${first.date}T00:00:00Z`), amount: D(openingAmount).neg() });
  for (let i = 1; i < points.length; i++) {
    const flow = points[i]!.invested - points[i - 1]!.invested;
    if (flow !== 0)
      flows.push({
        date: new Date(`${points[i]!.date}T00:00:00Z`),
        amount: D(flow).neg(),
      });
  }
  flows.push({ date: new Date(`${last.date}T00:00:00Z`), amount: D(last.value) });
  return xirr(flows);
}

export function computeMetrics(
  userId: string,
  portfolioId?: string,
  window: PnlWindow = "all",
) {
  return cached(
    userCacheKey(userId, "metrics2", portfolioId ?? "all", window),
    TTL.metrics,
    () => computeMetricsUncached(userId, portfolioId, window),
  );
}

async function computeMetricsUncached(
  userId: string,
  portfolioId?: string,
  window: PnlWindow = "all",
) {
  // Reuses the (cached) full timeseries; slicing happens here, so every
  // window shares one series computation.
  const series = await computeTimeseries(userId, undefined, portfolioId);
  const baseline = windowStart(window, toIsoDate(new Date()));
  let points: MetricSeriesPoint[] = series;
  if (baseline) {
    const startIdx = series.findIndex((p) => p.date > baseline);
    // Keep one point before the boundary as the return baseline.
    points = startIdx === -1 ? [] : series.slice(Math.max(0, startIdx - 1));
  }

  const metrics = seriesMetrics(points);
  const moneyWeighted = seriesXirr(points, baseline ? "value" : "invested");
  // Dalbar-style behavior gap: money-weighted − time-weighted. Positive =
  // the user's timing of contributions added return beyond what their picks
  // did on their own; negative = timing cost them.
  const behaviorGap =
    metrics.twrAnnualized !== null && moneyWeighted !== null
      ? moneyWeighted * 100 - metrics.twrAnnualized
      : null;

  return {
    window,
    // Carries `from`, where the period these figures cover starts, stated under
    // "Performance details" (petyr, mission 38: "I can't tell what period any
    // of these cover").
    ...metrics,
    xirr: pct(moneyWeighted),
    behaviorGap,
  };
}

const serializeRealized = (g: ReturnType<typeof replayAsset>["realized"][number]) => ({
  soldAt: toIsoDate(g.soldAt),
  acquiredAt: toIsoDate(g.acquiredAt),
  quantity: g.quantity.toNumber(),
  proceeds: g.proceeds.toNumber(),
  costBasis: g.costBasis.toNumber(),
  gain: g.gain.toNumber(),
  longTerm: g.longTerm,
  /** The sell transaction, so a sale on /transactions can show its own lots. */
  sourceTxnId: g.sourceTxnId,
});

/** One asset's sales matched to the purchases they used: the position page's
 *  replay without its prices. A sale's details on /transactions need only
 *  this; waiting on the whole position (latest quote, price series, the
 *  average-cost steps) left the dialog on "Working out which purchases…"
 *  (petyr, missions 70/71). */
export function computeSales(userId: string, assetId: string, portfolioId?: string) {
  return cached(
    userCacheKey(userId, "sales", portfolioId ?? "all", assetId),
    TTL.sales,
    async () => {
      const { txns } = await loadEngineTransactions(
        database, userId, assetId, undefined, portfolioId,
      );
      return replayAsset(txns).realized.map(serializeRealized);
    },
  );
}

export function computePosition(
  userId: string,
  assetId: string,
  portfolioId?: string,
) {
  return cached(
    userCacheKey(userId, "position2", portfolioId ?? "all", assetId),
    TTL.position,
    () => computePositionUncached(userId, assetId, portfolioId),
  );
}

async function computePositionUncached(
  userId: string,
  assetId: string,
  portfolioId?: string,
) {
  const { txns, assets } = await loadEngineTransactions(
    database, userId, assetId, undefined, portfolioId,
  );
  const asset = assets.get(assetId);
  if (!asset || txns.length === 0) return null;

  const { openLots, realized, dividendIncome } = replayAsset(txns);
  const today = toIsoDate(new Date());
  const market = getMarketData();
  const from = toIsoDate(txns[0]!.tradedAt);
  // Side by side: the latest price can wait on a live quote while the series
  // reads the cache, and neither needs the other.
  const [latest, prices] = await Promise.all([
    market.getLatestPrice(asset, today).catch(() => null),
    market.getPrices(asset, leadIn(from), today).catch((): PriceSeries => new Map()),
  ]);
  const pos = positionFromLots(openLots, latest ? D(latest.close) : undefined);

  // Chart in present-day units: the raw series is unadjusted, so pre-split
  // closes, trade markers, and avg-cost steps are scaled by the splits the
  // engine knows (user-recorded + injected) — otherwise the price line cliffs
  // at each split and old markers float far above it.
  const splitEvents: SplitEvent[] = txns
    .filter((t) => t.type === "split")
    .map((t) => ({ date: toIsoDate(t.tradedAt), ratio: t.quantity }));
  const displayPrices = adjustForSplits(prices, splitEvents);
  const toPresentUnits = (value: number, date: IsoDate): number =>
    splitEvents.length === 0
      ? value
      : D(value).div(splitFactorAfter(splitEvents, date)).toNumber();

  // Stepwise average-cost-per-unit line (recomputed after each transaction).
  const costBasisSteps: { date: IsoDate; avgCost: number }[] = [];
  for (let i = 0; i < txns.length; i++) {
    const { openLots: lotsAt } = replayAsset(txns.slice(0, i + 1));
    const snap = positionFromLots(lotsAt);
    if (snap.avgCostPerUnit) {
      const date = toIsoDate(txns[i]!.tradedAt);
      const step = { date, avgCost: toPresentUnits(snap.avgCostPerUnit.toNumber(), date) };
      // Several trades on one day collapse to the end-of-day average; the
      // chart rejects duplicate timestamps (crashed the page for day traders).
      if (costBasisSteps.at(-1)?.date === date) costBasisSteps[costBasisSteps.length - 1] = step;
      else costBasisSteps.push(step);
    }
  }

  return {
    asset: { id: asset.id, symbol: asset.symbol, name: asset.name, class: asset.class },
    position: {
      quantity: pos.quantity.toNumber(),
      costBasis: pos.costBasis.toNumber(),
      avgCost: pos.avgCostPerUnit?.toNumber() ?? null,
      price: latest ? Number(latest.close) : null,
      priceDate: latest?.date ?? null,
      marketValue: pos.marketValue?.toNumber() ?? null,
      unrealizedGain: pos.unrealizedGain?.toNumber() ?? null,
      unrealizedGainPct: pos.unrealizedGainPct?.toNumber() ?? null,
      dividends: dividendIncome.toNumber(),
    },
    lots: openLots.map((l) => {
      // The day after the anniversary, like the Tax Center's All Lots: arya
      // couldn't see per purchase what it would make or when it turns
      // long-term without leaving the page (mission 61).
      const ltOn = new Date(l.openedAt);
      ltOn.setUTCFullYear(ltOn.getUTCFullYear() + 1);
      ltOn.setUTCDate(ltOn.getUTCDate() + 1);
      return {
        openedAt: toIsoDate(l.openedAt),
        quantity: l.quantity.toNumber(),
        costBasis: l.costBasis.toNumber(),
        avgCost: l.costBasis.div(l.quantity).toNumber(),
        /** Gain if sold at the latest price (null without one). */
        gain: latest ? l.quantity.mul(D(latest.close)).sub(l.costBasis).toNumber() : null,
        longTerm: isLongTerm(l.openedAt, new Date()),
        longTermOn: toIsoDate(ltOn),
      };
    }),
    realizedYears: realizedByYear(realized).map((y) => ({
      year: y.year,
      shortTerm: y.shortTerm.toNumber(),
      longTerm: y.longTerm.toNumber(),
      total: y.total.toNumber(),
    })),
    realizedEntries: realized.map(serializeRealized),
    priceSeries: [...displayPrices.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, close]) => ({ date, close: close.toNumber() })),
    costBasisSteps,
    markers: txns
      .filter((t) => t.type === "buy" || t.type === "sell")
      .map((t) => {
        const date = toIsoDate(t.tradedAt);
        return {
          date,
          type: t.type as "buy" | "sell",
          quantity: t.quantity.toNumber(),
          price:
            t.pricePerUnit === null
              ? null
              : toPresentUnits(t.pricePerUnit.toNumber(), date),
        };
      }),
  };
}

/**
 * Replay the user's actual cash flows into one or more benchmarks — each
 * benchmark is an independent full-weight replay of the same flows. Optional
 * `scopeAssetIds` restricts the comparison to a slice of the portfolio
 * (e.g. "just my META and GOOGL money"). Shared by the compare page and the
 * agent.
 */
export function computeDcaComparison(
  userId: string,
  opts: { benchmarkIds: string[]; scopeAssetIds?: string[]; portfolioId?: string },
) {
  return cached(
    userCacheKey(
      userId,
      "dca6", // v6: metrics carry from/to/returnDays/sharpeInputs (v5: providerRef for the live overlay) — don't serve stale JSON
      opts.portfolioId ?? "all",
      scopeKey(opts.benchmarkIds),
      scopeKey(opts.scopeAssetIds),
    ),
    TTL.dca,
    () => computeDcaComparisonUncached(userId, opts),
  );
}

async function computeDcaComparisonUncached(
  userId: string,
  opts: { benchmarkIds: string[]; scopeAssetIds?: string[]; portfolioId?: string },
) {
  const market = getMarketData();
  // Everything that doesn't need the flows starts at once: the portfolio's own
  // curve (it shares the transaction load below), the benchmark rows and their
  // splits. Run one after another they made a cold Compare take ~1s.
  const portfolioRun = computeTimeseries(userId, opts.scopeAssetIds, opts.portfolioId);
  const assetsRun =
    opts.benchmarkIds.length > 0
      ? database.select().from(schema.assets).where(inArray(schema.assets.id, opts.benchmarkIds)).execute()
      : Promise.resolve([]);
  const splitsRun = market
    .getSplits(opts.benchmarkIds)
    .catch(() => new Map<string, { date: IsoDate; ratio: string }[]>());
  // Awaited below or dropped on the empty path; never left unhandled.
  portfolioRun.catch(() => {});
  assetsRun.catch(() => {});

  const { txns, assets: userAssets } = await loadEngineTransactions(
    database,
    userId,
    undefined,
    opts.scopeAssetIds,
    opts.portfolioId,
  );
  if (txns.length === 0 || opts.benchmarkIds.length === 0) {
    return {
      portfolio: [],
      benchmarks: [],
      trades: [],
      portfolioXirr: null,
      portfolioMetrics: seriesMetrics([]),
    };
  }

  const { extractCashFlows: extract, replayDca, xirr } = await import("@beobeo/core");
  const flows = extract(txns);
  // The user's own trades behind the flows, so the page can show what each
  // benchmark trade mirrors ("you bought $500 of NVDA").
  const trades = flows.map((f) => ({
    date: toIsoDate(f.date),
    type: f.type ?? null,
    symbol: f.assetId ? (userAssets.get(f.assetId)?.symbol ?? null) : null,
    amount: f.amount.toNumber(),
  }));
  const from = toIsoDate(flows[0]!.date);
  const to = toIsoDate(new Date());

  const assetRows = await assetsRun;
  const assetById = new Map(assetRows.map((a) => [a.id, a]));

  const benchmarkPrices = await market.getPricesBulk(assetRows, leadIn(from), to);
  // Benchmarks are synthetic positions with no split transactions to multiply
  // units, so their unadjusted series must be split-adjusted before replay.
  const benchmarkSplits = await splitsRun;

  const benchmarks = opts.benchmarkIds.map((id) => {
    const asset = assetById.get(id);
    if (!asset) throw new Error("Unknown benchmark asset");
    const prices = adjustForSplits(
      benchmarkPrices.get(id) ?? new Map(),
      benchmarkSplits.get(id) ?? [],
    );
    const replay = replayDca({
      flows,
      benchmark: [{ prices, weight: D(1) }],
      to,
    });
    const series = replay.series.map((p) => ({
      date: p.date,
      value: p.value.toNumber(),
      invested: p.invested.toNumber(),
    }));
    const lastDate = [...prices.keys()].sort().at(-1);
    return {
      assetId: asset.id,
      symbol: asset.symbol,
      class: asset.class,
      providerRef: asset.providerRef,
      series,
      // Each trade the replay made, by index into `trades`, at present-day
      // (split-adjusted) units and prices.
      fills: replay.fills.map((f) => ({
        trade: f.flow,
        fillDate: f.fillDate,
        price: f.price.toNumber(),
        units: f.units.toNumber(),
        unitsAfter: f.unitsAfter.toNumber(),
      })),
      units: replay.finalUnits[0]?.toNumber() ?? 0,
      lastClose:
        lastDate !== undefined
          ? { date: lastDate, price: D(prices.get(lastDate)!).toNumber() }
          : null,
      xirr: replay.moneyWeightedReturn,
      // Same flow-adjusted metric pipeline as the portfolio — identical
      // flows in every column makes this a true apples-to-apples table.
      metrics: seriesMetrics(series),
    };
  });

  const portfolio = await portfolioRun;

  const lastPortfolio = portfolio[portfolio.length - 1];
  const portfolioXirr = lastPortfolio
    ? xirr([
        ...flows.map((f) => ({ date: f.date, amount: f.amount.neg() })),
        {
          date: new Date(`${lastPortfolio.date}T00:00:00Z`),
          amount: D(lastPortfolio.value),
        },
      ])
    : null;

  return {
    portfolio,
    benchmarks,
    trades,
    portfolioXirr,
    portfolioMetrics: seriesMetrics(portfolio),
  };
}

/**
 * The comparison valued at today's prices, like the dashboard: your last point
 * becomes the overview's live value (the scoped holdings' when scoped) and each
 * benchmark's becomes its units × its live price, so both sides of the edge are
 * priced at the same moment. The rest of the series stays on daily closes.
 * Compare used to stop at the last close: $33,431 there next to $33,502 on the
 * dashboard read as two answers (arya, missions 111/116; gilderoy, mission 60).
 * Runs per request on top of the cached replay (quotes are memoized 60s).
 */
export async function computeDcaComparisonLive(
  userId: string,
  opts: { benchmarkIds: string[]; scopeAssetIds?: string[]; portfolioId?: string },
) {
  const result = await computeDcaComparison(userId, opts);
  const atClose = {
    ...result,
    benchmarks: result.benchmarks.map((b) => ({
      ...b,
      lastPrice: b.lastClose ? { ...b.lastClose, live: false } : null,
    })),
    pricedLive: false,
  };
  if (result.portfolio.length === 0) return atClose;
  const today = toIsoDate(new Date());
  const [overview, latest] = await Promise.all([
    computeOverview(userId, opts.portfolioId).catch(() => null),
    getMarketData()
      .getLatestPrices(
        result.benchmarks.map((b) => ({
          id: b.assetId,
          symbol: b.symbol,
          class: b.class,
          providerRef: b.providerRef,
        })),
        today,
      )
      .catch(() => new Map<string, { date: IsoDate; close: string }>()),
  ]);

  const withLast = <P extends { value: number }>(series: P[], value: number): P[] =>
    series.length === 0 ? series : [...series.slice(0, -1), { ...series.at(-1)!, value }];

  // Your side: the dashboard's own figure. Both sides stay on closes when the
  // overview left an asset out (an oversold history) or one in scope has no
  // price, since the series would then count something the overview doesn't.
  if (!overview || overview.dataIssues.length > 0) return atClose;
  const held = opts.scopeAssetIds
    ? overview.holdings.filter((h) => opts.scopeAssetIds!.includes(h.assetId))
    : overview.holdings;
  if (held.some((h) => h.marketValue === null)) return atClose;
  const portfolio = withLast(result.portfolio, held.reduce((s, h) => s + h.marketValue!, 0));

  const benchmarks = result.benchmarks.map((b, i) => {
    const quote = latest.get(b.assetId);
    if (!quote) return atClose.benchmarks[i]!;
    // The quote is in today's units, the same units the replay holds.
    const price = D(quote.close);
    return {
      ...b,
      series: withLast(b.series, D(b.units).mul(price).toNumber()),
      lastPrice: { date: quote.date, price: price.toNumber(), live: quote.date >= today },
    };
  });

  return { ...result, portfolio, benchmarks, pricedLive: true };
}

export { extractCashFlows };
