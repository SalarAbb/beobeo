import { describe, expect, it } from "vitest";
import { coinbaseImporter } from "../src/coinbase";
import { deltaImporter } from "../src/delta";
import { detectImporter } from "../src/detect";
import { parseGenericCsv } from "../src/generic";
import { robinhoodImporter } from "../src/robinhood";
import { cleanNumber } from "../src/types";

const ROBINHOOD_CSV = `Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount
3/1/2024,3/1/2024,3/4/2024,AAPL,Apple Inc,Buy,10,$180.50,($1805.00)
6/1/2024,6/1/2024,6/3/2024,AAPL,Apple Inc,Sell,5,$195.00,$975.00
2/14/2025,2/14/2025,2/14/2025,AAPL,Apple Dividend,CDIV,,,$24.75
1/5/2024,1/5/2024,1/5/2024,,ACH Deposit,ACH,,,$500.00`;

const COINBASE_CSV = `Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes
2024-01-29T14:00:00Z,Buy,BTC,0.25,USD,43850.00,10962.50,10974.50,12.00,Bought 0.25 BTC
2024-10-21T09:30:00Z,Send,BTC,0.05,USD,67420.00,,,,Sent to cold wallet
2025-03-05T16:45:00Z,Sell,BTC,0.1,USD,94100.00,9410.00,9396.00,14.00,Sold 0.1 BTC`;

describe("cleanNumber", () => {
  it("strips currency formatting and handles parenthesised negatives", () => {
    expect(cleanNumber("$1,805.00")).toBe("1805.00");
    expect(cleanNumber("($1805.00)")).toBe("-1805.00");
    expect(cleanNumber("-42.5")).toBe("-42.5");
    expect(cleanNumber("")).toBeNull();
    expect(cleanNumber("N/A")).toBeNull();
  });
});

describe("robinhoodImporter", () => {
  it("parses buys, sells, and dividends; skips cash rows", () => {
    const result = robinhoodImporter.parse(ROBINHOOD_CSV);
    expect(result.issues).toEqual([]);
    expect(result.skipped).toBe(1); // the ACH row
    expect(result.transactions).toHaveLength(3);

    const [buy, sell, div] = result.transactions;
    expect(buy).toMatchObject({
      symbol: "AAPL",
      type: "buy",
      quantity: "10",
      pricePerUnit: "180.50",
    });
    expect(sell).toMatchObject({ type: "sell", quantity: "5", pricePerUnit: "195.00" });
    expect(div).toMatchObject({ type: "dividend", quantity: "1", pricePerUnit: "24.75" });
  });
});

describe("coinbaseImporter", () => {
  it("parses buys/sells with fees and maps Send to transfer_out", () => {
    const result = coinbaseImporter.parse(COINBASE_CSV);
    expect(result.issues).toEqual([]);
    expect(result.transactions).toHaveLength(3);

    const [buy, send, sell] = result.transactions;
    expect(buy).toMatchObject({
      symbol: "BTC",
      assetClass: "crypto",
      type: "buy",
      quantity: "0.25",
      pricePerUnit: "43850.00",
      fees: "12.00",
    });
    expect(send).toMatchObject({ type: "transfer_out", quantity: "0.05" });
    expect(sell).toMatchObject({ type: "sell", fees: "14.00" });
  });

  it("tolerates preamble lines before the header", () => {
    const withPreamble = `You can use this file...\n\n${COINBASE_CSV}`;
    const result = coinbaseImporter.parse(withPreamble);
    expect(result.transactions).toHaveLength(3);
  });
});

describe("detectImporter", () => {
  it("detects Robinhood and Coinbase exports", () => {
    expect(detectImporter(ROBINHOOD_CSV)?.id).toBe("robinhood");
    expect(detectImporter(COINBASE_CSV)?.id).toBe("coinbase");
    expect(detectImporter("a,b,c\n1,2,3")).toBeNull();
  });
});

describe("parseGenericCsv", () => {
  it("maps arbitrary columns via a user mapping", () => {
    const csv = `Date,Ticker,Action,Shares,Cost,Commission
2024-05-01,VOO,Bought,5,471.80,1.00
2024-06-01,VOO,Sold,2,480.00,
2024-07-01,VOO,Staked,1,480.00,`;
    const result = parseGenericCsv(csv, {
      dateColumn: "Date",
      symbolColumn: "Ticker",
      typeColumn: "Action",
      quantityColumn: "Shares",
      priceColumn: "Cost",
      feesColumn: "Commission",
    });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      symbol: "VOO",
      type: "buy",
      quantity: "5",
      pricePerUnit: "471.80",
      fees: "1.00",
    });
    expect(result.issues).toHaveLength(1); // unknown "Staked" action
    expect(result.issues[0]!.message).toContain("Staked".toLowerCase());
  });
});

