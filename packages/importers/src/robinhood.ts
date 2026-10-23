import { parseCsv } from "./parse";
import {
  cleanNumber,
  type CsvImporter,
  type ImportTransactionType,
  type ParseResult,
} from "./types";

/**
 * Robinhood account-activity export.
 * Columns: Activity Date, Process Date, Settle Date, Instrument, Description,
 *          Trans Code, Quantity, Price, Amount
 */
const TRANS_CODES: Record<string, ImportTransactionType> = {
  buy: "buy",
  sell: "sell",
  cdiv: "dividend",
  spl: "split",
  rec: "transfer_in",
};

export const robinhoodImporter: CsvImporter = {
  id: "robinhood",
  label: "Robinhood",

  matches(headers) {
    return (
      headers.includes("Activity Date") &&
      headers.includes("Trans Code") &&
      headers.includes("Instrument")
    );
  },

  parse(csvText): ParseResult {
    const { rows } = parseCsv(csvText);
    const result: ParseResult = { transactions: [], issues: [], skipped: 0 };

    rows.forEach((row, i) => {
      const rowNum = i + 1;
      const code = row["Trans Code"]?.trim().toLowerCase() ?? "";
      const type = TRANS_CODES[code];
      if (!type) {
        // Cash movements (ACH, INT, GOLD…) aren't asset transactions.
        result.skipped++;
        return;
      }

      const symbol = row["Instrument"]?.trim().toUpperCase();
      if (!symbol) {
        result.issues.push({ row: rowNum, message: "missing instrument" });
        return;
      }

      const tradedAt = new Date(row["Activity Date"] ?? "");
      if (Number.isNaN(tradedAt.getTime())) {
        result.issues.push({ row: rowNum, message: "invalid Activity Date" });
        return;
      }

      if (type === "dividend") {
        const amount = cleanNumber(row["Amount"]);
        if (!amount) {
          result.issues.push({ row: rowNum, message: "dividend missing Amount" });
          return;
        }
        result.transactions.push({
          symbol,
          assetClass: "stock",
          type,
          quantity: "1",
          pricePerUnit: amount.replace(/^-/, ""),
          fees: "0",
          tradedAt,
          raw: row,
        });
        return;
      }

      const quantity = cleanNumber(row["Quantity"]);
      if (!quantity || Number(quantity) <= 0) {
        result.issues.push({ row: rowNum, message: "invalid quantity" });
        return;
      }

      const price = cleanNumber(row["Price"]);
      if ((type === "buy" || type === "sell") && !price) {
        result.issues.push({ row: rowNum, message: "missing price" });
        return;
      }

      result.transactions.push({
        symbol,
        assetClass: "stock",
        type,
        quantity,
        pricePerUnit: price,
        fees: "0",
        tradedAt,
        raw: row,
      });
    });

    return result;
  },
};
