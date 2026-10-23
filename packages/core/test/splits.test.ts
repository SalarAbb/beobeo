import { describe, expect, it } from "vitest";
import { D, type IsoDate } from "../src/types";
import type { PriceSeries } from "../src/timeseries";
import { adjustForSplits, splitFactorAfter } from "../src/splits";

const series = (entries: [IsoDate, number][]): PriceSeries =>
  new Map(entries.map(([d, v]) => [d, D(v)]));

describe("adjustForSplits", () => {
  it("returns the series unchanged when there are no splits", () => {
    const prices = series([["2024-01-02", 100]]);
    expect(adjustForSplits(prices, [])).toBe(prices);
  });

  it("divides closes strictly before a 4-for-1 split; on/after unchanged", () => {
    // 400 pre-split = 100 in present-day units; split-date close is already post-split.
    const prices = series([
      ["2024-06-07", 400],
      ["2024-06-10", 101], // split effective this date
      ["2024-06-11", 102],
    ]);
    const adjusted = adjustForSplits(prices, [{ date: "2024-06-10", ratio: 4 }]);
    expect(adjusted.get("2024-06-07")!.toNumber()).toBe(100);
    expect(adjusted.get("2024-06-10")!.toNumber()).toBe(101);
    expect(adjusted.get("2024-06-11")!.toNumber()).toBe(102);
  });

  it("compounds multiple splits (2-for-1 then 3-for-1 → ÷6 before both)", () => {
    // 600 before both splits → 600/2/3 = 100; 90 between them → 90/3 = 30.
    const prices = series([
      ["2023-01-05", 600],
      ["2023-06-05", 90], // after the 2:1 (2023-03-01), before the 3:1 (2024-01-10)
      ["2024-02-05", 31],
    ]);
    const adjusted = adjustForSplits(prices, [
      { date: "2023-03-01", ratio: 2 },
      { date: "2024-01-10", ratio: 3 },
    ]);
    expect(adjusted.get("2023-01-05")!.toNumber()).toBe(100);
    expect(adjusted.get("2023-06-05")!.toNumber()).toBe(30);
    expect(adjusted.get("2024-02-05")!.toNumber()).toBe(31);
  });

  it("handles reverse splits (1-for-4, ratio 0.25 → pre-split closes ×4)", () => {
    // 5 pre-reverse-split = 5/0.25 = 20 in present-day units.
    const prices = series([
      ["2025-02-03", 5],
      ["2025-02-10", 21],
    ]);
    const adjusted = adjustForSplits(prices, [{ date: "2025-02-10", ratio: "0.25" }]);
    expect(adjusted.get("2025-02-03")!.toNumber()).toBe(20);
    expect(adjusted.get("2025-02-10")!.toNumber()).toBe(21);
  });
});

describe("splitFactorAfter", () => {
  it("compounds only splits strictly after the date", () => {
    const splits = [
      { date: "2023-03-01", ratio: 2 },
      { date: "2024-01-10", ratio: 3 },
    ];
    expect(splitFactorAfter(splits, "2023-01-05").toNumber()).toBe(6);
    expect(splitFactorAfter(splits, "2023-03-01").toNumber()).toBe(3); // on-date excluded
    expect(splitFactorAfter(splits, "2024-01-10").toNumber()).toBe(1);
  });
});
