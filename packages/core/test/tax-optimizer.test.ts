import { describe, expect, it } from "vitest";
import { D, ZERO } from "../src/types";
import { detectWashSaleBlocks, type RecentBuyTxn } from "../src/tax-wash-sale";
import {
  planFifo,
  planHighestCostFirst,
  planSale,
  ripeningSoon,
  summarizeHarvest,
  taxOwedSoFar,
  type TaxLot,
  type TaxProfile,
} from "../src/tax-optimizer";

const asOf = new Date("2026-06-15T00:00:00Z");
const daysAgo = (n: number) => new Date(asOf.getTime() - n * 86_400_000);
const daysFromNow = (n: number) => new Date(asOf.getTime() + n * 86_400_000);

const baseProfile: TaxProfile = {
  ordinaryRate: 0.32,
  ltcgRate: 0.15,
  ytdShortTermGain: ZERO,
  ytdLongTermGain: ZERO,
  carryforwardShortTerm: ZERO,
  carryforwardLongTerm: ZERO,
  carryforwardDiscount: 0.7,
};

let lotSeq = 0;
const lot = (over: Partial<TaxLot> = {}): TaxLot => ({
  lotId: `lot-${++lotSeq}`,
  assetId: "asset-x",
  symbol: "XYZ",
  assetClass: "stock",
  accountId: "acct-1",
  accountName: "Fidelity Brokerage",
  quantity: D(10),
  costBasis: D(1000),
  openedAt: daysAgo(400),
  price: D(150),
  ...over,
});

