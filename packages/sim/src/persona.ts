import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const assetClass = z.enum(["stock", "etf", "fund", "crypto"]);

/** A tradable instrument in a persona's universe. */
export const instrumentSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  class: assetClass,
});
export type Instrument = z.infer<typeof instrumentSchema>;

const cadence = z.enum(["week", "biweek", "month", "quarter"]);

/**
 * Deterministic policy rules — the persona's mechanical habits. Cheap and
 * reproducible: used for history bootstrap and as the baseline every sim
 * day. The LLM mind layers discretionary decisions on top.
 */
export const ruleSchema = z.discriminatedUnion("kind", [
  /** Fixed-dollar buy on a cadence. weekday: 1=Mon..5=Fri (week/biweek); day-of-month for month/quarter. */
  z.object({
    kind: z.literal("dca"),
    symbol: z.string(),
    amountUsd: z.number().positive(),
    every: cadence,
    day: z.number().int().min(1).max(28),
    account: z.string(),
  }),
  /** Buy when the close is down >= dropPct over lookbackDays. */
  z.object({
    kind: z.literal("dip_buy"),
    symbols: z.array(z.string()).min(1),
    dropPct: z.number().positive(),
    lookbackDays: z.number().int().positive(),
    amountUsd: z.number().positive(),
    cooldownDays: z.number().int().nonnegative(),
    account: z.string(),
  }),
  /** Each cadence period, buy the universe member with the best lookback return. */
  z.object({
    kind: z.literal("momentum"),
    symbols: z.array(z.string()).min(2),
    lookbackDays: z.number().int().positive(),
    amountUsd: z.number().positive(),
    every: cadence,
    day: z.number().int().min(1).max(28),
    account: z.string(),
  }),
  /** Sell sellFraction of a position whose unrealized gain exceeds gainPct. */
  z.object({
    kind: z.literal("take_profit"),
    symbols: z.array(z.string()).min(1),
    gainPct: z.number().positive(),
    sellFraction: z.number().positive().max(1),
    cooldownDays: z.number().int().nonnegative(),
    account: z.string(),
  }),
  /** Sell the whole position when down >= lossPct vs. cost; optionally rebuy a substitute (or the same coin, for crypto). */
  z.object({
    kind: z.literal("harvest"),
    symbols: z.array(z.string()).min(1),
    lossPct: z.number().positive(),
    substitutes: z.record(z.string(), z.string()).default({}),
    cooldownDays: z.number().int().nonnegative(),
    account: z.string(),
  }),
  /** Contribute amountUsd on a cadence, split to pull weights toward targets. */
  z.object({
    kind: z.literal("rebalance"),
    targets: z.record(z.string(), z.number().positive()),
    amountUsd: z.number().positive(),
    every: cadence,
    day: z.number().int().min(1).max(28),
    account: z.string(),
  }),
  /** One-time deposit split by target weight on the first trading day >= `on` (a rollover, an inheritance). */
  z.object({
    kind: z.literal("lump"),
    on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    targets: z.record(z.string(), z.number().positive()),
    amountUsd: z.number().positive(),
    account: z.string(),
  }),
  /** Sell amountUsd on a cadence to live on, taken from whatever is most overweight vs targets. */
  z.object({
    kind: z.literal("withdraw"),
    targets: z.record(z.string(), z.number().positive()),
    amountUsd: z.number().positive(),
    every: cadence,
    day: z.number().int().min(1).max(28),
    account: z.string(),
  }),
]);
export type Rule = z.infer<typeof ruleSchema>;

export const personaSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Bump whenever the persona is tuned — the journal keeps every version. */
  version: z.number().int().positive(),
  name: z.string(),
  age: z.number().int(),
  life: z.string(),
  /** 1 = struggles with apps, 5 = writes code. */
  techSavviness: z.number().int().min(1).max(5),
  /** Milliseconds this person tolerates before a page feels slow. */
  patienceMs: z.number().int().positive(),
  aesthetic: z.string(),
  strategy: z.string(),
  riskTolerance: z.enum(["low", "medium", "high"]),
  tax: z.object({
    filingStatus: z.enum(["single", "married_joint", "head_of_household"]),
    ordinaryRate: z.number(),
    ltcgRate: z.number(),
  }),
  accounts: z
    .array(
      z.object({
        name: z.string(),
        institution: z.string(),
        type: z.enum(["taxable", "traditional_ira", "roth_ira", "401k", "other_tax_advantaged"]),
        /** Portfolio it sits in (one of `portfolios`); default "Main". */
        portfolio: z.string().optional(),
      }),
    )
    .min(1),
  /**
   * Extra portfolios beyond "Main", e.g. a child's custodial account: a
   * separate taxpayer, so it gets its own Tax Center profile at these rates.
   */
  portfolios: z
    .array(z.object({ name: z.string(), owner: z.string(), tax: z.object({ ordinaryRate: z.number(), ltcgRate: z.number() }) }))
    .optional(),
  /** Logs every cash dividend the broker pays (real per-share payouts × units held on the ex-date). */
  recordsDividends: z.boolean().optional(),
  universe: z.array(instrumentSchema).min(1),
  /** Biases the mind should play honestly (FOMO, loss aversion, …). */
  biases: z.array(z.string()),
  goals: z.array(z.string()),
  /** Seed questions — the mind riffs on these, it doesn't recite them. */
  typicalQuestions: z.array(z.string()),
  /** Monthly discretionary budget the mind may deploy beyond the policy. */
  discretionaryUsdPerMonth: z.number().nonnegative(),
  /** ISO date this persona's investing history starts (bootstrap replays from here). */
  joinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** How curious they are: chance of wandering the app on a given day, how far, and where they gravitate. */
  explore: z
    .object({
      chance: z.number().min(0).max(1),
      steps: z.number().int().min(1).max(30),
      affinity: z.record(z.string(), z.number().nonnegative()),
    })
    .optional(),
  policy: z.array(ruleSchema),
});
export type Persona = z.infer<typeof personaSchema>;

export const PERSONAS_DIR = new URL("../personas/", import.meta.url).pathname;

export function loadPersonas(dir = PERSONAS_DIR): Persona[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown;
      const parsed = personaSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`Invalid persona ${f}: ${parsed.error.message}`);
      }
      return parsed.data;
    });
}

/** Quantity decimals the sim sends for each symbol: crypto 8, everything else 6 (see fmtQty). */
export function qtyDecimals(p: Persona): (symbol: string) => number {
  const crypto = new Set(p.universe.filter((i) => i.class === "crypto").map((i) => i.symbol));
  return (symbol) => (crypto.has(symbol) ? 8 : 6);
}

export function simEmail(personaId: string, suffix = ""): string {
  return `sim+${personaId}${suffix}@beobeo.sim`;
}

/** Deterministic per-persona password — sim accounts are throwaway by design. */
export function simPassword(personaId: string): string {
  return `sim-${personaId}-pass-0`;
}
