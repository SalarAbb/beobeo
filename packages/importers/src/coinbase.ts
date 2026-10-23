import { parseCsv } from "./parse";
import {
  cleanNumber,
  type CsvImporter,
  type ImportTransactionType,
  type ParseResult,
} from "./types";

/**
 * Coinbase transactions export.
 * Columns: Timestamp, Transaction Type, Asset, Quantity Transacted,
 *          Spot Price Currency, Spot Price at Transaction, Subtotal,
 *          Total (inclusive of fees and/or spread), Fees and/or Spread, Notes
 */
const TYPES: Record<string, ImportTransactionType> = {
  buy: "buy",
  "advance trade buy": "buy",
  sell: "sell",
  "advance trade sell": "sell",
  receive: "transfer_in",
  send: "transfer_out",
  "staking income": "dividend",
  "rewards income": "dividend",
  "learning reward": "dividend",
};

export const coinbaseImporter: CsvImporter = {
  id: "coinbase",
  label: "Coinbase",

  matches(headers) {
    return (
      headers.includes("Transaction Type") &&
      headers.includes("Quantity Transacted") &&
      headers.some((h) => h.startsWith("Spot Price"))
    );
  },

  parse(csvText): ParseResult {
    // Coinbase exports sometimes carry preamble lines before the header.
    const lines = csvText.split("\n");
    const headerIdx = lines.findIndex((l) => l.includes("Transaction Type"));
    const body = headerIdx > 0 ? lines.slice(headerIdx).join("\n") : csvText;

    const { rows } = parseCsv(body);
    const result: ParseResult = { transactions: [], issues: [], skipped: 0 };

    rows.forEach((row, i) => {
      const rowNum = i + 1;
      const rawType = row["Transaction Type"]?.trim().toLowerCase() ?? "";
      const type = TYPES[rawType];
      if (!type) {
        result.skipped++;
        return;
      }

      const symbol = row["Asset"]?.trim().toUpperCase();
      if (!symbol) {
        result.issues.push({ row: rowNum, message: "missing asset" });
        return;
      }

      const tradedAt = new Date(row["Timestamp"] ?? "");
      if (Number.isNaN(tradedAt.getTime())) {
        result.issues.push({ row: rowNum, message: "invalid timestamp" });
        return;
      }

      if (type === "dividend") {
        const qty = cleanNumber(row["Quantity Transacted"]);
        const spot = cleanNumber(row["Spot Price at Transaction"]);
        if (!qty || !spot) {
          result.issues.push({ row: rowNum, message: "reward row missing quantity/spot price" });
          return;
        }
        result.transactions.push({
          symbol,
          assetClass: "crypto",
          type,
          quantity: qty,
          pricePerUnit: spot,
          fees: "0",
          tradedAt,
          raw: row,
        });
        return;
      }

      const quantity = cleanNumber(row["Quantity Transacted"]);
      if (!quantity || Number(quantity) <= 0) {
        result.issues.push({ row: rowNum, message: "invalid quantity" });
        return;
      }

      const spot = cleanNumber(row["Spot Price at Transaction"]);
      if ((type === "buy" || type === "sell") && !spot) {
        result.issues.push({ row: rowNum, message: "missing spot price" });
        return;
      }

      const fees = cleanNumber(row["Fees and/or Spread"]) ?? "0";

      result.transactions.push({
        symbol,
        assetClass: "crypto",
        type,
        quantity,
        pricePerUnit: spot,
        fees: fees.replace(/^-/, ""),
        tradedAt,
        note: row["Notes"]?.trim() || undefined,
        raw: row,
      });
    });

    return result;
  },
};
