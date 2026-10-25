import { describe, expect, it } from "vitest";
import { Holdings } from "../src/holdings";
import { cadencePeriod, emptyPolicyState } from "../src/policy";
import { replayPolicy } from "../src/run";
import { fmtQty } from "../src/world";
import { book, persona, weekdays } from "./fixtures";

describe("cadencePeriod", () => {
  it("weekly fires on/after the trigger weekday, keyed by ISO week", () => {
    // 2026-01-05 is a Monday, ISO week 2.
    expect(cadencePeriod("2026-01-05", "week", 1)).toEqual({ key: "2026-W2", due: true });
    expect(cadencePeriod("2026-01-06", "week", 3).due).toBe(false); // Tue < Wed
    expect(cadencePeriod("2026-01-08", "week", 3)).toEqual({ key: "2026-W2", due: true });
  });
  it("monthly is due from the trigger day on; quarterly only in the quarter's first month", () => {
    expect(cadencePeriod("2026-03-02", "month", 3).due).toBe(false);
    expect(cadencePeriod("2026-03-04", "month", 3)).toEqual({ key: "2026-3", due: true });
    expect(cadencePeriod("2026-04-12", "quarter", 10)).toEqual({ key: "2026-Q2", due: true });
    expect(cadencePeriod("2026-05-12", "quarter", 10).due).toBe(false);
  });
});

