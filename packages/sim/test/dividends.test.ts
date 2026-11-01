import { describe, expect, it } from "vitest";
import type { DividendFill } from "../src/dividends";
import { Holdings } from "../src/holdings";
import { emptyPolicyState } from "../src/policy";
import { replayPolicy } from "../src/run";
import { book, persona, weekdays } from "./fixtures";

describe("dividends in the replay", () => {
  it("pays on the units held the morning of the ex-date, not that day's buy, rounded to the cent", () => {
    // $100 of AAA at $50 every Monday: 2 units on Jan 5, 4 by Jan 12.
    const p = persona([{ kind: "dca", symbol: "AAA", amountUsd: 100, every: "week", day: 1, account: "Brokerage" }]);
    const closes = weekdays("2026-01-05", 14, () => 50);
    const paid: DividendFill[] = [];
    const divs = new Map([["AAA", new Map([["2026-01-05", 0.5], ["2026-01-09", 0.3333], ["2026-01-12", 0.25]])]]);
    replayPolicy(p, new Holdings(), book({ AAA: closes }), emptyPolicyState(), "2026-01-04", "2026-01-16", { book: divs, paid });
    expect(paid).toEqual([
      // Jan 5: nothing held before that morning's first buy.
      { date: "2026-01-09", account: "Brokerage", symbol: "AAA", cash: 0.67 }, // 2 × 0.3333
      { date: "2026-01-12", account: "Brokerage", symbol: "AAA", cash: 0.5 }, // 2 × 0.25, before the Jan 12 buy
    ]);
  });
});
