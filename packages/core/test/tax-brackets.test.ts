import { describe, expect, it } from "vitest";
import { bracketOptions, ltcgRateAt } from "../src/tax-brackets";

describe("bracketOptions", () => {
  it("single: six bands, 10% folded into 12%, each with its gain rate", () => {
    // 12% band starts at $0 → under the $49,450 0% bound → 0%.
    // 22% starts at $50,400 → 15%. 35% starts at $256,225 (< $545,500) → 15%.
    // 37% starts at $640,600 (≥ $545,500) → 20%.
    expect(bracketOptions("single")).toEqual([
      { ordinaryRatePct: 12, ltcgRatePct: 0, incomeFrom: 0, incomeTo: 50_400 },
      { ordinaryRatePct: 22, ltcgRatePct: 15, incomeFrom: 50_400, incomeTo: 105_700 },
      { ordinaryRatePct: 24, ltcgRatePct: 15, incomeFrom: 105_700, incomeTo: 201_775 },
      { ordinaryRatePct: 32, ltcgRatePct: 15, incomeFrom: 201_775, incomeTo: 256_225 },
      { ordinaryRatePct: 35, ltcgRatePct: 15, incomeFrom: 256_225, incomeTo: 640_600 },
      { ordinaryRatePct: 37, ltcgRatePct: 20, incomeFrom: 640_600, incomeTo: null },
    ]);
  });

  it("married filing jointly: bands are contiguous and the 37% band is open-ended", () => {
    const rows = bracketOptions("married_joint");
    expect(rows.map((r) => r.ordinaryRatePct)).toEqual([12, 22, 24, 32, 35, 37]);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.incomeFrom).toBe(rows[i - 1]!.incomeTo);
    // 0% runs to $98,900, inside the 12% band (to $100,800); 35% starts at
    // $512,450, under the $613,700 20% bound → 15%.
    expect(rows.map((r) => r.ltcgRatePct)).toEqual([0, 15, 15, 15, 15, 20]);
    expect(rows.at(-1)!.incomeTo).toBeNull();
  });

  it("head of household: 12% band (to $67,450) still reads 0% on gains", () => {
    const rows = bracketOptions("head_of_household");
    expect(rows[0]).toEqual({ ordinaryRatePct: 12, ltcgRatePct: 0, incomeFrom: 0, incomeTo: 67_450 });
    expect(rows[1]!.ltcgRatePct).toBe(15);
  });
});

describe("ltcgRateAt", () => {
  it("switches exactly at the bounds", () => {
    expect(ltcgRateAt("single", 49_449)).toBe(0);
    expect(ltcgRateAt("single", 49_450)).toBe(15);
    expect(ltcgRateAt("single", 545_499)).toBe(15);
    expect(ltcgRateAt("single", 545_500)).toBe(20);
    expect(ltcgRateAt("married_joint", 98_899)).toBe(0);
  });
});