describe("replayPolicy", () => {
  it("weekly DCA buys exactly once per week, on the first trading day >= trigger", () => {
    const p = persona([{ kind: "dca", symbol: "AAA", amountUsd: 100, every: "week", day: 1, account: "Brokerage" }]);
    // Jan 5 2026 (Mon) .. Jan 25: 3 weeks; Monday Jan 19 is a "holiday" (no close).
    const closes = weekdays("2026-01-05", 21, () => 50).filter(([d]) => d !== "2026-01-19");
    const fills = replayPolicy(p, new Holdings(), book({ AAA: closes }), emptyPolicyState(), "2026-01-04", "2026-01-25");
    expect(fills.map((f) => f.date)).toEqual(["2026-01-05", "2026-01-12", "2026-01-20"]);
    expect(fills[0]!.qty).toBeCloseTo(2);
  });

  it("dip_buy fires when the lookback drop is reached, then respects the cooldown", () => {
    const p = persona([{ kind: "dip_buy", symbols: ["AAA"], dropPct: 10, lookbackDays: 7, amountUsd: 90, cooldownDays: 10, account: "Brokerage" }]);
    // 100 flat, then falls to 85 from Jan 12 on.
    const closes = weekdays("2026-01-01", 25, (i) => (i >= 11 ? 85 : 100));
    const fills = replayPolicy(p, new Holdings(), book({ AAA: closes }), emptyPolicyState(), "2026-01-01", "2026-01-25");
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ date: "2026-01-12", type: "buy", price: 85 });
  });

  it("harvest sells the whole losing position and rebuys the substitute with the proceeds", () => {
    const p = persona([{ kind: "harvest", symbols: ["AAA"], lossPct: 10, substitutes: { AAA: "BBB" }, cooldownDays: 30, account: "Brokerage" }]);
    const h = new Holdings();
    h.apply({ type: "buy", account: "Brokerage", symbol: "AAA", qty: 10, price: 100 });
    const b = book({ AAA: [["2026-01-05", 95], ["2026-01-06", 88]], BBB: [["2026-01-05", 40], ["2026-01-06", 44]] });
    const fills = replayPolicy(p, h, b, emptyPolicyState(), "2026-01-04", "2026-01-06");
    expect(fills.map((f) => [f.date, f.type, f.symbol])).toEqual([
      ["2026-01-06", "sell", "AAA"],
      ["2026-01-06", "buy", "BBB"],
    ]);
    expect(fills[1]!.qty).toBeCloseTo((10 * 88) / 44);
    expect(h.get("Brokerage", "AAA")!.qty).toBe(0);
  });

  it("rebalance funds the underweight sleeve first", () => {
    const p = persona([{ kind: "rebalance", targets: { AAA: 0.5, BBB: 0.5 }, amountUsd: 100, every: "month", day: 1, account: "Brokerage" }]);
    const h = new Holdings();
    h.apply({ type: "buy", account: "Brokerage", symbol: "AAA", qty: 3, price: 100 }); // $300 AAA, $0 BBB
    const b = book({ AAA: [["2026-02-02", 100]], BBB: [["2026-02-02", 10]] });
    const fills = replayPolicy(p, h, b, emptyPolicyState(), "2026-02-01", "2026-02-02");
    // Post-contribution total $400 → each target $200; only BBB is short → all $100 goes to BBB.
    expect(fills.map((f) => [f.symbol, Math.round(f.qty * f.price)])).toEqual([["BBB", 100]]);
  });

  it("lump buys once, split by target weight, on the first trading day on/after its date", () => {
    const p = persona([{ kind: "lump", on: "2026-02-01", targets: { AAA: 0.6, BBB: 0.4 }, amountUsd: 1000, account: "Brokerage" }]);
    const b = book({ AAA: [["2026-02-02", 100], ["2026-02-03", 100]], BBB: [["2026-02-02", 10], ["2026-02-03", 10]] });
    const fills = replayPolicy(p, new Holdings(), b, emptyPolicyState(), "2026-01-30", "2026-02-03");
    expect(fills.map((f) => [f.date, f.symbol, Math.round(f.qty * f.price), f.reason])).toEqual([
      ["2026-02-02", "AAA", 600, "lump"],
      ["2026-02-02", "BBB", 400, "lump"],
    ]);
  });

  it("withdraw sells the overweight sleeve first, once per period", () => {
    const p = persona([{ kind: "withdraw", targets: { AAA: 0.5, BBB: 0.5 }, amountUsd: 100, every: "month", day: 1, account: "Brokerage" }]);
    const h = new Holdings();
    h.apply({ type: "buy", account: "Brokerage", symbol: "AAA", qty: 6, price: 100 }); // $600
    h.apply({ type: "buy", account: "Brokerage", symbol: "BBB", qty: 40, price: 10 }); // $400
    const b = book({ AAA: [["2026-02-02", 100], ["2026-02-03", 100]], BBB: [["2026-02-02", 10], ["2026-02-03", 10]] });
    const fills = replayPolicy(p, h, b, emptyPolicyState(), "2026-02-01", "2026-02-03");
    // Post-withdrawal total $900 → targets $450 each; AAA is $150 over, BBB $0 → all $100 from AAA.
    expect(fills.map((f) => [f.date, f.type, f.symbol, Math.round(f.qty * f.price)])).toEqual([["2026-02-02", "sell", "AAA", 100]]);
  });

  it("withdraw never asks for more than the account holds", () => {
    const p = persona([{ kind: "withdraw", targets: { AAA: 1 }, amountUsd: 500, every: "month", day: 1, account: "Brokerage" }]);
    const h = new Holdings();
    h.apply({ type: "buy", account: "Brokerage", symbol: "AAA", qty: 2, price: 100 });
    const fills = replayPolicy(p, h, book({ AAA: [["2026-02-02", 100]] }), emptyPolicyState(), "2026-02-01", "2026-02-02");
    expect(fills.map((f) => f.qty)).toEqual([2]);
    expect(h.get("Brokerage", "AAA")!.qty).toBe(0);
  });

  it("a full sell equals the exact sum of the rounded buys sent to the app (no 1e-6 oversell)", () => {
    const h = new Holdings(() => 6);
    const micros = (q: number) => BigInt(fmtQty(q, false).replace(".", "").padEnd(1, "0")) * 10n ** BigInt(6 - (fmtQty(q, false).split(".")[1]?.length ?? 0));
    let bought = 0n;
    for (const usd of [250, 250, 250, 333.33, 97.1]) bought += micros(h.apply({ type: "buy", account: "A", symbol: "X", qty: usd / 613.37, price: 613.37 })!.qty);
    const sold = micros(h.apply({ type: "sell", account: "A", symbol: "X", qty: h.get("A", "X")!.qty, price: 600 })!.qty);
    expect(sold).toBe(bought);
    expect(h.get("A", "X")!.qty).toBe(0);
  });

  it("never lets a sell exceed holdings", () => {
    const h = new Holdings();
    h.apply({ type: "buy", account: "A", symbol: "X", qty: 2, price: 10 });
    expect(h.apply({ type: "sell", account: "A", symbol: "X", qty: 5, price: 10 })!.qty).toBe(2);
    expect(h.apply({ type: "sell", account: "A", symbol: "X", qty: 1, price: 10 })).toBeNull();
  });
});
