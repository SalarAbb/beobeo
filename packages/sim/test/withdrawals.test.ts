import { describe, expect, it } from "vitest";
import { usualDeposit, withdrawalPace } from "../../../apps/web/src/lib/next-buy-defaults";
import { withdrawalBrief } from "../src/run";

// barristan's shape: a lump in 2025, then $3,500 out on the 3rd of each month.
const points = [
  { date: "2025-11-01", invested: 100_000 },
  { date: "2025-12-03", invested: 96_500 },
  { date: "2026-01-05", invested: 93_000 },
  { date: "2026-02-03", invested: 89_500 },
  { date: "2026-02-20", invested: 90_000 }, // $500 put back
  { date: "2026-03-03", invested: 86_500 },
];

describe("usualDeposit", () => {
  it("names setup's starting holdings as such, not as a deposit (luna, mission 140)", () => {
    expect(usualDeposit([{ invested: 450 }, { invested: 450 }])).toEqual({ usd: 450, from: "start" });
  });
  it("takes the last deposit with fewer than three to go by", () => {
    expect(usualDeposit([{ invested: 450 }, { invested: 600 }])).toEqual({ usd: 150, from: "last" });
  });
  it("takes the median of three or more", () => {
    const pts = [{ invested: 300 }, { invested: 400 }, { invested: 500 }, { invested: 600 }];
    expect(usualDeposit(pts)).toEqual({ usd: 100, from: "usual" });
  });
});

describe("withdrawalPace byMonth", () => {
  it("nets this year's money out per month and sums to thisYearUsd", () => {
    const pace = withdrawalPace(points)!;
    expect(pace.thisYearUsd).toBe(10_000);
    expect(pace.byMonth).toEqual([
      { month: "2026-01", outUsd: 3_500 },
      { month: "2026-02", outUsd: 3_000 },
      { month: "2026-03", outUsd: 3_500 },
    ]);
    expect(pace.byMonth.reduce((t, m) => t + m.outUsd, 0)).toBe(pace.thisYearUsd);
  });

  it("puts the month list in the persona's brief", () => {
    const brief = withdrawalBrief(withdrawalPace(points)!, 0);
    expect(brief).toContain("month by month: 2026-01 $3,500, 2026-02 $3,000, 2026-03 $3,500");
  });
});
