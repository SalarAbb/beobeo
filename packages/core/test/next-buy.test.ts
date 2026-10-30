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
    // Below the top pick it says why it ranks lower.
    expect(second!.reason).toBe(
      "VTI is 60% of your portfolio (63.6% after this buy), so it spreads your money less than VXUS.",
    );
  });

  it("a held top pick says it spreads money more than the runner-up", () => {
    // Two funds. $100 into $445 → 545 after. No price data, so the dip parts tie and fit decides.
    // VOO: 300 → 400/545 = 73.4%, fit 0.266. VXUS: 145 → 245/545 = 45.0%, fit 0.550.
    const [top, second] = pickNextBuy({
      amountUsd: 100,
      portfolioValue: 445,
      candidates: [cand({ key: "VOO", heldValue: 300 }), cand({ key: "VXUS", heldValue: 145 })],
    });
    expect(top!.key).toBe("VXUS");
    expect(top!.reason).toBe(
      "VXUS is 32.6% of your portfolio (45% after this buy), so it keeps your money more spread out than VOO would.",
    );
    expect(second!.reason).toBe(
      "VOO is 67.4% of your portfolio (73.4% after this buy), so it spreads your money less than VXUS.",
    );
  });

  it("a single company counts double, so an index fund beats piling into one stock", () => {
    // Mission 62 (luna): VOO 300 + NVDA 145; $100 → 545. No price data.
    // VOO (fund): 400/545 = 0.733945 → fit 0.266055, score 0.6 × 0.266055 = 0.159633.
    // NVDA (stock): 245/545 = 0.449541, counted double 0.899083 → fit 0.100917,
    //   score 0.060550. Counted once it was 0.550 and NVDA won.
    const [top, second] = pickNextBuy({
      amountUsd: 100,
      portfolioValue: 445,
      candidates: [
        cand({ key: "VOO", heldValue: 300 }),
        cand({ key: "NVDA", assetClass: "stock", heldValue: 145 }),
      ],
    });
    expect(top!.key).toBe("VOO");
    expect(top!.singleName).toBe(false);
    expect(top!.score).toBeCloseTo(0.159633, 6);
    expect(second!.singleName).toBe(true);
    expect(second!.fit).toBeCloseTo(0.100917, 6);
    expect(second!.score).toBeCloseTo(0.06055, 6);
    expect(top!.reason).toBe(
      "VOO is a fund of many companies, so it keeps your money more spread out than NVDA, a single company that would be 45% of your portfolio after this buy.",
    );
    expect(second!.reason).toBe(
      "NVDA is a single company, and this buy would make it 45% of your portfolio, so it spreads your money less than VOO, a fund of many companies.",
    );
  });

  it("a coin past half the portfolio scores no fit, and a small stock still beats a heavy fund", () => {
    // $1,000 into 10,000 → 11,000.
    // BTC (crypto): 5,000 → 6,000/11,000 = 0.545455, ×2 = 1.09 → fit 0 (floored).
    // AAPL (stock): 500 → 1,500/11,000 = 0.136364, ×2 = 0.272727 → fit 0.727273.
    // VTI (fund): 4,500 → 5,500/11,000 = 0.5 → fit 0.5.
    // No prices → scores 0.6 × fit: AAPL 0.436364, VTI 0.3, BTC 0.
    const picks = pickNextBuy({
      amountUsd: 1000,
      portfolioValue: 10000,
      candidates: [
        cand({ key: "BTC", assetClass: "crypto", heldValue: 5000 }),
        cand({ key: "VTI", heldValue: 4500 }),
        cand({ key: "AAPL", assetClass: "stock", heldValue: 500 }),
      ],
    });
    expect(picks.map((p) => p.key)).toEqual(["AAPL", "VTI", "BTC"]);
    expect(picks[0]!.score).toBeCloseTo(0.436364, 6);
    expect(picks[1]!.score).toBeCloseTo(0.3, 12);
    expect(picks[2]!.fit).toBe(0);
    // The top pick is a single company too, so the plain weight comparison speaks.
    expect(picks[1]!.reason).toBe(
      "VTI is 45% of your portfolio (50% after this buy), so it spreads your money less than AAPL.",
    );
    expect(picks[2]!.reason).toBe(
      "BTC is 50% of your portfolio (54.5% after this buy), so it spreads your money less than AAPL.",
    );
  });

  it("a lone heavy holding states its weight plainly", () => {
    // VTI 6,000 of 10,000 = 60%; +1,000 → 7,000/11,000 = 63.6%.
    const [p] = pickNextBuy({
      amountUsd: 1000,
      portfolioValue: 10000,
      candidates: [cand({ key: "VTI", heldValue: 6000 })],
    });
    expect(p!.reason).toBe("VTI is already 60% of your portfolio; this buy takes it to 63.6%.");
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
    // With a target mix fit weighs 0.9: 0.9 × 0.7 = 0.63.
    expect(picks[0]!.score).toBeCloseTo(0.63, 12);
    // All $1,000 overshoots the $700 gap: (1,500 + 1,000) / 11,000 = 22.7%.
    expect(picks[0]!.reason).toBe(
      "BND is $700 short of its 20% target; all $1,000 here takes it to 22.7%.",
    );
    expect(picks[1]!.reason).toBe("AAPL isn't in your target mix.");
    expect(picks[2]!.reason).toBe("VTI is already at or above its 50% target.");
  });

  it("with a target mix, a dip can't lift a smaller shortfall over a bigger one", () => {
    // Mission 48 (minerva): 50/30/20, VTI 30,750 / VXUS 18,378 / BND 12,606 =
    // 61,734; $6,000 → 67,734.
    // VTI gap = 33,867 − 30,750 = 3,117 → fit 0.5195. At its 1-year high, above cost → dip 0.
    //   score = 0.9 × 0.5195 = 0.46755.
    // VXUS gap = 20,320.2 − 18,378 = 1,942.2 → fit 0.3237. At its high → dip 0.
    //   score = 0.9 × 0.3237 = 0.29133.
    // BND gap = 13,546.8 − 12,606 = 940.8 → fit 0.1568. At its 1-year low and
    //   2% under its cost: range 1, cost 0.02/0.2 = 0.1 → dip 0.7 + 0.03 = 0.73.
    //   score = 0.9 × 0.1568 + 0.1 × 0.73 = 0.14112 + 0.073 = 0.21412.
    // Under the old 0.6/0.4 BND scored 0.386 and beat VXUS's 0.194.
    const picks = pickNextBuy({
      amountUsd: 6000,
      portfolioValue: 61734,
      targets: { VTI: 0.5, VXUS: 0.3, BND: 0.2 },
      candidates: [
        cand({ key: "BND", price: 98, rangeLow: 98, rangeHigh: 103, avgCost: 100, heldValue: 12606 }),
        cand({ key: "VXUS", price: 70, rangeLow: 60, rangeHigh: 70, avgCost: 60, heldValue: 18378 }),
        cand({ key: "VTI", price: 330, rangeLow: 280, rangeHigh: 330, avgCost: 300, heldValue: 30750 }),
      ],
    });
    expect(picks.map((p) => p.key)).toEqual(["VTI", "VXUS", "BND"]);
    expect(picks[0]!.score).toBeCloseTo(0.46755, 6);
    expect(picks[1]!.score).toBeCloseTo(0.29133, 6);
    expect(picks[2]!.dip).toBeCloseTo(0.73, 12);
    expect(picks[2]!.score).toBeCloseTo(0.21412, 6);
    // VTI after = 36,750 / 67,734 = 54.3%.
    expect(picks[0]!.reason).toBe(
      "VTI is $3,117 short of its 50% target, the most of your options; all $6,000 here takes it to 54.3%.",
    );
    expect(picks[1]!.reason).toBe("VXUS is $1,942 short of its 30% target, less than VTI's $3,117.");
    // BND's dip part (0.073) is smaller than its fit part (0.141), so the target speaks.
    expect(picks[2]!.reason).toBe("BND is $941 short of its 20% target, less than VTI's $3,117.");
  });

  it("with a target mix, the dip decides between options that can each take it all", () => {
    // $1,000 into 20,000 → 21,000. A and B targeted 50%, each held 5,000:
    // gap 10,500 − 5,000 = 5,500 ≥ 1,000 → fit 1 each.
    // A at its 1-year low (range 1), at cost → dip 0.7, score 0.9 + 0.07 = 0.97.
    // B at its high → dip 0, score 0.9.
    const [a, b] = pickNextBuy({
      amountUsd: 1000,
      portfolioValue: 20000,
      targets: { A: 0.5, B: 0.5 },
      candidates: [
        cand({ key: "B", price: 120, rangeLow: 100, rangeHigh: 120, heldValue: 5000 }),
        cand({ key: "A", price: 100, rangeLow: 100, rangeHigh: 125, heldValue: 5000 }),
      ],
    });
    expect(a!.key).toBe("A");
    expect(a!.score).toBeCloseTo(0.97, 12);
    expect(b!.score).toBeCloseTo(0.9, 12);
    // A = 100/125 − 1 = −20% off its high.
    expect(a!.reason).toBe(
      "A is $5,500 short of its 50% target, so it can take all $1,000, like B, and it sits 20% below its 1-year high.",
    );
    expect(b!.reason).toBe("B is $5,500 short of its 50% target too, but A sits lower in its 1-year range.");
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
