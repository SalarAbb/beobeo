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

  it("tolerates a weekend-sized trailing gap", () => {
    // Cache ends Friday 2024-05-31; request through Sunday 2024-06-02 → no fetch.
    expect(
      planFetch({ min: "2024-01-01", max: "2024-05-31" }, "2024-01-01", "2024-06-02"),
    ).toEqual([]);
    // But a week-old cache refetches the tail.
    expect(
      planFetch({ min: "2024-01-01", max: "2024-05-25" }, "2024-01-01", "2024-06-02"),
    ).toEqual([{ from: "2024-05-26", to: "2024-06-02" }]);
  });

  it("refetches equities once a weekday close is missing", () => {
    // Cache ends Tuesday 2026-10-27; on Friday 2026-10-30 Wednesday and
    // Thursday are missing (the old 4-day tolerance served Tuesday's close).
    expect(
      planFetch({ min: "2026-01-02", max: "2026-10-27" }, "2026-01-02", "2026-10-30"),
    ).toEqual([{ from: "2026-10-28", to: "2026-10-30" }]);
    // Thursday's close in hand on Friday: today's may not be out yet.
    expect(
      planFetch({ min: "2026-01-02", max: "2026-10-29" }, "2026-01-02", "2026-10-30"),
    ).toEqual([]);
    // Friday's close on Monday: only the weekend in between.
    expect(
      planFetch({ min: "2026-01-02", max: "2026-10-30" }, "2026-01-02", "2026-11-02"),
    ).toEqual([]);
  });

  it("treats every day as a trading day for crypto", () => {
    expect(
      planFetch({ min: "2026-01-01", max: "2026-10-31" }, "2026-01-01", "2026-11-02", "daily"),
    ).toEqual([{ from: "2026-11-01", to: "2026-11-02" }]);
    expect(
      planFetch({ min: "2026-01-01", max: "2026-11-01" }, "2026-01-01", "2026-11-02", "daily"),
    ).toEqual([]);
  });
});
