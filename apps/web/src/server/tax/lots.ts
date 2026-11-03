import { and, eq } from "drizzle-orm";
import { db, schema } from "@beobeo/db";
import {
  buildLots,
  D,
  toIsoDate,
  ZERO,
  type EngineTransaction,
  type LotEngineResult,
  type RecentBuyTxn,
  type TaxLot,
  type TaxProfile,
} from "@beobeo/core";
import { getMarketData } from "../market-data";
import { loadKnownSplits, lotMethodFor, mergeKnownSplits } from "../portfolio";
import { loadScopedRows, type ScopedTxnRow } from "../scoped-rows";

const DAY_MS = 86_400_000;
/** Wash-sale window (30d) plus slack for the DRIP date-correlation heuristic. */
const RECENT_WINDOW_DAYS = 40;
const DRIP_WINDOW_MS = 5 * DAY_MS;
const DRIP_AMOUNT_TOLERANCE = 0.1;

const isTaxAdvantaged = (accountType: string): boolean => accountType !== "taxable";

export interface TaxLotBundle {
  /** Sellable universe — taxable accounts only. */
  lots: TaxLot[];
  /** Every account in scope, taxable or not — cross-account wash-sale input. */
  recentBuys: RecentBuyTxn[];
  ytdShortTermGain: ReturnType<typeof D>;
  ytdLongTermGain: ReturnType<typeof D>;
  /** This year's sales in taxable accounts, one per sell transaction, oldest
   *  first: the rows the two YTD totals above add up from. */
  ytdSales: YtdSale[];
  /** This year's realized gain inside IRAs/401(k)s: counted in the
   *  dashboard's "this year" figure, never taxed. */
  ytdTaxAdvantagedGain: ReturnType<typeof D>;
  /** Every sale in scope, every year and account, one per sell transaction,
   *  oldest first: the rows the Dashboard's all-time "Gain from sales" adds
   *  up from (petyr, mission 104, couldn't trace his −$1,523 to its sales). */
  allSales: PastSale[];
  /** What each account holds now, retirement accounts included: one row per
   *  (account, asset) with units left. `price` is null when unpriced. */
  accountPositions: AccountPosition[];
}

export interface AccountPosition {
  accountId: string;
  accountName: string;
  accountType: string;
  assetId: string;
  symbol: string;
  quantity: ReturnType<typeof D>;
  costBasis: ReturnType<typeof D>;
  price: ReturnType<typeof D> | null;
}

export interface YtdSale {
  txnId: string;
  soldAt: Date;
  symbol: string;
  accountName: string;
  quantity: ReturnType<typeof D>;
  proceeds: ReturnType<typeof D>;
  shortTermGain: ReturnType<typeof D>;
  longTermGain: ReturnType<typeof D>;
}

export interface PastSale extends YtdSale {
  /** False for sales inside an IRA/401(k): counted, never taxed. */
  taxed: boolean;
}

export { loadScopedRows, type ScopedTxnRow };

/**
 * Replay each (account, asset) pair through the lot engine. Rows must be
 * sorted by tradedAt. Lots must carry their account identity so a plan can
 * say "sell from Fidelity" (and brokers match per account, FIFO or HIFO by the account's method for that kind of asset), which the
 * dashboard's per-asset engine transactions don't track. A pair whose history
 * doesn't replay (an oversell from a partial export) is skipped, never thrown.
 */
export function replayByAccount(
  rows: ScopedTxnRow[],
  knownSplits: Awaited<ReturnType<typeof loadKnownSplits>>,
): { account: ScopedTxnRow["account"]; asset: ScopedTxnRow["asset"]; result: LotEngineResult }[] {
  const groups = new Map<string, ScopedTxnRow[]>();
  for (const row of rows) {
    const key = `${row.txn.accountId}:${row.txn.assetId}`;
    const g = groups.get(key);
    if (g) g.push(row);
    else groups.set(key, [row]);
  }
  const out = [];
  for (const groupRows of groups.values()) {
    const { account, asset } = groupRows[0]!;
    // Same provider splits the dashboard injects: without them a position the
    // user never recorded a split for keeps pre-split units at post-split
    // prices (fake losses), and a post-split sale oversells and drops the
    // whole asset from the Tax Center (gilderoy's NFLX).
    const txns: EngineTransaction[] = mergeKnownSplits(
      groupRows.map(({ txn }) => ({
        id: txn.id,
        assetId: txn.assetId,
        type: txn.type,
        quantity: D(txn.quantity),
        pricePerUnit: txn.pricePerUnit === null ? null : D(txn.pricePerUnit),
        fees: D(txn.fees),
        tradedAt: txn.tradedAt,
      })),
      knownSplits.filter((s) => s.assetId === asset.id),
    );
    try {
      out.push({ account, asset, result: buildLots(txns, lotMethodFor(account, asset.class)) });
    } catch {
      // inconsistent history for this account+asset — skip, don't crash the page
    }
  }
  return out;
}

