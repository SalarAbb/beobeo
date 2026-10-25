import { describe, expect, it } from "vitest";
import { splitDuplicates, type DedupeRow } from "../src/dedupe";

const row = (o: Partial<DedupeRow> = {}): DedupeRow => ({
  accountId: "acc",
  assetId: "link",
  type: "buy",
  quantity: "32.71",
  pricePerUnit: "11.96",
  fees: "0",
  tradedAt: new Date("2020-09-14T01:07:00Z"),
  ...o,
});

describe("splitDuplicates", () => {
  it("skips a row already in the account, even with padded DB numerics", () => {
    const existing = [row({ quantity: "32.710000000000000000", pricePerUnit: "11.9600000000", fees: "0.0000000000" })];
    const { fresh, duplicates } = splitDuplicates([row()], existing);
    expect(fresh).toHaveLength(0);
    expect(duplicates).toHaveLength(1);
  });

  it("tolerates up to a minute of timestamp drift, not more", () => {
    const existing = [row()];
    expect(splitDuplicates([row({ tradedAt: new Date("2020-09-14T01:07:59Z") })], existing).duplicates).toHaveLength(1);
    expect(splitDuplicates([row({ tradedAt: new Date("2020-09-14T01:08:01Z") })], existing).fresh).toHaveLength(1);
  });

  it("keeps same-day fills that differ in price or quantity (real separate trades)", () => {
    // From a real export: 80 DRAM at $39.99 and 80 DRAM at $40.60, 11 minutes apart.
    const existing = [row({ assetId: "dram", quantity: "80", pricePerUnit: "39.99", tradedAt: new Date("2026-05-01T13:50:40Z") })];
    const incoming = [row({ assetId: "dram", quantity: "80", pricePerUnit: "40.6", tradedAt: new Date("2026-05-01T14:01:40Z") })];
    expect(splitDuplicates(incoming, existing).fresh).toHaveLength(1);
    expect(splitDuplicates([row({ quantity: "32.72" })], [row()]).fresh).toHaveLength(1);
  });

  it("never matches across accounts, assets or transaction types", () => {
    const { fresh } = splitDuplicates([row({ accountId: "other" }), row({ assetId: "btc" }), row({ type: "sell" })], [row()]);
    expect(fresh).toHaveLength(3);
  });

  it("matches one-to-one: two identical fills against one existing row keep one", () => {
    const { fresh, duplicates } = splitDuplicates([row(), row()], [row()]);
    expect(duplicates).toHaveLength(1);
    expect(fresh).toHaveLength(1);
  });
});
