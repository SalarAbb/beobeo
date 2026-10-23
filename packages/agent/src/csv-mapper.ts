import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const TXN_TYPES = [
  "buy",
  "sell",
  "dividend",
  "split",
  "transfer_in",
  "transfer_out",
  "fee",
] as const;

const mappingSchema = z.object({
  dateColumn: z.string(),
  symbolColumn: z.string(),
  typeColumn: z.string(),
  quantityColumn: z.string(),
  priceColumn: z.string().nullable(),
  /** Total cash value column when there is no per-unit price column. */
  totalAmountColumn: z.string().nullable(),
  feesColumn: z.string().nullable(),
  noteColumn: z.string().nullable(),
  assetClassColumn: z.string().nullable(),
  /** Distinct type-column values mapped to our transaction types. */
  typeMap: z.array(
    z.object({ csvValue: z.string(), type: z.enum(TXN_TYPES) }),
  ),
  /** Type-column values that are not asset transactions (cash, interest…). */
  skipTypes: z.array(z.string()),
  /** Distinct asset-class values mapped to our classes (empty if no class column). */
  classMap: z.array(
    z.object({
      csvValue: z.string(),
      class: z.enum(["stock", "etf", "fund", "crypto"]),
    }),
  ),
  confidence: z.enum(["high", "medium", "low"]),
  /** One short sentence for the user: what was recognized / any caveat. */
  summary: z.string(),
});

export type SuggestedCsvMapping = z.infer<typeof mappingSchema>;

const SYSTEM = `You map broker/portfolio-app CSV exports (Robinhood, Delta, Schwab, Fidelity, Kraken, eToro, …) onto a normalized transaction schema.

Rules:
- Every column name you output MUST be copied exactly from the provided header list.
- quantityColumn holds units of the asset (shares/coins), never cash totals. If both a unit-price column and a total-amount column exist, priceColumn is the PER-UNIT price.
- If only a total-amount column exists (no per-unit price), set priceColumn to null and totalAmountColumn to that column — the importer derives price as total / quantity.
- typeMap must cover EVERY distinct value seen in the type column of the samples, lowercased. Values that are not asset transactions (cash deposits/withdrawals, interest, card payments, staking of fiat, etc.) go in skipTypes instead.
- Dividend/interest-income rows about an asset map to "dividend". Wallet/exchange moves of an asset map to transfer_in/transfer_out.
- assetClassColumn only when a column clearly distinguishes crypto vs stock/ETF; classMap covers its distinct values, lowercased.
- confidence: "high" only when date, symbol, type, and quantity are unambiguous.`;

/**
 * Ask Claude to infer a GenericMapping-compatible column mapping from a CSV
 * header + sample rows. Structured output — the result always parses.
 */
export async function suggestCsvMapping(opts: {
  headers: string[];
  /** Up to ~10 raw sample rows (arrays of cell strings, same order as headers). */
  sampleRows: string[][];
  apiKey?: string;
}): Promise<SuggestedCsvMapping> {
  const client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});

  const sample = [
    opts.headers.join(","),
    ...opts.sampleRows
      .slice(0, 10)
      .map((r) => r.map((c) => (c.includes(",") ? `"${c}"` : c)).join(",")),
  ].join("\n");

  const response = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 2000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Map this CSV export:\n\n\`\`\`csv\n${sample}\n\`\`\``,
      },
    ],
    output_config: { format: zodOutputFormat(mappingSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Mapping model returned no structured output");

  // Guard: reject hallucinated column names outright.
  const valid = new Set(opts.headers);
  const columns = [
    parsed.dateColumn,
    parsed.symbolColumn,
    parsed.typeColumn,
    parsed.quantityColumn,
    parsed.priceColumn,
    parsed.totalAmountColumn,
    parsed.feesColumn,
    parsed.noteColumn,
    parsed.assetClassColumn,
  ];
  for (const col of columns) {
    if (col !== null && !valid.has(col)) {
      throw new Error(`Suggested column "${col}" does not exist in the CSV`);
    }
  }
  return parsed;
}
