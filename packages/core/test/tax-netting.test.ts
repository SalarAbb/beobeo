import { describe, expect, it } from "vitest";
import { D } from "../src/types";
import { explainNetting, totalTax, type TaxRates } from "../src/tax-netting";

const rates: TaxRates = { ordinaryRate: 0.32, ltcgRate: 0.15, carryforwardDiscount: 0.7 };

describe("totalTax", () => {
  it("taxes a pure short-term gain at the ordinary rate", () => {
    expect(totalTax(D(10000), D(0), rates).toNumber()).toBeCloseTo(10000 * 0.32, 8);
  });

  it("taxes a pure long-term gain at the LTCG rate", () => {
    expect(totalTax(D(0), D(10000), rates).toNumber()).toBeCloseTo(10000 * 0.15, 8);
  });

  it("cross-nets an ST loss against an LT gain before taxing the remainder", () => {
    // ST -4000, LT +10000 -> LT reduced to 6000, taxed at ltcgRate.
    expect(totalTax(D(-4000), D(10000), rates).toNumber()).toBeCloseTo(6000 * 0.15, 8);
  });

  it("cross-nets an LT loss against an ST gain before taxing the remainder", () => {
    expect(totalTax(D(10000), D(-4000), rates).toNumber()).toBeCloseTo(6000 * 0.32, 8);
  });

  it("deducts a small net loss fully against ordinary income (under $3,000)", () => {
    expect(totalTax(D(-1500), D(0), rates).toNumber()).toBeCloseTo(-1500 * 0.32, 8);
  });

  it("caps the ordinary deduction at $3,000 and discounts the carryforward remainder", () => {
    // Net loss 5000: $3000 at full ordinary rate, $2000 carryforward at ordinaryRate*0.7.
    const expected = -(3000 * 0.32 + 2000 * 0.32 * 0.7);
    expect(totalTax(D(-5000), D(0), rates).toNumber()).toBeCloseTo(expected, 8);
  });

  it("combines ST and LT losses toward the same $3,000 cap", () => {
    // ST -1000, LT -2500 -> net loss 3500: $3000 full + $500 discounted carryforward.
    const expected = -(3000 * 0.32 + 500 * 0.32 * 0.7);
    expect(totalTax(D(-1000), D(-2500), rates).toNumber()).toBeCloseTo(expected, 8);
  });

  it("is zero for zero gains and losses", () => {
    expect(totalTax(D(0), D(0), rates).toNumber()).toBe(0);
  });
});

describe("explainNetting", () => {
  it("agrees with totalTax's number while also exposing the buckets", () => {
    const b = explainNetting(D(-5000), D(0), rates);
    expect(b.totalTax.toNumber()).toBeCloseTo(totalTax(D(-5000), D(0), rates).toNumber(), 8);
    expect(b.ordinaryDeduction.toNumber()).toBeCloseTo(3000, 8);
    expect(b.carryforward.toNumber()).toBeCloseTo(2000, 8);
    expect(b.shortTermGainTaxed.toNumber()).toBe(0);
    expect(b.longTermGainTaxed.toNumber()).toBe(0);
  });

  it("reports the post-cross-netting gain, not the pre-netting one", () => {
    // ST -4000, LT +10000 -> LT reduced to 6000 taxed; no loss bucket left.
    const b = explainNetting(D(-4000), D(10000), rates);
    expect(b.longTermGainTaxed.toNumber()).toBeCloseTo(6000, 8);
    expect(b.shortTermGainTaxed.toNumber()).toBe(0);
    expect(b.ordinaryDeduction.toNumber()).toBe(0);
    expect(b.carryforward.toNumber()).toBe(0);
  });

  it("every dollar of a net loss lands in exactly one bucket (reconciliation)", () => {
    const b = explainNetting(D(-1200), D(-2500), rates);
    const totalLoss = 1200 + 2500;
    expect(b.ordinaryDeduction.add(b.carryforward).toNumber()).toBeCloseTo(totalLoss, 8);
  });
});
