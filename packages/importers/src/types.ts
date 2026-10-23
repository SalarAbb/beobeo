export type ImportTransactionType =
  | "buy"
  | "sell"
  | "dividend"
  | "split"
  | "transfer_in"
  | "transfer_out"
  | "fee";

export interface ParsedTransaction {
  symbol: string;
  /** Human-readable asset name when the export provides one. */
  name?: string;
  /** Optional hint; the wizard lets the user confirm/override. */
  assetClass?: "stock" | "etf" | "fund" | "crypto";
  type: ImportTransactionType;
  quantity: string;
  pricePerUnit: string | null;
  fees: string;
  tradedAt: Date;
  note?: string;
  /** Original CSV row, for the preview UI and debugging. */
  raw: Record<string, string>;
}

export interface ParseIssue {
  /** 1-based data row number (excluding the header). */
  row: number;
  message: string;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  issues: ParseIssue[];
  /** Rows understood but intentionally skipped (e.g. cash movements). */
  skipped: number;
}

export interface CsvImporter {
  readonly id: string;
  readonly label: string;
  /** Quick sniff: does this CSV's header look like this broker's export? */
  matches(headers: string[]): boolean;
  parse(csvText: string): ParseResult;
}

/** Strip $, commas, whitespace; handle (123.45) negatives. Returns null if not a number. */
export function cleanNumber(value: string | undefined): string | null {
  if (!value) return null;
  let s = value.trim().replace(/[$,]/g, "");
  if (s === "") return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return negative ? `-${s}` : s;
}
