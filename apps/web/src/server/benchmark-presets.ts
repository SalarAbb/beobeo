import { inArray } from "drizzle-orm";
import { db, schema } from "@beobeo/db";

export interface BenchmarkPreset {
  id: string;
  symbol: string;
  name: string;
  class: string;
}

const WANTED = [
  { symbol: "SPY", name: "SPDR S&P 500 ETF", class: "etf" as const },
  { symbol: "QQQ", name: "Invesco QQQ Trust", class: "etf" as const },
  { symbol: "BTC", name: "Bitcoin", class: "crypto" as const, providerRef: "bitcoin" },
];

async function load(): Promise<BenchmarkPreset[]> {
  await db
    .insert(schema.assets)
    .values(WANTED)
    .onConflictDoNothing({ target: [schema.assets.symbol, schema.assets.class] });
  const rows = await db
    .select()
    .from(schema.assets)
    .where(inArray(schema.assets.symbol, WANTED.map((w) => w.symbol)));
  const order = new Map(WANTED.map((w, i) => [`${w.symbol}:${w.class}`, i]));
  return rows
    .filter((r) => order.has(`${r.symbol}:${r.class}`))
    .sort((a, b) => order.get(`${a.symbol}:${a.class}`)! - order.get(`${b.symbol}:${b.class}`)!)
    .map((r) => ({ id: r.id, symbol: r.symbol, name: r.name, class: r.class }));
}

const g = globalThis as { __beobeoPresets?: Promise<BenchmarkPreset[]> };

/**
 * Compare's preset benchmarks (SPY, QQQ, BTC), created on first use. They're
 * shared assets whose ids never change, so they're resolved once per process
 * (a failed load is retried on the next call). The page used to fetch them
 * with an insert + select on every visit, and its comparison query waited for
 * that answer before it could even start.
 */
export function loadBenchmarkPresets(): Promise<BenchmarkPreset[]> {
  g.__beobeoPresets ??= load().catch((err: unknown) => {
    g.__beobeoPresets = undefined;
    throw err;
  });
  return g.__beobeoPresets;
}
