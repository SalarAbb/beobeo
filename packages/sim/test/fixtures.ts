import { personaSchema, type Persona, type Rule } from "../src/persona";
import { addDays, PriceBook } from "../src/world";

/** A price book from {symbol: [[date, close], ...]}. */
export function book(data: Record<string, [string, number][]>): PriceBook {
  return new PriceBook(new Map(Object.entries(data).map(([s, rows]) => [s, new Map(rows)])));
}

/** Weekday closes (Mon–Fri) for `days` calendar days from `start`, following `f(i)`. */
export function weekdays(start: string, days: number, f: (i: number) => number): [string, number][] {
  const out: [string, number][] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push([d, f(i)]);
  }
  return out;
}

export function persona(policy: Rule[]): Persona {
  return personaSchema.parse({
    id: "test", version: 1, name: "Test", age: 40, life: "", techSavviness: 3, patienceMs: 2000,
    aesthetic: "", strategy: "", riskTolerance: "medium",
    tax: { filingStatus: "single", ordinaryRate: 24, ltcgRate: 15 },
    accounts: [{ name: "Brokerage", institution: "X", type: "taxable" }],
    universe: [{ symbol: "AAA", name: "A", class: "etf" }],
    biases: [], goals: [], typicalQuestions: [], discretionaryUsdPerMonth: 0,
    joinedOn: "2026-01-05", policy,
  });
}
