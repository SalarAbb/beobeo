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

  it("matches a date-only export against the same trade stored with its time (same qty and price)", () => {
    // Found by a persona mission: a Robinhood export reads 10/7/2026 as local midnight (07:00Z);
    // the account had the trade at 20:00Z. 13h apart, same quantity and price → the same trade.
    const existing = [row({ assetId: "vxus", quantity: "12.388166", pricePerUnit: "84.7934", tradedAt: new Date("2026-10-07T20:00:00Z") })];
    const incoming = [row({ assetId: "vxus", quantity: "12.388166", pricePerUnit: "84.79", tradedAt: new Date("2026-10-07T07:00:00Z") })];
    expect(splitDuplicates(incoming, existing).duplicates).toHaveLength(1);
  });

  it("does not stretch the window when there's no price to confirm (transfers)", () => {
    const existing = [row({ type: "transfer_in", pricePerUnit: null })];
    expect(splitDuplicates([row({ type: "transfer_in", pricePerUnit: null, tradedAt: new Date("2020-09-14T01:07:59Z") })], existing).duplicates).toHaveLength(1);
    expect(splitDuplicates([row({ type: "transfer_in", pricePerUnit: null, tradedAt: new Date("2020-09-14T05:00:00Z") })], existing).fresh).toHaveLength(1);
  });

  it("keeps the same quantity on a different day at a different price (a real repeat buy)", () => {
    const existing = [row({ quantity: "10", pricePerUnit: "100" })];
    expect(splitDuplicates([row({ quantity: "10", pricePerUnit: "103.50", tradedAt: new Date("2020-09-15T01:07:00Z") })], existing).fresh).toHaveLength(1);
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
