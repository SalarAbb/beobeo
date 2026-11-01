import { D, Decimal, ZERO } from "./types";
import { isLongTerm } from "./lots";
import { explainNetting, totalTax, type TaxRates } from "./tax-netting";
import { isWashSaleExempt, type WashSaleBlock, type WashSaleOpts } from "./tax-wash-sale";
import { ltcgZeroUpTo, type FilingStatus } from "./tax-brackets";

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

/**
 * Estimated tax owed on the gains realized so far this year (after the
 * prior-year carryforward and cross-netting), never negative — the "do I owe
 * anything right now?" answer. A net loss owes nothing; its deduction value
 * is deliberately NOT subtracted here, so this is a bill, not a balance.
 */
export function taxOwedSoFar(profile: TaxProfile): Decimal {
  const { st, lt } = effectiveStart(profile);
  const n = explainNetting(st, lt, rates(profile));
  return n.shortTermGainTaxed
    .mul(profile.ordinaryRate)
    .add(n.longTermGainTaxed.mul(profile.ltcgRate));
}

/** What selling every lot today would add to this year's tax bill. */
export interface SellEverything {
  proceedsUsd: Decimal;
  costBasisUsd: Decimal;
  shortTermGainUsd: Decimal;
  longTermGainUsd: Decimal;
  /** Bill after the sale − bill now (both via `taxOwedSoFar`); negative when
   *  the sale's losses cut tax already owed. */
  taxUsd: Decimal;
  /** Losses left out: a recent buy in a retirement account disallows them
   *  for good (a taxable-account rebuy would be sold too, so it counts). */
  disallowedLossUsd: Decimal;
  /** The rates the after-sale bill used (income-adjusted when given). */
  ordinaryRate: number;
  ltcgRate: number;
}

/**
 * "Roughly what would I owe if I sold?" for the whole scope: every lot's
 * gain by term, added to the year's position (carryforward and cross-netting
 * included), priced as the difference of two `taxOwedSoFar` bills. With an
 * income, each bill applies `profileAtIncome` to its own year, so a sale that
 * pushes the year out of the 0% long-term bracket pays the full rate
 * (conservative, like `profileAtIncome`). `profile` is the saved one, not one
 * already adjusted to the income.
 */
