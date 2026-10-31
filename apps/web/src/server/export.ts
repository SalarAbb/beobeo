import { D, toIsoDate, type Decimal } from "@beobeo/core";
import { db } from "@beobeo/db";
import { getMarketData } from "./market-data";
import { loadKnownSplits } from "./portfolio";
import { loadScopedRows, replayByAccount, type ScopedTxnRow } from "./tax/lots";

/**
 * CSV downloads (Transactions → Export): every trade, every sale matched to
 * the purchases it used, every purchase still held. Built so a user can
 * reconcile against their broker row by row: exact stored figures (Decimal
 * strings, never floats), dates as YYYY-MM-DD, one header row.
 *
 * Sales and open purchases are matched FIFO per account, like the Tax Center
 * and like brokers report them. Retirement accounts are included and marked.
 */
export const EXPORT_KINDS = ["transactions", "realized", "lots"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

const ACCOUNT_TYPE: Record<string, string> = {
  taxable: "Taxable",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  other_tax_advantaged: "Other tax-advantaged",
};

const TYPE: Record<string, string> = {
  buy: "Buy",
  sell: "Sell",
  dividend: "Dividend",
  split: "Split",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  fee: "Fee",
};

type Cell = string | number | null;

/** Quote per RFC 4180, and defuse user-typed text a spreadsheet would run
 *  as a formula (names and notes only: numbers keep their minus sign). */
function line(cells: Cell[]): string {
  return cells
    .map((c) => {
      const s = c === null ? "" : String(c);
      return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    })
    .join(",");
}
const text = (s: string | null) => (s && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
const money = (d: Decimal) => d.toFixed(2);
/** Quantities as stored, without trailing zeros (numeric(38,18) pads them). */
const qty = (d: Decimal) => d.toString();

function csv(header: string[], rows: Cell[][]): string {
  return [line(header), ...rows.map(line)].join("\r\n") + "\r\n";
}

/** What a file holds, said back in the download toast so it can be checked
 *  against a broker without opening it: the row count and each dollar
 *  column's total, summed from the rounded cells as a spreadsheet would. */
export type ExportSummary = {
  rows: number;
  /** Column name → total, a 2-dp string. */
  sums: Record<string, string>;
  /** Realized only: this tax year's gain in taxable accounts. */
  taxableGainThisYear?: { year: number; rows: number; gain: string };
};
export type ExportFile = { body: string; summary: ExportSummary };

function file(header: string[], rows: Cell[][], sumColumns: string[] = []): ExportFile {
  const sums: Record<string, string> = {};
  for (const col of sumColumns) {
    const i = header.indexOf(col);
    sums[col] = money(rows.reduce((t, r) => (r[i] == null ? t : t.add(D(r[i]!))), D(0)));
  }
  return { body: csv(header, rows), summary: { rows: rows.length, sums } };
}

/** The day a purchase counts as long-term: the day after its anniversary. */
function longTermOn(openedAt: Date): string {
  const d = new Date(openedAt);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return toIsoDate(d);
}

function transactionsCsv(rows: ScopedTxnRow[]): ExportFile {
  return file(
    ["Date", "Type", "Symbol", "Name", "Asset class", "Account", "Account type", "Quantity", "Price per unit", "Fees", "Amount", "Source", "Note"],
    rows
      .slice()
      .reverse() // newest first, like the Transactions list
      .map(({ txn, asset, account }) => {
        const price = txn.pricePerUnit === null ? null : D(txn.pricePerUnit);
        const gross = price === null ? null : D(txn.quantity).mul(price);
        const amount =
          gross === null
            ? null
            : txn.type === "buy"
              ? gross.add(txn.fees)
              : txn.type === "sell"
                ? gross.sub(txn.fees)
                : txn.type === "split" || txn.type === "fee"
                  ? null
                  : gross;
        return [
          toIsoDate(txn.tradedAt),
          TYPE[txn.type] ?? txn.type,
          asset.symbol,
          text(asset.name),
          asset.class,
          text(account.name),
          ACCOUNT_TYPE[account.accountType] ?? account.accountType,
          qty(D(txn.quantity)),
          price === null ? null : price.toString(),
          money(D(txn.fees)),
          amount === null ? null : money(amount),
          txn.source,
          text(txn.note),
        ];
      }),
  );
}

async function replay(rows: ScopedTxnRow[]) {
  const assetIds = [...new Set(rows.map((r) => r.asset.id))];
  return replayByAccount(rows, await loadKnownSplits(db, assetIds));
}

async function realizedCsv(rows: ScopedTxnRow[], asOf: Date): Promise<ExportFile> {
  const sales = (await replay(rows)).flatMap(({ account, asset, result }) =>
    result.realized.map((g) => ({ g, account, asset })),
  );
  sales.sort(
    (a, b) =>
      a.g.soldAt.getTime() - b.g.soldAt.getTime() ||
      a.asset.symbol.localeCompare(b.asset.symbol) ||
      a.g.acquiredAt.getTime() - b.g.acquiredAt.getTime(),
  );
  const year = asOf.getUTCFullYear();
  let taxableGainThisYear = D(0);
  let taxableRowsThisYear = 0;
  const out = file(
    ["Tax year", "Sold", "Bought", "Symbol", "Account", "Account type", "Quantity", "Proceeds", "Cost basis", "Gain", "Term", "Taxed"],
    sales.map(({ g, account, asset }) => {
      // From the rounded columns, so every row's gain is exactly proceeds −
      // basis (as on Form 8949); the cents of the column total can then
      // differ from the unrounded total by a cent or two.
      const gain = money(D(money(g.proceeds)).sub(money(g.costBasis)));
      if (g.soldAt.getUTCFullYear() === year && account.accountType === "taxable") {
        taxableGainThisYear = taxableGainThisYear.add(gain);
        taxableRowsThisYear += 1;
      }
      return [
        g.soldAt.getUTCFullYear(),
        toIsoDate(g.soldAt),
        toIsoDate(g.acquiredAt),
        asset.symbol,
        text(account.name),
        ACCOUNT_TYPE[account.accountType] ?? account.accountType,
        qty(g.quantity),
        money(g.proceeds),
        money(g.costBasis),
        gain,
        g.longTerm ? "Long-term" : "Short-term",
        account.accountType === "taxable" ? "Yes" : "No (retirement account)",
      ];
    }),
    ["Proceeds", "Cost basis", "Gain"],
  );
  out.summary.taxableGainThisYear = {
    year,
    rows: taxableRowsThisYear,
    gain: money(taxableGainThisYear),
  };
  return out;
}

async function lotsCsv(rows: ScopedTxnRow[], asOf: Date): Promise<ExportFile> {
  const assets = [...new Map(rows.map((r) => [r.asset.id, r.asset])).values()];
  const [replays, latest] = await Promise.all([
    replay(rows),
    getMarketData()
      .getLatestPrices(assets, toIsoDate(asOf))
      .catch(() => new Map<string, { date: string; close: string }>()),
  ]);
  const lots = replays.flatMap(({ account, asset, result }) =>
    result.openLots.map((lot) => ({ lot, account, asset })),
  );
  lots.sort(
    (a, b) =>
      a.asset.symbol.localeCompare(b.asset.symbol) ||
      a.lot.openedAt.getTime() - b.lot.openedAt.getTime(),
  );
  const today = toIsoDate(asOf);
  return file(
    ["Symbol", "Account", "Account type", "Bought", "Quantity", "Cost basis", "Cost per unit", "Price", "Price date", "Value", "Gain", "Term", "Long-term from"],
    lots.map(({ lot, account, asset }) => {
      const price = latest.get(asset.id);
      const value = price ? lot.quantity.mul(price.close) : null;
      const ltOn = longTermOn(lot.openedAt);
      return [
        asset.symbol,
        text(account.name),
        ACCOUNT_TYPE[account.accountType] ?? account.accountType,
        toIsoDate(lot.openedAt),
        qty(lot.quantity),
        money(lot.costBasis),
        lot.quantity.isZero() ? null : lot.costBasis.div(lot.quantity).toFixed(4),
        price ? D(price.close).toString() : null,
        price?.date ?? null,
        value ? money(value) : null,
        value ? money(D(money(value)).sub(money(lot.costBasis))) : null,
        ltOn <= today ? "Long-term" : "Short-term",
        ltOn,
      ];
    }),
    ["Cost basis", "Value", "Gain"],
  );
}

export async function buildExport(
  userId: string,
  kind: ExportKind,
  portfolioId: string | undefined,
  asOf: Date = new Date(),
): Promise<ExportFile> {
  const rows = await loadScopedRows(userId, portfolioId ?? "all");
  if (kind === "transactions") return transactionsCsv(rows);
  if (kind === "realized") return realizedCsv(rows, asOf);
  return lotsCsv(rows, asOf);
}
