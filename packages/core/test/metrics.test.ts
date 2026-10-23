import { describe, expect, it } from "vitest";
import type { IsoDate } from "../src/types";
import {
  annualize,
  bestWorstDay,
  chainReturns,
  currentDrawdown,
  dailyReturns,
  maxDrawdown,
  sharpe,
  valueDrawdown,
  volatility,
  type DailyReturn,
  type MetricSeriesPoint,
} from "../src/metrics";

const point = (
  date: string,
  value: number,
  invested: number,
): MetricSeriesPoint => ({ date: date as IsoDate, value, invested });

const rs = (values: number[]): DailyReturn[] =>
  values.map((r, i) => ({
    date: `2024-01-${String(i + 2).padStart(2, "0")}` as IsoDate,
    r,
  }));

describe("dailyReturns", () => {
  it("adjusts for a mid-series deposit (the canonical TWR case)", () => {
    // Day 2: +10% on 100. Day 3: deposit 100 at open, then 210 → 220 (+4.7619%).
    // Day 4: 220 → 200 (−9.0909%). Naive return is (200−200)/200 = 0%, but the
    // *investments* compounded to 1.1 × 220/210 × 200/220 − 1 = 22/21 − 1.
    const series = [
      point("2024-01-02", 100, 100),
      point("2024-01-03", 110, 100),
      point("2024-01-04", 220, 200),
      point("2024-01-05", 200, 200),
    ];
    const returns = dailyReturns(series);
    expect(returns).toHaveLength(3);
    expect(returns[0]!.r).toBeCloseTo(0.1, 12);
    expect(returns[1]!.r).toBeCloseTo(220 / 210 - 1, 12);
    expect(returns[2]!.r).toBeCloseTo(200 / 220 - 1, 12);
    // TWR = 22/21 − 1 ≈ +4.7619% even though naive P/L is exactly 0.
    expect(chainReturns(returns)).toBeCloseTo(22 / 21 - 1, 12);
  });

  it("skips days with no capital at risk (denominator ≤ 0)", () => {
    // Day 2 fully cashes out at open (flow −100 against value 100): no base.
    const series = [
      point("2024-01-02", 100, 100),
      point("2024-01-03", 0, 0),
      point("2024-01-04", 0, 0),
    ];
    expect(dailyReturns(series)).toHaveLength(0);
  });

  it("returns empty for empty and single-point series", () => {
    expect(dailyReturns([])).toHaveLength(0);
    expect(dailyReturns([point("2024-01-02", 100, 100)])).toHaveLength(0);
  });

  it("drops artifact days: extreme implied move on a flow-dominated day", () => {
    // Day 2 deposits 100 (dominates the prior 100 of value) but value only
    // reaches 110 — implied r = 110/200 − 1 = −45%: a valuation mismatch
    // (e.g. the bought asset has no cached close yet), not a market move.
    const series = [
      point("2024-01-02", 100, 100),
      point("2024-01-03", 110, 200),
      point("2024-01-04", 115.5, 200), // clean +5% day afterwards
    ];
    const returns = dailyReturns(series);
    expect(returns).toHaveLength(1);
    expect(returns[0]!.date).toBe("2024-01-04");
    expect(returns[0]!.r).toBeCloseTo(0.05, 12);
  });

  it("keeps a normal-sized return on a flow-dominated day", () => {
    // Same big deposit, but the value tracks it: r = 210/200 − 1 = +5%.
    const series = [
      point("2024-01-02", 100, 100),
      point("2024-01-03", 210, 200),
    ];
    const returns = dailyReturns(series);
    expect(returns).toHaveLength(1);
    expect(returns[0]!.r).toBeCloseTo(0.05, 12);
  });

  it("keeps a genuine crash on a day without large flows", () => {
    // −45% with zero flow = a real market move; must survive the guard.
    const series = [
      point("2024-01-02", 100, 100),
      point("2024-01-03", 55, 100),
    ];
    const returns = dailyReturns(series);
    expect(returns).toHaveLength(1);
    expect(returns[0]!.r).toBeCloseTo(-0.45, 12);
  });
});

describe("annualize", () => {
  it("is the identity over exactly one year", () => {
    expect(annualize(0.1, 365)).toBeCloseTo(0.1, 12);
  });

  it("compounds a half-year gain: (1.1)^2 − 1 over 182.5 days", () => {
    expect(annualize(0.1, 182.5)).toBeCloseTo(1.1 * 1.1 - 1, 12);
  });

  it("refuses spans under 2 days (same guard as xirr)", () => {
    expect(annualize(0.001, 1)).toBeNull();
  });

  it("refuses total losses (cumulative ≤ −1)", () => {
    expect(annualize(-1, 365)).toBeNull();
  });
});

describe("maxDrawdown", () => {
  it("finds the worst peak-to-trough decline", () => {
    // Index: 1.10 → 0.88 → 0.924. Peak 1.10; trough 0.88 → −20%.
    expect(maxDrawdown(rs([0.1, -0.2, 0.05]))).toBeCloseTo(-0.2, 12);
  });

  it("is 0 for a monotonic rise", () => {
    expect(maxDrawdown(rs([0.01, 0.02, 0.03]))).toBe(0);
  });

  it("compounds consecutive losses from the running peak", () => {
    // Index: 1.10 → 0.99 → 0.891; peak 1.10 → trough 0.891 → −19%.
    expect(maxDrawdown(rs([0.1, -0.1, -0.1]))).toBeCloseTo(0.891 / 1.1 - 1, 12);
  });
});

