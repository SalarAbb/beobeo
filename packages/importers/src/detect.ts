import { coinbaseImporter } from "./coinbase";
import { deltaImporter } from "./delta";
import { parseCsv } from "./parse";
import { robinhoodImporter } from "./robinhood";
import type { CsvImporter } from "./types";

export const importers: CsvImporter[] = [
  robinhoodImporter,
  coinbaseImporter,
  deltaImporter,
];

/** Sniff the CSV header and return the matching broker preset, if any. */
export function detectImporter(csvText: string): CsvImporter | null {
  // Tolerate preamble lines (Coinbase) by checking each of the first lines.
  const lines = csvText.split("\n").slice(0, 10);
  for (const importer of importers) {
    for (const line of lines) {
      const headers = parseCsv(line).headers;
      if (headers.length > 2 && importer.matches(headers)) return importer;
    }
  }
  return null;
}
