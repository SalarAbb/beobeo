import { describe, expect, it } from "vitest";
import { buildLots, buildLotsByAccount, isLongTerm } from "../src/lots";
import { positionFromLots } from "../src/position";
import { realizedByYear } from "../src/realized";
import { D, EngineError } from "../src/types";
import { txn } from "./helpers";

const dec = (v: string | number) => D(v);

describe("buildLots — FIFO matching", () => {
  it("matches a sell across two lots FIFO with proportional fees", () => {
    const result = buildLots([
      txn({ type: "buy", qty: 10, price: 100, fees: 5, at: "2024-01-01" }),
      txn({ type: "buy", qty: 10, price: 120, at: "2024-02-01" }),
      txn({ type: "sell", qty: 15, price: 150, fees: 10, at: "2024-03-01" }),
    ]);

    // Net proceeds: 15×150 − 10 = 2240
    expect(result.realized).toHaveLength(2);

    const [first, second] = result.realized;
    // Slice 1: all 10 units of lot 1 (basis 1005), proceeds 2240 × 10/15
    expect(first!.quantity.eq(10)).toBe(true);
    expect(first!.costBasis.eq(1005)).toBe(true);
    expect(first!.proceeds.sub(dec(2240).mul(10).div(15)).abs().lt("1e-30")).toBe(true);

    // Slice 2: 5 of 10 units of lot 2 (basis 600), proceeds 2240 × 5/15
    expect(second!.quantity.eq(5)).toBe(true);
    expect(second!.costBasis.eq(600)).toBe(true);

    // Total realized gain: 2240 − (1005 + 600) = 635
    const totalGain = result.realized.reduce(
      (s, g) => s.add(g.gain),
      dec(0),
    );
    expect(totalGain.sub(635).abs().lt("1e-30")).toBe(true);

    // Remaining: 5 units of lot 2, basis 600
    expect(result.openLots).toHaveLength(1);
    expect(result.openLots[0]!.quantity.eq(5)).toBe(true);
    expect(result.openLots[0]!.costBasis.eq(600)).toBe(true);
  });

  it("rejects an oversell", () => {
    expect(() =>
      buildLots([
        txn({ type: "buy", qty: 5, price: 100, at: "2024-01-01" }),
        txn({ type: "sell", qty: 6, price: 100, at: "2024-02-01" }),
      ]),
    ).toThrowError(EngineError);
    try {
      buildLots([
        txn({ type: "buy", qty: 5, price: 100, at: "2024-01-01" }),
        txn({ type: "sell", qty: 6, price: 100, at: "2024-02-01" }),
      ]);
    } catch (e) {
      expect((e as EngineError).code).toBe("OVERSELL");
    }
  });

  it("rejects unsorted input", () => {
    expect(() =>
      buildLots([
        txn({ type: "buy", qty: 5, price: 100, at: "2024-02-01" }),
        txn({ type: "buy", qty: 5, price: 100, at: "2024-01-01" }),
      ]),
    ).toThrowError(/sorted/);
  });

  it("applies splits to quantity but not basis, preserving acquisition date", () => {
    const result = buildLots([
      txn({ type: "buy", qty: 10, price: 100, at: "2020-01-01" }),
      txn({ type: "split", qty: 4, at: "2020-06-01" }),
      txn({ type: "sell", qty: 40, price: 30, at: "2021-07-01" }),
    ]);
    expect(result.openLots).toHaveLength(0);
    expect(result.realized).toHaveLength(1);
    const gain = result.realized[0]!;
    // proceeds 1200 − basis 1000 = 200
    expect(gain.gain.eq(200)).toBe(true);
    // acquired 2020-01-01, sold 2021-07-01 → long-term despite the split
    expect(gain.longTerm).toBe(true);
  });

  it("handles reverse splits", () => {
    const result = buildLots([
      txn({ type: "buy", qty: 100, price: 1, at: "2024-01-01" }),
      txn({ type: "split", qty: "0.25", at: "2024-02-01" }),
    ]);
    expect(result.openLots[0]!.quantity.eq(25)).toBe(true);
    expect(result.openLots[0]!.costBasis.eq(100)).toBe(true);
  });

  it("treats transfer_in without a price as zero basis", () => {
    const result = buildLots([
      txn({ type: "transfer_in", qty: 2, price: null, at: "2024-01-01" }),
      txn({ type: "sell", qty: 2, price: 500, at: "2024-02-01" }),
    ]);
    expect(result.realized[0]!.costBasis.eq(0)).toBe(true);
    expect(result.realized[0]!.gain.eq(1000)).toBe(true);
  });

  it("removes units on transfer_out without realizing gains", () => {
    const result = buildLots([
      txn({ type: "buy", qty: 10, price: 100, at: "2024-01-01" }),
      txn({ type: "transfer_out", qty: 4, price: null, at: "2024-02-01" }),
    ]);
    expect(result.realized).toHaveLength(0);
    expect(result.openLots[0]!.quantity.eq(6)).toBe(true);
    expect(result.openLots[0]!.costBasis.eq(600)).toBe(true);
  });

  it("accumulates dividend income net of fees", () => {
    const result = buildLots([
      txn({ type: "buy", qty: 10, price: 100, at: "2024-01-01" }),
      txn({ type: "dividend", qty: 1, price: 50, at: "2024-03-01" }),
      txn({ type: "dividend", qty: 1, price: 25, fees: 1, at: "2024-06-01" }),
    ]);
    expect(result.dividendIncome.eq(74)).toBe(true);
  });
});

