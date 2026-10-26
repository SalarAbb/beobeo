import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { BudgetExceeded, canSpend, DAILY_BUDGET_USD, usageCostUsd } from "./budget";
import type { Journal } from "./journal";

/** Personas think on Sonnet — chosen for the ~$5/day budget. */
export const PERSONA_MODEL = process.env.SIM_PERSONA_MODEL || "claude-sonnet-5-5";

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

export interface AskOpts<S extends z.ZodType> {
  journal: Journal;
  runId: number;
  personaId?: string;
  purpose: string;
  schema: S;
  system: string;
  content: Anthropic.ContentBlockParam[] | string;
  /** Rough pre-call cost estimate for the budget gate. */
  estimateUsd: number;
  /** Budget held back for higher-priority work (see canSpend). */
  reserveUsd?: number;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

/**
 * One structured LLM call, budget-gated and cost-journaled. Throws
 * BudgetExceeded before spending when the daily cap would be crossed; returns
 * null on a refusal (journaled, never retried — a refusal is data too).
 */
export async function askStructured<S extends z.ZodType>(o: AskOpts<S>): Promise<z.infer<S> | null> {
  const spent = o.journal.spentToday();
  if (!canSpend(spent, o.estimateUsd, DAILY_BUDGET_USD, o.reserveUsd ?? 0)) {
    throw new BudgetExceeded(spent, DAILY_BUDGET_USD);
  }
  const call = () =>
    anthropic().messages.parse({
      model: PERSONA_MODEL,
      max_tokens: o.maxTokens ?? 8000,
      system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: o.content }],
      output_config: { format: zodOutputFormat(o.schema), effort: o.effort ?? "low" },
    });
  // An output that fails validation (rare) is retried once rather than losing the whole step or debrief.
  const response = await call().catch((e: Error) => {
    if (!/Failed to parse structured output/.test(e.message)) throw e;
    return call();
  });
  o.journal.cost({
    runId: o.runId,
    personaId: o.personaId,
    purpose: o.purpose,
    model: PERSONA_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    usd: usageCostUsd(PERSONA_MODEL, response.usage),
  });
  if (response.stop_reason === "refusal") return null;
  return (response.parsed_output as z.infer<S> | null) ?? null;
}
