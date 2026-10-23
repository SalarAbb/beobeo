import { parseCsv } from "./parse";
import {
  cleanNumber,
  type ImportTransactionType,
  type ParseResult,
} from "./types";

/** Column mapping the user builds in the import wizard (or AI suggests). */
export interface GenericMapping {
  dateColumn: string;
  symbolColumn: string;
  typeColumn: string;
  quantityColumn: string;
  priceColumn?: string;
  /** Total cash value column (price derived as total / quantity) when the
   *  export has no per-unit price (e.g. Delta's "Quote amount"). */
  totalAmountColumn?: string;
  feesColumn?: string;
  noteColumn?: string;
  /** Column holding the asset class (e.g. Delta's "Asset type"). */
  assetClassColumn?: string;
  /** CSV value (lowercased) → asset class, e.g. { "crypto": "crypto" }. */
  classMap?: Record<string, "stock" | "etf" | "fund" | "crypto">;
  /** CSV value (lowercased) → transaction type, e.g. { "bought": "buy" }. */
  typeMap?: Record<string, ImportTransactionType>;
  /** Type-column values (lowercased) to skip silently (cash movements etc.). */
  skipTypes?: string[];
}

const DEFAULT_TYPE_MAP: Record<string, ImportTransactionType> = {
  buy: "buy",
  bought: "buy",
  purchase: "buy",
  sell: "sell",
  sold: "sell",
  sale: "sell",
  dividend: "dividend",
  div: "dividend",
  split: "split",
  "transfer in": "transfer_in",
  deposit: "transfer_in",
  receive: "transfer_in",
  "transfer out": "transfer_out",
  withdrawal: "transfer_out",
  send: "transfer_out",
  fee: "fee",
};

export function parseGenericCsv(
  csvText: string,
  mapping: GenericMapping,
): ParseResult {
  const { rows } = parseCsv(csvText);
  const typeMap = { ...DEFAULT_TYPE_MAP, ...(mapping.typeMap ?? {}) };
  const result: ParseResult = { transactions: [], issues: [], skipped: 0 };

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    // "LINK (ChainLink)" → "LINK"
    const symbol = row[mapping.symbolColumn]?.split("(")[0]?.trim().toUpperCase();
    if (!symbol) {
      result.issues.push({ row: rowNum, message: "missing symbol" });
      return;
    }

    const rawType = row[mapping.typeColumn]?.trim().toLowerCase() ?? "";
    if (mapping.skipTypes?.includes(rawType)) {
      result.skipped++;
      return;
    }
    const type = typeMap[rawType];
    if (!type) {
      result.issues.push({ row: rowNum, message: `unknown type "${rawType}"` });
      return;
    }

    const quantity = cleanNumber(row[mapping.quantityColumn]);
    if (!quantity || Number(quantity) <= 0) {
      result.issues.push({ row: rowNum, message: "invalid quantity" });
      return;
    }

    const tradedAt = new Date(row[mapping.dateColumn] ?? "");
    if (Number.isNaN(tradedAt.getTime())) {
      result.issues.push({ row: rowNum, message: "invalid date" });
      return;
    }

    let price = mapping.priceColumn ? cleanNumber(row[mapping.priceColumn]) : null;
    if (price === null && mapping.totalAmountColumn) {
      const total = cleanNumber(row[mapping.totalAmountColumn]);
      if (total && Number(total) > 0 && Number(quantity) > 0) {
        price = String(Number((Number(total) / Number(quantity)).toPrecision(12)));
      }
    }
    if ((type === "buy" || type === "sell") && price === null) {
      result.issues.push({ row: rowNum, message: "buy/sell requires a price" });
      return;
    }

    const feesRaw = mapping.feesColumn ? cleanNumber(row[mapping.feesColumn]) : null;

    const rawClass = mapping.assetClassColumn
      ? row[mapping.assetClassColumn]?.trim().toLowerCase()
      : undefined;
    const assetClass = rawClass ? mapping.classMap?.[rawClass] : undefined;

    result.transactions.push({
      symbol,
      assetClass,
      type,
      quantity: quantity.replace(/^-/, ""),
      pricePerUnit: price ? price.replace(/^-/, "") : null,
      fees: feesRaw ? feesRaw.replace(/^-/, "") : "0",
      tradedAt,
      note: mapping.noteColumn ? row[mapping.noteColumn]?.trim() : undefined,
      raw: row,
    });
  });

  return result;
}
