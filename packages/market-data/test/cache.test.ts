import { describe, expect, it } from "vitest";
import { planFetch } from "../src/cache";

describe("planFetch", () => {
  it("fetches the full range when the cache is empty", () => {
    expect(planFetch(null, "2024-01-01", "2024-06-01")).toEqual([
      { from: "2024-01-01", to: "2024-06-01" },
    ]);
  });

  it("fetches nothing when the cache covers the range", () => {
    expect(
      planFetch({ min: "2023-01-01", max: "2024-06-01" }, "2024-01-01", "2024-06-01"),
    ).toEqual([]);
  });

  it("fetches only the leading gap", () => {
    expect(
      planFetch({ min: "2024-03-01", max: "2024-06-01" }, "2024-01-01", "2024-06-01"),
    ).toEqual([{ from: "2024-01-01", to: "2024-02-29" }]);
  });

  it("fetches only the trailing gap", () => {
    expect(
      planFetch({ min: "2023-01-01", max: "2024-03-01" }, "2024-01-01", "2024-06-01"),
    ).toEqual([{ from: "2024-03-02", to: "2024-06-01" }]);
  });

  it("fetches both gaps when the cache covers the middle", () => {
    expect(
      planFetch({ min: "2024-02-01", max: "2024-04-01" }, "2024-01-01", "2024-06-01"),
    ).toEqual([
      { from: "2024-01-01", to: "2024-01-31" },
      { from: "2024-04-02", to: "2024-06-01" },
    ]);
  });

  it("tolerates a weekend-sized trailing gap (staleDays)", () => {
    // Cache ends Friday 2024-05-31; request through Sunday 2024-06-02 → no fetch.
    expect(
      planFetch({ min: "2024-01-01", max: "2024-05-31" }, "2024-01-01", "2024-06-02"),
    ).toEqual([]);
    // But a week-old cache refetches the tail.
    expect(
      planFetch({ min: "2024-01-01", max: "2024-05-25" }, "2024-01-01", "2024-06-02"),
    ).toEqual([{ from: "2024-05-26", to: "2024-06-02" }]);
  });
});
