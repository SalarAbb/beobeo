import { describe, expect, it } from "vitest";
import { projectGrowth } from "../src/projection";

describe("projectGrowth", () => {
  it("at 0% just adds the deposits, and finds the month a target is reached", () => {
    // 1,000 + 100/month: 2,200 after a year, 3,400 after two; 2,000 = month 10.
    const p = projectGrowth({ startValue: 1000, monthly: 100, yearlyReturnPct: 0, years: 2, target: 2000 });
    expect(p.yearly).toEqual([
      { year: 1, value: 2200, putIn: 1200 },
      { year: 2, value: 3400, putIn: 2400 },
    ]);
    expect(p.endValue).toBe(3400);
    expect(p.putIn).toBe(2400);
    expect(p.growth).toBe(0);
    expect(p.targetInMonths).toBe(10);
    expect(p.runsOutInMonths).toBeNull();
  });

  it("compounds monthly to exactly the yearly rate", () => {
    // 10,000 at 12%: 11,200 after one year, 12,544 after two.
    const p = projectGrowth({ startValue: 10_000, monthly: 0, yearlyReturnPct: 12, years: 2 });
    expect(p.yearly[0]!.value).toBeCloseTo(11_200, 6);
    expect(p.endValue).toBeCloseTo(12_544, 6);
    expect(p.growth).toBeCloseTo(2_544, 6);
  });

  it("deposits made through the year earn part of a year", () => {
    // 100 at each month's end at 12%/yr: r = 1.12^(1/12) − 1 = 0.0094888,
    // future value = 100 × ((1+r)^12 − 1) / r = 100 × 0.12 / 0.0094888 = 1,264.65.
    const p = projectGrowth({ startValue: 0, monthly: 100, yearlyReturnPct: 12, years: 1 });
    expect(p.endValue).toBeCloseTo(1264.65, 1);
    expect(p.putIn).toBe(1200);
  });

  it("withdrawals run it out; the last one only takes what's left", () => {
    // 1,250 − 100/month at 0%: 50 left after month 12, empty in month 13.
    const p = projectGrowth({ startValue: 1250, monthly: -100, yearlyReturnPct: 0, years: 2 });
    expect(p.runsOutInMonths).toBe(13);
    expect(p.yearly).toEqual([
      { year: 1, value: 50, putIn: -1200 },
      { year: 2, value: 0, putIn: -1250 },
    ]);
    expect(p.endValue).toBe(0);
    expect(p.growth).toBe(0);
  });

  it("finds the run-out month past the horizon", () => {
    // 3,000 − 100/month at 0% lasts 30 months, beyond a 1-year horizon.
    const p = projectGrowth({ startValue: 3000, monthly: -100, yearlyReturnPct: 0, years: 1 });
    expect(p.endValue).toBe(1800);
    expect(p.runsOutInMonths).toBe(30);
  });

  it("a bad start replaces the first years' returns", () => {
    // −50% then 10%, 10%: 1,000 × 0.5 × 1.1 × 1.1 = 605.
    const p = projectGrowth({
      startValue: 1000,
      monthly: 0,
      yearlyReturnPct: 10,
      years: 3,
      firstYearsPct: [-50],
    });
    expect(p.yearly[0]!.value).toBeCloseTo(500, 6);
    expect(p.endValue).toBeCloseTo(605, 6);
  });

  it("raises the monthly amount once a year", () => {
    // 100/month in year 1, 110/month in year 2 at 0%: 1,200 + 1,320 = 2,520.
    const p = projectGrowth({ startValue: 0, monthly: 100, yearlyReturnPct: 0, years: 2, yearlyRaisePct: 10 });
    expect(p.endValue).toBeCloseTo(2520, 6);
    expect(p.putIn).toBeCloseTo(2520, 6);
  });

  it("a target already met is month 0; one never met is null", () => {
    expect(projectGrowth({ startValue: 5000, monthly: 0, yearlyReturnPct: 5, years: 1, target: 4000 }).targetInMonths).toBe(0);
    expect(projectGrowth({ startValue: 100, monthly: 0, yearlyReturnPct: 0, years: 1, target: 200 }).targetInMonths).toBeNull();
  });
});