describe("planSale golden cases", () => {
  it("1: two lots, identical gain per share, different holding periods -> picks the long-term lot", () => {
    // Both: 10 shares, $100/sh basis, $150/sh price -> $500 gain each.
    const shortTerm = lot({
      lotId: "st",
      openedAt: daysAgo(30), // short-term
      quantity: D(10),
      costBasis: D(1000),
      price: D(150),
    });
    const longTerm = lot({
      lotId: "lt",
      openedAt: daysAgo(400), // long-term
      quantity: D(10),
      costBasis: D(1000),
      price: D(150),
    });
    const plan = planSale({
      objective: "raise_cash",
      targetProceeds: D(1500), // exactly one lot's proceeds
      lots: [shortTerm, longTerm],
      blocked: [],
      profile: baseProfile,
      asOf,
    });
    expect(plan.sales).toHaveLength(1);
    expect(plan.sales[0]!.lot.lotId).toBe("lt");
    expect(plan.sales[0]!.isLongTerm).toBe(true);
  });

  it("2: loss lot + same-symbol buy 12 days prior -> blocked, plan routes around it", () => {
    const lossLot = lot({
      lotId: "loss",
      assetId: "asset-eth",
      symbol: "ETH",
      quantity: D(10),
      costBasis: D(2000), // basis 2000, price*qty = 1000 -> loss of 1000
      price: D(100),
      openedAt: daysAgo(200),
    });
    const gainLot = lot({
      lotId: "gain",
      assetId: "asset-btc",
      symbol: "BTC",
      quantity: D(10),
      costBasis: D(500),
      price: D(100), // proceeds 1000, gain 500
      openedAt: daysAgo(200),
    });
    const recentBuys: RecentBuyTxn[] = [
      {
        assetId: "asset-eth",
        accountId: "acct-1",
        accountName: "Fidelity Brokerage",
        isTaxAdvantaged: false,
        tradedAt: daysAgo(12),
        likelyDividendReinvestment: false,
      },
    ];
    const blocked = detectWashSaleBlocks(
      [{ lotId: "loss", assetId: "asset-eth", symbol: "ETH", lossUsd: D(1000) }],
      recentBuys,
      asOf,
    );
    expect(blocked).toHaveLength(1);

    const plan = planSale({
      objective: "raise_cash",
      targetProceeds: D(1000),
      lots: [lossLot, gainLot],
      blocked,
      profile: baseProfile,
      asOf,
    });
    // Routes around the blocked lot entirely — only the gain lot is sold.
    expect(plan.sales.every((s) => s.lot.lotId !== "loss")).toBe(true);
    expect(plan.sales.some((s) => s.lot.lotId === "gain")).toBe(true);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0]!.reason).toContain("wash-sale window");
  });

  it("3: loss lot's replacement bought in an IRA -> permanent disallowance, nothing written anywhere", () => {
    const recentBuys: RecentBuyTxn[] = [
      {
        assetId: "asset-eth",
        accountId: "acct-ira",
        accountName: "Schwab IRA",
        isTaxAdvantaged: true,
        tradedAt: daysAgo(5),
        likelyDividendReinvestment: false,
      },
    ];
    const blocked = detectWashSaleBlocks(
      [{ lotId: "loss", assetId: "asset-eth", symbol: "ETH", lossUsd: D(1000) }],
      recentBuys,
      asOf,
    );
    expect(blocked[0]!.permanentlyDisallowed).toBe(true);
    expect(blocked[0]!.reason).toContain("PERMANENTLY disallowed");
    // The module is planning-only: confirm the block object carries no
    // mutation/adjustment payload of any kind.
    expect(Object.keys(blocked[0]!)).not.toContain("basisAdjustment");
    expect(Object.keys(blocked[0]!)).not.toContain("writtenTo");
  });

  it("4: $10k YTD short-term gains -> a short-term loss lot is valued at the ordinary rate, not LTCG", () => {
    const profile: TaxProfile = { ...baseProfile, ytdShortTermGain: D(10000) };
    const lossLot = lot({
      quantity: D(10),
      costBasis: D(2000),
      price: D(100), // loss of 1000, short-term
      openedAt: daysAgo(30),
    });
    const plan = planSale({
      objective: "harvest_losses",
      targetProceeds: ZERO,
      lots: [lossLot],
      blocked: [],
      profile,
      asOf,
    });
    expect(plan.sales).toHaveLength(1);
    // ST bucket stays positive throughout (10000 -> 9000), so the loss's
    // marginal value is exactly -1000 * ordinaryRate (no cap, no discount).
    expect(plan.sales[0]!.taxCost.toNumber()).toBeCloseTo(-1000 * 0.32, 6);
  });

  it("5: zero YTD gains, no carryforward room -> loss beyond $3,000 is discounted, not full value", () => {
    const lossLot = lot({
      quantity: D(10),
      costBasis: D(6000),
      price: D(100), // loss of 5000
      openedAt: daysAgo(30),
    });
    const plan = planSale({
      objective: "harvest_losses",
      targetProceeds: ZERO,
      lots: [lossLot],
      blocked: [],
      profile: baseProfile,
      asOf,
    });
    const expected = -(3000 * 0.32 + 2000 * 0.32 * 0.7);
    expect(plan.sales[0]!.taxCost.toNumber()).toBeCloseTo(expected, 6);
    // And it is NOT counted at the naive full rate:
    expect(plan.sales[0]!.taxCost.toNumber()).not.toBeCloseTo(-5000 * 0.32, 2);
  });

  it("6: a lot 9 days from long-term with a large gain is still sold if cash is needed, with a timing warning", () => {
    const gainLot = lot({
      quantity: D(10),
      costBasis: D(500),
      price: D(200), // proceeds 2000, gain 1500
      openedAt: daysAgo(356), // 9 days short of the 1-year+1-day boundary
    });
    const plan = planSale({
      objective: "raise_cash",
      targetProceeds: D(2000),
      lots: [gainLot],
      blocked: [],
      profile: baseProfile,
      asOf,
    });
    expect(plan.sales).toHaveLength(1);
    expect(plan.sales[0]!.isLongTerm).toBe(false);
    expect(plan.sales[0]!.ripening).toBeDefined();
    expect(plan.sales[0]!.ripening!.daysUntilLongTerm).toBeGreaterThan(0);
    expect(plan.sales[0]!.ripening!.daysUntilLongTerm).toBeLessThanOrEqual(10);
    expect(plan.sales[0]!.ripening!.estSavingsIfWaited.toNumber()).toBeCloseTo(
      1500 * (0.32 - 0.15),
      6,
    );

    // Also shows up in the standalone ripening-soon list even without a plan.
    const soon = ripeningSoon([gainLot], baseProfile, asOf, 45);
    expect(soon).toHaveLength(1);
    expect(soon[0]!.lot.lotId).toBe(gainLot.lotId);
  });

  it("7: target exceeds all eligible proceeds -> best partial plan, explicit shortfall", () => {
    const only = lot({ quantity: D(10), costBasis: D(1000), price: D(150) }); // proceeds 1500
    const plan = planSale({
      objective: "raise_cash",
      targetProceeds: D(5000),
      lots: [only],
      blocked: [],
      profile: baseProfile,
      asOf,
    });
    expect(plan.totalProceeds.toNumber()).toBeCloseTo(1500, 6);
    expect(plan.shortfall.toNumber()).toBeCloseTo(3500, 6);
    expect(plan.sales).toHaveLength(1);
    expect(plan.sales[0]!.sellQuantity.toNumber()).toBeCloseTo(10, 6); // whole lot, still short
  });

  it("8: a state that taxes LTCG at (or above) the ordinary rate flips the ranking vs. a state that doesn't", () => {
    // The core engine takes already-combined federal+state rates — a state's
    // `state_treats_ltcg_as_ordinary` setting is folded in one layer up (it
    // adds the state's ordinary rate to the LTCG side instead of a separate,
    // typically lower, state LTCG rate). What matters HERE is that the
    // engine's ranking is a direct, sensitive function of that gap — not a
    // hardcoded "always prefer long-term" rule.
    const shortTerm = lot({
      lotId: "st",
      openedAt: daysAgo(30),
      quantity: D(10),
      costBasis: D(1000),
      price: D(150), // gain 500
    });
    const longTerm = lot({
      lotId: "lt",
      openedAt: daysAgo(400),
      quantity: D(10),
      costBasis: D(1000),
      price: D(150), // gain 500
    });

    // A state with a genuine LTCG preference (e.g. 0% state LTCG add-on):
    // combined ordinary 29%, combined LTCG 15% -> LT is clearly cheaper.
    const preferentialState: TaxProfile = { ...baseProfile, ordinaryRate: 0.29, ltcgRate: 0.15 };
    const planPreferential = planSale({
      objective: "raise_cash",
      targetProceeds: D(1500),
      lots: [shortTerm, longTerm],
      blocked: [],
      profile: preferentialState,
      asOf,
    });
    expect(planPreferential.sales[0]!.lot.lotId).toBe("lt");

    // A state where LTCG is taxed at (here, deliberately above, to force a
    // clean assertion) the ordinary rate: the long-term discount evaporates
    // and short-term becomes the cheaper lot to sell.
    const ltcgAsOrdinary: TaxProfile = { ...baseProfile, ordinaryRate: 0.29, ltcgRate: 0.33 };
    const planFlipped = planSale({
      objective: "raise_cash",
      targetProceeds: D(1500),
      lots: [shortTerm, longTerm],
      blocked: [],
      profile: ltcgAsOrdinary,
      asOf,
    });
    expect(planFlipped.sales[0]!.lot.lotId).toBe("st");
    expect(planPreferential.sales[0]!.lot.lotId).not.toBe(planFlipped.sales[0]!.lot.lotId);
  });
});

