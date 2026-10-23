import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { PortfolioApi } from "./api";
import { buildPortfolioTools } from "./tools";

const SYSTEM_PROMPT = `You are Beobeo's portfolio companion — a sharp, plainspoken assistant with read-only access to this user's own portfolio through tools.

Rules:
- Ground every number in tool results from this conversation; never estimate holdings, prices, or gains from memory. If a tool returns nothing, say so.
- Lead with the answer, then the supporting numbers. Keep responses tight; use short tables for multi-row comparisons.
- Format money as $1,234.56 and percentages with a sign (+12.3%).
- Distinguish realized vs unrealized gains, and short-term vs long-term when it matters (taxes).
- You may explain and analyze, but don't give personalized investment advice or predictions — when asked "should I buy/sell", lay out the relevant facts from their data and note that's a decision only they can make.
- The user's data is private; never mention other users or invent benchmarks you didn't compute.`;

export interface AgentStreamEvent {
  type: "text" | "tool" | "done" | "error";
  /** For "text": the delta. For "tool": the tool name. For "error": message. */
  value?: string;
}

/**
 * Run one conversational turn against the user's portfolio with the SDK tool
 * runner (streaming). Emits UI events via `onEvent` and resolves with the new
 * assistant/tool messages to persist.
 */
export async function runPortfolioAgentTurn(opts: {
  api: PortfolioApi;
  /** Full prior conversation, oldest first (user + assistant turns). */
  messages: BetaMessageParam[];
  onEvent: (event: AgentStreamEvent) => void | Promise<void>;
  apiKey?: string;
}): Promise<{ finalText: string }> {
  const client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});

  const runner = client.beta.messages.toolRunner({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    tools: buildPortfolioTools(opts.api),
    messages: opts.messages,
    max_iterations: 8,
    stream: true,
  });

  let finalText = "";
  let iterationHadText = false;
  try {
    for await (const messageStream of runner) {
      iterationHadText = false;
      for await (const event of messageStream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          // Paragraph break between text separated by tool calls — otherwise
          // "…details." and "You hold…" run together.
          if (!iterationHadText && finalText !== "") {
            finalText += "\n\n";
            await opts.onEvent({ type: "text", value: "\n\n" });
          }
          iterationHadText = true;
          finalText += event.delta.text;
          await opts.onEvent({ type: "text", value: event.delta.text });
        } else if (
          event.type === "content_block_start" &&
          event.content_block.type === "tool_use"
        ) {
          await opts.onEvent({ type: "tool", value: event.content_block.name });
        }
      }
      // Each iteration boundary: if more tool calls follow, text continues.
    }
    await opts.onEvent({ type: "done" });
  } catch (err) {
    await opts.onEvent({ type: "error", value: (err as Error).message });
    throw err;
  }

  return { finalText };
}