export function sellEverything(
  lots: TaxLot[],
  blocked: WashSaleBlock[],
  profile: TaxProfile,
  asOf: Date,
  opts: { income?: IncomeInfo; federalLtcgRate?: number } = {},
): SellEverything {
  const gone = new Set(blocked.filter((b) => b.permanentlyDisallowed).map((b) => b.lotId));
  let proceeds = ZERO;
  let cost = ZERO;
  let st = ZERO;
  let lt = ZERO;
  let disallowed = ZERO;
  for (const l of lots) {
    const value = l.quantity.mul(l.price);
    const gain = value.sub(l.costBasis);
    proceeds = proceeds.add(value);
    cost = cost.add(l.costBasis);
    if (gain.lt(0) && gone.has(l.lotId)) {
      disallowed = disallowed.sub(gain);
      continue;
    }
    if (isLongTerm(l.openedAt, asOf)) lt = lt.add(gain);
    else st = st.add(gain);
  }
  const atIncome = (p: TaxProfile) =>
    opts.income ? profileAtIncome(p, opts.income, opts.federalLtcgRate ?? 0) : p;
  const after = atIncome({
    ...profile,
    ytdShortTermGain: profile.ytdShortTermGain.add(st),
    ytdLongTermGain: profile.ytdLongTermGain.add(lt),
  });
  return {
    proceedsUsd: proceeds,
    costBasisUsd: cost,
    shortTermGainUsd: st,
    longTermGainUsd: lt,
    taxUsd: taxOwedSoFar(after).sub(taxOwedSoFar(atIncome(profile))),
    disallowedLossUsd: disallowed,
    ordinaryRate: after.ordinaryRate,
    ltcgRate: after.ltcgRate,
  };
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

/** One wash-sale-exempt asset (crypto by default) you could sell at a loss
 *  and buy straight back: same holdings, loss booked now. */
export interface LossLock {
  assetId: string;
  symbol: string;
  assetClass: string;
  /** The loss lots, as the harvest engine would sell them. */
  sales: PlannedSale[];
  quantity: Decimal;
  proceeds: Decimal;
  /** Positive magnitude of the loss booked. */
  lossUsd: Decimal;
  /** Positive = tax this lock saves, attributed in the harvest engine's
   *  order, so the locks' savings sum exactly to `totalTaxSavedUsd`. */
  taxSavedUsd: Decimal;
}

/**
 * "Sell and buy back" opportunities: every loss lot of an asset the
 * wash-sale rule doesn't cover, run through the same harvest engine as
 * Harvest Losses (so the $3,000 cap, cross-netting and carryforward discount
 * are all honored), grouped per asset, biggest saving first. Rebuying resets
 * the basis lower, so the tax is deferred rather than erased; callers must
 * say so.
 */
export function lossLocks(
  lots: TaxLot[],
  profile: TaxProfile,
  asOf: Date,
  opts: WashSaleOpts = {},
): { locks: LossLock[]; totalTaxSavedUsd: Decimal; plan: TaxPlan } {
  const plan = planSale({
    objective: "harvest_losses",
    targetProceeds: ZERO,
    lots: lots.filter((l) => isWashSaleExempt(l.assetClass, opts)),
    blocked: [],
    profile,
    asOf,
  });
  const locks = groupSalesByAsset(plan.sales);
  return { locks, totalTaxSavedUsd: ZERO.sub(plan.totalTaxCost), plan };
}

/** Per-asset totals of a harvest plan's sales, biggest saving first. */
function groupSalesByAsset(sales: PlannedSale[]): LossLock[] {
  const byAsset = new Map<string, LossLock>();
  for (const s of sales) {
    let lock = byAsset.get(s.lot.assetId);
    if (!lock) {
      lock = {
        assetId: s.lot.assetId,
        symbol: s.lot.symbol,
        assetClass: s.lot.assetClass,
        sales: [],
        quantity: ZERO,
        proceeds: ZERO,
        lossUsd: ZERO,
        taxSavedUsd: ZERO,
      };
      byAsset.set(s.lot.assetId, lock);
    }
    lock.sales.push(s);
    lock.quantity = lock.quantity.add(s.sellQuantity);
    lock.proceeds = lock.proceeds.add(s.proceeds);
    lock.lossUsd = lock.lossUsd.sub(s.realizedGain);
    lock.taxSavedUsd = lock.taxSavedUsd.sub(s.taxCost);
  }

  return [...byAsset.values()].sort((a, b) => b.taxSavedUsd.cmp(a.taxSavedUsd));
}

/**
 * Where one move's loss lands in the year's netting, in dollars of loss (all
 * ≥ 0): the gains it cancels, by the rate they were taxed at after
 * cross-netting (a short-term loss can cancel long-term gains), the part that
 * comes off ordinary income (the $3,000) and the part that carries forward.
 * The move's saving is exactly cancelsShortTerm × ordinaryRate +
 * cancelsLongTerm × ltcgRate + offIncome × ordinaryRate + carriedForward ×
 * ordinaryRate × carryforwardDiscount, so the UI can show the arithmetic
 * behind "saves ~$X" (barristan: "I don't see how it gets that number").
 */
export interface LossLanding {
  cancelsShortTermUsd: Decimal;
  cancelsLongTermUsd: Decimal;
  offIncomeUsd: Decimal;
  carriedForwardUsd: Decimal;
}

const NO_LANDING: LossLanding = {
  cancelsShortTermUsd: ZERO,
  cancelsLongTermUsd: ZERO,
  offIncomeUsd: ZERO,
  carriedForwardUsd: ZERO,
};

type YearPosition = { st: Decimal; lt: Decimal };

/** The netting difference between two year positions, as a `LossLanding`. */
function landingBetween(before: YearPosition, after: YearPosition, r: TaxRates): LossLanding {
  const b = explainNetting(before.st, before.lt, r);
  const a = explainNetting(after.st, after.lt, r);
  return {
    cancelsShortTermUsd: b.shortTermGainTaxed.sub(a.shortTermGainTaxed),
    cancelsLongTermUsd: b.longTermGainTaxed.sub(a.longTermGainTaxed),
    offIncomeUsd: a.ordinaryDeduction.sub(b.ordinaryDeduction),
    carriedForwardUsd: a.carryforward.sub(b.carryforward),
  };
}

/** Each asset's landing for sales replayed in the engine's own order from
 *  `start`, so per-asset landings stack exactly like their `taxSavedUsd`. */
function landingsByAsset(
  sales: PlannedSale[],
  start: YearPosition,
  r: TaxRates,
): Map<string, LossLanding> {
  const out = new Map<string, LossLanding>();
  let pos = start;
  for (const s of sales) {
    const next = s.isLongTerm
      ? { st: pos.st, lt: pos.lt.add(s.realizedGain) }
      : { st: pos.st.add(s.realizedGain), lt: pos.lt };
    const step = landingBetween(pos, next, r);
    const sum = out.get(s.lot.assetId) ?? NO_LANDING;
    out.set(s.lot.assetId, {
      cancelsShortTermUsd: sum.cancelsShortTermUsd.add(step.cancelsShortTermUsd),
      cancelsLongTermUsd: sum.cancelsLongTermUsd.add(step.cancelsLongTermUsd),
      offIncomeUsd: sum.offIncomeUsd.add(step.offIncomeUsd),
      carriedForwardUsd: sum.carriedForwardUsd.add(step.carriedForwardUsd),
    });
    pos = next;
  }
  return out;
}

/** One purchase behind a wait or on-hold move, with what waiting on it alone
 *  saves (wait only; an on-hold asset is valued as a whole). */
export interface MovePurchase {
  lot: TaxLot;
  valueUsd: Decimal | null;
}

/** One line of the "Moves available now" list. `valueUsd` is the tax it
 *  saves (null when it can't be priced against this year's profile). Loss
 *  moves carry where their loss lands (null for a hold that clears next year). */
export type TaxMove =
  | { kind: "lock"; lock: LossLock; valueUsd: Decimal; landing: LossLanding }
  | {
      kind: "harvest";
      lock: LossLock;
      valueUsd: Decimal;
      rebuyAfter: Date;
      landing: LossLanding;
    }
  | {
      kind: "wait";
      assetId: string;
      symbol: string;
      assetClass: string;
      lots: number;
      /** First day a sale of these lots is safely long-term (UTC date): the
       *  day after the purchase's anniversary, the date All Lots shows. */
      firstLongTermOn: Date;
      lastLongTermOn: Date;
      valueUsd: Decimal;
      /** Each purchase, oldest first. */
      purchases: MovePurchase[];
    }
  | {
      kind: "on_hold";
      assetId: string;
      symbol: string;
      assetClass: string;
      lots: number;
      lossUsd: Decimal;
      /** First day selling no longer trips the wash-sale rule. */
      clearsOn: Date;
      /** Selling before `clearsOn` loses the loss for good (IRA rebuy). */
      permanentlyDisallowed: boolean;
      valueUsd: Decimal | null;
      landing: LossLanding | null;
      /** Each blocked purchase, oldest first (`valueUsd` null). */
      purchases: MovePurchase[];
    }
  | { kind: "zero_gain"; gain: ZeroRateGain; valueUsd: Decimal };

export interface TaxMoves {
  /** Biggest value first; unpriced moves last. */
  moves: TaxMove[];
  /** Tax saved by every lock + harvest move together (they sum to this). */
  lockAndHarvestSavedUsd: Decimal;
  /** Where those booked losses land: gains cancelled / $3,000 / carryforward. */
  breakdown: HarvestBreakdown;
  /** Of the $3,000 a net loss can take off ordinary income, the part this
   *  year's sales haven't used yet (before any move). */
  deductionRoomUsd: Decimal;
  /** Last day a sale counts for this tax year (Dec 31, UTC). */
  deadline: Date;
  /** Long-term gains that would still be taxed at 0% this year, given the
   *  sales already made (not the loss moves); null when no income was given. */
  zeroRateRoomUsd: Decimal | null;
}

/** Enough about the year's income to place it against the 0% gain bracket. */
export interface IncomeInfo {
  status: FilingStatus;
  /** Taxable income this year (after deductions) before any investment gains. */
  taxableIncomeUsd: number;
}

/**
 * The profile as it applies at this income: when income plus the year's net
 * gain stays inside the 0% long-term bracket, `federalLtcgRate` (a fraction,
 * already part of `profile.ltcgRate`) comes off, so the verdict and loss
 * values don't charge 15% on gains that owe 0%. A year that straddles the
 * bracket keeps the full rate (conservative: it overstates, never hides tax).
 */
export function profileAtIncome(
  profile: TaxProfile,
  income: IncomeInfo,
  federalLtcgRate: number,
): TaxProfile {
  const { st, lt } = effectiveStart(profile);
  const net = Decimal.max(ZERO, st.add(lt));
  if (net.add(income.taxableIncomeUsd).gt(ltcgZeroUpTo(income.status))) return profile;
  return { ...profile, ltcgRate: Math.max(0, profile.ltcgRate - federalLtcgRate) };
}

/** One asset's long-term gains to sell and buy straight back inside the 0% room. */
export interface ZeroRateGain {
  assetId: string;
  symbol: string;
  assetClass: string;
  sales: PlannedSale[];
  quantity: Decimal;
  proceeds: Decimal;
  gainUsd: Decimal;
}

export interface ZeroRateGainsOpts {
  /** Assets not to touch: a rebuy would restart a wash-sale wait on them. */
  excludeAssetIds?: Iterable<string>;
  /** Federal long-term rate the reset cost spares a later sale (default 15%). */
  laterRate?: number;
}

/**
 * Gain harvesting (R-003): when this year's taxable income sits under the 0%
 * long-term bracket, long-term gains up to the bracket's top cost no federal
 * tax. Selling and buying straight back (gains have no wash-sale rule) resets
 * the cost higher, so a later sale owes `laterRate` less on that gain.
 *
 * Room = top of the 0% bracket − income − this year's net gain (short-term
 * gains are ordinary income and stack under the long-term ones). When the
 * year nets to a loss, no gains are offered: they would first eat losses
 * worth a deduction or carryforward, so they aren't free.
 *
 * Fill: long-term gain lots, the most gain per dollar sold first (fewest
 * dollars traded), ties by lot id; a partial lot is cut to whole units
 * (crypto to 8 decimals) so the gain never overshoots the room. One line per
 * asset, biggest gain first.
 */
export function zeroRateGains(
  lots: TaxLot[],
  profile: TaxProfile,
  income: IncomeInfo,
  asOf: Date,
  opts: ZeroRateGainsOpts = {},
): { roomUsd: Decimal; gains: ZeroRateGain[]; valueUsd: Decimal } {
  const laterRate = D(opts.laterRate ?? 0.15);
  const { st, lt } = effectiveStart(profile);
  const net = st.add(lt);
  const room = Decimal.max(
    ZERO,
    D(ltcgZeroUpTo(income.status)).sub(income.taxableIncomeUsd).sub(Decimal.max(ZERO, net)),
  );
  if (net.lt(0) || room.lt(1)) return { roomUsd: room, gains: [], valueUsd: ZERO };

  const excluded = new Set(opts.excludeAssetIds ?? []);
  const candidates = lots
    .filter((l) => !excluded.has(l.assetId) && l.quantity.gt(0) && isLongTerm(l.openedAt, asOf))
    .map((l) => {
      const proceeds = l.quantity.mul(l.price);
      return { l, proceeds, gain: proceeds.sub(l.costBasis) };
    })
    .filter((c) => c.gain.gt(0))
    .sort((a, b) => {
      const r = b.gain.div(b.proceeds).cmp(a.gain.div(a.proceeds));
      if (r !== 0) return r;
      return a.l.lotId < b.l.lotId ? -1 : a.l.lotId > b.l.lotId ? 1 : 0;
    });

  let left = room;
  const sales: PlannedSale[] = [];
  for (const { l, proceeds, gain } of candidates) {
    if (left.lt(1)) break;
    let qty = l.quantity;
    let g = gain;
    let p = proceeds;
    if (gain.gt(left)) {
      const perUnit = gain.div(l.quantity);
      qty = left.div(perUnit).toDecimalPlaces(l.assetClass === "crypto" ? 8 : 0, Decimal.ROUND_DOWN);
      if (qty.lte(0)) continue;
      g = perUnit.mul(qty);
      p = l.price.mul(qty);
    }
    left = left.sub(g);
    sales.push({
      lot: l,
      sellQuantity: qty,
      proceeds: p,
      realizedGain: g,
      isLongTerm: true,
      taxCost: ZERO,
      effectiveRate: 0,
      netAfterTax: p,
    });
  }

  const byAsset = new Map<string, ZeroRateGain>();
  for (const s of sales) {
    let z = byAsset.get(s.lot.assetId);
    if (!z) {
      z = {
        assetId: s.lot.assetId,
        symbol: s.lot.symbol,
        assetClass: s.lot.assetClass,
        sales: [],
        quantity: ZERO,
        proceeds: ZERO,
        gainUsd: ZERO,
      };
      byAsset.set(s.lot.assetId, z);
    }
    z.sales.push(s);
    z.quantity = z.quantity.add(s.sellQuantity);
    z.proceeds = z.proceeds.add(s.proceeds);
    z.gainUsd = z.gainUsd.add(s.realizedGain);
  }
  const gains = [...byAsset.values()].sort((a, b) => b.gainUsd.cmp(a.gainUsd));
  const total = gains.reduce((s, z) => s.add(z.gainUsd), ZERO);
  return { roomUsd: room, gains, valueUsd: total.mul(laterRate) };
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const byOpened = (a: TaxLot, b: TaxLot) => a.openedAt.getTime() - b.openedAt.getTime();
const utcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Shift a profile's YTD position by sales already counted. */
function afterSales(profile: TaxProfile, sales: PlannedSale[]): TaxProfile {
  let st = profile.ytdShortTermGain;
  let lt = profile.ytdLongTermGain;
  for (const s of sales) {
    if (s.isLongTerm) lt = lt.add(s.realizedGain);
    else st = st.add(s.realizedGain);
  }
  return { ...profile, ytdShortTermGain: st, ytdLongTermGain: lt };
}

/**
 * Everything worth doing (or not doing) for this year's taxes right now, as
 * one list with a dollar value per line (R-003). Values stack in a fixed
 * order so lock + harvest lines add up exactly to the joint saving:
 *   1. lock: wash-sale-exempt losses (crypto) to sell and buy straight back
 *      (`lossLocks`), valued first because you keep the position;
 *   2. harvest: other unblocked losses, valued on top of the locks, with the
 *      day it's safe to buy back (31 days later);
 *   3. on_hold: losses a recent same-asset buy blocks, valued on top of 1+2
 *      as if sold the day they clear (null if that's next year);
 *   4. wait: short-term gains that turn long-term within 45 days, each lot
 *      valued alone against the starting position (as `ripeningSoon`).
 */
export function taxMoves(
  lots: TaxLot[],
  blocked: WashSaleBlock[],
  profile: TaxProfile,
  asOf: Date,
  opts: WashSaleOpts & { income?: IncomeInfo } = {},
): TaxMoves {
  const deadline = new Date(Date.UTC(asOf.getUTCFullYear(), 11, 31));
  const r = rates(profile);
  const moves: TaxMove[] = [];

  const locks = lossLocks(lots, profile, asOf, opts);
  // In the plan's own sale order: the locks are regrouped per asset.
  const lockSales = locks.plan.sales;
  const lockLandings = landingsByAsset(lockSales, effectiveStart(profile), r);
  for (const lock of locks.locks) {
    moves.push({
      kind: "lock",
      lock,
      valueUsd: lock.taxSavedUsd,
      landing: lockLandings.get(lock.assetId) ?? NO_LANDING,
    });
  }

  const afterLocks = afterSales(profile, lockSales);
  const harvest = planSale({
    objective: "harvest_losses",
    targetProceeds: ZERO,
    lots: lots.filter((l) => !isWashSaleExempt(l.assetClass, opts)),
    blocked,
    profile: afterLocks,
    asOf,
  });
  const rebuyAfter = addDays(utcDay(asOf), 31);
  const harvestLandings = landingsByAsset(harvest.sales, effectiveStart(afterLocks), r);
  for (const lock of groupSalesByAsset(harvest.sales)) {
    moves.push({
      kind: "harvest",
      lock,
      valueUsd: lock.taxSavedUsd,
      rebuyAfter,
      landing: harvestLandings.get(lock.assetId) ?? NO_LANDING,
    });
  }
  const harvestSales = [...lockSales, ...harvest.sales];

  // On hold: group blocked loss lots per asset; the latest trigger decides
  // when the whole asset clears.
  const lotById = new Map(lots.map((l) => [l.lotId, l]));
  const holds = new Map<string, { blocks: WashSaleBlock[]; lots: TaxLot[] }>();
  for (const b of blocked) {
    const l = lotById.get(b.lotId);
    if (!l) continue;
    const h = holds.get(b.assetId) ?? { blocks: [], lots: [] };
    h.blocks.push(b);
    h.lots.push(l);
    holds.set(b.assetId, h);
  }
  let { st: afterSt, lt: afterLt } = effectiveStart(afterSales(profile, harvestSales));
  for (const [assetId, h] of holds) {
    const lastTrigger = Math.max(...h.blocks.map((b) => b.triggerDate.getTime()));
    const clearsOn = addDays(utcDay(new Date(lastTrigger)), 31);
    let lossUsd = ZERO;
    let st = afterSt;
    let lt = afterLt;
    for (const l of h.lots) {
      const gain = l.quantity.mul(l.price).sub(l.costBasis);
      lossUsd = lossUsd.sub(gain);
      if (isLongTerm(l.openedAt, clearsOn)) lt = lt.add(gain);
      else st = st.add(gain);
    }
    let valueUsd: Decimal | null = null;
    let landing: LossLanding | null = null;
    if (clearsOn.getTime() <= deadline.getTime()) {
      valueUsd = totalTax(afterSt, afterLt, r).sub(totalTax(st, lt, r));
      landing = landingBetween({ st: afterSt, lt: afterLt }, { st, lt }, r);
      afterSt = st;
      afterLt = lt;
    }
    const first = h.lots[0]!;
    moves.push({
      kind: "on_hold",
      assetId,
      symbol: first.symbol,
      assetClass: first.assetClass,
      lots: h.lots.length,
      lossUsd,
      clearsOn,
      permanentlyDisallowed: h.blocks.some((b) => b.permanentlyDisallowed),
      valueUsd,
      landing,
      purchases: [...h.lots].sort(byOpened).map((lot) => ({ lot, valueUsd: null })),
    });
  }

  const waits = new Map<string, Extract<TaxMove, { kind: "wait" }>>();
  for (const { lot, ripening } of ripeningSoon(lots, profile, asOf)) {
    if (ripening.estSavingsIfWaited.lte(0)) continue; // a loss gains nothing by waiting
    // A sale on the anniversary itself is still short-term (IRS), so the date
    // to wait for is the day after, the same date All Lots shows.
    const on = addDays(utcDay(longTermQualifyingInstant(lot.openedAt)), 1);
    const purchase = { lot, valueUsd: ripening.estSavingsIfWaited };
    const w = waits.get(lot.assetId);
    if (!w) {
      waits.set(lot.assetId, {
        kind: "wait",
        assetId: lot.assetId,
        symbol: lot.symbol,
        assetClass: lot.assetClass,
        lots: 1,
        firstLongTermOn: on,
        lastLongTermOn: on,
        valueUsd: ripening.estSavingsIfWaited,
        purchases: [purchase],
      });
      continue;
    }
    w.lots += 1;
    w.purchases.push(purchase);
    if (on < w.firstLongTermOn) w.firstLongTermOn = on;
    if (on > w.lastLongTermOn) w.lastLongTermOn = on;
    w.valueUsd = w.valueUsd.add(ripening.estSavingsIfWaited);
  }
  for (const w of waits.values()) w.purchases.sort((a, b) => byOpened(a.lot, b.lot));
  moves.push(...waits.values());

  // zero_gain: long-term gains inside the 0% bracket, measured from the year
  // as it stands (not after the loss sales: a user may skip those, and inside
  // 0% they're worth little, so the UI may hide them), and never on an asset
  // with a loss move or hold, since the rebuy would restart its wash-sale wait.
  let zeroRateRoomUsd: Decimal | null = null;
  if (opts.income) {
    const lossAssets = moves.flatMap((m) =>
      m.kind === "lock" || m.kind === "harvest"
        ? [m.lock.assetId]
        : m.kind === "on_hold"
          ? [m.assetId]
          : [],
    );
    const z = zeroRateGains(lots, profile, opts.income, asOf, {
      excludeAssetIds: lossAssets,
    });
    zeroRateRoomUsd = z.roomUsd;
    for (const gain of z.gains) {
      moves.push({ kind: "zero_gain", gain, valueUsd: gain.gainUsd.mul(0.15) });
    }
  }

  moves.sort((a, b) => {
    if (a.valueUsd === null || b.valueUsd === null) {
      return a.valueUsd === null ? (b.valueUsd === null ? 0 : 1) : -1;
    }
    return b.valueUsd.cmp(a.valueUsd);
  });

  const { st, lt } = effectiveStart(profile);
  return {
    moves,
    lockAndHarvestSavedUsd: locks.totalTaxSavedUsd.sub(harvest.totalTaxCost),
    breakdown: summarizeHarvest(profile, harvestSales),
    deductionRoomUsd: D(3000).sub(explainNetting(st, lt, r).ordinaryDeduction),
    deadline,
    zeroRateRoomUsd,
  };
}
