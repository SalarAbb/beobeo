import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@beobeo/db", () => ({
  db: {},
  schema: { assetSplits: { assetId: "asset_id", date: "date", ratio: "ratio" } },
}));
const { MarketDataService } = await import("../src/service");

/** A db whose `select().from().orderBy()` answers with the given rows and
 *  counts how many times it was asked. */
function fakeDb(rows: { assetId: string; date: string; ratio: string }[]) {
  const reads = { n: 0 };
  const db = {
    select: () => ({
      from: () => ({
        orderBy: async () => {
          reads.n++;
          return rows;
        },
      }),
    }),
  };
  return { db, reads };
}

describe("MarketDataService.getSplits", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 10, 2, 15) }));
  afterEach(() => vi.useRealTimers());

  it("reads the table once and answers each asset from memory", async () => {
    const { db, reads } = fakeDb([
      { assetId: "nvda", date: "2021-07-20", ratio: "4" },
      { assetId: "nvda", date: "2024-06-10", ratio: "10" },
      { assetId: "aapl", date: "2020-08-31", ratio: "4" },
    ]);
    const svc = new MarketDataService(db as never, {});
    const [a, b] = await Promise.all([svc.getSplits(["nvda", "voo"]), svc.getSplits(["aapl"])]);
    expect(a).toEqual(
      new Map([
        [
          "nvda",
          [
            { date: "2021-07-20", ratio: "4" },
            { date: "2024-06-10", ratio: "10" },
          ],
        ],
      ]),
    );
    expect(b.get("aapl")).toEqual([{ date: "2020-08-31", ratio: "4" }]);
    expect(reads.n).toBe(1);

    // A caller changing its copy doesn't change the next answer.
    a.get("nvda")![0]!.ratio = "999";
    expect((await svc.getSplits(["nvda"])).get("nvda")![0]!.ratio).toBe("4");
    expect(reads.n).toBe(1);
  });

  it("reads it again after 10 minutes", async () => {
    const { db, reads } = fakeDb([]);
    const svc = new MarketDataService(db as never, {});
    await svc.getSplits(["nvda"]);
    vi.setSystemTime(Date.now() + 9 * 60_000);
    await svc.getSplits(["nvda"]);
    expect(reads.n).toBe(1);
    vi.setSystemTime(Date.now() + 2 * 60_000);
    await svc.getSplits(["nvda"]);
    expect(reads.n).toBe(2);
  });

  it("asks again after a failed read", async () => {
    let fail = true;
    const db = {
      select: () => ({
        from: () => ({
          orderBy: async () => {
            if (fail) throw new Error("db down");
            return [{ assetId: "nvda", date: "2024-06-10", ratio: "10" }];
          },
        }),
      }),
    };
    const svc = new MarketDataService(db as never, {});
    await expect(svc.getSplits(["nvda"])).rejects.toThrow("db down");
    fail = false;
    expect((await svc.getSplits(["nvda"])).get("nvda")).toHaveLength(1);
  });
});
