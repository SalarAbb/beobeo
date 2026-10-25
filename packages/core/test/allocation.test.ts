import { describe, expect, it } from "vitest";
import { allocationDrift, fillToTarget } from "../src/allocation";

const threeFund = { VTI: 0.5, VXUS: 0.3, BND: 0.2 };

describe("allocationDrift", () => {
  it("compares current weights to the target mix", () => {
    // Total 10,000 → VTI 60% / VXUS 25% / BND 15% against 50/30/20.
    // Gap = target × total − value: VTI 5,000 − 6,000 = −1,000 (over),
    // VXUS 3,000 − 2,500 = +500, BND 2,000 − 1,500 = +500 (under).
    const { total, rows } = allocationDrift(
      [
        { key: "VTI", value: 6000 },
        { key: "VXUS", value: 2500 },
        { key: "BND", value: 1500 },
      ],
      threeFund,
    );
    expect(total).toBe(10000);
    expect(rows.map((r) => r.key)).toEqual(["VTI", "VXUS", "BND"]);
    const [vti, vxus, bnd] = rows;
    expect(vti!.current).toBeCloseTo(0.6, 12);
    expect(vti!.drift).toBeCloseTo(0.1, 12);
    expect(vti!.gapUsd).toBeCloseTo(-1000, 9);
    expect(vxus!.drift).toBeCloseTo(-0.05, 12);
    expect(vxus!.gapUsd).toBeCloseTo(500, 9);
    expect(bnd!.current).toBeCloseTo(0.15, 12);
    expect(bnd!.gapUsd).toBeCloseTo(500, 9);
  });

  it("lists holdings without a target (target 0) and targets not held (value 0)", () => {
    // AAPL is held but untargeted: its whole 20% is drift. BND is targeted
    // but not held yet: −20% drift, the full 2,000 is the gap.
    const { rows } = allocationDrift(
      [
        { key: "VTI", value: 8000 },
        { key: "AAPL", value: 2000 },
      ],
      { VTI: 0.8, BND: 0.2 },
    );
    expect(rows.map((r) => r.key)).toEqual(["VTI", "BND", "AAPL"]);
    const bnd = rows.find((r) => r.key === "BND")!;
    expect(bnd.value).toBe(0);
    expect(bnd.drift).toBeCloseTo(-0.2, 12);
    expect(bnd.gapUsd).toBeCloseTo(2000, 9);
    const aapl = rows.find((r) => r.key === "AAPL")!;
    expect(aapl.target).toBe(0);
    expect(aapl.drift).toBeCloseTo(0.2, 12);
    expect(rows.find((r) => r.key === "VTI")!.drift).toBeCloseTo(0, 12);
  });

  it("an empty portfolio has 0% current weights, not NaN", () => {
    const { total, rows } = allocationDrift([], { VTI: 1 });
    expect(total).toBe(0);
    expect(rows[0]!.current).toBe(0);
    expect(rows[0]!.drift).toBe(-1);
  });
});

describe("fillToTarget", () => {
  it("sends a small deposit only to the most underweight sleeve", () => {
    // 5,000/3,000/1,000 + 1,000 = 10,000 after → targets 5,000/3,000/2,000.
    // Only BND is short (by exactly 1,000), so it takes everything.
    const plan = fillToTarget(
      [
        { key: "VTI", value: 5000 },
        { key: "VXUS", value: 3000 },
        { key: "BND", value: 1000 },
      ],
      threeFund,
      1000,
    );
    expect(plan).toEqual([{ key: "BND", amountUsd: 1000 }]);
  });

  it("splits between the underweight sleeves and never buys the overweight one", () => {
    // 4,000/3,000/1,000 + 2,000 = 10,000 → targets 5,000/3,000/2,000:
    // VTI +1,000, BND +1,000, VXUS already at target gets nothing.
    const plan = fillToTarget(
      [
        { key: "VTI", value: 4000 },
        { key: "VXUS", value: 3000 },
        { key: "BND", value: 1000 },
      ],
      threeFund,
      2000,
    );
    expect(plan).toEqual([
      { key: "BND", amountUsd: 1000 },
      { key: "VTI", amountUsd: 1000 },
    ]);
  });

  it("levels up without reaching target when the deposit is too small for both", () => {
    // VTI 4,000 (r = 8,000), VXUS 3,000 (r = 10,000), BND 1,000 (r = 5,000);
    // deposit 1,200. Level L for {BND}: (1,200 + 1,000)/0.2 = 11,000 > 8,000,
    // so VTI joins: L = (1,200 + 5,000)/0.7 = 8,857.142857… ≤ 10,000.
    // BND: 0.2L − 1,000 = 771.428571… → 771.43; VTI: 0.5L − 4,000 =
    // 428.571428… → 428.57. Both end at the same fraction of target.
    const plan = fillToTarget(
      [
        { key: "VTI", value: 4000 },
        { key: "VXUS", value: 3000 },
        { key: "BND", value: 1000 },
      ],
      threeFund,
      1200,
    );
    expect(plan).toEqual([
      { key: "BND", amountUsd: 771.43 },
      { key: "VTI", amountUsd: 428.57 },
    ]);
  });

  it("splits by target weight when already on target", () => {
    const plan = fillToTarget(
      [
        { key: "VTI", value: 5000 },
        { key: "VXUS", value: 3000 },
        { key: "BND", value: 2000 },
      ],
      threeFund,
      1000,
    );
    expect(plan).toEqual([
      { key: "VTI", amountUsd: 500 },
      { key: "VXUS", amountUsd: 300 },
      { key: "BND", amountUsd: 200 },
    ]);
  });

  it("never sends money to an untargeted holding, and fills a target not held yet", () => {
    // AAPL (untargeted) counts toward nothing. Targeted pool: VTI 8,000, BND 0.
    // 2,000 deposit → L for {BND}: 2,000/0.2 = 10,000 ≤ VTI's r = 10,000.
    const plan = fillToTarget(
      [
        { key: "VTI", value: 8000 },
        { key: "AAPL", value: 2000 },
      ],
      { VTI: 0.8, BND: 0.2 },
      2000,
    );
    expect(plan).toEqual([{ key: "BND", amountUsd: 2000 }]);
  });

  it("rounds to cents and the pieces always add up to the deposit", () => {
    // Three equal targets from zero: 33.333… each → 3,333 cents each with
    // one cent left over, which goes to the first in order.
    const plan = fillToTarget([], { A: 1 / 3, B: 1 / 3, C: 1 / 3 }, 100);
    expect(plan).toEqual([
      { key: "A", amountUsd: 33.34 },
      { key: "B", amountUsd: 33.33 },
      { key: "C", amountUsd: 33.33 },
    ]);
  });

  it("returns nothing for a zero deposit or no targets", () => {
    expect(fillToTarget([{ key: "VTI", value: 1 }], threeFund, 0)).toEqual([]);
    expect(fillToTarget([{ key: "VTI", value: 1 }], {}, 500)).toEqual([]);
  });
});
