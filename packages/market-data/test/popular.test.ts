import { describe, expect, it } from "vitest";
import { searchPopular } from "../src/popular";

describe("searchPopular", () => {
  it("matches famous tickers instantly by symbol prefix", () => {
    const results = searchPopular("META");
    expect(results[0]).toMatchObject({ symbol: "META", class: "stock" });
  });

  it("matches by company name substring, symbol matches ranked first", () => {
    const results = searchPopular("meta");
    expect(results[0]!.symbol).toBe("META");
    const apple = searchPopular("apple");
    expect(apple.some((r) => r.symbol === "AAPL")).toBe(true);
  });

  it("matches crypto with providerRef", () => {
    const results = searchPopular("bitcoin");
    expect(results[0]).toMatchObject({ symbol: "BTC", providerRef: "bitcoin" });
  });

  it("returns nothing for empty or nonsense queries", () => {
    expect(searchPopular("")).toEqual([]);
    expect(searchPopular("zzzznotathing")).toEqual([]);
  });

  it("never returns duplicate symbol+class pairs", () => {
    for (const q of ["m", "a", "v", "co"]) {
      const results = searchPopular(q);
      const keys = results.map((r) => `${r.symbol}:${r.class}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
