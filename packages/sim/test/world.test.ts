import { describe, expect, it } from "vitest";
import { fmtQty } from "../src/world";
import { book } from "./fixtures";

describe("PriceBook", () => {
  const b = book({ AAA: [["2026-01-02", 100], ["2026-01-05", 110], ["2026-01-09", 121]] });

  it("never returns a close after asOf (no lookahead)", () => {
    expect(b.closeAsOf("AAA", "2026-01-04")).toEqual({ date: "2026-01-02", close: 100 });
    expect(b.closeAsOf("AAA", "2026-01-08")?.close).toBe(110);
    expect(b.closeAsOf("AAA", "2026-01-01")).toBeNull();
    expect(b.window("AAA", "2026-01-06", 30).map((c) => c.date)).toEqual(["2026-01-02", "2026-01-05"]);
  });

  it("changePct compares against the close on/before the lookback date", () => {
    expect(b.changePct("AAA", "2026-01-09", 7)).toBeCloseTo(21);
    expect(b.changePct("AAA", "2026-01-02", 7)).toBeNull();
  });

  it("fmtQty trims trailing zeros at class precision", () => {
    expect(fmtQty(100, false)).toBe("100");
    expect(fmtQty(1.5, false)).toBe("1.5");
    expect(fmtQty(0.123456789, true)).toBe("0.12345679");
  });
});