/**
 * Load the sellable lot universe + wash-sale context for a tax-entity scope
 * ("all" or one portfolio id — see tax_profiles' doc comment for why a
 * portfolio is the taxpayer boundary here). One query, one bulk price read
 * — never a per-asset loop.
 */
export async function loadTaxLots(
  userId: string,
  portfolioKey: string,
  asOf: Date = new Date(),
): Promise<TaxLotBundle> {
  const rows = await loadScopedRows(userId, portfolioKey);

  if (rows.length === 0) {
    return {
      lots: [],
      recentBuys: [],
      ytdShortTermGain: ZERO,
      ytdLongTermGain: ZERO,
      ytdSales: [],
      ytdTaxAdvantagedGain: ZERO,
      allSales: [],
      accountPositions: [],
    };
  }

  const assetsById = new Map(rows.map((r) => [r.asset.id, r.asset]));
  const market = getMarketData();
  const today = toIsoDate(asOf);
  const [latestByAsset, knownSplits] = await Promise.all([
    market
      .getLatestPrices([...assetsById.values()], today)
      .catch(() => new Map<string, { date: string; close: string }>()),
    loadKnownSplits(db, [...assetsById.keys()]),
  ]);

  const lots: TaxLot[] = [];
  let ytdShortTermGain = ZERO;
  let ytdLongTermGain = ZERO;
  let ytdTaxAdvantagedGain = ZERO;
  const salesById = new Map<string, YtdSale>();
  const allSalesById = new Map<string, PastSale>();
  const accountPositions: AccountPosition[] = [];
  const thisYear = asOf.getUTCFullYear();

  for (const { account, asset, result: engineResult } of replayByAccount(rows, knownSplits)) {
    let quantity = ZERO;
    let costBasis = ZERO;
    for (const lot of engineResult.openLots) {
      quantity = quantity.add(lot.quantity);
      costBasis = costBasis.add(lot.costBasis);
    }
    if (quantity.gt(0)) {
      const latest = latestByAsset.get(asset.id);
      accountPositions.push({
        accountId: account.id,
        accountName: account.name,
        accountType: account.accountType,
        assetId: asset.id,
        symbol: asset.symbol,
        quantity,
        costBasis,
        price: latest ? D(latest.close) : null,
      });
    }

    for (const g of engineResult.realized) {
      const sale = allSalesById.get(g.sourceTxnId) ?? {
        txnId: g.sourceTxnId,
        soldAt: g.soldAt,
        symbol: asset.symbol,
        accountName: account.name,
        taxed: account.accountType === "taxable",
        quantity: ZERO,
        proceeds: ZERO,
        shortTermGain: ZERO,
        longTermGain: ZERO,
      };
      sale.quantity = sale.quantity.add(g.quantity);
      sale.proceeds = sale.proceeds.add(g.proceeds);
      if (g.longTerm) sale.longTermGain = sale.longTermGain.add(g.gain);
      else sale.shortTermGain = sale.shortTermGain.add(g.gain);
      allSalesById.set(g.sourceTxnId, sale);
    }

    if (account.accountType !== "taxable") {
      // IRAs contribute no sellable lots and no taxable gain.
      for (const g of engineResult.realized) {
        if (g.soldAt.getUTCFullYear() === thisYear) {
          ytdTaxAdvantagedGain = ytdTaxAdvantagedGain.add(g.gain);
        }
      }
      continue;
    }

    for (const g of engineResult.realized) {
      if (g.soldAt.getUTCFullYear() !== thisYear) continue;
      if (g.longTerm) ytdLongTermGain = ytdLongTermGain.add(g.gain);
      else ytdShortTermGain = ytdShortTermGain.add(g.gain);
      const sale = salesById.get(g.sourceTxnId) ?? {
        txnId: g.sourceTxnId,
        soldAt: g.soldAt,
        symbol: asset.symbol,
        accountName: account.name,
        quantity: ZERO,
        proceeds: ZERO,
        shortTermGain: ZERO,
        longTermGain: ZERO,
      };
      sale.quantity = sale.quantity.add(g.quantity);
      sale.proceeds = sale.proceeds.add(g.proceeds);
      if (g.longTerm) sale.longTermGain = sale.longTermGain.add(g.gain);
      else sale.shortTermGain = sale.shortTermGain.add(g.gain);
      salesById.set(g.sourceTxnId, sale);
    }

    const latest = latestByAsset.get(asset.id);
    if (!latest) continue; // unpriced asset — can't value a sale, skip its lots

    for (const lot of engineResult.openLots) {
      lots.push({
        lotId: lot.sourceTxnId,
        assetId: asset.id,
        symbol: asset.symbol,
        assetClass: asset.class,
        accountId: account.id,
        accountName: account.name,
        quantity: lot.quantity,
        costBasis: lot.costBasis,
        openedAt: lot.openedAt,
        price: D(latest.close),
      });
    }
  }

  // Recent buys across EVERY account in scope (taxable or not) — the
  // cross-account/cross-tax-status detection is the whole point.
  const windowStart = asOf.getTime() - RECENT_WINDOW_DAYS * DAY_MS;
  const recentBuys: RecentBuyTxn[] = [];
  for (const row of rows) {
    if (row.txn.type !== "buy") continue;
    if (row.txn.tradedAt.getTime() < windowStart) continue;
    const buyAmount =
      D(row.txn.quantity).mul(row.txn.pricePerUnit ?? 0).add(row.txn.fees).toNumber();
    const likelyDividendReinvestment = rows.some((d) => {
      if (d.txn.type !== "dividend") return false;
      if (d.txn.assetId !== row.txn.assetId || d.txn.accountId !== row.txn.accountId) return false;
      if (Math.abs(d.txn.tradedAt.getTime() - row.txn.tradedAt.getTime()) > DRIP_WINDOW_MS) {
        return false;
      }
      const divAmount = D(d.txn.quantity).mul(d.txn.pricePerUnit ?? 0).toNumber();
      if (buyAmount === 0) return false;
      return Math.abs(divAmount - buyAmount) / buyAmount <= DRIP_AMOUNT_TOLERANCE;
    });
    recentBuys.push({
      assetId: row.txn.assetId,
      accountId: row.txn.accountId,
      accountName: row.account.name,
      isTaxAdvantaged: isTaxAdvantaged(row.account.accountType),
      tradedAt: row.txn.tradedAt,
      likelyDividendReinvestment,
      quantity: D(row.txn.quantity),
      amountUsd: D(row.txn.quantity).mul(row.txn.pricePerUnit ?? 0).add(row.txn.fees),
    });
  }

  const bySaleDate = (a: YtdSale, b: YtdSale) =>
    a.soldAt.getTime() - b.soldAt.getTime() || a.symbol.localeCompare(b.symbol);
  const ytdSales = [...salesById.values()].sort(bySaleDate);
  const allSales = [...allSalesById.values()].sort(bySaleDate);
  return {
    lots,
    recentBuys,
    ytdShortTermGain,
    ytdLongTermGain,
    ytdSales,
    ytdTaxAdvantagedGain,
    allSales,
    accountPositions,
  };
}

