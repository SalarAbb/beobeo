import {
  D,
  planFifo,
  planHighestCostFirst,
  planSale,
  ripeningSoon,
  summarizeHarvest,
  taxOwedSoFar,
  detectWashSaleBlocks,
  isLongTerm,
  type LossLotCandidate,
  type PlannedSale,
  type TaxLot,
  type TaxPlan,
  type WashSaleBlock,
} from "@beobeo/core";
import { cached, userCacheKey } from "./cache";
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
      lossUsd: l.costBasis.sub(l.quantity.mul(l.price)),
    }));
}

async function assembleScope(userId: string, scope: string, asOf: Date) {
  const [{ lots, recentBuys, ytdShortTermGain, ytdLongTermGain }, profileRow] =
    await Promise.all([
      loadTaxLots(userId, scope, asOf),
      loadOrCreateTaxProfile(userId, scope),
    ]);
  const profile = toEngineProfile(profileRow, ytdShortTermGain, ytdLongTermGain);
  const blocked = detectWashSaleBlocks(lossCandidates(lots), recentBuys, asOf);
  return { lots, profile, blocked, profileRow, ytdShortTermGain, ytdLongTermGain };
}

// ---- JSON-safe serialization (Decimal -> number, Date -> ISO string) ----
// `asOf` threads through so every isLongTerm check in one request agrees.

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

const serializeBlock = (b: WashSaleBlock) => ({
  lotId: b.lotId,
  assetId: b.assetId,
  symbol: b.symbol,
  disallowedLossUsd: b.disallowedLossUsd.toNumber(),
  permanentlyDisallowed: b.permanentlyDisallowed,
  triggerAccountName: b.triggerAccountName,
  triggerDate: b.triggerDate.toISOString(),
  likelyDividendReinvestment: b.likelyDividendReinvestment,
  reason: b.reason,
});

const serializePlan = (p: TaxPlan, asOf: Date) => ({
  objective: p.objective,
  targetProceeds: p.targetProceeds.toNumber(),
  totalProceeds: p.totalProceeds.toNumber(),
  totalTaxCost: p.totalTaxCost.toNumber(),
  totalAfterTax: p.totalAfterTax.toNumber(),
  shortfall: p.shortfall.toNumber(),
  sales: p.sales.map((s) => serializeSale(s, asOf)),
  blocked: p.blocked.map(serializeBlock),
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
    const { lots } = await loadTaxLots(userId, scope, asOf);
    return lots
      .map((l) => serializeLot(l, asOf))
      .sort((a, b) => b.marketValue - a.marketValue);
  });
}

export function computeTaxNow(userId: string, portfolioId?: string) {
  const scope = portfolioKey(portfolioId);
  return cached(userCacheKey(userId, "tax-now", scope), TTL.now, async () => {
    const asOf = new Date();
    const { lots, profile, blocked } = await assembleScope(userId, scope, asOf);

    const soon = ripeningSoon(lots, profile, asOf, 45).map((r) => ({
      lot: serializeLot(r.lot, asOf),
      daysUntilLongTerm: r.ripening.daysUntilLongTerm,
      estSavingsIfWaited: r.ripening.estSavingsIfWaited.toNumber(),
    }));

    const harvest = planSale({
      objective: "harvest_losses",
      targetProceeds: D(0),
      lots,
      blocked,
      profile,
      asOf,
    });

    const yearEnd = new Date(Date.UTC(asOf.getUTCFullYear(), 11, 31, 23, 59, 59));
    const daysLeftInTaxYear = Math.max(
      0,
      Math.ceil((yearEnd.getTime() - asOf.getTime()) / 86_400_000),
    );

    return {
      daysLeftInTaxYear,
      // The effective (override-aware) YTD position — this is what actually
      // drives every marginal tax-cost number on this page: a loss offsetting
      // a YTD gain is worth more than one heading straight to carryforward.
      ytdShortTermGain: profile.ytdShortTermGain.toNumber(),
      ytdLongTermGain: profile.ytdLongTermGain.toNumber(),
      taxOwedSoFarUsd: taxOwedSoFar(profile).toNumber(),
      ripeningSoon: soon,
      harvestPreview: harvest.sales.slice(0, 5).map((s) => serializeSale(s, asOf)),
      harvestOpportunityCount: harvest.sales.length,
      harvestTotalLossUsd: harvest.sales.reduce((s, x) => s + x.realizedGain.toNumber(), 0),
      harvestEstTaxSavedUsd: -harvest.totalTaxCost.toNumber(),
      blockedCount: blocked.length,
    };
  });
}

export function computeTaxPlan(
  userId: string,
  portfolioId: string | undefined,
  targetProceeds: number,
  doNotSell?: string[],
) {
  const scope = portfolioKey(portfolioId);
  const doNotSellKey = doNotSell && doNotSell.length > 0 ? [...doNotSell].sort().join(",") : "none";
  return cached(
    userCacheKey(userId, "tax-plan5", scope, Math.round(targetProceeds), doNotSellKey),
    TTL.plan,
    async () => {
      const asOf = new Date();
      const { lots, profile, blocked } = await assembleScope(userId, scope, asOf);
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
        optimized: serializePlan(optimized, asOf),
        fifo: serializePlan(fifo, asOf),
        highestCostFirst: serializePlan(highestCostFirst, asOf),
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
    userCacheKey(userId, "tax-harvest5", scope, lossCapUsd ?? "uncapped"),
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
        blocked: plan.blocked.map(serializeBlock),
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