describe("currentDrawdown", () => {
  it("measures the final distance below the running peak", () => {
    // Index: 1.10 → 0.88 → 0.924. Peak 1.10 → ends at 0.924/1.10 − 1 = −16%.
    expect(currentDrawdown(rs([0.1, -0.2, 0.05]))).toBeCloseTo(
      0.924 / 1.1 - 1,
      12,
    );
  });

  it("is 0 when the series ends at an all-time high", () => {
    expect(currentDrawdown(rs([0.1, -0.05, 0.2]))).toBeCloseTo(0, 12);
  });

  it("differs from maxDrawdown after a partial recovery", () => {
    // Trough was −20% (maxDrawdown) but the series recovered half of it.
    const returns = rs([0.1, -0.2, 0.1]);
    expect(maxDrawdown(returns)).toBeCloseTo(-0.2, 12);
    expect(currentDrawdown(returns)).toBeCloseTo(0.968 / 1.1 - 1, 12);
  });
});

describe("volatility", () => {
  it("hand-computed stdev × √252, dropping zero-fill days (unweighted)", () => {
    // Non-zero returns: [0.01, −0.01, 0.02, −0.02, 0.01], mean 0.002.
    // Squared deviations: 64e-6 + 144e-6 + 324e-6 + 484e-6 + 64e-6 = 1080e-6.
    // Population variance = 1080e-6/5 = 2.16e-4.
    const returns = rs([0.01, -0.01, 0.02, 0, 0, -0.02, 0.01]);
    expect(volatility(returns)).toBeCloseTo(
      Math.sqrt(2.16e-4) * Math.sqrt(252),
      10,
    );
  });

  it("weights by capital at risk: tiny wild days can't dominate big calm ones", () => {
    // Two wild ±40% days on $100; four calm ±1% days on $10,000.
    // Weighted mean = 0. Weighted variance =
    // (100·0.16·2 + 10000·0.0001·4) / 40200 = 36/40200 ≈ 8.9552e-4.
    const returns: DailyReturn[] = [
      { date: "2024-01-02" as IsoDate, r: 0.4, base: 100 },
      { date: "2024-01-03" as IsoDate, r: -0.4, base: 100 },
      { date: "2024-01-04" as IsoDate, r: 0.01, base: 10000 },
      { date: "2024-01-05" as IsoDate, r: -0.01, base: 10000 },
      { date: "2024-01-06" as IsoDate, r: 0.01, base: 10000 },
      { date: "2024-01-07" as IsoDate, r: -0.01, base: 10000 },
    ];
    expect(volatility(returns)).toBeCloseTo(
      Math.sqrt(36 / 40200) * Math.sqrt(252),
      10,
    );
    // Unweighted, the same returns would read ~3.7 (370%) — the weighting
    // is what keeps a $100-era from defining a $10k portfolio's risk.
    expect(volatility(returns)!).toBeLessThan(0.5);
  });

  it("is null with fewer than 5 non-zero observations", () => {
    expect(volatility(rs([0.01, 0.02, 0, 0, -0.01, 0.03]))).toBeNull();
  });
});

describe("sharpe", () => {
  it("equals (annualized weighted mean − rf) / weighted volatility", () => {
    const returns = rs([0.02, -0.01, 0.01, 0.03, -0.02]);
    // Unweighted (no bases): mean 0.006; population variance =
    // (0.014² + 0.016² + 0.004² + 0.024² + 0.026²)/5 = 1.72e-3/5 = 3.44e-4.
    const annual = Math.pow(1.006, 252) - 1;
    const vol = Math.sqrt(3.44e-4) * Math.sqrt(252);
    expect(sharpe(returns, 0.045)).toBeCloseTo((annual - 0.045) / vol, 10);
  });

  it("is null when volatility is zero (constant returns)", () => {
    expect(sharpe(rs([0.01, 0.01, 0.01, 0.01, 0.01]), 0.045)).toBeNull();
  });

  it("is null for empty input", () => {
    expect(sharpe([], 0.045)).toBeNull();
  });
});

describe("valueDrawdown", () => {
  it("tracks the dollar peak: max and current drawdown", () => {
    // Values 100 → 120 → 90 → 110: peak 120, trough 90 (−25%), now −8.33%.
    const series = [
      point("2024-01-02", 100, 100),
      point("2024-01-03", 120, 100),
      point("2024-01-04", 90, 100),
      point("2024-01-05", 110, 100),
    ];
    const dd = valueDrawdown(series)!;
    expect(dd.max).toBeCloseTo(90 / 120 - 1, 12);
    expect(dd.current).toBeCloseTo(110 / 120 - 1, 12);
  });

  it("is 0/0 at an all-time high and skips leading zero-value days", () => {
    const series = [
      point("2024-01-02", 0, 0),
      point("2024-01-03", 100, 100),
      point("2024-01-04", 150, 100),
    ];
    const dd = valueDrawdown(series)!;
    expect(dd.max).toBe(0);
    expect(dd.current).toBe(0);
  });

  it("is null when the series never has value", () => {
    expect(valueDrawdown([point("2024-01-02", 0, 0)])).toBeNull();
  });
});

describe("bestWorstDay", () => {
  it("picks extremes among non-zero days", () => {
    const returns = rs([0.01, -0.03, 0, 0.05, -0.01]);
    const result = bestWorstDay(returns)!;
    expect(result.best.r).toBeCloseTo(0.05, 12);
    expect(result.best.date).toBe("2024-01-05");
    expect(result.worst.r).toBeCloseTo(-0.03, 12);
    expect(result.worst.date).toBe("2024-01-03");
  });

  it("is null when every day is a zero-fill day", () => {
    expect(bestWorstDay(rs([0, 0, 0]))).toBeNull();
  });
});