type TaxProfileRow = typeof schema.taxProfiles.$inferSelect;

/** Auto-creates a default-rate profile for this scope on first visit —
 *  same pattern as the app's auto-created "Main" portfolio/"Default" account. */
export async function loadOrCreateTaxProfile(
  userId: string,
  portfolioKey: string,
): Promise<TaxProfileRow> {
  const [existing] = await db
    .select()
    .from(schema.taxProfiles)
    .where(
      and(eq(schema.taxProfiles.userId, userId), eq(schema.taxProfiles.portfolioKey, portfolioKey)),
    );
  if (existing) return existing;
  // A new portfolio's profile starts from the rates the user already gave
  // (sign-up saves them on "all"); carryforwards and YTD stay per-portfolio.
  const [base] =
    portfolioKey === "all"
      ? []
      : await db
          .select()
          .from(schema.taxProfiles)
          .where(
            and(eq(schema.taxProfiles.userId, userId), eq(schema.taxProfiles.portfolioKey, "all")),
          );
  const rates = base && {
    federalOrdinaryRatePct: base.federalOrdinaryRatePct,
    federalLtcgRatePct: base.federalLtcgRatePct,
    stateOrdinaryRatePct: base.stateOrdinaryRatePct,
    stateLtcgRatePct: base.stateLtcgRatePct,
    stateTreatsLtcgAsOrdinary: base.stateTreatsLtcgAsOrdinary,
  };
  const [created] = await db
    .insert(schema.taxProfiles)
    .values({ userId, portfolioKey, ...rates })
    .onConflictDoNothing({ target: [schema.taxProfiles.userId, schema.taxProfiles.portfolioKey] })
    .returning();
  if (created) return created;
  // Lost an insert race — read back what the other request created.
  const [row] = await db
    .select()
    .from(schema.taxProfiles)
    .where(
      and(eq(schema.taxProfiles.userId, userId), eq(schema.taxProfiles.portfolioKey, portfolioKey)),
    );
  return row!;
}

/** Combine stored rates + computed-or-overridden YTD into the core engine's
 *  fraction-based TaxProfile. */
export function toEngineProfile(
  row: TaxProfileRow,
  computedYtdShortTerm: ReturnType<typeof D>,
  computedYtdLongTerm: ReturnType<typeof D>,
): TaxProfile {
  return {
    ordinaryRate:
      (Number(row.federalOrdinaryRatePct) + Number(row.stateOrdinaryRatePct)) / 100,
    ltcgRate: (Number(row.federalLtcgRatePct) + Number(row.stateLtcgRatePct)) / 100,
    ytdShortTermGain:
      row.ytdShortTermOverride !== null ? D(row.ytdShortTermOverride) : computedYtdShortTerm,
    ytdLongTermGain:
      row.ytdLongTermOverride !== null ? D(row.ytdLongTermOverride) : computedYtdLongTerm,
    carryforwardShortTerm: D(row.carryforwardShortTerm),
    carryforwardLongTerm: D(row.carryforwardLongTerm),
    carryforwardDiscount: Number(row.carryforwardDiscountPct) / 100,
  };
}
