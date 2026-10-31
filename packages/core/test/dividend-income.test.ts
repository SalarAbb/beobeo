import { describe, expect, it } from "vitest";
import { estimateDividendIncome } from "../src/dividend-income";

const AS_OF = "2026-10-30";

describe("estimateDividendIncome", () => {
  it("multiplies a trailing year of per-share payments by the units held now", () => {
    const est = estimateDividendIncome(
      [
        {
          key: "KO",
          quantity: "10",
          value: "700",
          costBasis: "600",
          payments: [
            // Exactly 365 days back: outside (asOf − 365, asOf].
            { date: "2025-10-30", amount: "0.51" },
            { date: "2025-11-28", amount: "0.51" },
            { date: "2026-03-13", amount: "0.51" },
            { date: "2026-06-13", amount: "0.51" },
            { date: "2026-09-15", amount: "0.51" },
            // After asOf: not known yet.
            { date: "2026-11-27", amount: "0.51" },
          ],
        },
        {
          // 2-for-1 on 2026-06-10: the March payment was per pre-split share,
          // so it counts 0.02 / 2 = 0.01 per share held now.
          key: "NVDA",
          quantity: "20",
          value: "3600",
          costBasis: "2000",
          payments: [
            { date: "2026-03-05", amount: "0.02" },
            { date: "2026-09-05", amount: "0.01" },
          ],
          splits: [{ date: "2026-06-10", ratio: "2" }],
        },
        { key: "VTI", quantity: "5", value: "1500", costBasis: "1400", payments: [] },
      ],
      AS_OF,
    );

    // KO: 4 × 0.51 = 2.04 a share × 10 = 20.40. NVDA: 0.02 × 20 = 0.40.
    expect(est.holdings).toEqual([
      {
        key: "KO",
        quantity: 10,
        perShareYearly: 2.04,
        paymentsPerYear: 4,
        yearlyUsd: 20.4,
        yieldOnValuePct: 2.91, // 20.40 / 700
        yieldOnCostPct: 3.4, // 20.40 / 600
        lastExDate: "2026-09-15",
        months: [3, 6, 9, 11],
      },
      {
        key: "NVDA",
        quantity: 20,
        perShareYearly: 0.02,
        paymentsPerYear: 2,
        yearlyUsd: 0.4,
        yieldOnValuePct: 0.01, // 0.40 / 3,600 = 0.0111%
        yieldOnCostPct: 0.02, // 0.40 / 2,000
        lastExDate: "2026-09-05",
        months: [3, 9],
      },
    ]);
    expect(est.noPayments).toEqual(["VTI"]);
    expect(est.yearlyUsd).toBe(20.8);
    expect(est.monthlyAverageUsd).toBe(1.73); // 20.80 / 12 = 1.7333
    // Over every holding passed in: 20.80 / 5,800 value, 20.80 / 4,000 cost.
    expect(est.yieldOnValuePct).toBe(0.36);
    expect(est.yieldOnCostPct).toBe(0.52);
    const months = Object.fromEntries(est.byMonth.map((m) => [m.month, m.usd]));
    expect(est.byMonth).toHaveLength(12);
    expect(months).toEqual({
      1: 0, 2: 0, 3: 5.3, 4: 0, 5: 0, 6: 5.1, 7: 0, 8: 0, 9: 5.3, 10: 0, 11: 5.1, 12: 0,
    });
  });

  it("leaves yield on value out when a holding is unpriced", () => {
    const est = estimateDividendIncome(
      [
        {
          key: "O",
          quantity: "3",
          value: null,
          costBasis: "300",
          payments: [{ date: "2026-01-15", amount: "1" }],
        },
      ],
      AS_OF,
    );
    expect(est.holdings[0]).toMatchObject({ yearlyUsd: 3, yieldOnValuePct: null, yieldOnCostPct: 1 });
    expect(est.yieldOnValuePct).toBeNull();
    expect(est.yieldOnCostPct).toBe(1);
  });

  it("counts a monthly payer's twelve payments", () => {
    const payments = Array.from({ length: 12 }, (_, i) => {
      const month = ((10 + i) % 12) + 1; // Nov 2025 … Oct 2026
      const year = month >= 11 ? 2025 : 2026;
      return { date: `${year}-${String(month).padStart(2, "0")}-01`, amount: "0.25" };
    });
    const est = estimateDividendIncome(
      [{ key: "O", quantity: "100", value: "6000", costBasis: "5500", payments }],
      AS_OF,
    );
    expect(est.holdings[0]).toMatchObject({ paymentsPerYear: 12, perShareYearly: 3, yearlyUsd: 300 });
    expect(est.monthlyAverageUsd).toBe(25);
    expect(est.byMonth.every((m) => m.usd === 25)).toBe(true);
    expect(est.yieldOnValuePct).toBe(5);
  });
});