describe("isLongTerm — one-year boundary", () => {
  it("is short-term at exactly one year, long-term one day later", () => {
    const acquired = new Date("2020-06-01T00:00:00Z");
    expect(isLongTerm(acquired, new Date("2021-06-01T00:00:00Z"))).toBe(false);
    expect(isLongTerm(acquired, new Date("2021-06-02T00:00:00Z"))).toBe(true);
  });
});

describe("realizedByYear", () => {
  it("groups gains into calendar-year buckets with short/long split", () => {
    const { realized } = buildLots([
      txn({ type: "buy", qty: 10, price: 100, at: "2020-01-01" }),
      txn({ type: "sell", qty: 5, price: 110, at: "2020-06-01" }),
      txn({ type: "sell", qty: 5, price: 130, at: "2021-06-01" }),
    ]);
    const years = realizedByYear(realized);
    expect(years).toHaveLength(2);

    const y2020 = years[0]!;
    expect(y2020.year).toBe(2020);
    expect(y2020.shortTerm.eq(50)).toBe(true);
    expect(y2020.longTerm.eq(0)).toBe(true);

    const y2021 = years[1]!;
    expect(y2021.year).toBe(2021);
    expect(y2021.shortTerm.eq(0)).toBe(true);
    expect(y2021.longTerm.eq(150)).toBe(true);
  });
});

describe("positionFromLots", () => {
  it("computes cost basis, market value, and unrealized P/L", () => {
    const { openLots } = buildLots([
      txn({ type: "buy", qty: 10, price: 100, fees: 10, at: "2024-01-01" }),
      txn({ type: "buy", qty: 10, price: 200, at: "2024-02-01" }),
    ]);
    const pos = positionFromLots(openLots, dec(180));
    expect(pos.quantity.eq(20)).toBe(true);
    expect(pos.costBasis.eq(3010)).toBe(true);
    expect(pos.avgCostPerUnit!.eq("150.5")).toBe(true);
    expect(pos.marketValue!.eq(3600)).toBe(true);
    expect(pos.unrealizedGain!.eq(590)).toBe(true);
  });

  it("handles an empty position", () => {
    const pos = positionFromLots([]);
    expect(pos.quantity.eq(0)).toBe(true);
    expect(pos.avgCostPerUnit).toBeNull();
  });
});

describe("buildLots — real-world import edge cases", () => {
  it("throws OVERSELL on mid-stream oversell even when totals balance", () => {
    // Partial exports often list a sell before the buys that covered it.
    expect(() =>
      buildLots([
        txn({ type: "buy", qty: 5, price: 100, at: "2024-01-01" }),
        txn({ type: "sell", qty: 10, price: 110, at: "2024-02-01" }),
        txn({ type: "buy", qty: 5, price: 100, at: "2024-03-01" }),
      ]),
    ).toThrowError(/OVERSELL|removes/);
  });

  it("keeps tiny residual positions from high-precision crypto quantities", () => {
    // e.g. Delta: bought 555.03 LINK total, sold 555 → 0.03 remains
    const { openLots } = buildLots([
      txn({ type: "buy", qty: "555.03", price: 10, at: "2024-01-01" }),
      txn({ type: "sell", qty: "555", price: 12, at: "2024-06-01" }),
    ]);
    expect(openLots[0]!.quantity.eq("0.03")).toBe(true);
  });
});

