import { D, Decimal, ZERO } from "./types";
import { isLongTerm } from "./lots";
import { explainNetting, totalTax, type TaxRates } from "./tax-netting";
import type { WashSaleBlock } from "./tax-wash-sale";

const DAY_MS = 86_400_000;

export interface TaxLot {
  lotId: string;
  assetId: string;
  symbol: string;
  assetClass: string;
  accountId: string;
  accountName: string;
  quantity: Decimal;
  /** Total cost basis for this lot's full `quantity`. */
  costBasis: Decimal;
  openedAt: Date;
  /** Current price per unit. */
  price: Decimal;
}

export interface TaxProfile {
  /** Combined federal+state fraction (0.32 = 32%). */
  ordinaryRate: number;
  ltcgRate: number;
  /** Year-to-date realized gain/loss by character; can be negative. */
  ytdShortTermGain: Decimal;
  ytdLongTermGain: Decimal;
  /** Loss carried forward from prior years (positive = available to use). */
  carryforwardShortTerm: Decimal;
  carryforwardLongTerm: Decimal;
  carryforwardDiscount: number;
}

export interface RipeningInfo {
  daysUntilLongTerm: number;
  /** Positive = waiting until long-term saves this much tax on this lot's
   *  gain/loss (at today's price — a real assumption, since a future price
   *  is unknowable; the UI must say "assuming the price holds"). */
  estSavingsIfWaited: Decimal;
}

export interface PlannedSale {
  lot: TaxLot;
  sellQuantity: Decimal;
  proceeds: Decimal;
  realizedGain: Decimal;
  isLongTerm: boolean;
  /** Marginal tax cost of this sale, computed exactly for `sellQuantity`
   *  (negative = a net tax benefit, i.e. a harvested loss). */
  taxCost: Decimal;
  /** taxCost / realizedGain, informational only. */
  effectiveRate: number;
  netAfterTax: Decimal;
  ripening?: RipeningInfo;
}

export interface TaxPlan {
  objective: "raise_cash" | "harvest_losses";
  targetProceeds: Decimal;
  totalProceeds: Decimal;
  totalTaxCost: Decimal;
  totalAfterTax: Decimal;
  /** How far short of targetProceeds this plan falls; 0 if met (always 0
   *  for harvest_losses, which has no cash target). */
  shortfall: Decimal;
  sales: PlannedSale[];
  blocked: WashSaleBlock[];
  excluded: { lot: TaxLot; reason: string }[];
}

/** The 1-year-and-a-day instant a lot must be sold AFTER to qualify
 *  long-term — mirrors isLongTerm's strict "> one year later" rule. */
