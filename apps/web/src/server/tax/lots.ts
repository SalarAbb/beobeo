import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@beobeo/db";
import {
  buildLots,
  D,
  toIsoDate,
  ZERO,
  type EngineTransaction,
  type RecentBuyTxn,
  type TaxLot,
  type TaxProfile,
} from "@beobeo/core";
import { getMarketData } from "../market-data";

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
  const conditions = [eq(schema.transactions.userId, userId)];
  if (portfolioKey !== "all") {
    conditions.push(eq(schema.accounts.portfolioId, portfolioKey));
  }

  const rows = await db
    .select({ txn: schema.transactions, asset: schema.assets, account: schema.accounts })
    .from(schema.transactions)
    .innerJoin(schema.assets, eq(schema.transactions.assetId, schema.assets.id))
    .innerJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
    .where(and(...conditions))
    .orderBy(asc(schema.transactions.tradedAt), asc(schema.transactions.createdAt));

  if (rows.length === 0) {
    return { lots: [], recentBuys: [], ytdShortTermGain: ZERO, ytdLongTermGain: ZERO };
  }

  // Group by (account, asset) — lots must carry their account identity so a
  // plan can say "sell from Fidelity", which the shared engine transactions
  // don't track (buildLots itself is unaware of accounts).
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.txn.accountId}:${row.txn.assetId}`;
    const g = groups.get(key);
    if (g) g.push(row);
    else groups.set(key, [row]);
  }

  const assetsById = new Map(rows.map((r) => [r.asset.id, r.asset]));
  const market = getMarketData();
  const today = toIsoDate(asOf);
  const latestByAsset = await market
    .getLatestPrices([...assetsById.values()], today)
    .catch(() => new Map<string, { date: string; close: string }>());

  const lots: TaxLot[] = [];
  let ytdShortTermGain = ZERO;
  let ytdLongTermGain = ZERO;
  const thisYear = asOf.getUTCFullYear();

  for (const groupRows of groups.values()) {
    const { account, asset } = groupRows[0]!;
    const txns: EngineTransaction[] = groupRows.map(({ txn }) => ({
      id: txn.id,
      assetId: txn.assetId,
      type: txn.type,
      quantity: D(txn.quantity),
      pricePerUnit: txn.pricePerUnit === null ? null : D(txn.pricePerUnit),
      fees: D(txn.fees),
      tradedAt: txn.tradedAt,
    }));

    let engineResult;
    try {
      engineResult = buildLots(txns);
    } catch {
      continue; // inconsistent history for this account+asset — skip, don't crash the page
    }

    if (account.accountType !== "taxable") continue; // IRAs contribute no sellable lots

    for (const g of engineResult.realized) {
      if (g.soldAt.getUTCFullYear() !== thisYear) continue;
      if (g.longTerm) ytdLongTermGain = ytdLongTermGain.add(g.gain);
      else ytdShortTermGain = ytdShortTermGain.add(g.gain);
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
    });
  }

  return { lots, recentBuys, ytdShortTermGain, ytdLongTermGain };
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
  const [created] = await db
    .insert(schema.taxProfiles)
    .values({ userId, portfolioKey })
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
