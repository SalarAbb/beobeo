import {
  D,
  planFifo,
  planHighestCostFirst,
  planSale,
  summarizeHarvest,
  taxMoves,
  taxOwedSoFar,
  toIsoDate,
  detectWashSaleBlocks,
  isLongTerm,
  profileAtIncome,
  sellEverything,
  type IncomeInfo,
  type LossLanding,
  type LossLotCandidate,
  type MovePurchase,
  type TaxMove,
  type PlannedSale,
  type TaxLot,
  type TaxPlan,
  type WashSaleBlock,
} from "@beobeo/core";
import { cached, sharedRun, userCacheKey } from "./cache";
import { computeOverview } from "./portfolio";
import { loadOrCreateTaxProfile, loadTaxLots, toEngineProfile } from "./tax/lots";

const TTL = { now: 60, lots: 60, plan: 60, harvest: 60 } as const;

const portfolioKey = (portfolioId?: string): string => portfolioId ?? "all";

/** Sale lots whose current value is below cost — the wash-sale candidate pool. */
function lossCandidates(lots: TaxLot[]): LossLotCandidate[] {
  return lots
    .filter((l) => l.quantity.mul(l.price).lt(l.costBasis))
    .map((l) => ({
      lotId: l.lotId,
      assetId: l.assetId,
      symbol: l.symbol,
      assetClass: l.assetClass,
      lossUsd: l.costBasis.sub(l.quantity.mul(l.price)),
    }));
}

/**
 * The page's first batch asks for tax.now, tax.lots and tax.profile at once,
 * and each needs the same lots and profile row; on the Neon driver three
 * copies of the same queries queue behind each other. Concurrent callers
 * share one run (read-only to them; core only sorts copies).
 *
 * A finished load lingers as long as tax.now's cache (writes drop it): every
 * Raise Cash amount and the Harvest tab otherwise reloaded the rows, prices
 * and replay, 0.7–1.1s per plan after the Now tab had just loaded them
 * (petyr, mission 110: "I stared at spinners on Raise Cash and Harvest").
 */
const LOAD_LINGER_MS = 60_000;

function loadScopeLots(userId: string, scope: string, asOf: Date) {
  return sharedRun(
    userCacheKey(userId, "tax-lots-load", scope),
    () => loadTaxLots(userId, scope, asOf),
    { lingerMs: LOAD_LINGER_MS },
  );
}

function loadScopeProfileRow(userId: string, scope: string) {
  return sharedRun(
    userCacheKey(userId, "tax-profile-row", scope),
    () => loadOrCreateTaxProfile(userId, scope),
    { lingerMs: LOAD_LINGER_MS },
  );
}

async function assembleScope(userId: string, scope: string, asOf: Date) {
  const [bundle, profileRow] = await Promise.all([
    loadScopeLots(userId, scope, asOf),
    loadScopeProfileRow(userId, scope),
  ]);
  const { lots, recentBuys, ytdShortTermGain, ytdLongTermGain } = bundle;
  const profile = toEngineProfile(profileRow, ytdShortTermGain, ytdLongTermGain);
  const blocked = detectWashSaleBlocks(lossCandidates(lots), recentBuys, asOf);
  return {
    lots,
    profile,
    blocked,
    profileRow,
    ytdShortTermGain,
    ytdLongTermGain,
    ytdSales: bundle.ytdSales,
    ytdTaxAdvantagedGain: bundle.ytdTaxAdvantagedGain,
    allSales: bundle.allSales,
    accountPositions: bundle.accountPositions,
  };
}

// ---- JSON-safe serialization (Decimal -> number, Date -> ISO string) ----
// `asOf` threads through so every isLongTerm check in one request agrees.

