import { describe, expect, it } from "vitest";
import { D } from "../src/types";
import {
  detectWashSaleBlocks,
  isWashSaleExempt,
  type LossLotCandidate,
  type RecentBuyTxn,
} from "../src/tax-wash-sale";

const asOf = new Date("2026-06-15T00:00:00Z");

const lossLot = (over: Partial<LossLotCandidate> = {}): LossLotCandidate => ({
  lotId: "lot-1",
  assetId: "asset-eth",
  symbol: "ETH",
  lossUsd: D(1000),
  ...over,
});

const buy = (over: Partial<RecentBuyTxn> = {}): RecentBuyTxn => ({
  assetId: "asset-eth",
  accountId: "acct-taxable",
  accountName: "Fidelity Brokerage",
  isTaxAdvantaged: false,
  tradedAt: new Date("2026-06-03T00:00:00Z"), // 12 days before asOf
  likelyDividendReinvestment: false,
  ...over,
});

describe("detectWashSaleBlocks", () => {
  it("golden 2: a loss lot with a same-symbol buy 12 days prior is blocked, with a cited reason", () => {
    const blocks = detectWashSaleBlocks([lossLot()], [buy()], asOf);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.lotId).toBe("lot-1");
    expect(blocks[0]!.permanentlyDisallowed).toBe(false);
    expect(blocks[0]!.reason).toContain("12 days before this sale");
    expect(blocks[0]!.reason).toContain("Fidelity Brokerage");
  });

  it("golden 3: replacement bought in an IRA is permanently disallowed, no basis adjustment implied", () => {
    const blocks = detectWashSaleBlocks(
      [lossLot()],
      [buy({ accountName: "Schwab IRA", isTaxAdvantaged: true })],
      asOf,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.permanentlyDisallowed).toBe(true);
    expect(blocks[0]!.reason).toContain("PERMANENTLY disallowed");
    expect(blocks[0]!.reason).toContain("Rev. Rul. 2008-5");
    // The module performs no writes at all — nothing to assert against a DB;
    // confirm the block is purely descriptive data, not a mutation record.
    expect(blocks[0]).not.toHaveProperty("basisAdjustment");
  });

  it("cites the closest buy's units and dollars when given, null otherwise", () => {
    const blocks = detectWashSaleBlocks(
      [lossLot()],
      [
        buy({ tradedAt: new Date("2026-05-20T00:00:00Z"), quantity: D(9), amountUsd: D(900) }),
        buy({ quantity: D("0.5"), amountUsd: D("1612.40") }), // Jun 3, the closer one
      ],
      asOf,
    );
    expect(blocks[0]!.triggerQuantity?.toString()).toBe("0.5");
    expect(blocks[0]!.triggerAmountUsd?.toString()).toBe("1612.4");
    const bare = detectWashSaleBlocks([lossLot()], [buy()], asOf);
    expect(bare[0]!.triggerQuantity).toBeNull();
    expect(bare[0]!.triggerAmountUsd).toBeNull();
  });

  it("does not block a loss lot with no qualifying buy", () => {
    expect(detectWashSaleBlocks([lossLot()], [], asOf)).toHaveLength(0);
  });

  it("does not block a buy exactly 31 days prior (outside the window)", () => {
    const old = buy({ tradedAt: new Date("2026-05-15T00:00:00Z") }); // 31 days
    expect(detectWashSaleBlocks([lossLot()], [old], asOf)).toHaveLength(0);
  });

  it("does not block a buy of a different asset", () => {
    const other = buy({ assetId: "asset-btc" });
    expect(detectWashSaleBlocks([lossLot()], [other], asOf)).toHaveLength(0);
  });

  it("ignores buys in accounts irrelevant to the trigger only by asset match — cross-account still blocks", () => {
    // Cross-account detection is the value-add: sale in one account, buy in
    // another, still blocks.
    const crossAccount = buy({ accountId: "acct-other", accountName: "Robinhood" });
    const blocks = detectWashSaleBlocks([lossLot()], [crossAccount], asOf);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.triggerAccountName).toBe("Robinhood");
  });

  it("flags a likely dividend reinvestment in the reason text", () => {
    const drip = buy({ likelyDividendReinvestment: true });
    const blocks = detectWashSaleBlocks([lossLot()], [drip], asOf);
    expect(blocks[0]!.reason).toContain("dividend reinvestment");
  });

  it("cites the closest qualifying buy when multiple exist", () => {
    const far = buy({ tradedAt: new Date("2026-05-20T00:00:00Z"), accountName: "Far" });
    const close = buy({ tradedAt: new Date("2026-06-10T00:00:00Z"), accountName: "Close" });
    const blocks = detectWashSaleBlocks([lossLot()], [far, close], asOf);
    expect(blocks[0]!.triggerAccountName).toBe("Close");
  });
});

describe("crypto wash-sale exemption", () => {
  it("never blocks a crypto loss lot, even with a same-asset buy 12 days prior (IRA too)", () => {
    const crypto = lossLot({ assetClass: "crypto" });
    expect(detectWashSaleBlocks([crypto], [buy()], asOf)).toHaveLength(0);
    expect(
      detectWashSaleBlocks([crypto], [buy({ isTaxAdvantaged: true })], asOf),
    ).toHaveLength(0);
  });

  it("still blocks stocks and ETFs", () => {
    const stock = lossLot({ assetClass: "stock", assetId: "asset-eth" });
    const etf = lossLot({ lotId: "lot-2", assetClass: "etf" });
    expect(detectWashSaleBlocks([stock, etf], [buy()], asOf)).toHaveLength(2);
  });

  it("is configurable: an empty exempt list treats crypto as covered", () => {
    const crypto = lossLot({ assetClass: "crypto" });
    const blocks = detectWashSaleBlocks([crypto], [buy()], asOf, { exemptAssetClasses: [] });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.reason).toContain("12 days before this sale");
  });

  it("checks a candidate with no class (the conservative side)", () => {
    expect(isWashSaleExempt(undefined)).toBe(false);
    expect(isWashSaleExempt("crypto")).toBe(true);
    expect(isWashSaleExempt("etf")).toBe(false);
    expect(isWashSaleExempt("crypto", { exemptAssetClasses: ["fund"] })).toBe(false);
  });
});
