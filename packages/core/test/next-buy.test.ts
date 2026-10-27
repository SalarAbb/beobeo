import { describe, expect, it } from "vitest";
import {
  pickNextBuy,
  placeAccount,
  type NextBuyAccount,
  type NextBuyCandidate,
} from "../src/next-buy";

const cand = (c: Partial<NextBuyCandidate> & { key: string }): NextBuyCandidate => ({
  assetClass: "etf",
  price: null,
  rangeLow: null,
  rangeHigh: null,
  avgCost: null,
  heldValue: 0,
  ...c,
});

describe("pickNextBuy", () => {
  it("without a target mix, spreading money beats piling onto the biggest holding", () => {
    // $1,000 into a $10,000 portfolio → 11,000 after.
    // VTI: held 6,000 → weight after 7,000/11,000 = 0.636364, fit 0.363636.
    //   Range 180–250 at 200 → position 20/70 = 0.285714, range score 0.714286;
    //   above its 190 cost → cost score 0. dip = 0.7 × 0.714286 = 0.5.
    //   score = 0.6 × 0.363636 + 0.4 × 0.5 = 0.418182.
    // VXUS: new → weight after 1,000/11,000 = 0.090909, fit 0.909091.
    //   Range 50–70 at 60 → position 0.5, dip = 0.35.
    //   score = 0.545455 + 0.14 = 0.685455.
    const [first, second] = pickNextBuy({
      amountUsd: 1000,
      portfolioValue: 10000,
      candidates: [
        cand({ key: "VTI", price: 200, rangeLow: 180, rangeHigh: 250, avgCost: 190, heldValue: 6000 }),
        cand({ key: "VXUS", price: 60, rangeLow: 50, rangeHigh: 70 }),
      ],
    });
    expect(first!.key).toBe("VXUS");
    expect(first!.score).toBeCloseTo(0.685455, 6);
    expect(first!.weightNow).toBe(0);
    expect(first!.reason).toBe("You don't own VXUS yet, so it spreads your money wider.");
    expect(second!.key).toBe("VTI");
    expect(second!.fit).toBeCloseTo(0.363636, 6);
    expect(second!.dip).toBeCloseTo(0.5, 9);
    expect(second!.score).toBeCloseTo(0.418182, 6);
    expect(second!.vsCost).toBeCloseTo(200 / 190 - 1, 12);
    // Fit part 0.218 beats dip part 0.2, so the weight speaks.
    expect(second!.reason).toBe("VTI is already 60% of your portfolio; this buy takes it to 63.6%.");
  });

  it("calls a small holding small", () => {
    // VXUS 600 of 10,000 = 6%; +1,000 → 1,600/11,000 = 14.5%.
    const [p] = pickNextBuy({
      amountUsd: 1000,
      portfolioValue: 10000,
      candidates: [cand({ key: "VXUS", heldValue: 600 })],
    });
    expect(p!.reason).toBe("VXUS is just 6% of your portfolio, so this spreads your money (14.5% after).");
  });

  it("a dip under your cost leads when the fit is equal", () => {
    // Both held 5,000 of 10,000; +1,000 → fit = 1 − 6,000/11,000 = 0.454545 each.
    // A at 80 = its 1-year low (range score 1), 20% under its 100 cost (cost
    //   score 1) → dip 1, score 0.272727 + 0.4 = 0.672727.
    // B at its high (range score 0), above its 90 cost → dip 0, score 0.272727.
    const [a, b] = pickNextBuy({
      amountUsd: 1000,
      portfolioValue: 10000,
      candidates: [
        cand({ key: "B", price: 100, rangeLow: 80, rangeHigh: 100, avgCost: 90, heldValue: 5000 }),
        cand({ key: "A", price: 80, rangeLow: 80, rangeHigh: 100, avgCost: 100, heldValue: 5000 }),
      ],
    });
    expect(a!.key).toBe("A");
    expect(a!.score).toBeCloseTo(0.672727, 6);
    expect(a!.rangePosition).toBe(0);
    expect(a!.offHigh).toBeCloseTo(-0.2, 12);
    expect(a!.reason).toBe("A is 20% below its 1-year high, and 20% under what you paid.");
    expect(b!.score).toBeCloseTo(0.272727, 6);
  });

  it("with a target mix, the candidate furthest short of target wins", () => {
    // 50/30/20 mix; VTI 6,000 / VXUS 2,500 / BND 1,500; +1,000 → 11,000.
    // VTI gap = 0.5 × 11,000 − 6,000 = −500 → fit 0.
    // BND gap = 0.2 × 11,000 − 1,500 = 700 → fit 700/1,000 = 0.7, score 0.42.
    // AAPL untargeted → fit 0. No prices → no dip anywhere.
    // VTI and AAPL tie at 0; AAPL's lower weight after (0.0909 vs 0.636) goes first.
    const picks = pickNextBuy({
      amountUsd: 1000,
      portfolioValue: 10000,
      targets: { VTI: 0.5, VXUS: 0.3, BND: 0.2 },
      candidates: [
        cand({ key: "VTI", heldValue: 6000 }),
        cand({ key: "BND", heldValue: 1500 }),
        cand({ key: "AAPL", assetClass: "stock" }),
      ],
    });
    expect(picks.map((p) => p.key)).toEqual(["BND", "AAPL", "VTI"]);
    expect(picks[0]!.gapUsd).toBeCloseTo(700, 9);
    expect(picks[0]!.score).toBeCloseTo(0.42, 12);
    expect(picks[0]!.reason).toBe("BND is $700 short of its 20% target.");
    expect(picks[1]!.reason).toBe("AAPL isn't in your target mix.");
    expect(picks[2]!.reason).toBe("VTI is already at or above its 50% target.");
  });

  it("caps fit at 1 when the gap is bigger than the deposit, and breaks ties by symbol", () => {
    // Both targeted 50%, both empty, $100 into nothing → gap 50 each, fit 0.5.
    // Identical scores and weights → alphabetical.
    const picks = pickNextBuy({
      amountUsd: 100,
      portfolioValue: 0,
      targets: { ZZZ: 0.5, AAA: 0.5 },
      candidates: [cand({ key: "ZZZ" }), cand({ key: "AAA" })],
    });
    expect(picks.map((p) => p.key)).toEqual(["AAA", "ZZZ"]);
    expect(picks[0]!.fit).toBeCloseTo(0.5, 12);
    // 0.5 × 100,100 − 0 = 50,050 short of a $100 deposit → capped at 1.
    const [big] = pickNextBuy({
      amountUsd: 100,
      portfolioValue: 100000,
      targets: { VTI: 0.5 },
      candidates: [cand({ key: "VTI" })],
    });
    expect(big!.fit).toBe(1);
  });

  it("returns nothing for no amount or no candidates", () => {
    expect(pickNextBuy({ amountUsd: 0, portfolioValue: 1, candidates: [cand({ key: "X" })] })).toEqual([]);
    expect(pickNextBuy({ amountUsd: 10, portfolioValue: 1, candidates: [] })).toEqual([]);
  });
});

