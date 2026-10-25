import { describe, expect, it } from "vitest";
import { canSpend, usageCostUsd } from "../src/budget";
import { percentile, rankThemes, type ThemeStats } from "../src/themes";

const t = (o: Partial<ThemeStats>): ThemeStats => ({
  key: "k", title: "", area: "ux", kind: "friction", status: "open",
  personas: 1, days: 1, recent: 1, avgSeverity: 2, maxSeverity: 2, ...o,
});

describe("rankThemes", () => {
  it("breadth across personas beats one loud persona", () => {
    const r = rankThemes([
      t({ key: "loud", personas: 1, days: 1, avgSeverity: 5, maxSeverity: 5 }),
      t({ key: "broad", personas: 4, days: 3, avgSeverity: 2, maxSeverity: 3 }),
    ]);
    expect(r.map((x) => x.key)).toEqual(["broad", "loud"]);
  });
  it("drops praise and wontfix", () => {
    expect(rankThemes([t({ kind: "praise" }), t({ key: "w", status: "wontfix" })])).toEqual([]);
  });
});

describe("percentile", () => {
  it("nearest-rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("budget", () => {
  it("prices usage per MTok", () => {
    expect(usageCostUsd("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 })).toBeCloseTo(3);
  });
  it("holds back the reserve for higher-priority work", () => {
    expect(canSpend(4.4, 0.12, 5)).toBe(true);
    expect(canSpend(4.4, 0.12, 5, 0.5)).toBe(false);
  });
});