describe("buildLotsByAccount — a sale only uses its own account's purchases", () => {
  const inAcct = (accountId: string | undefined, t: ReturnType<typeof txn>) => ({ ...t, accountId });

  it("matches a taxable sale against the taxable lot, not the IRA's older one", () => {
    const txns = [
      inAcct("ira", txn({ type: "buy", qty: 10, price: 50, at: "2023-01-01" })),
      inAcct("taxable", txn({ type: "buy", qty: 10, price: 100, at: "2024-01-01" })),
      inAcct("taxable", txn({ type: "sell", qty: 5, price: 90, at: "2024-06-01" })),
    ];
    const r = buildLotsByAccount(txns);
    // Taxable: proceeds 5 × 90 = 450, basis 5 × 100 = 500 → −50, short-term.
    expect(r.realized).toHaveLength(1);
    expect(r.realized[0]!.gain.eq(-50)).toBe(true);
    expect(r.realized[0]!.longTerm).toBe(false);
    // Open: IRA 10 @ 50 = 500 (oldest first), taxable 5 left @ 100 = 500.
    expect(r.openLots.map((l) => l.quantity.toNumber())).toEqual([10, 5]);
    expect(r.openLots.map((l) => l.costBasis.toNumber())).toEqual([500, 500]);
    // One queue across accounts would have sold the IRA's $50 shares: 450 − 250 = +200, long-term.
    const pooled = buildLots(txns);
    expect(pooled.realized[0]!.gain.eq(200)).toBe(true);
    expect(pooled.realized[0]!.longTerm).toBe(true);
  });

  it("applies an account-less split to every account and sums dividends once", () => {
    const r = buildLotsByAccount([
      inAcct("ira", txn({ type: "buy", qty: 2, price: 100, at: "2024-01-01" })),
      inAcct("taxable", txn({ type: "buy", qty: 3, price: 100, at: "2024-02-01" })),
      inAcct(undefined, txn({ type: "split", qty: 2, at: "2024-03-01" })),
      inAcct("ira", txn({ type: "dividend", qty: 1, price: 10, at: "2024-03-15" })),
      inAcct("taxable", txn({ type: "dividend", qty: 1, price: 5, at: "2024-03-15" })),
      inAcct("taxable", txn({ type: "sell", qty: 6, price: 60, at: "2024-04-01" })),
    ]);
    // Taxable: 3 → 6 units after the split, basis 300; 6 × 60 = 360 → +60.
    expect(r.realized).toHaveLength(1);
    expect(r.realized[0]!.gain.eq(60)).toBe(true);
    // IRA: 2 → 4 units, basis 200.
    expect(r.openLots).toHaveLength(1);
    expect(r.openLots[0]!.quantity.eq(4)).toBe(true);
    expect(r.openLots[0]!.costBasis.eq(200)).toBe(true);
    expect(r.dividendIncome.eq(15)).toBe(true);
  });

  it("throws OVERSELL when an account sells shares only another account holds", () => {
    expect(() =>
      buildLotsByAccount([
        inAcct("ira", txn({ type: "buy", qty: 10, price: 50, at: "2024-01-01" })),
        inAcct("taxable", txn({ type: "sell", qty: 5, price: 60, at: "2024-02-01" })),
      ]),
    ).toThrowError(EngineError);
  });

  it("is buildLots when there's one account or none", () => {
    const txns = [
      txn({ type: "buy", qty: 10, price: 100, at: "2024-01-01" }),
      txn({ type: "sell", qty: 4, price: 120, at: "2024-02-01" }),
    ];
    // 4 × 120 = 480 − 4 × 100 = 80; 6 units left at $600.
    const b = buildLotsByAccount(txns.map((t) => inAcct("one", t)));
    expect(b.realized[0]!.gain.eq(80)).toBe(true);
    expect(buildLotsByAccount(txns).openLots[0]!.costBasis.eq(600)).toBe(true);
  });
});

describe("buildLots HIFO", () => {
  it("sells the highest cost per unit first and keeps open lots oldest first", () => {
    const r = buildLots(
      [
        txn({ type: "buy", qty: 10, price: 100, at: "2024-01-01" }),
        txn({ type: "buy", qty: 10, price: 150, at: "2024-02-01" }),
        txn({ type: "buy", qty: 10, price: 120, at: "2024-03-01" }),
        txn({ type: "sell", qty: 15, price: 200, at: "2025-03-01" }),
      ],
      "hifo",
    );
    // 10 @ 150: proceeds 2,000, basis 1,500, held > 1 year → long-term +500.
    // 5 @ 120: proceeds 1,000, basis 600, held exactly 1 year → short-term +400.
    expect(r.realized.map((g) => [g.quantity.toString(), g.costBasis.toString(), g.gain.toDecimalPlaces(2).toString(), g.longTerm])).toEqual([
      ["10", "1500", "500", true],
      ["5", "600", "400", false],
    ]);
    expect(r.openLots.map((l) => [l.quantity.toString(), l.costBasis.toString()])).toEqual([
      ["10", "1000"],
      ["5", "600"],
    ]);
  });

  it("applies each account's own method", () => {
    const a = (o: Parameters<typeof txn>[0], accountId: string) => ({
      ...txn(o),
      accountId,
      ...(accountId === "x" ? { lotMethod: "hifo" as const } : {}),
    });
    const r = buildLotsByAccount(
      [
        a({ type: "buy", qty: 1, price: 100, at: "2024-01-01" }, "x"),
        a({ type: "buy", qty: 1, price: 300, at: "2024-02-01" }, "x"),
        a({ type: "buy", qty: 1, price: 100, at: "2024-01-01" }, "y"),
        a({ type: "buy", qty: 1, price: 300, at: "2024-02-01" }, "y"),
        a({ type: "sell", qty: 1, price: 200, at: "2024-06-01" }, "x"),
        a({ type: "sell", qty: 1, price: 200, at: "2024-06-02" }, "y"),
      ],
    );
    // x (HIFO) sells the $300 one: −100. y (default FIFO) sells the $100 one: +100.
    expect(r.realized.map((g) => g.gain.toString())).toEqual(["-100", "100"]);
  });
});