describe("counterfactuals (FIFO / highest-cost-first) vs optimized", () => {
  it("FIFO ignores tax consequences entirely — oldest lot first regardless of rate", () => {
    const shortTerm = lot({
      lotId: "st-old",
      openedAt: daysAgo(500), // oldest, but happens to still be long-term here so make it short:
      quantity: D(10),
      costBasis: D(1000),
      price: D(150),
    });
    // Force short-term: reset to a recent open date but keep it "oldest" by
    // making the other lot even more recent.
    const stLot = { ...shortTerm, openedAt: daysAgo(20) };
    const newerLongTerm = lot({
      lotId: "lt-newer",
      openedAt: daysAgo(400),
      quantity: D(10),
      costBasis: D(1000),
      price: D(150),
    });
    // FIFO sorts by openedAt ascending -> lt-newer (400 days ago) is "older"
    // than stLot (20 days ago), so FIFO picks lt-newer first regardless of
    // the fact both are equally good here; the point is it never LOOKS at tax.
    const plan = planFifo({
      targetProceeds: D(1500),
      lots: [stLot, newerLongTerm],
      blocked: [],
      profile: baseProfile,
      asOf,
    });
    expect(plan.sales[0]!.lot.lotId).toBe("lt-newer");
  });

  it("optimized plan's after-tax proceeds are never worse than FIFO's for the same target", () => {
    const lots = [
      lot({ lotId: "a", openedAt: daysAgo(500), quantity: D(10), costBasis: D(500), price: D(150) }),
      lot({ lotId: "b", openedAt: daysAgo(20), quantity: D(10), costBasis: D(1400), price: D(150) }),
      lot({ lotId: "c", openedAt: daysAgo(10), quantity: D(10), costBasis: D(200), price: D(150) }),
    ];
    const target = D(3000);
    const optimized = planSale({
      objective: "raise_cash",
      targetProceeds: target,
      lots,
      blocked: [],
      profile: baseProfile,
      asOf,
    });
    const fifo = planFifo({ targetProceeds: target, lots, blocked: [], profile: baseProfile, asOf });
    const hcf = planHighestCostFirst({
      targetProceeds: target,
      lots,
      blocked: [],
      profile: baseProfile,
      asOf,
    });
    expect(optimized.totalAfterTax.gte(fifo.totalAfterTax.sub(0.01))).toBe(true);
    expect(optimized.totalAfterTax.gte(hcf.totalAfterTax.sub(0.01))).toBe(true);
  });
});

