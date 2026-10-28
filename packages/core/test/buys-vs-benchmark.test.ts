import { describe, expect, it } from "vitest";
import { buysVsBenchmark } from "../src/buys-vs-benchmark";
import type { PriceSeries } from "../src/timeseries";
import { D } from "../src/types";
import { txn } from "./helpers";

const series = (entries: [string, number][]): PriceSeries =>
  new Map(entries.map(([d, p]) => [d, D(p)]));

// Benchmark: 100 → 125 over the window; 2024-03-02 is a closed day.
const bench = series([
  ["2024-01-02", 100],
  ["2024-02-01", 80],
  ["2024-03-01", 110],
  ["2024-03-04", 120],
  ["2024-06-03", 125],
]);

describe("buysVsBenchmark", () => {
  it("values each buy now against the same dollars in the benchmark, worst first", () => {
    const rows = buysVsBenchmark(
      [
        // $1,005 at 100 → benchmark 10.05 units × 125 = $1,256.25; 10 × $90 = $900; edge −356.25
        txn({ type: "buy", qty: 10, price: 100, fees: 5, at: "2024-01-02", assetId: "A", id: "a1" }),
        // $400 at 80 → 5 units × 125 = $625; 4 × $90 = $360; edge −265
        txn({ type: "buy", qty: 4, price: 100, at: "2024-02-01", assetId: "A", id: "a2" }),
        // $500 at 120 → 4.1666… × 125 = $520.8333…; 10 × $60 = $600; edge +79.1666…
        txn({ type: "buy", qty: 10, price: 50, at: "2024-03-04", assetId: "B", id: "b1" }),
        txn({ type: "sell", qty: 2, price: 95, at: "2024-04-01", assetId: "A" }),
        txn({ type: "dividend", qty: 1, price: 12, at: "2024-05-01", assetId: "A" }),
      ],
      new Map([
        ["A", D(90)],
        ["B", D(60)],
      ]),
      bench,
    );
    expect(rows.map((r) => r.txnId)).toEqual(["a1", "a2", "b1"]);
    expect(rows[0]!.cost.toNumber()).toBe(1005);
    expect(rows[0]!.valueNow!.toNumber()).toBe(900);
    expect(rows[0]!.benchmarkValueNow!.toNumber()).toBe(1256.25);
    expect(rows[0]!.edge!.toNumber()).toBe(-356.25);
    expect(rows[1]!.edge!.toNumber()).toBe(-265);
    expect(rows[2]!.benchmarkValueNow!.toFixed(4)).toBe("520.8333");
    expect(rows[2]!.edge!.toFixed(4)).toBe("79.1667");
  });

  it("buys on a closed day at the next close, and scales units by later splits only", () => {
    const rows = buysVsBenchmark(
      [
        // Bought Saturday 03-02 → benchmark fills at 03-04's 120: $600 → 5 units × 125 = $625
        txn({ type: "buy", qty: 3, price: 200, at: "2024-03-02", assetId: "A", id: "before" }),
        txn({ type: "split", qty: 2, at: "2024-04-01", assetId: "A" }),
        // After the split: not scaled. $300 at 125 → $300 in the benchmark
        txn({ type: "buy", qty: 3, price: 100, at: "2024-06-03", assetId: "A", id: "after" }),
      ],
      new Map([["A", D(105)]]),
      bench,
    );
    const before = rows.find((r) => r.txnId === "before")!;
    const after = rows.find((r) => r.txnId === "after")!;
    expect(before.unitsNow.toNumber()).toBe(6);
    expect(before.valueNow!.toNumber()).toBe(630);
    expect(before.benchmarkValueNow!.toNumber()).toBe(625);
    expect(before.edge!.toNumber()).toBe(5);
    expect(after.unitsNow.toNumber()).toBe(3);
    expect(after.edge!.toNumber()).toBe(15);
  });

  it("sorts buys without a price last, with a null edge", () => {
    const rows = buysVsBenchmark(
      [
        txn({ type: "buy", qty: 1, price: 10, at: "2024-01-02", assetId: "NOPRICE", id: "n" }),
        txn({ type: "buy", qty: 1, price: 100, at: "2024-01-02", assetId: "A", id: "a" }),
      ],
      new Map([["A", D(100)]]),
      bench,
    );
    expect(rows.map((r) => r.txnId)).toEqual(["a", "n"]);
    expect(rows[1]!.valueNow).toBeNull();
    expect(rows[1]!.edge).toBeNull();
    // $100 at 100 → 1 unit × 125 = 125; held $100 → edge −25
    expect(rows[0]!.edge!.toNumber()).toBe(-25);
  });
});