describe("parseGenericCsv — AI-mapping extensions", () => {
  const DELTA_CSV = `Date,Way,Symbol,Asset type,Amount,Price per unit,Fee,Notes
2024-03-01 14:22:05,BUY,AAPL,Stock,10,180.50,1.00,
2024-02-10 03:45:12,BUY,BTC,Crypto,0.5,48000,10,dca buy
2024-04-15 12:00:00,DEPOSIT,USD,Fiat,1000,,,
2024-09-01 10:00:00,TRANSFER_OUT,BTC,Crypto,0.1,,,to ledger`;

  it("applies classMap via assetClassColumn and skips skipTypes rows", () => {
    const result = parseGenericCsv(DELTA_CSV, {
      dateColumn: "Date",
      symbolColumn: "Symbol",
      typeColumn: "Way",
      quantityColumn: "Amount",
      priceColumn: "Price per unit",
      feesColumn: "Fee",
      noteColumn: "Notes",
      assetClassColumn: "Asset type",
      classMap: { stock: "stock", crypto: "crypto" },
      typeMap: { transfer_out: "transfer_out" },
      skipTypes: ["deposit"],
    });
    expect(result.issues).toEqual([]);
    expect(result.skipped).toBe(1); // the USD deposit
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[0]).toMatchObject({
      symbol: "AAPL",
      assetClass: "stock",
      type: "buy",
      fees: "1.00",
    });
    expect(result.transactions[1]).toMatchObject({
      symbol: "BTC",
      assetClass: "crypto",
      quantity: "0.5",
    });
    expect(result.transactions[2]).toMatchObject({
      type: "transfer_out",
      assetClass: "crypto",
      note: "to ledger",
    });
  });
});

describe("deltaImporter", () => {
  // Header + row shapes from a real Delta Investment Tracker export.
  const DELTA_EXPORT = `"Date","Way","Base amount","Base currency (name)","Base type","Quote amount","Quote currency","Exchange","Sent/Received from","Sent to","Fee amount","Fee currency (name)","Broker","Notes","Sync Base Holding","Leverage Metadata"
"2020-09-14T01:07:00.000Z","BUY",32.71,"LINK (ChainLink)","CRYPTO",391.2116,"USD","DGA",,,,,,,false,
"2023-08-01T00:54:00.000Z","BUY",62,"AAPL (Apple Inc)","STOCK",7664.44,"USD","Nasdaq",,,,,,,false,
"2024-04-27T01:24:13.000Z","DEPOSIT",9678,"USD (United States dollar)","FIAT",,,,"OTHER","MY_WALLET",,,"",,false,
"2025-02-04T02:19:00.000Z","SELL",62,"AAPL (Apple Inc)","STOCK",14372.84,"USD","Nasdaq",,,2.5,"USD (United States dollar)",,,false,
"2025-06-01T02:00:00.000Z","WITHDRAW",2544.15,"USD (United States dollar)","FIAT",,,,,,,,,,false,
"2024-08-01T01:00:00.000Z","BUY",15,"VTI (Vanguard Total Stock Market ETF)","FUND",4100.25,"USD","NYSE",,,,,,,false,`;

  it("auto-detects and parses the real Delta layout", () => {
    expect(detectImporter(DELTA_EXPORT)?.id).toBe("delta");
    const result = deltaImporter.parse(DELTA_EXPORT);
    expect(result.issues).toEqual([]);
    expect(result.skipped).toBe(2); // fiat DEPOSIT + WITHDRAW
    expect(result.transactions).toHaveLength(4);

    const [link, aaplBuy, aaplSell, vti] = result.transactions;
    // price derived from total: 391.2116 / 32.71 = 11.96
    expect(link).toMatchObject({ symbol: "LINK", assetClass: "crypto", type: "buy" });
    expect(Number(link!.pricePerUnit)).toBeCloseTo(11.96, 2);
    expect(aaplBuy).toMatchObject({ symbol: "AAPL", assetClass: "stock" });
    expect(Number(aaplBuy!.pricePerUnit)).toBeCloseTo(123.62, 2);
    expect(aaplSell).toMatchObject({ type: "sell", fees: "2.5" });
    expect(Number(aaplSell!.pricePerUnit)).toBeCloseTo(231.82, 2);
    expect(vti).toMatchObject({ symbol: "VTI", assetClass: "fund" });
  });
});
