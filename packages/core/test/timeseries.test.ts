import { describe, expect, it } from "vitest";
import { portfolioTimeSeries, type PriceSeries } from "../src/timeseries";
import { D } from "../src/types";
import { txn } from "./helpers";

const series = (entries: [string, number][]): PriceSeries =>
  new Map(entries.map(([d, p]) => [d, D(p)]));

describe("portfolioTimeSeries", () => {
  it("values holdings daily with forward-filled prices", () => {
    const prices = new Map([
      ["A", series([["2024-01-01", 10], ["2024-01-03", 12]])],
      ["B", series([["2024-01-02", 100]])],
    ]);
    const points = portfolioTimeSeries({
      txns: [
        txn({ type: "buy", qty: 5, price: 10, at: "2024-01-01", assetId: "A" }),
        txn({ type: "buy", qty: 2, price: 100, at: "2024-01-02", assetId: "B" }),
      ],
      prices,
      to: "2024-01-04",
    });

    expect(points.map((p) => p.date)).toEqual([
      "2024-01-01",
      "2024-01-02",
      "2024-01-03",
      "2024-01-04",
    ]);
    // 01-01: 5×10 = 50
    expect(points[0]!.value.eq(50)).toBe(true);
    expect(points[0]!.invested.eq(50)).toBe(true);
    // 01-02: A forward-filled at 10 (50) + B 2×100 (200)
    expect(points[1]!.value.eq(250)).toBe(true);
    expect(points[1]!.invested.eq(250)).toBe(true);
    // 01-03: A at 12 (60) + B forward-filled (200)
    expect(points[2]!.value.eq(260)).toBe(true);
    // 01-04: both forward-filled
    expect(points[3]!.value.eq(260)).toBe(true);
    expect(points[3]!.invested.eq(250)).toBe(true);
  });

  it("applies splits to holdings without changing invested", () => {
    const prices = new Map([["A", series([["2024-01-01", 10], ["2024-01-03", 12]])]]);
    const points = portfolioTimeSeries({
      txns: [
        txn({ type: "buy", qty: 5, price: 10, at: "2024-01-01", assetId: "A" }),
        txn({ type: "split", qty: 2, at: "2024-01-03", assetId: "A" }),
      ],
      prices,
      to: "2024-01-03",
    });
    // After 2:1 split, 10 units × 12 = 120; invested still 50
    expect(points[2]!.value.eq(120)).toBe(true);
    expect(points[2]!.invested.eq(50)).toBe(true);
  });

  it("reduces holdings and invested on sells", () => {
    const prices = new Map([["A", series([["2024-01-01", 10]])]]);
    const points = portfolioTimeSeries({
      txns: [
        txn({ type: "buy", qty: 10, price: 10, at: "2024-01-01", assetId: "A" }),
        txn({ type: "sell", qty: 4, price: 10, fees: 2, at: "2024-01-02", assetId: "A" }),
      ],
      prices,
      to: "2024-01-02",
    });
    // 6 units × 10 = 60; invested = 100 − (40 − 2) = 62
    expect(points[1]!.value.eq(60)).toBe(true);
    expect(points[1]!.invested.eq(62)).toBe(true);
  });

  it("returns empty for no transactions", () => {
    expect(
      portfolioTimeSeries({ txns: [], prices: new Map(), to: "2024-01-01" }),
    ).toEqual([]);
  });
});

describe("portfolioTimeSeries — forward-fill seeding", () => {
  it("values a position opened today using the last close before the window", () => {
    const prices = new Map([
      // only closes BEFORE the first transaction (e.g. bought Monday pre-close)
      ["A", series([["2024-01-10", 95], ["2024-01-12", 100]])],
    ]);
    const points = portfolioTimeSeries({
      txns: [
        txn({ type: "buy", qty: 10, price: 101, at: "2024-01-15", assetId: "A" }),
      ],
      prices,
      to: "2024-01-15",
    });
    expect(points).toHaveLength(1);
    // Friday's close (100) seeds the value — not 0.
    expect(points[0]!.value.eq(1000)).toBe(true);
    expect(points[0]!.invested.eq(1010)).toBe(true);
  });
});

describe("portfolioTimeSeries — inconsistent data", () => {
  it("values oversold (negative) holdings at zero instead of negative", () => {
    const prices = new Map([["A", series([["2024-01-01", 10]])]]);
    const points = portfolioTimeSeries({
      txns: [
        txn({ type: "buy", qty: 5, price: 10, at: "2024-01-01", assetId: "A" }),
        txn({ type: "sell", qty: 8, price: 10, at: "2024-01-02", assetId: "A" }),
      ],
      prices,
      to: "2024-01-02",
    });
    // qty is -3 after the bad sell; chart shows 0, never negative value
    expect(points[1]!.value.gte(0)).toBe(true);
  });
});
