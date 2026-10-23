import { parseCsv } from "./parse";
import {
  cleanNumber,
  type CsvImporter,
  type ImportTransactionType,
  type ParseResult,
} from "./types";

/**
 * Delta Investment Tracker export.
 * Columns: Date, Way, Base amount, Base currency (name), Base type,
 *          Quote amount, Quote currency, Exchange, Sent/Received from,
 *          Sent to, Fee amount, Fee currency (name), Broker, Notes, …
 *
 * Notable: there is NO per-unit price column — "Quote amount" is the total
 * cash value, so price = quote / base. Symbols arrive as "LINK (ChainLink)".
 * FIAT rows are cash movements, not asset transactions.
 */
const WAYS: Record<string, ImportTransactionType> = {
  buy: "buy",
  sell: "sell",
  deposit: "transfer_in",
  receive: "transfer_in",
  transfer_in: "transfer_in",
  withdraw: "transfer_out",
  send: "transfer_out",
  transfer_out: "transfer_out",
  dividend: "dividend",
  staking: "dividend",
  interest: "dividend",
  reward: "dividend",
  airdrop: "transfer_in",
};

const CLASSES: Record<string, "stock" | "etf" | "fund" | "crypto"> = {
  crypto: "crypto",
  stock: "stock",
  etf: "etf",
  fund: "fund",
};

/** "LINK (ChainLink)" → { symbol: "LINK", name: "ChainLink" } */
const extractAsset = (
  raw: string | undefined,
): { symbol: string; name?: string } | null => {
  const symbol = raw?.split("(")[0]?.trim().toUpperCase();
  if (!symbol) return null;
  const name = raw?.match(/\(([^)]+)\)/)?.[1]?.trim();
  return { symbol, name };
};

export const deltaImporter: CsvImporter = {
  id: "delta",
  label: "Delta",

  matches(headers) {
    return (
      headers.includes("Way") &&
      headers.includes("Base amount") &&
      headers.includes("Base currency (name)")
    );
  },

  parse(csvText): ParseResult {
    const { rows } = parseCsv(csvText);
    const result: ParseResult = { transactions: [], issues: [], skipped: 0 };

    rows.forEach((row, i) => {
      const rowNum = i + 1;

      // FIAT base = cash deposit/withdrawal — not an asset transaction.
      const baseType = row["Base type"]?.trim().toLowerCase() ?? "";
      if (baseType === "fiat") {
        result.skipped++;
        return;
      }

      const way = row["Way"]?.trim().toLowerCase() ?? "";
      const type = WAYS[way];
      if (!type) {
        result.issues.push({ row: rowNum, message: `unknown Way "${row["Way"]}"` });
        return;
      }

      const parsedAsset = extractAsset(row["Base currency (name)"]);
      if (!parsedAsset) {
        result.issues.push({ row: rowNum, message: "missing base currency" });
        return;
      }
      const { symbol, name } = parsedAsset;

      const quantity = cleanNumber(row["Base amount"]);
      if (!quantity || Number(quantity) <= 0) {
        result.issues.push({ row: rowNum, message: "invalid Base amount" });
        return;
      }

      const tradedAt = new Date(row["Date"] ?? "");
      if (Number.isNaN(tradedAt.getTime())) {
        result.issues.push({ row: rowNum, message: "invalid Date" });
        return;
      }

      // Per-unit price derived from the total: quote / base.
      const quote = cleanNumber(row["Quote amount"]);
      let pricePerUnit: string | null = null;
      if (quote && Number(quote) > 0) {
        const price = Number(quote) / Number(quantity);
        pricePerUnit = String(Number(price.toPrecision(12)));
      }
      if ((type === "buy" || type === "sell") && pricePerUnit === null) {
        result.issues.push({ row: rowNum, message: "missing Quote amount" });
        return;
      }

      // Fees only when denominated in USD (crypto-denominated fees would
      // corrupt cash math); Delta reports "USD (United States dollar)".
      const feeCurrency = row["Fee currency (name)"]?.trim().toUpperCase() ?? "";
      const feeAmount = cleanNumber(row["Fee amount"]);
      const fees =
        feeAmount && (feeCurrency === "" || feeCurrency.startsWith("USD"))
          ? feeAmount.replace(/^-/, "")
          : "0";

      result.transactions.push({
        symbol,
        name,
        assetClass: CLASSES[baseType],
        type,
        quantity,
        pricePerUnit,
        fees,
        tradedAt,
        note: row["Notes"]?.trim() || undefined,
        raw: row,
      });
    });

    return result;
  },
};
