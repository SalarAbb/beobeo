import { execSync } from "node:child_process";
import type { Holdings } from "./holdings";
import type { Journal } from "./journal";
import type { Persona } from "./persona";
import { emptyPolicyState, runPolicy, type PolicyState, type TradeIntent } from "./policy";
import { addDays, type IsoDate, type PriceBook } from "./world";

export function gitInfo(): { branch: string; sha: string } {
  const sh = (c: string) => {
    try {
      return execSync(c, { cwd: new URL("../../..", import.meta.url).pathname }).toString().trim();
    } catch {
      return "unknown";
    }
  };
  return { branch: sh("git rev-parse --abbrev-ref HEAD"), sha: sh("git rev-parse --short HEAD") };
}

export function loadPolicyState(journal: Journal, personaId: string): { state: PolicyState; lastDate: IsoDate | null } {
  const row = journal.get<{ json: string; last_date: string }>(
    "SELECT json, last_date FROM policy_state WHERE persona_id = ?",
    personaId,
  );
  return row ? { state: JSON.parse(row.json) as PolicyState, lastDate: row.last_date } : { state: emptyPolicyState(), lastDate: null };
}

export function savePolicyState(journal: Journal, personaId: string, state: PolicyState, lastDate: IsoDate): void {
  journal.run(
    "INSERT INTO policy_state (persona_id, json, last_date) VALUES (?, ?, ?) ON CONFLICT(persona_id) DO UPDATE SET json = excluded.json, last_date = excluded.last_date",
    personaId,
    JSON.stringify(state),
    lastDate,
  );
}

/**
 * Run the persona's habits for every day in (fromExclusive, toInclusive],
 * applying fills to `holdings` as they happen so later days see earlier
 * trades. Returns the intents actually filled (sells clamped to holdings),
 * each stamped with its date.
 */
export function replayPolicy(
  persona: Persona,
  holdings: Holdings,
  book: PriceBook,
  state: PolicyState,
  fromExclusive: IsoDate,
  toInclusive: IsoDate,
): (TradeIntent & { date: IsoDate })[] {
  const out: (TradeIntent & { date: IsoDate })[] = [];
  for (let d = addDays(fromExclusive, 1); d <= toInclusive; d = addDays(d, 1)) {
    for (const intent of runPolicy(persona, holdings, book, d, state)) {
      const fill = holdings.apply(intent);
      if (fill) out.push({ ...intent, qty: fill.qty, date: d });
    }
  }
  return out;
}

const pct = (x: number | null) => (x === null ? "  n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
const usd = (x: number) => `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function marketBrief(persona: Persona, book: PriceBook, date: IsoDate): string {
  return persona.universe
    .map((i) => {
      const c = book.closeAsOf(i.symbol, date);
      if (!c) return `${i.symbol}: no price yet`;
      return `${i.symbol} (${i.name}) $${c.close.toFixed(2)} · 1d ${pct(book.changePct(i.symbol, date, 1))} · 1w ${pct(book.changePct(i.symbol, date, 7))} · 1m ${pct(book.changePct(i.symbol, date, 30))} · 1y ${pct(book.changePct(i.symbol, date, 365))}`;
    })
    .join("\n");
}

export function holdingsBrief(holdings: Holdings, book: PriceBook, date: IsoDate): string {
  const rows = holdings.positions();
  if (rows.length === 0) return "(no holdings yet)";
  let total = 0;
  let cost = 0;
  const lines = rows.map(({ account, symbol, pos }) => {
    const price = book.closeAsOf(symbol, date)?.close ?? 0;
    const value = pos.qty * price;
    total += value;
    cost += pos.cost;
    return `${account} · ${symbol}: ${pos.qty.toFixed(4)} units, cost ${usd(pos.cost)}, now ${usd(value)} (${pct((value / pos.cost - 1) * 100)})`;
  });
  return `${lines.join("\n")}\nTOTAL: ${usd(total)} on ${usd(cost)} invested (${pct(cost > 0 ? (total / cost - 1) * 100 : null)})`;
}

export function themesBrief(journal: Journal): string {
  const t = journal.openThemes();
  return t.length === 0 ? "(none yet)" : t.map((x) => `- ${x.key}: ${x.title} [${x.status}]`).join("\n");
}

/** Deterministic daily rotation: which personas do the expensive UI walkthrough today. */
export function rotation<T>(items: T[], date: IsoDate, perDay: number): T[] {
  if (items.length === 0) return [];
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const start = (day * perDay) % items.length;
  return Array.from({ length: Math.min(perDay, items.length) }, (_, i) => items[(start + i) % items.length]!);
}