function longTermQualifyingInstant(openedAt: Date): Date {
  const d = new Date(openedAt.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return new Date(d.getTime() + 1);
}

/** Fold a prior-year carryforward loss into this year's starting position —
 *  it nets exactly like a same-character loss realized today. */
function effectiveStart(profile: TaxProfile): { st: Decimal; lt: Decimal } {
  return {
    st: profile.ytdShortTermGain.sub(profile.carryforwardShortTerm),
    lt: profile.ytdLongTermGain.sub(profile.carryforwardLongTerm),
  };
}

const rates = (profile: TaxProfile): TaxRates => ({
  ordinaryRate: profile.ordinaryRate,
  ltcgRate: profile.ltcgRate,
  carryforwardDiscount: profile.carryforwardDiscount,
});

/**
 * Value a lot's gain/loss as short-term vs. long-term under a fixed
 * baseline netting state (the profile's starting position, not whatever a
 * plan has accumulated so far — keeps every ripening number in a report
 * directly comparable to the others). Positive `estSavingsIfWaited` means
 * long-term treatment costs less tax than selling now.
 */
function ripeningFor(
  lot: TaxLot,
  profile: TaxProfile,
  asOf: Date,
): RipeningInfo {
  const qualifiesAt = longTermQualifyingInstant(lot.openedAt);
  const daysUntilLongTerm = Math.ceil((qualifiesAt.getTime() - asOf.getTime()) / DAY_MS);
  const gain = lot.quantity.mul(lot.price).sub(lot.costBasis);
  const { st, lt } = effectiveStart(profile);
  const r = rates(profile);
  const base = totalTax(st, lt, r);
  const asShortTerm = totalTax(st.add(gain), lt, r).sub(base);
  const asLongTerm = totalTax(st, lt.add(gain), r).sub(base);
  return { daysUntilLongTerm, estSavingsIfWaited: asShortTerm.sub(asLongTerm) };
}

/**
 * Lots that are still short-term but qualify for long-term treatment within
 * `withinDays` — independent of any plan, for a standalone "ripening soon"
 * list (golden test 6: shown even when the lot ends up sold anyway).
 */
export function ripeningSoon(
  lots: TaxLot[],
  profile: TaxProfile,
  asOf: Date,
  withinDays = 45,
): { lot: TaxLot; ripening: RipeningInfo }[] {
  const out: { lot: TaxLot; ripening: RipeningInfo }[] = [];
  for (const lot of lots) {
    if (isLongTerm(lot.openedAt, asOf)) continue;
    const ripening = ripeningFor(lot, profile, asOf);
    if (ripening.daysUntilLongTerm > 0 && ripening.daysUntilLongTerm <= withinDays) {
      out.push({ lot, ripening });
    }
  }
  return out;
}

export interface HarvestBreakdown {
  /** Total magnitude of loss harvested (sum of |realizedGain| across the
   *  loss sales given) — the three buckets below sum to this. */
  totalHarvestedLossUsd: Decimal;
  /** Portion that offset gains you'd otherwise be taxed on this year. */
  gainsOffsetUsd: Decimal;
  /** Portion that landed in the $3,000 ordinary-income deduction. */
  ordinaryDeductionUsd: Decimal;
  /** Portion left over as a carryforward to future years. */
  carryforwardUsd: Decimal;
}

/**
 * Explain what a set of harvested losses actually DID to the tax picture —
 * "how much of this offsets gains you already have" vs. "how much is just
 * a $3,000 deduction" vs. "how much only carries forward" — by comparing
 * the netting breakdown before vs. after the harvest is applied. Robust to
 * cross-netting between short/long-term (it reads the post-netting taxed
 * amounts, not a per-character subtraction), so the three buckets always
 * sum exactly to the total harvested loss.
 */
export function summarizeHarvest(
  profile: TaxProfile,
  sales: { realizedGain: Decimal; isLongTerm: boolean }[],
): HarvestBreakdown {
  const r = rates(profile);
  const { st: baseSt, lt: baseLt } = effectiveStart(profile);

  let harvestedSt = ZERO;
  let harvestedLt = ZERO;
  for (const s of sales) {
    if (s.realizedGain.gte(0)) continue; // only losses are "harvested"
    if (s.isLongTerm) harvestedLt = harvestedLt.add(s.realizedGain);
    else harvestedSt = harvestedSt.add(s.realizedGain);
  }
  const totalHarvestedLossUsd = harvestedSt.add(harvestedLt).neg();

  const before = explainNetting(baseSt, baseLt, r);
  const after = explainNetting(baseSt.add(harvestedSt), baseLt.add(harvestedLt), r);

  const gainsOffsetUsd = before.shortTermGainTaxed
    .add(before.longTermGainTaxed)
    .sub(after.shortTermGainTaxed.add(after.longTermGainTaxed));
  const ordinaryDeductionUsd = after.ordinaryDeduction.sub(before.ordinaryDeduction);
  const carryforwardUsd = after.carryforward.sub(before.carryforward);

  return { totalHarvestedLossUsd, gainsOffsetUsd, ordinaryDeductionUsd, carryforwardUsd };
}

export interface PlanSaleOpts {
  targetProceeds: Decimal;
  lots: TaxLot[];
  /** Pre-computed via detectWashSaleBlocks — those lots are excluded. */
  blocked: WashSaleBlock[];
  profile: TaxProfile;
  /** Lot ids, asset ids, or symbols to never sell. */
  doNotSell?: Set<string>;
  asOf: Date;
  ripeningWindowDays?: number;
}

type Order = "marginal" | "fifo" | "highest-cost-first";

/** Shared engine behind planSale/planFifo/planHighestCostFirst — only the
 *  candidate ORDER differs; the tax math for whatever gets taken is always
 *  the exact totalTax-delta, so the three plans are apples-to-apples. */
function runGreedy(
  opts: PlanSaleOpts & { objective: "raise_cash" | "harvest_losses" },
  order: Order,
): TaxPlan {
  const { profile, asOf, blocked } = opts;
  const ripeningWindowDays = opts.ripeningWindowDays ?? 45;
  const doNotSell = opts.doNotSell ?? new Set<string>();
  const blockedIds = new Set(blocked.map((b) => b.lotId));
  const r = rates(profile);

  const excluded: { lot: TaxLot; reason: string }[] = [];
  let pool = opts.lots.filter((lot) => {
    if (blockedIds.has(lot.lotId)) return false; // reported via `blocked`, not `excluded`
    if (
      doNotSell.has(lot.lotId) ||
      doNotSell.has(lot.assetId) ||
      doNotSell.has(lot.symbol)
    ) {
      excluded.push({ lot, reason: "on your do-not-sell list" });
      return false;
    }
    return true;
  });

  if (opts.objective === "harvest_losses") {
    pool = pool.filter((lot) => lot.quantity.mul(lot.price).lt(lot.costBasis));
  }

  if (order === "fifo") {
    pool = [...pool].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  } else if (order === "highest-cost-first") {
    // HIFO: highest cost-basis-per-share first (minimizes reported gain;
    // ignores holding period entirely — the naive "good enough" heuristic).
    pool = [...pool].sort((a, b) =>
      b.costBasis.div(b.quantity).sub(a.costBasis.div(a.quantity)).toNumber(),
    );
  }

  let { st, lt } = effectiveStart(profile);
  let remaining = opts.targetProceeds;
  const sales: PlannedSale[] = [];

  const marginalDelta = (
    isLT: boolean,
    gain: Decimal,
  ): { delta: Decimal; newSt: Decimal; newLt: Decimal } => {
    const newSt = isLT ? st : st.add(gain);
    const newLt = isLT ? lt.add(gain) : lt;
    return { delta: totalTax(newSt, newLt, r).sub(totalTax(st, lt, r)), newSt, newLt };
  };

  while (pool.length > 0 && (opts.objective === "harvest_losses" || remaining.gt(0))) {
    let lot: TaxLot;
    if (order === "marginal") {
      // Re-sort by CURRENT marginal cost-per-dollar-raised every iteration —
      // the netting position (and therefore the best next lot) changes as
      // lots are added.
      let best: { lot: TaxLot; costPerDollar: Decimal } | null = null;
      for (const candidate of pool) {
        const proceeds = candidate.quantity.mul(candidate.price);
        if (proceeds.lte(0)) continue;
        const isLT = isLongTerm(candidate.openedAt, asOf);
        const gain = proceeds.sub(candidate.costBasis);
        const { delta } = marginalDelta(isLT, gain);
        const costPerDollar = delta.div(proceeds);
        if (!best || costPerDollar.lt(best.costPerDollar)) {
          best = { lot: candidate, costPerDollar };
        }
      }
      if (!best) break;
      lot = best.lot;
    } else {
      lot = pool[0]!;
    }

    const lotProceeds = lot.quantity.mul(lot.price);
    const isLT = isLongTerm(lot.openedAt, asOf);
    const takeWhole =
      opts.objective === "harvest_losses" || lotProceeds.lte(remaining) || lotProceeds.lte(0);
    const sellQuantity = takeWhole
      ? lot.quantity
      : lot.quantity.mul(remaining.div(lotProceeds));
    const proceeds = lot.price.mul(sellQuantity);
    const gain = proceeds.sub(lot.costBasis.mul(sellQuantity.div(lot.quantity)));
    const { delta, newSt, newLt } = marginalDelta(isLT, gain);
    st = newSt;
    lt = newLt;

    let ripening: RipeningInfo | undefined;
    if (!isLT) {
      const info = ripeningFor(lot, profile, asOf);
      if (info.daysUntilLongTerm > 0 && info.daysUntilLongTerm <= ripeningWindowDays) {
        ripening = info;
      }
    }

    sales.push({
      lot,
      sellQuantity,
      proceeds,
      realizedGain: gain,
      isLongTerm: isLT,
      taxCost: delta,
      effectiveRate: gain.isZero() ? 0 : delta.div(gain).toNumber(),
      netAfterTax: proceeds.sub(delta),
      ripening,
    });

    if (opts.objective === "raise_cash") remaining = remaining.sub(proceeds);

    if (order === "marginal") {
      pool = pool.filter((l) => l.lotId !== lot.lotId);
    } else {
      pool = pool.slice(1); // static order: always consume the front
    }
  }

  return finalizePlan(opts, sales, blocked, excluded);
}

function finalizePlan(
  opts: PlanSaleOpts & { objective: "raise_cash" | "harvest_losses" },
  sales: PlannedSale[],
  blocked: WashSaleBlock[],
  excluded: { lot: TaxLot; reason: string }[],
): TaxPlan {
  const totalProceeds = sales.reduce((s, x) => s.add(x.proceeds), ZERO);
  const totalTaxCost = sales.reduce((s, x) => s.add(x.taxCost), ZERO);
  const shortfall =
    opts.objective === "raise_cash"
      ? Decimal.max(0, opts.targetProceeds.sub(totalProceeds))
      : ZERO;
  return {
    objective: opts.objective,
    targetProceeds: opts.targetProceeds,
    totalProceeds,
    totalTaxCost,
    totalAfterTax: totalProceeds.sub(totalTaxCost),
    shortfall,
    sales,
    blocked,
    excluded,
  };
}

/** The optimizer: dynamic marginal-cost ordering, re-sorted after every
 *  addition, followed by a bounded local-search swap pass. */
export function planSale(
  opts: PlanSaleOpts & { objective: "raise_cash" | "harvest_losses" },
): TaxPlan {
  const plan = runGreedy(opts, "marginal");
  if (opts.objective !== "raise_cash") return plan;
  return improveBySwapping(opts, plan);
}

/** What the broker's FIFO default would do — oldest lots first, entirely
 *  unaware of tax rate or holding-period consequences. */
export function planFifo(opts: PlanSaleOpts): TaxPlan {
  return runGreedy({ ...opts, objective: "raise_cash" }, "fifo");
}

/** The naive "sell my priciest lots first" heuristic (HIFO) — minimizes
 *  reported gain but ignores short/long-term rate differences entirely. */
export function planHighestCostFirst(opts: PlanSaleOpts): TaxPlan {
  return runGreedy({ ...opts, objective: "raise_cash" }, "highest-cost-first");
}

const MAX_SWAP_ITERATIONS = 20;

/**
 * Bounded local search: try replacing one sold lot with one unsold eligible
 * lot (sized to raise roughly the same proceeds), keep the swap only if it
 * strictly lowers total tax cost without dropping total proceeds below
 * target. Gets within a rounding error of optimal on realistic portfolios
 * without the complexity of an exact solver — and every swap is a single
 * explainable exchange, not an opaque re-optimization.
 */
function improveBySwapping(opts: PlanSaleOpts, plan: TaxPlan): TaxPlan {
  const blockedIds = new Set(plan.blocked.map((b) => b.lotId));
  const excludedIds = new Set(plan.excluded.map((e) => e.lot.lotId));
  const soldIds = new Set(plan.sales.map((s) => s.lot.lotId));
  const outsiders = opts.lots.filter(
    (l) => !blockedIds.has(l.lotId) && !excludedIds.has(l.lotId) && !soldIds.has(l.lotId),
  );
  if (outsiders.length === 0 || plan.sales.length === 0) return plan;

  let sales = [...plan.sales];
  const r = rates(opts.profile);

  const stateFor = (excludeIdx: number): { st: Decimal; lt: Decimal } => {
    let { st, lt } = effectiveStart(opts.profile);
    sales.forEach((s, i) => {
      if (i === excludeIdx) return;
      if (s.isLongTerm) lt = lt.add(s.realizedGain);
      else st = st.add(s.realizedGain);
    });
    return { st, lt };
  };

  for (let iter = 0; iter < MAX_SWAP_ITERATIONS; iter++) {
    let bestSwap: { i: number; replacement: PlannedSale; gain: Decimal } | null = null;

    for (let i = 0; i < sales.length; i++) {
      const current = sales[i]!;
      const { st, lt } = stateFor(i);
      const baseline = totalTax(st, lt, r);

      for (const candidate of outsiders) {
        if (sales.some((s) => s.lot.lotId === candidate.lotId)) continue;
        const availableProceeds = candidate.quantity.mul(candidate.price);
        const target = current.proceeds;
        // Require the candidate to be able to FULLY replace what it's
        // swapping out — a partial replacement would quietly shrink total
        // proceeds below the target, which no improving swap is allowed to do.
        if (availableProceeds.lt(target)) continue;
        const qty = candidate.quantity.mul(target.div(availableProceeds));
        const proceeds = candidate.price.mul(qty);
        const isLT = isLongTerm(candidate.openedAt, opts.asOf);
        const gain = proceeds.sub(candidate.costBasis.mul(qty.div(candidate.quantity)));
        const newSt = isLT ? st : st.add(gain);
        const newLt = isLT ? lt.add(gain) : lt;
        const taxCost = totalTax(newSt, newLt, r).sub(baseline);
        const improvement = current.taxCost.sub(taxCost); // positive = better

        if (improvement.gt(0) && (!bestSwap || improvement.gt(bestSwap.gain))) {
          bestSwap = {
            i,
            gain: improvement,
            replacement: {
              lot: candidate,
              sellQuantity: qty,
              proceeds,
              realizedGain: gain,
              isLongTerm: isLT,
              taxCost,
              effectiveRate: gain.isZero() ? 0 : taxCost.div(gain).toNumber(),
              netAfterTax: proceeds.sub(taxCost),
              ripening: isLT
                ? undefined
                : (() => {
                    const info = ripeningFor(candidate, opts.profile, opts.asOf);
                    return info.daysUntilLongTerm > 0 &&
                      info.daysUntilLongTerm <= (opts.ripeningWindowDays ?? 45)
                      ? info
                      : undefined;
                  })(),
            },
          };
        }
      }
    }

    if (!bestSwap) break;
    sales = sales.map((s, i) => (i === bestSwap!.i ? bestSwap!.replacement : s));
  }

  return finalizePlan(
    { ...opts, objective: "raise_cash" },
    sales,
    plan.blocked,
    plan.excluded,
  );
}
