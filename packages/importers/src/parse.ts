import Papa from "papaparse";

export interface RawCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(csvText: string): RawCsv {
  const result = Papa.parse<Record<string, string>>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return {
    headers: result.meta.fields ?? [],
    rows: result.data,
  };
}