describe("harvest_losses preset (target proceeds = 0)", () => {
  it("includes every non-blocked loss lot regardless of target", () => {
    const loss1 = lot({ lotId: "l1", quantity: D(10), costBasis: D(2000), price: D(100) });
    const loss2 = lot({
      lotId: "l2",
      assetId: "asset-y",
      symbol: "ABC",
      quantity: D(5),
      costBasis: D(1000),
      price: D(150),
    });
    const gain = lot({
      lotId: "g1",
      assetId: "asset-z",
      symbol: "GAIN",
      quantity: D(5),
      costBasis: D(100),
      price: D(150),
    });
    const plan = planSale({
      objective: "harvest_losses",
      targetProceeds: ZERO,
      lots: [loss1, loss2, gain],
      blocked: [],
      profile: baseProfile,
      asOf,
    });
    expect(plan.sales.map((s) => s.lot.lotId).sort()).toEqual(["l1", "l2"]);
    expect(plan.totalTaxCost.lt(0)).toBe(true); // net benefit
    expect(plan.shortfall.toNumber()).toBe(0);
  });
});

describe("summarizeHarvest", () => {
  const sale = (realizedGain: number, isLongTerm: boolean) => ({
    realizedGain: D(realizedGain),
    isLongTerm,
  });

  it("buckets always sum exactly to the total harvested loss (reconciliation)", () => {
    const profile: TaxProfile = { ...baseProfile, ytdShortTermGain: D(1500) };
    const sales = [sale(-1000, false), sale(-4000, true)];
    const b = summarizeHarvest(profile, sales);
    expect(b.totalHarvestedLossUsd.toNumber()).toBeCloseTo(5000, 8);
    expect(
      b.gainsOffsetUsd.add(b.ordinaryDeductionUsd).add(b.carryforwardUsd).toNumber(),
    ).toBeCloseTo(5000, 8);
  });

  it("attributes the portion that offsets an existing YTD gain", () => {
    // $1,500 YTD short-term gain; harvest a $1,000 short-term loss -> all of
    // it offsets the gain, nothing left for the $3,000 bucket or carryforward.
    const profile: TaxProfile = { ...baseProfile, ytdShortTermGain: D(1500) };
    const b = summarizeHarvest(profile, [sale(-1000, false)]);
    expect(b.gainsOffsetUsd.toNumber()).toBeCloseTo(1000, 8);
    expect(b.ordinaryDeductionUsd.toNumber()).toBe(0);
    expect(b.carryforwardUsd.toNumber()).toBe(0);
  });

  it("with zero YTD gains, splits into the $3,000 deduction then carryforward", () => {
    const b = summarizeHarvest(baseProfile, [sale(-5000, false)]);
    expect(b.gainsOffsetUsd.toNumber()).toBe(0);
    expect(b.ordinaryDeductionUsd.toNumber()).toBeCloseTo(3000, 8);
    expect(b.carryforwardUsd.toNumber()).toBeCloseTo(2000, 8);
  });

  it("splits across all three buckets when the harvest is large enough", () => {
    // $800 YTD gain absorbs first, next $3,000 is the ordinary deduction,
    // remainder carries forward.
    const profile: TaxProfile = { ...baseProfile, ytdShortTermGain: D(800) };
    const b = summarizeHarvest(profile, [sale(-6000, false)]);
    expect(b.gainsOffsetUsd.toNumber()).toBeCloseTo(800, 8);
    expect(b.ordinaryDeductionUsd.toNumber()).toBeCloseTo(3000, 8);
    expect(b.carryforwardUsd.toNumber()).toBeCloseTo(2200, 8);
  });

  it("ignores gain sales — only losses count as harvested", () => {
    const b = summarizeHarvest(baseProfile, [sale(500, false), sale(-1000, false)]);
    expect(b.totalHarvestedLossUsd.toNumber()).toBeCloseTo(1000, 8);
  });
});

describe("taxOwedSoFar", () => {
  it("taxes each bucket at its own rate", () => {
    // ST $1,000 × 32% = $320; LT $2,000 × 15% = $300 -> $620.
    const p = { ...baseProfile, ytdShortTermGain: D(1000), ytdLongTermGain: D(2000) };
    expect(taxOwedSoFar(p).toNumber()).toBeCloseTo(620, 8);
  });

  it("cross-nets a short-term loss against long-term gains first", () => {
    // ST −$1,500 cancels $1,500 of the $2,000 LT gain -> $500 × 15% = $75.
    const p = { ...baseProfile, ytdShortTermGain: D(-1500), ytdLongTermGain: D(2000) };
    expect(taxOwedSoFar(p).toNumber()).toBeCloseTo(75, 8);
  });

  it("a carryforward that covers the gains leaves nothing owed (never negative)", () => {
    // ST $1,000 − $1,500 carryforward = −$500 net loss -> owes $0, not −$160.
    const p = { ...baseProfile, ytdShortTermGain: D(1000), carryforwardShortTerm: D(1500) };
    expect(taxOwedSoFar(p).toNumber()).toBe(0);
  });

  it("owes nothing with no sales", () => {
    expect(taxOwedSoFar(baseProfile).toNumber()).toBe(0);
  });
});