describe("placeAccount", () => {
  const brokerage: NextBuyAccount = { id: "t1", name: "Brokerage", type: "taxable" };
  const coinbase: NextBuyAccount = { id: "t2", name: "Coinbase", type: "taxable" };
  const roth: NextBuyAccount = { id: "r", name: "Roth", type: "roth_ira" };
  const ira: NextBuyAccount = { id: "i", name: "IRA", type: "traditional_ira" };
  const all = [brokerage, coinbase, roth, ira];

  it("puts crypto in a taxable account, the one already holding it first", () => {
    expect(placeAccount({ assetClass: "crypto" }, all)).toEqual({ id: "t1", name: "Brokerage", why: null });
    expect(placeAccount({ assetClass: "crypto", heldIn: ["t2"] }, all)).toEqual({
      id: "t2",
      name: "Coinbase",
      why: "where you already hold it",
    });
  });

  it("puts bond-like funds in a tax-advantaged account, traditional before Roth", () => {
    expect(placeAccount({ assetClass: "etf", incomeHeavy: true }, all)).toEqual({
      id: "i",
      name: "IRA",
      why: "its interest would be taxed every year in a regular account",
    });
    expect(placeAccount({ assetClass: "etf", incomeHeavy: true }, [brokerage, roth])!.id).toBe("r");
    // No shelter at all → the regular rules.
    expect(placeAccount({ assetClass: "etf", incomeHeavy: true }, [brokerage, coinbase])!.id).toBe("t1");
  });

  it("otherwise joins the account that holds it, else the first taxable", () => {
    expect(placeAccount({ assetClass: "stock", heldIn: ["r"] }, all)).toEqual({
      id: "r",
      name: "Roth",
      why: "where you already hold it",
    });
    expect(placeAccount({ assetClass: "stock" }, [roth, brokerage])).toEqual({
      id: "t1",
      name: "Brokerage",
      why: null,
    });
    // Unknown held-in ids (another portfolio) are ignored.
    expect(placeAccount({ assetClass: "stock", heldIn: ["gone"] }, all)!.id).toBe("t1");
  });

  it("gives no reason with a single account, and nothing with none", () => {
    expect(placeAccount({ assetClass: "etf", incomeHeavy: true }, [roth])).toEqual({
      id: "r",
      name: "Roth",
      why: null,
    });
    expect(placeAccount({ assetClass: "stock" }, [])).toBeNull();
  });
});
