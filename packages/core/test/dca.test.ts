import { describe, expect, it } from "vitest";
import { extractCashFlows, replayDca } from "../src/dca";
import { xirr } from "../src/xirr";
import type { PriceSeries } from "../src/timeseries";
import { D } from "../src/types";
import { txn } from "./helpers";

const series = (entries: [string, number][]): PriceSeries =>
  new Map(entries.map(([d, p]) => [d, D(p)]));

describe("extractCashFlows", () => {
  it("maps buys to inflows and sells to outflows, ignoring dividends", () => {
    const flows = extractCashFlows([
      txn({ type: "buy", qty: 10, price: 100, fees: 5, at: "2024-01-01" }),
      txn({ type: "dividend", qty: 1, price: 50, at: "2024-02-01" }),
      txn({ type: "sell", qty: 5, price: 110, fees: 2, at: "2024-03-01" }),
    ]);
    expect(flows).toHaveLength(2);
    expect(flows[0]!.amount.eq(1005)).toBe(true);
    expect(flows[1]!.amount.eq(-548)).toBe(true);
  });
});

describe("replayDca", () => {
  const benchPrices = series([
    ["2024-01-01", 100],
    ["2024-01-02", 100],
    ["2024-01-03", 110],
    ["2024-01-05", 120], // 01-04 is a non-trading day
  ]);

  it("buys the benchmark at each flow date and marks to market daily", () => {
    const { series: points, finalUnits } = replayDca({
      flows: [
        { date: new Date("2024-01-01T00:00:00Z"), amount: D(1000) },
        { date: new Date("2024-01-04T00:00:00Z"), amount: D(600) },
      ],
      benchmark: [{ prices: benchPrices, weight: D(1) }],
      to: "2024-01-05",
    });

    // Flow 1: 1000 @ 100 → 10 units.
    // Flow 2 lands on a non-trading day → executes at next close (120) → 5 units.
    expect(finalUnits[0]!.eq(15)).toBe(true);

    expect(points.map((p) => p.date)).toEqual([
      "2024-01-01",
      "2024-01-02",
      "2024-01-03",
      "2024-01-04",
      "2024-01-05",
    ]);
    expect(points[0]!.value.eq(1000)).toBe(true); // 10 × 100
    expect(points[2]!.value.eq(1100)).toBe(true); // 10 × 110
    expect(points[3]!.value.eq(1650)).toBe(true); // 15 × 110 (forward-filled)
    expect(points[4]!.value.eq(1800)).toBe(true); // 15 × 120
    expect(points[4]!.invested.eq(1600)).toBe(true);
  });

  it("sells units on withdrawals", () => {
    const { series: points, finalUnits } = replayDca({
      flows: [
        { date: new Date("2024-01-01T00:00:00Z"), amount: D(1000) },
        { date: new Date("2024-01-03T00:00:00Z"), amount: D(-550) },
      ],
      benchmark: [{ prices: benchPrices, weight: D(1) }],
      to: "2024-01-05",
    });
    // Sell 550 @ 110 → −5 units → 5 remain; final value 5 × 120 = 600.
    expect(finalUnits[0]!.eq(5)).toBe(true);
    expect(points[4]!.value.eq(600)).toBe(true);
    expect(points[4]!.invested.eq(450)).toBe(true);
  });

  it("splits flows across a weighted basket", () => {
    const x = series([["2024-01-01", 100], ["2024-01-02", 100]]);
    const y = series([["2024-01-01", 200], ["2024-01-02", 200]]);
    const { finalUnits, series: points } = replayDca({
      flows: [{ date: new Date("2024-01-01T00:00:00Z"), amount: D(1000) }],
      benchmark: [
        { prices: x, weight: D("0.5") },
        { prices: y, weight: D("0.5") },
      ],
      to: "2024-01-02",
    });
    expect(finalUnits[0]!.eq(5)).toBe(true); // 500 / 100
    expect(finalUnits[1]!.eq("2.5")).toBe(true); // 500 / 200
    expect(points[1]!.value.eq(1000)).toBe(true);
  });

  it("computes a money-weighted return", () => {
    const flat = series([
      ["2024-01-01", 100],
      ["2025-01-01", 110],
    ]);
    const { moneyWeightedReturn } = replayDca({
      flows: [{ date: new Date("2024-01-01T00:00:00Z"), amount: D(1000) }],
      benchmark: [{ prices: flat, weight: D(1) }],
      to: "2025-01-01",
    });
    // 1000 → 1100 over ~1 year ≈ 10% (366 days in 2024, so slightly under)
    expect(moneyWeightedReturn).not.toBeNull();
    expect(moneyWeightedReturn!).toBeGreaterThan(0.09);
    expect(moneyWeightedReturn!).toBeLessThan(0.105);
  });
});

describe("xirr", () => {
  it("solves the simple one-year 10% case", () => {
    const rate = xirr([
      { date: new Date("2020-01-01T00:00:00Z"), amount: D(-1000) },
      { date: new Date("2020-12-31T00:00:00Z"), amount: D(1100) },
    ]);
    expect(rate).not.toBeNull();
    expect(Math.abs(rate! - 0.1)).toBeLessThan(0.001);
  });

  it("returns null when all flows have the same sign", () => {
    expect(
      xirr([
        { date: new Date("2020-01-01T00:00:00Z"), amount: D(-1000) },
        { date: new Date("2020-06-01T00:00:00Z"), amount: D(-500) },
      ]),
    ).toBeNull();
  });

  it("handles negative returns", () => {
    const rate = xirr([
      { date: new Date("2020-01-01T00:00:00Z"), amount: D(-1000) },
      { date: new Date("2020-12-31T00:00:00Z"), amount: D(500) },
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeLessThan(-0.4);
    expect(rate!).toBeGreaterThan(-0.6);
  });
});

describe("xirr — short-span guard", () => {
  it("returns null when all flows land within ~a day (annualization is noise)", () => {
    expect(
      xirr([
        { date: new Date("2026-07-13T16:00:00Z"), amount: D(-6300) },
        { date: new Date("2026-07-13T00:00:00Z"), amount: D(6306.4) },
      ]),
    ).toBeNull();
  });
});
