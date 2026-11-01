import { describe, expect, it } from "vitest";
import { D, ZERO } from "../src/types";
import {
  detectWashSaleBlocks,
  type RecentBuyTxn,
  type WashSaleBlock,
} from "../src/tax-wash-sale";
import {
  planFifo,
  planHighestCostFirst,
  planSale,
  ripeningSoon,
  summarizeHarvest,
  taxOwedSoFar,
  lossLocks,
  taxMoves,
  zeroRateGains,
  profileAtIncome,
  sellEverything,
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

describe("sellEverything (what selling it all would owe)", () => {
  // LT: 10 sh, $1,000 basis, $150 -> +$500. ST: 10 sh, $1,300 basis, $150 -> +$200.
  const ltLot = lot({ lotId: "se-lt", openedAt: daysAgo(400), costBasis: D(1000) });
  const stLot = lot({ lotId: "se-st", openedAt: daysAgo(30), costBasis: D(1300) });

  it("taxes each term at its own rate, on top of nothing sold yet", () => {
    // $200 × 32% + $500 × 15% = $64 + $75 = $139; proceeds 2 × $1,500.
    const r = sellEverything([ltLot, stLot], [], baseProfile, asOf);
    expect(r.proceedsUsd.toNumber()).toBe(3000);
    expect(r.costBasisUsd.toNumber()).toBe(2300);
    expect(r.shortTermGainUsd.toNumber()).toBe(200);
    expect(r.longTermGainUsd.toNumber()).toBe(500);
    expect(r.taxUsd.toNumber()).toBeCloseTo(139, 8);
  });

  it("a long-term carryforward lowers it", () => {
    // LT $500 − $300 carryforward = $200 × 15% = $30, plus ST $64 -> $94.
    const p = { ...baseProfile, carryforwardLongTerm: D(300) };
    expect(sellEverything([ltLot, stLot], [], p, asOf).taxUsd.toNumber()).toBeCloseTo(94, 8);
  });

  it("a losing sale cuts tax already owed (negative)", () => {
    // ST −$400 lot (10 sh, $1,900 basis, $150). Before: $1,000 × 32% = $320.
    // After: $600 × 32% = $192 -> −$128.
    const loser = lot({ lotId: "se-loss", openedAt: daysAgo(30), costBasis: D(1900) });
    const p = { ...baseProfile, ytdShortTermGain: D(1000) };
    expect(sellEverything([loser], [], p, asOf).taxUsd.toNumber()).toBeCloseTo(-128, 8);
  });

  it("leaves out a loss a retirement-account rebuy disallows for good", () => {
    const loser = lot({ lotId: "se-loss", openedAt: daysAgo(30), costBasis: D(1900) });
    const gone: WashSaleBlock = {
      lotId: "se-loss",
      assetId: "asset-x",
      symbol: "XYZ",
      disallowedLossUsd: D(400),
      permanentlyDisallowed: true,
      triggerAccountName: "Roth",
      triggerDate: daysAgo(5),
      likelyDividendReinvestment: false,
      reason: "bought again in Roth",
    };
    const p = { ...baseProfile, ytdShortTermGain: D(1000) };
    const r = sellEverything([loser], [gone], p, asOf);
    expect(r.taxUsd.toNumber()).toBe(0);
    expect(r.disallowedLossUsd.toNumber()).toBe(400);
    expect(r.shortTermGainUsd.toNumber()).toBe(0);
  });

  it("with an income inside the 0% bracket, long-term gains owe only the state part", () => {
    // Single, $20,000 taxable + $500 LT stays under $49,450: 15% federal comes off
    // a 20% combined rate -> $500 × 5% = $25.
    const p = { ...baseProfile, ltcgRate: 0.2 };
    const income = { status: "single" as const, taxableIncomeUsd: 20_000 };
    const r = sellEverything([ltLot], [], p, asOf, { income, federalLtcgRate: 0.15 });
    expect(r.taxUsd.toNumber()).toBeCloseTo(25, 8);
    expect(r.ltcgRate).toBeCloseTo(0.05, 8);
  });

  it("a sale that pushes the year past the 0% bracket pays the full rate", () => {
    // $49,000 taxable + $500 LT = $49,500 > $49,450 -> $500 × 20% = $100.
    const p = { ...baseProfile, ltcgRate: 0.2 };
    const income = { status: "single" as const, taxableIncomeUsd: 49_000 };
    const r = sellEverything([ltLot], [], p, asOf, { income, federalLtcgRate: 0.15 });
    expect(r.taxUsd.toNumber()).toBeCloseTo(100, 8);
  });
});

describe("lossLocks (sell-and-buy-back crypto losses)", () => {
  // $2,000 short-term gain already realized; 32% ordinary / 15% LT / 0.7 carryforward.
  const profile: TaxProfile = { ...baseProfile, ytdShortTermGain: D(2000) };
  const eth = lot({
    lotId: "eth",
    assetId: "asset-eth",
    symbol: "ETH",
    assetClass: "crypto",
    quantity: D(2),
    costBasis: D(6000),
    price: D(2000), // proceeds 4,000 -> loss 2,000, short-term
    openedAt: daysAgo(100),
  });
  const btc = lot({
    lotId: "btc",
    assetId: "asset-btc",
    symbol: "BTC",
    assetClass: "crypto",
    quantity: D("0.1"),
    costBasis: D(10000),
    price: D(60000), // proceeds 6,000 -> loss 4,000, long-term
    openedAt: daysAgo(400),
  });
  const btcGain = lot({
    lotId: "btc-gain",
    assetId: "asset-btc",
    symbol: "BTC",
    assetClass: "crypto",
    quantity: D("0.1"),
    costBasis: D(3000),
    price: D(60000),
    openedAt: daysAgo(800),
  });
  const stockLoss = lot({ lotId: "xyz", costBasis: D(5000), price: D(100) });

  it("golden: books crypto losses only, honoring cross-netting, the $3,000 cap and carryforward", () => {
    // Baseline: ST +2,000 -> tax 640.
    // BTC first (better per dollar: -1,280/6,000 vs ETH -640/4,000):
    //   ST +2,000, LT -4,000 -> cross-net to LT -2,000 -> deduction 2,000 x .32 = -640.
    //   delta = -640 - 640 = -1,280.
    // Then ETH: ST 0, LT -4,000 -> 3,000 x .32 = -960, 1,000 x .32 x .7 = -224 -> -1,184.
    //   delta = -1,184 - (-640) = -544.
    // Total saved 1,824 (= 640 - (-1,184)). Stock loss and BTC gain lot ignored.
    const { locks, totalTaxSavedUsd } = lossLocks([eth, btc, btcGain, stockLoss], profile, asOf);
    expect(totalTaxSavedUsd.toNumber()).toBeCloseTo(1824, 6);
    expect(locks.map((l) => l.symbol)).toEqual(["BTC", "ETH"]);
    expect(locks[0]!.taxSavedUsd.toNumber()).toBeCloseTo(1280, 6);
    expect(locks[0]!.lossUsd.toNumber()).toBeCloseTo(4000, 6);
    expect(locks[0]!.proceeds.toNumber()).toBeCloseTo(6000, 6);
    expect(locks[0]!.quantity.toNumber()).toBeCloseTo(0.1, 10);
    expect(locks[0]!.sales.map((s) => s.lot.lotId)).toEqual(["btc"]);
    expect(locks[1]!.taxSavedUsd.toNumber()).toBeCloseTo(544, 6);
    expect(locks[1]!.lossUsd.toNumber()).toBeCloseTo(2000, 6);
  });

  it("finds nothing when the exemption is switched off", () => {
    const { locks, totalTaxSavedUsd } = lossLocks([eth, btc], profile, asOf, {
      exemptAssetClasses: [],
    });
    expect(locks).toHaveLength(0);
    expect(totalTaxSavedUsd.toNumber()).toBe(0);
  });

  it("finds nothing when no crypto is below cost", () => {
    expect(lossLocks([btcGain, stockLoss], profile, asOf).locks).toHaveLength(0);
  });
});

describe("taxMoves (one ranked list of moves, R-003)", () => {
  // $2,000 short-term gain already realized; 32% ordinary / 15% LT / 0.7 carryforward.
  const profile: TaxProfile = { ...baseProfile, ytdShortTermGain: D(2000) };
  const eth = lot({
    lotId: "m-eth",
    assetId: "asset-eth",
    symbol: "ETH",
    assetClass: "crypto",
    quantity: D(2),
    costBasis: D(6000),
    price: D(2000), // loss 2,000, short-term
    openedAt: daysAgo(100),
  });
  const btc = lot({
    lotId: "m-btc",
    assetId: "asset-btc",
    symbol: "BTC",
    assetClass: "crypto",
    quantity: D("0.1"),
    costBasis: D(10000),
    price: D(60000), // loss 4,000, long-term
    openedAt: daysAgo(400),
  });
  const xyz = lot({ lotId: "m-xyz", costBasis: D(5000), price: D(100) }); // loss 4,000, LT
  const vti = lot({
    lotId: "m-vti",
    assetId: "asset-vti",
    symbol: "VTI",
    costBasis: D(2000),
    price: D(100), // loss 1,000, short-term
    openedAt: daysAgo(60),
  });
  const aapl1 = lot({
    lotId: "m-aapl1",
    assetId: "asset-aapl",
    symbol: "AAPL",
    openedAt: daysAgo(350), // 2025-06-30 -> long-term from 2026-06-30
  }); // gain 500, short-term
  const aapl2 = lot({
    lotId: "m-aapl2",
    assetId: "asset-aapl",
    symbol: "AAPL",
    openedAt: daysAgo(340), // 2025-07-10 -> long-term from 2026-07-10
  });
  const vtiBlock: WashSaleBlock = {
    lotId: "m-vti",
    assetId: "asset-vti",
    symbol: "VTI",
    disallowedLossUsd: D(1000),
    permanentlyDisallowed: false,
    triggerAccountName: "Roth",
    triggerDate: daysAgo(10), // 2026-06-05 -> clears 2026-07-06
    likelyDividendReinvestment: false,
    reason: "bought again",
  };

  it("golden: locks, then harvest on top, then on-hold on top, then waits; ranked by dollars", () => {
    // 1. Locks (same as the lossLocks golden): BTC 1,280, ETH 544; state after: ST 0,
    //    LT -4,000 -> tax -960 - 224 = -1,184.
    // 2. Harvest XYZ on top: LT -8,000 -> -960 - 5,000 x .224 = -2,080; saves 896.
    // 3. VTI clears 2026-07-06 (still short-term): ST -1,000, LT -8,000 -> net -9,000
    //    -> -960 - 6,000 x .224 = -2,304; saves 224.
    // 4. Each AAPL lot alone vs. the start (ST +2,000 -> 640): short +500 -> 800 (+160),
    //    long +500 -> 75 (+75); waiting saves 85 each, 170 for both.
    const r = taxMoves([eth, btc, xyz, vti, aapl1, aapl2], [vtiBlock], profile, asOf);
    expect(r.moves.map((m) => m.kind)).toEqual(["lock", "harvest", "lock", "on_hold", "wait"]);
    const [btcLock, xyzHarvest, ethLock, vtiHold, aaplWait] = r.moves;
    expect(btcLock!.valueUsd!.toNumber()).toBeCloseTo(1280, 6);
    expect(xyzHarvest!.valueUsd!.toNumber()).toBeCloseTo(896, 6);
    expect(ethLock!.valueUsd!.toNumber()).toBeCloseTo(544, 6);
    expect(vtiHold!.valueUsd!.toNumber()).toBeCloseTo(224, 6);
    expect(aaplWait!.valueUsd!.toNumber()).toBeCloseTo(170, 6);

    if (xyzHarvest?.kind !== "harvest") throw new Error("expected harvest");
    expect(xyzHarvest.lock.lossUsd.toNumber()).toBeCloseTo(4000, 6);
    expect(xyzHarvest.rebuyAfter.toISOString().slice(0, 10)).toBe("2026-07-16");
    if (vtiHold?.kind !== "on_hold") throw new Error("expected on_hold");
    expect(vtiHold.clearsOn.toISOString().slice(0, 10)).toBe("2026-07-06");
    expect(vtiHold.lossUsd.toNumber()).toBeCloseTo(1000, 6);
    expect(vtiHold.purchases.map((p) => [p.lot.lotId, p.valueUsd])).toEqual([["m-vti", null]]);
    if (aaplWait?.kind !== "wait") throw new Error("expected wait");
    expect(aaplWait.lots).toBe(2);
    // Bought 2025-06-30 and 2025-07-10: a sale on the anniversary is still
    // short-term, so each is safely long-term the day after.
    expect(aaplWait.firstLongTermOn.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(aaplWait.lastLongTermOn.toISOString().slice(0, 10)).toBe("2026-07-11");
    // Each purchase, oldest first, with its own 85 from waiting (sums to the 170).
    expect(
      aaplWait.purchases.map((p) => [p.lot.lotId, p.valueUsd!.toNumber()]),
    ).toEqual([
      ["m-aapl1", expect.closeTo(85, 6)],
      ["m-aapl2", expect.closeTo(85, 6)],
    ]);

    // Where each loss lands, in the engine's order (32% ordinary, 15% LT, carryforward
    // counted at 70% of 32% = 22.4%):
    //  BTC first (LT -4,000 from ST +2,000): cross-nets the 2,000 ST gain away, 2,000
    //    off income -> 2,000 x .32 + 2,000 x .32 = 1,280.
    //  ETH (ST -2,000): 1,000 more off income (3,000 cap), 1,000 carries forward
    //    -> 320 + 224 = 544.
    //  XYZ (LT -4,000): all 4,000 carries forward -> 896.
    //  VTI hold (ST -1,000): carries forward -> 224.
    const landing = (m: (typeof r.moves)[number]) => {
      if (m.kind === "wait" || m.kind === "zero_gain" || !m.landing) throw new Error("no landing");
      const l = m.landing;
      return [l.cancelsShortTermUsd, l.cancelsLongTermUsd, l.offIncomeUsd, l.carriedForwardUsd].map(
        (x) => x.toNumber(),
      );
    };
    expect(landing(btcLock!)).toEqual([2000, 0, 2000, 0]);
    expect(landing(ethLock!)).toEqual([0, 0, 1000, 1000]);
    expect(landing(xyzHarvest!)).toEqual([0, 0, 0, 4000]);
    expect(landing(vtiHold!)).toEqual([0, 0, 0, 1000]);
    // The arithmetic the UI prints reproduces each saving exactly.
    for (const m of [btcLock!, ethLock!, xyzHarvest!, vtiHold!]) {
      const [cst, clt, inc, cf] = landing(m);
      expect(cst! * 0.32 + clt! * 0.15 + inc! * 0.32 + cf! * 0.32 * 0.7).toBeCloseTo(
        m.valueUsd!.toNumber(),
        6,
      );
    }

    // Lock + harvest lines add up to the joint saving: 640 - (-2,080) = 2,720.
    expect(r.lockAndHarvestSavedUsd.toNumber()).toBeCloseTo(2720, 6);
    // 10,000 booked: 2,000 cancels the ST gain, 3,000 off income, 5,000 carries forward.
    expect(r.breakdown.gainsOffsetUsd.toNumber()).toBeCloseTo(2000, 6);
    expect(r.breakdown.ordinaryDeductionUsd.toNumber()).toBeCloseTo(3000, 6);
    expect(r.breakdown.carryforwardUsd.toNumber()).toBeCloseTo(5000, 6);
    expect(r.deductionRoomUsd.toNumber()).toBe(3000);
    expect(r.deadline.toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("a hold that clears next year has no value and sorts last; a net loss shrinks the $3,000 room", () => {
    const lateAsOf = new Date("2026-12-20T00:00:00Z");
    // A YTD net short-term loss of 1,000 already uses 1,000 of the 3,000.
    const lossYear: TaxProfile = { ...baseProfile, ytdShortTermGain: D(-1000) };
    const r = taxMoves(
      [{ ...vti, openedAt: new Date("2026-10-01T00:00:00Z") }, xyz],
      [{ ...vtiBlock, triggerDate: new Date("2026-12-10T00:00:00Z") }], // clears 2027-01-10
      lossYear,
      lateAsOf,
    );
    expect(r.moves.map((m) => m.kind)).toEqual(["harvest", "on_hold"]);
    const hold = r.moves[1]!;
    expect(hold.valueUsd).toBeNull();
    if (hold.kind !== "on_hold") throw new Error("expected on_hold");
    expect(hold.clearsOn.toISOString().slice(0, 10)).toBe("2027-01-10");
    expect(r.deductionRoomUsd.toNumber()).toBe(2000);
    // XYZ on top of ST -1,000: LT -4,000 -> net -5,000 -> -960 - 2,000 x .224 = -1,408;
    // before: -1,000 x .32 = -320; saves 1,088.
    expect(r.moves[0]!.valueUsd!.toNumber()).toBeCloseTo(1088, 6);
    // ...of which 2,000 comes off income (640) and 2,000 carries forward (448);
    // the hold that clears next year has no landing.
    const harvest = r.moves[0]!;
    if (harvest.kind !== "harvest") throw new Error("expected harvest");
    expect(harvest.landing.offIncomeUsd.toNumber()).toBe(2000);
    expect(harvest.landing.carriedForwardUsd.toNumber()).toBe(4000 - 2000);
    expect(harvest.landing.cancelsLongTermUsd.toNumber()).toBe(0);
    expect(hold.landing).toBeNull();
  });

  it("is empty when nothing is down, blocked or ripening", () => {
    const r = taxMoves([lot({ openedAt: daysAgo(800) })], [], profile, asOf);
    expect(r.moves).toHaveLength(0);
    expect(r.lockAndHarvestSavedUsd.toNumber()).toBe(0);
  });
});

describe("zeroRateGains (0% long-term room, R-003)", () => {
  // Single, $40,000 taxable income, $2,000 long-term gain already taken.
  // Room = 49,450 (top of single 0%) - 40,000 - 2,000 = 7,450.
  const profile: TaxProfile = { ...baseProfile, ytdLongTermGain: D(2000) };
  const income = { status: "single" as const, taxableIncomeUsd: 40_000 };
  const vtiA = lot({
    lotId: "z-a",
    assetId: "asset-vti",
    symbol: "VTI",
    quantity: D(10),
    costBasis: D(2000),
    price: D(300), // proceeds 3,000, gain 1,000 (1/3 of proceeds), $100 a share
    openedAt: daysAgo(900),
  });
  const vtiB = lot({
    lotId: "z-b",
    assetId: "asset-vti",
    symbol: "VTI",
    quantity: D(20),
    costBasis: D(3000),
    price: D(300), // proceeds 6,000, gain 3,000 (1/2)
    openedAt: daysAgo(500),
  });
  const aapl = lot({
    lotId: "z-c",
    assetId: "asset-aapl",
    symbol: "AAPL",
    quantity: D(50),
    costBasis: D(5000),
    price: D(200), // proceeds 10,000, gain 5,000 (1/2), $100 a share
    openedAt: daysAgo(1200),
  });
  const qqqShort = lot({
    lotId: "z-d",
    assetId: "asset-qqq",
    symbol: "QQQ",
    quantity: D(5),
    costBasis: D(1000),
    price: D(500), // gain 1,500 but short-term: not 0%-eligible
    openedAt: daysAgo(100),
  });
  const bndLoss = lot({
    lotId: "z-e",
    assetId: "asset-bnd",
    symbol: "BND",
    costBasis: D(2000),
    price: D(150), // loss 500, long-term
    openedAt: daysAgo(700),
  });

  it("golden: fills the room with the most gain per dollar first, whole shares only", () => {
    // Ratio order: z-b (1/2) and z-c (1/2) tie -> lot id: z-b, z-c, then z-a (1/3).
    // z-b whole: gain 3,000, left 4,450. z-c: 4,450 / $100 = 44.5 -> 44 shares,
    // gain 4,400, left 50. z-a: 50 / $100 = 0.5 -> 0 shares, skipped.
    // Value at 15% later: AAPL 660, VTI 450, total 7,400 x .15 = 1,110.
    const r = zeroRateGains([vtiA, vtiB, aapl, qqqShort, bndLoss], profile, income, asOf);
    expect(r.roomUsd.toNumber()).toBe(7450);
    expect(r.gains.map((g) => g.symbol)).toEqual(["AAPL", "VTI"]);
    const [a, v] = r.gains;
    expect(a!.quantity.toNumber()).toBe(44);
    expect(a!.gainUsd.toNumber()).toBe(4400);
    expect(a!.proceeds.toNumber()).toBe(8800);
    expect(v!.quantity.toNumber()).toBe(20);
    expect(v!.gainUsd.toNumber()).toBe(3000);
    expect(v!.sales.map((s) => s.lot.lotId)).toEqual(["z-b"]);
    expect(r.valueUsd.toNumber()).toBe(1110);
  });

  it("cuts crypto to the exact dollar of room", () => {
    // MFJ, 98,000 income -> room 98,900 - 98,000 = 900 (no gains this year).
    // BTC gain per coin 40,000 -> 900 / 40,000 = 0.0225 BTC, gain exactly 900, value 135.
    const btc = lot({
      lotId: "z-btc",
      assetId: "asset-btc",
      symbol: "BTC",
      assetClass: "crypto",
      quantity: D(1),
      costBasis: D(20000),
      price: D(60000),
      openedAt: daysAgo(800),
    });
    const r = zeroRateGains(
      [btc],
      baseProfile,
      { status: "married_joint", taxableIncomeUsd: 98_000 },
      asOf,
    );
    expect(r.roomUsd.toNumber()).toBe(900);
    expect(r.gains[0]!.quantity.toString()).toBe("0.0225");
    expect(r.gains[0]!.gainUsd.toNumber()).toBe(900);
    expect(r.valueUsd.toNumber()).toBe(135);
  });

  it("offers nothing above the bracket, or when the year nets to a loss", () => {
    const above = zeroRateGains(
      [aapl],
      baseProfile,
      { status: "married_joint", taxableIncomeUsd: 120_000 },
      asOf,
    );
    expect(above.roomUsd.toNumber()).toBe(0);
    expect(above.gains).toHaveLength(0);
    // Net -5,000 this year: room ignores the loss (49,450 - 40,000 = 9,450), but
    // gains would first eat a loss worth a deduction, so none are offered.
    const lossYear = zeroRateGains(
      [aapl],
      { ...baseProfile, ytdLongTermGain: D(-5000) },
      income,
      asOf,
    );
    expect(lossYear.roomUsd.toNumber()).toBe(9450);
    expect(lossYear.gains).toHaveLength(0);
  });

  it("profileAtIncome: drops the federal long-term rate only when the year fits in 0%", () => {
    // Combined LT rate 0.20 = 15% federal + 5% state. Single, 40,000 income.
    const p: TaxProfile = { ...baseProfile, ltcgRate: 0.2, ytdLongTermGain: D(9000) };
    // 40,000 + 9,000 = 49,000 <= 49,450: state part only. Tax on 9,000 = 450.
    const inside = profileAtIncome(p, income, 0.15);
    expect(inside.ltcgRate).toBeCloseTo(0.05, 12);
    expect(taxOwedSoFar(inside).toNumber()).toBeCloseTo(450, 6);
    // 40,000 + 9,500 = 49,500 > 49,450: straddles, keeps the full 20%.
    const straddle = { ...p, ytdLongTermGain: D(9500) };
    expect(profileAtIncome(straddle, income, 0.15).ltcgRate).toBe(0.2);
    // A carryforward that nets the year below the line counts: 9,500 - 1,000 = 8,500.
    expect(
      profileAtIncome({ ...straddle, carryforwardLongTerm: D(1000) }, income, 0.15).ltcgRate,
    ).toBeCloseTo(0.05, 12);
  });

  it("in taxMoves: skips assets with a loss move, ranks with the rest, null room without income", () => {
    // BND harvest (loss 500, LT): LT +2,000 -> +1,500, saves 75. The room ignores it
    // (the user may skip the loss sale): 49,450 - 40,000 - 2,000 = 7,450, the
    // golden's fill: AAPL 44 shares 4,400 -> 660, VTI 3,000 -> 450. A second BND
    // lot in gain is skipped (BND has a loss move).
    const bndGain = { ...bndLoss, lotId: "z-f", costBasis: D(1000), price: D(300) };
    const lots = [vtiA, vtiB, aapl, bndLoss, bndGain];
    const r = taxMoves(lots, [], profile, asOf, { income });
    expect(r.zeroRateRoomUsd!.toNumber()).toBe(7450);
    expect(r.moves.map((m) => m.kind)).toEqual(["zero_gain", "zero_gain", "harvest"]);
    const [a, v, h] = r.moves;
    if (a!.kind !== "zero_gain" || v!.kind !== "zero_gain") throw new Error("expected zero_gain");
    expect(a!.gain.symbol).toBe("AAPL");
    expect(a!.gain.quantity.toNumber()).toBe(44);
    expect(a!.valueUsd.toNumber()).toBe(660);
    expect(v!.valueUsd.toNumber()).toBe(450);
    expect(h!.valueUsd!.toNumber()).toBeCloseTo(75, 6);
    // Gain moves leave the joint loss saving alone.
    expect(r.lockAndHarvestSavedUsd.toNumber()).toBeCloseTo(75, 6);
    expect(taxMoves(lots, [], profile, asOf).zeroRateRoomUsd).toBeNull();
  });
});