/** The first safely long-term sale date: the day after the purchase's anniversary. */
function longTermOn(openedAt: Date): Date {
  const d = new Date(openedAt);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

const DAY_MS = 86_400_000;

const serializeLot = (l: TaxLot, asOf: Date) => ({
  lotId: l.lotId,
  assetId: l.assetId,
  symbol: l.symbol,
  assetClass: l.assetClass,
  accountId: l.accountId,
  accountName: l.accountName,
  quantity: l.quantity.toNumber(),
  costBasis: l.costBasis.toNumber(),
  openedAt: l.openedAt.toISOString(),
  price: l.price.toNumber(),
  marketValue: l.quantity.mul(l.price).toNumber(),
  unrealizedGain: l.quantity.mul(l.price).sub(l.costBasis).toNumber(),
  isLongTerm: isLongTerm(l.openedAt, asOf),
  longTermOn: toIsoDate(longTermOn(l.openedAt)),
  /** Whole days until it turns long-term (0 once it is). */
  daysToLongTerm: isLongTerm(l.openedAt, asOf)
    ? 0
    : Math.max(1, Math.ceil((longTermOn(l.openedAt).getTime() - asOf.getTime()) / DAY_MS)),
});

const serializeSale = (s: PlannedSale, asOf: Date) => ({
  lot: serializeLot(s.lot, asOf),
  sellQuantity: s.sellQuantity.toNumber(),
  proceeds: s.proceeds.toNumber(),
  realizedGain: s.realizedGain.toNumber(),
  isLongTerm: s.isLongTerm,
  taxCost: s.taxCost.toNumber(),
  effectiveRate: s.effectiveRate,
  netAfterTax: s.netAfterTax.toNumber(),
  ripening: s.ripening
    ? {
        daysUntilLongTerm: s.ripening.daysUntilLongTerm,
        estSavingsIfWaited: s.ripening.estSavingsIfWaited.toNumber(),
      }
    : null,
});

/** A block with the purchase it holds back (petyr, mission 97: "it says QQQ is lost
 *  for good because of a Roth buy, but doesn't show me which purchase or date"). */
const serializeBlock = (b: WashSaleBlock, lots: TaxLot[]) => {
  const lot = lots.find((l) => l.lotId === b.lotId);
  return {
    lotId: b.lotId,
    assetId: b.assetId,
    symbol: b.symbol,
    disallowedLossUsd: b.disallowedLossUsd.toNumber(),
    permanentlyDisallowed: b.permanentlyDisallowed,
    triggerAccountName: b.triggerAccountName,
    triggerDate: b.triggerDate.toISOString(),
    triggerQuantity: b.triggerQuantity?.toNumber() ?? null,
    triggerAmountUsd: b.triggerAmountUsd?.toNumber() ?? null,
    likelyDividendReinvestment: b.likelyDividendReinvestment,
    reason: b.reason,
    lot: lot
      ? {
          accountName: lot.accountName,
          openedAt: lot.openedAt.toISOString(),
          quantity: lot.quantity.toNumber(),
          costBasis: lot.costBasis.toNumber(),
          marketValue: lot.quantity.mul(lot.price).toNumber(),
        }
      : null,
  };
};

const serializePlan = (p: TaxPlan, asOf: Date, lots: TaxLot[]) => ({
  objective: p.objective,
  targetProceeds: p.targetProceeds.toNumber(),
  totalProceeds: p.totalProceeds.toNumber(),
  totalTaxCost: p.totalTaxCost.toNumber(),
  totalAfterTax: p.totalAfterTax.toNumber(),
  shortfall: p.shortfall.toNumber(),
  sales: p.sales.map((s) => serializeSale(s, asOf)),
  blocked: p.blocked.map((b) => serializeBlock(b, lots)),
  excluded: p.excluded.map((e) => ({ lot: serializeLot(e.lot, asOf), reason: e.reason })),
});

// ---- Cached compute entry points ----

export function computeTaxProfile(userId: string, portfolioId?: string) {
  const scope = portfolioKey(portfolioId);
  return cached(userCacheKey(userId, "tax-profile", scope), TTL.now, async () => {
    const asOf = new Date();
    const { profileRow, profile, ytdShortTermGain, ytdLongTermGain } = await assembleScope(
      userId,
      scope,
      asOf,
    );
    return {
      federalOrdinaryRatePct: Number(profileRow.federalOrdinaryRatePct),
      federalLtcgRatePct: Number(profileRow.federalLtcgRatePct),
      stateOrdinaryRatePct: Number(profileRow.stateOrdinaryRatePct),
      stateLtcgRatePct: Number(profileRow.stateLtcgRatePct),
      stateTreatsLtcgAsOrdinary: profileRow.stateTreatsLtcgAsOrdinary,
      carryforwardShortTerm: Number(profileRow.carryforwardShortTerm),
      carryforwardLongTerm: Number(profileRow.carryforwardLongTerm),
      carryforwardDiscountPct: Number(profileRow.carryforwardDiscountPct),
      ytdShortTermComputed: ytdShortTermGain.toNumber(),
      ytdLongTermComputed: ytdLongTermGain.toNumber(),
      ytdShortTermOverride:
        profileRow.ytdShortTermOverride === null ? null : Number(profileRow.ytdShortTermOverride),
      ytdLongTermOverride:
        profileRow.ytdLongTermOverride === null ? null : Number(profileRow.ytdLongTermOverride),
      effectiveOrdinaryRate: profile.ordinaryRate,
      effectiveLtcgRate: profile.ltcgRate,
    };
  });
}

export function computeTaxLotsList(userId: string, portfolioId?: string) {
  const scope = portfolioKey(portfolioId);
  return cached(userCacheKey(userId, "tax-lots", scope), TTL.lots, async () => {
    const asOf = new Date();
    const { lots } = await loadScopeLots(userId, scope, asOf);
    return lots
      .map((l) => serializeLot(l, asOf))
      .sort((a, b) => b.marketValue - a.marketValue);
  });
}

/**
 * What each account holds (retirement accounts included), from the same
 * per-account replay as the lots: chat answers "what's in my IRA?" and
 * "work from the brokerage alone" from it, and the Accounts page lists each
 * account's holdings and value (petyr, mission 97). Value is null when unpriced.
 */
export function computeAccountHoldings(userId: string, portfolioId?: string) {
  const scope = portfolioKey(portfolioId);
  return cached(userCacheKey(userId, "account-holdings4", scope), TTL.lots, async () => {
    const { accountPositions } = await loadScopeLots(userId, scope, new Date());
    const byAccount = new Map<
      string,
      {
        accountName: string;
        /** A taxable account; sales inside retirement accounts aren't taxed. */
        taxed: boolean;
        value: number;
        costBasis: number;
        holdings: {
          assetId: string;
          symbol: string;
          quantity: number;
          costBasis: number;
          marketValue: number | null;
          /** Value − cost before rounding, so it equals the dashboard's Gain. */
          gain: number | null;
        }[];
      }
    >();
    for (const p of accountPositions) {
      const a = byAccount.get(p.accountId) ?? {
        accountName: p.accountName,
        taxed: p.accountType === "taxable",
        value: 0,
        costBasis: 0,
        holdings: [],
      };
      const marketValue = p.price ? p.quantity.mul(p.price).toDecimalPlaces(2).toNumber() : null;
      a.value += marketValue ?? 0;
      a.costBasis += p.costBasis.toNumber();
      a.holdings.push({
        assetId: p.assetId,
        symbol: p.symbol,
        quantity: p.quantity.toNumber(),
        costBasis: p.costBasis.toDecimalPlaces(2).toNumber(),
        marketValue,
        gain: p.price ? p.quantity.mul(p.price).sub(p.costBasis).toDecimalPlaces(2).toNumber() : null,
      });
      byAccount.set(p.accountId, a);
    }
    return [...byAccount].map(([accountId, a]) => ({
      accountId,
      accountName: a.accountName,
      taxed: a.taxed,
      value: Math.round(a.value * 100) / 100,
      costBasis: Math.round(a.costBasis * 100) / 100,
      holdings: a.holdings.sort((x, y) => (y.marketValue ?? 0) - (x.marketValue ?? 0)),
    }));
  });
}

/**
 * `income` = filing status + taxable income the user saved on this device
 * (Tax Profile), which unlocks the 0% long-term gain moves. Without it the
 * list has no gain moves and `zeroRateRoomUsd` is null.
 */
export function computeTaxNow(userId: string, portfolioId?: string, income?: IncomeInfo) {
  const scope = portfolioKey(portfolioId);
  const incomeKey = income ? `${income.status}:${Math.round(income.taxableIncomeUsd)}` : "none";
  return cached(userCacheKey(userId, "tax-now12", scope, incomeKey), TTL.now, async () => {
    const asOf = new Date();
    const [
      {
        lots,
        profile: saved,
        blocked,
        profileRow,
        ytdSales,
        ytdTaxAdvantagedGain,
        allSales,
        accountPositions,
      },
      overview,
    ] = await Promise.all([
        assembleScope(userId, scope, asOf),
        // The dashboard's "Gain from sales" tile, so the page can say how its
        // this-year taxable totals relate to it (personas read the all-time
        // tile as their tax number and called the Tax Center wrong).
        computeOverview(userId, portfolioId).catch(() => null),
      ]);

    const yearEnd = new Date(Date.UTC(asOf.getUTCFullYear(), 11, 31, 23, 59, 59));
    const daysLeftInTaxYear = Math.max(
      0,
      Math.ceil((yearEnd.getTime() - asOf.getTime()) / 86_400_000),
    );

    // With an income that keeps the year inside the 0% long-term bracket, the
    // saved federal long-term rate doesn't apply (verdict and loss values;
    // core `profileAtIncome`).
    const profile = income
      ? profileAtIncome(saved, income, Number(profileRow.federalLtcgRatePct) / 100)
      : saved;

    // One ranked list (R-003); the same payload feeds the chat snapshot.
    const tm = taxMoves(lots, blocked, profile, asOf, { income });

    // "What would I owe if I sold?" (samwell, mission 51): every taxable lot
    // on top of the year so far, plus what the retirement accounts it leaves
    // out are worth.
    const all = sellEverything(lots, blocked, saved, asOf, {
      income,
      federalLtcgRate: Number(profileRow.federalLtcgRatePct) / 100,
    });
    // The same estimate per asset, for the position page's "If you sold all
    // of it today" (arya, mission 61: no trim tax cost anywhere). Each asset
    // is priced alone on top of the year so far, so they don't sum to `all`.
    const lotsByAsset = new Map<string, typeof lots>();
    for (const l of lots) lotsByAsset.set(l.assetId, [...(lotsByAsset.get(l.assetId) ?? []), l]);
    const sellAllByAsset: Record<
      string,
      {
        symbol: string;
        assetClass: string;
        units: number;
        accounts: string[];
        proceedsUsd: number;
        costBasisUsd: number;
        shortTermGainUsd: number;
        longTermGainUsd: number;
        disallowedLossUsd: number;
        taxUsd: number;
      }
    > = {};
    for (const [assetId, assetLots] of lotsByAsset) {
      const one = sellEverything(assetLots, blocked, saved, asOf, {
        income,
        federalLtcgRate: Number(profileRow.federalLtcgRatePct) / 100,
      });
      sellAllByAsset[assetId] = {
        symbol: assetLots[0]!.symbol,
        assetClass: assetLots[0]!.assetClass,
        units: assetLots.reduce((s, l) => s + l.quantity.toNumber(), 0),
        accounts: [...new Set(assetLots.map((l) => l.accountName))],
        proceedsUsd: one.proceedsUsd.toNumber(),
        costBasisUsd: one.costBasisUsd.toNumber(),
        shortTermGainUsd: one.shortTermGainUsd.toNumber(),
        longTermGainUsd: one.longTermGainUsd.toNumber(),
        disallowedLossUsd: one.disallowedLossUsd.toNumber(),
        taxUsd: one.taxUsd.toNumber(),
      };
    }
    const untaxed = new Map<string, number>();
    for (const p of accountPositions) {
      if (p.accountType === "taxable" || !p.price) continue;
      untaxed.set(
        p.accountName,
        (untaxed.get(p.accountName) ?? 0) + p.quantity.mul(p.price).toNumber(),
      );
    }

    return {
      taxYear: asOf.getUTCFullYear(),
      sellAll:
        lots.length === 0
          ? null
          : {
              accounts: [...new Set(lots.map((l) => l.accountName))],
              proceedsUsd: all.proceedsUsd.toNumber(),
              costBasisUsd: all.costBasisUsd.toNumber(),
              shortTermGainUsd: all.shortTermGainUsd.toNumber(),
              longTermGainUsd: all.longTermGainUsd.toNumber(),
              taxUsd: all.taxUsd.toNumber(),
              disallowedLossUsd: all.disallowedLossUsd.toNumber(),
              ordinaryRatePct: all.ordinaryRate * 100,
              ltcgRatePct: all.ltcgRate * 100,
              carryforwardUsd: saved.carryforwardShortTerm
                .add(saved.carryforwardLongTerm)
                .toNumber(),
              untaxedAccounts: [...untaxed]
                .map(([name, valueUsd]) => ({ name, valueUsd }))
                .sort((a, b) => b.valueUsd - a.valueUsd),
            },
      sellAllByAsset,
      daysLeftInTaxYear,
      // The effective (override-aware) YTD position — this is what actually
      // drives every marginal tax-cost number on this page: a loss offsetting
      // a YTD gain is worth more than one heading straight to carryforward.
      ytdShortTermGain: profile.ytdShortTermGain.toNumber(),
      ytdLongTermGain: profile.ytdLongTermGain.toNumber(),
      taxOwedSoFarUsd: taxOwedSoFar(profile).toNumber(),
      ytdOverridden:
        profileRow.ytdShortTermOverride !== null || profileRow.ytdLongTermOverride !== null,
      ytdSales: ytdSales.map((s) => ({
        txnId: s.txnId,
        soldAt: toIsoDate(s.soldAt),
        symbol: s.symbol,
        accountName: s.accountName,
        quantity: s.quantity.toNumber(),
        proceeds: s.proceeds.toNumber(),
        shortTermGain: s.shortTermGain.toNumber(),
        longTermGain: s.longTermGain.toNumber(),
      })),
      ytdTaxAdvantagedGain: ytdTaxAdvantagedGain.toNumber(),
      // Every year's sales, retirement accounts included: what the Dashboard's
      // all-time "Gain from sales" adds up from (petyr, mission 104).
      allSales: allSales.map((s) => ({
        txnId: s.txnId,
        soldAt: toIsoDate(s.soldAt),
        symbol: s.symbol,
        accountName: s.accountName,
        taxed: s.taxed,
        quantity: s.quantity.toNumber(),
        proceeds: s.proceeds.toNumber(),
        shortTermGain: s.shortTermGain.toNumber(),
        longTermGain: s.longTermGain.toNumber(),
      })),
      dashboardRealized: overview && {
        allTime: overview.totals.realized,
        thisYear: overview.totals.realizedThisYear,
      },
      moves: tm.moves.map((m) => serializeMove(m, asOf)),
      // The rates every move's saving is worked out at (after the income
      // adjustment), so a move's landing × these = its "saves ~$X".
      ratesUsed: {
        shortTermPct: profile.ordinaryRate * 100,
        longTermPct: profile.ltcgRate * 100,
        carryforwardCountsPct: profile.carryforwardDiscount * 100,
      },
      movesTaxSavedUsd: tm.lockAndHarvestSavedUsd.toNumber(),
      movesBreakdown: {
        totalHarvestedLossUsd: tm.breakdown.totalHarvestedLossUsd.toNumber(),
        gainsOffsetUsd: tm.breakdown.gainsOffsetUsd.toNumber(),
        ordinaryDeductionUsd: tm.breakdown.ordinaryDeductionUsd.toNumber(),
        carryforwardUsd: tm.breakdown.carryforwardUsd.toNumber(),
      },
      deductionRoomUsd: tm.deductionRoomUsd.toNumber(),
      zeroRateRoomUsd: tm.zeroRateRoomUsd?.toNumber() ?? null,
      // The bracket the profile's rates came from has 0% long-term gains
      // (welcome step 1), so it's worth asking for income to size the room.
      inZeroRateBand: Number(profileRow.federalLtcgRatePct) === 0,
      hasLongTermGains: lots.some(
        (l) => isLongTerm(l.openedAt, asOf) && l.quantity.mul(l.price).gt(l.costBasis),
      ),
    };
  });
}

const cents = (d: { toNumber(): number }) => Math.round(d.toNumber() * 100) / 100;

/** Dollars of a move's loss by where they land; × `ratesUsed` = its saving. */
function serializeLanding(l: LossLanding) {
  return {
    cancelsShortTermGainsUsd: cents(l.cancelsShortTermUsd),
    cancelsLongTermGainsUsd: cents(l.cancelsLongTermUsd),
    offIncomeUsd: cents(l.offIncomeUsd),
    carriedForwardUsd: cents(l.carriedForwardUsd),
  };
}

/** One purchase behind a wait / on-hold row (petyr: "'Hold 2 purchases of VTI
 *  until Nov 5–Dec 5' never shows me the lots"). */
const serializePurchase = (p: MovePurchase, asOf: Date) => ({
  boughtOn: toIsoDate(p.lot.openedAt),
  isLongTerm: isLongTerm(p.lot.openedAt, asOf),
  accountName: p.lot.accountName,
  quantity: p.lot.quantity.toNumber(),
  costUsd: p.lot.costBasis.toNumber(),
  gainUsd: p.lot.quantity.mul(p.lot.price).sub(p.lot.costBasis).toNumber(),
  longTermOn: toIsoDate(longTermOn(p.lot.openedAt)),
  savedUsd: p.valueUsd === null ? null : p.valueUsd.toNumber(),
});

/** Plain-JSON move for the Now tab and the chat snapshot. */
function serializeMove(m: TaxMove, asOf: Date) {
  const value = m.valueUsd === null ? null : m.valueUsd.toNumber();
  switch (m.kind) {
    case "lock":
    case "harvest":
      return {
        kind: m.kind,
        assetId: m.lock.assetId,
        symbol: m.lock.symbol,
        assetClass: m.lock.assetClass,
        quantity: m.lock.quantity.toNumber(),
        lossUsd: m.lock.lossUsd.toNumber(),
        accounts: [...new Set(m.lock.sales.map((s) => s.lot.accountName))],
        rebuyAfter: m.kind === "harvest" ? toIsoDate(m.rebuyAfter) : null,
        taxSavedUsd: value,
        landing: serializeLanding(m.landing),
      };
    case "on_hold":
      return {
        kind: m.kind,
        assetId: m.assetId,
        symbol: m.symbol,
        assetClass: m.assetClass,
        lots: m.lots,
        lossUsd: m.lossUsd.toNumber(),
        clearsOn: toIsoDate(m.clearsOn),
        permanentlyDisallowed: m.permanentlyDisallowed,
        taxSavedUsd: value,
        landing: m.landing && serializeLanding(m.landing),
        purchases: m.purchases.map((p) => serializePurchase(p, asOf)),
      };
    case "wait":
      return {
        kind: m.kind,
        assetId: m.assetId,
        symbol: m.symbol,
        assetClass: m.assetClass,
        lots: m.lots,
        firstLongTermOn: toIsoDate(m.firstLongTermOn),
        lastLongTermOn: toIsoDate(m.lastLongTermOn),
        taxSavedUsd: value,
        purchases: m.purchases.map((p) => serializePurchase(p, asOf)),
      };
    case "zero_gain":
      return {
        kind: m.kind,
        assetId: m.gain.assetId,
        symbol: m.gain.symbol,
        assetClass: m.gain.assetClass,
        quantity: m.gain.quantity.toNumber(),
        gainUsd: m.gain.gainUsd.toNumber(),
        accounts: [...new Set(m.gain.sales.map((s) => s.lot.accountName))],
        taxSavedUsd: value,
      };
  }
}

export function computeTaxPlan(
  userId: string,
  portfolioId: string | undefined,
  targetProceeds: number,
  doNotSell?: string[],
  accountId?: string,
) {
  const scope = portfolioKey(portfolioId);
  const doNotSellKey = doNotSell && doNotSell.length > 0 ? [...doNotSell].sort().join(",") : "none";
  return cached(
    userCacheKey(
      userId,
      "tax-plan6",
      scope,
      Math.round(targetProceeds),
      doNotSellKey,
      accountId ?? "any",
    ),
    TTL.plan,
    async () => {
      const asOf = new Date();
      const all = await assembleScope(userId, scope, asOf);
      // "Sell only from my Schwab account" (petyr, mission 4): the plan, the FIFO
      // comparison and the on-hold list see just that account's lots. Wash-sale
      // detection already ran over every account, so a rebuy elsewhere still blocks.
      const { profile } = all;
      const lots = accountId ? all.lots.filter((l) => l.accountId === accountId) : all.lots;
      const inAccount = new Set(lots.map((l) => l.lotId));
      const blocked = accountId ? all.blocked.filter((b) => inAccount.has(b.lotId)) : all.blocked;
      const doNotSellSet = doNotSell && doNotSell.length > 0 ? new Set(doNotSell) : undefined;
      const opts = {
        targetProceeds: D(targetProceeds),
        lots,
        blocked,
        profile,
        doNotSell: doNotSellSet,
        asOf,
      };
      const optimized = planSale({ ...opts, objective: "raise_cash" as const });
      const fifo = planFifo(opts);
      const highestCostFirst = planHighestCostFirst(opts);
      const breakdown = summarizeHarvest(profile, optimized.sales);
      return {
        optimized: serializePlan(optimized, asOf, lots),
        fifo: serializePlan(fifo, asOf, lots),
        highestCostFirst: serializePlan(highestCostFirst, asOf, lots),
        headlineSavingsVsFifo: optimized.totalAfterTax.sub(fifo.totalAfterTax).toNumber(),
        // Same breakdown as the Harvest tab — any lots this plan sells at a
        // loss are valued through the identical gains-offset/$3k/carryforward
        // buckets, so the "why does each lot's tax cost differ" question
        // gets the same answer here.
        breakdown: {
          totalHarvestedLossUsd: breakdown.totalHarvestedLossUsd.toNumber(),
          gainsOffsetUsd: breakdown.gainsOffsetUsd.toNumber(),
          ordinaryDeductionUsd: breakdown.ordinaryDeductionUsd.toNumber(),
          carryforwardUsd: breakdown.carryforwardUsd.toNumber(),
        },
        // Realized capital gains so far this year — the waterfall chart's
        // starting position ("now"). $0 for most users; non-zero once
        // they've sold at a gain/loss earlier in the year.
        startingRealizedGain: profile.ytdShortTermGain.add(profile.ytdLongTermGain).toNumber(),
      };
    },
  );
}

export function computeTaxHarvest(
  userId: string,
  portfolioId: string | undefined,
  lossCapUsd?: number,
) {
  const scope = portfolioKey(portfolioId);
  return cached(
    userCacheKey(userId, "tax-harvest6", scope, lossCapUsd ?? "uncapped"),
    TTL.harvest,
    async () => {
      const asOf = new Date();
      const { lots, profile, blocked } = await assembleScope(userId, scope, asOf);
      const plan = planSale({
        objective: "harvest_losses",
        targetProceeds: D(0),
        lots,
        blocked,
        profile,
        asOf,
      });

      let sales = plan.sales;
      if (lossCapUsd !== undefined) {
        let cumulative = 0;
        const kept: typeof sales = [];
        for (const s of sales) {
          if (cumulative >= lossCapUsd) break;
          kept.push(s);
          cumulative += Math.abs(s.realizedGain.toNumber());
        }
        sales = kept;
      }

      const totalProceeds = sales.reduce((s, x) => s.add(x.proceeds), D(0));
      const totalTaxCost = sales.reduce((s, x) => s.add(x.taxCost), D(0));
      const breakdown = summarizeHarvest(profile, sales);
      return {
        objective: "harvest_losses" as const,
        totalProceeds: totalProceeds.toNumber(),
        totalTaxCost: totalTaxCost.toNumber(),
        totalAfterTax: totalProceeds.sub(totalTaxCost).toNumber(),
        estTaxSavedUsd: -totalTaxCost.toNumber(),
        sales: sales.map((s) => serializeSale(s, asOf)),
        blocked: plan.blocked.map((b) => serializeBlock(b, lots)),
        breakdown: {
          totalHarvestedLossUsd: breakdown.totalHarvestedLossUsd.toNumber(),
          gainsOffsetUsd: breakdown.gainsOffsetUsd.toNumber(),
          ordinaryDeductionUsd: breakdown.ordinaryDeductionUsd.toNumber(),
          carryforwardUsd: breakdown.carryforwardUsd.toNumber(),
        },
        startingRealizedGain: profile.ytdShortTermGain.add(profile.ytdLongTermGain).toNumber(),
      };
    },
  );
}
