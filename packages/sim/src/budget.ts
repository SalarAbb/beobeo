/** Per-MTok USD rates (Anthropic first-party, cached 2026-09-25). */
const RATES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function usageCostUsd(model: string, u: Usage): number {
  const r = RATES[model];
  if (!r) throw new Error(`No price for model ${model} — add it to RATES in budget.ts`);
  return (
    (u.input_tokens * r.input +
      u.output_tokens * r.output +
      (u.cache_read_input_tokens ?? 0) * r.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * r.cacheWrite) /
    1_000_000
  );
}

export class BudgetExceeded extends Error {
  constructor(spent: number, cap: number) {
    super(`Daily sim budget reached: $${spent.toFixed(2)} of $${cap.toFixed(2)}`);
  }
}

export const DAILY_BUDGET_USD = Number(process.env.SIM_DAILY_BUDGET_USD || 5);

/**
 * Pure guard: may a call that is estimated to cost `estimate` start, given
 * what's already been spent today? Reserves `reserve` for higher-priority
 * work (UI reviews are optional; trades/questions aren't), so optional
 * work stops first.
 */
export function canSpend(spent: number, estimate: number, cap: number, reserve = 0): boolean {
  return spent + estimate <= cap - reserve;
}
