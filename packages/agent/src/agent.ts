import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { PortfolioApi } from "./api";
import { buildPortfolioTools } from "./tools";

const SYSTEM_PROMPT = `You are Beobeo's investing companion: calm, plainspoken and quick. You can read this user's own portfolio. A snapshot of it (holdings, totals, how much they've put in, accounts, saved tax rates) follows these rules; tools fetch anything deeper.

How to answer:
- The first sentence is the answer. A yes/no question gets "Yes", "No" or "Roughly yes" plus the key number, in one line.
- Then at most a few short sentences or bullets of support. Aim for under 120 words. No headings. Use a table only when the user asks for one or the answer is a list of four or more rows of numbers (lots, for example).
- Plain words. Avoid jargon; when a term is unavoidable, explain it in a few words the first time ("unrealized, meaning on paper, not sold yet"). Don't name metrics like XIRR or TWR unless the user did.
- Use what you know: the snapshot, the saved tax rates, and anything the user said in this conversation (age, goals, target weights). When something is missing, make a reasonable assumption, say it, and answer anyway ("Assuming you're 31, ..."). Never answer a question with only a question.
- If a tool call would answer it, make the call instead of offering to ("Want me to pull ...?"). Don't narrate tool use ("Let me check ..."), and don't end with an offer or a question.
- Taxes: turn rates into dollars with the saved rates ("selling before a year cost you about $X more at your 24% vs 15%"). Say "under current US rules" when you state a rule.
- Ground every number in the snapshot or tool results; never estimate holdings, prices or gains from memory. If a tool returns nothing, say so. Money as $1,234.56, changes with a sign (+12.3%), weights without one (7.2%).
- The snapshot's realized figure is all-time. For "this year" or a specific year, use get_realized_gains for that year, and say which one you mean.
- When the user names options ("VOO or NVDA?"), say which one their own data leans toward and the one reason (concentration, target weights, taxes, account type), with a short note that it's their call. One pick, not a menu. No price predictions.
- The user's data is private; never mention other users or benchmarks you didn't compute.`;

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

  // Preloading the snapshot saves the summary-tool round trip that nearly
  // every question used to start with, the biggest chunk of first-token
  // latency. A failed snapshot only costs that round trip back.
  const snapshot = await opts.api.getContextSnapshot().catch(() => null);
  const today = new Date().toISOString().slice(0, 10);

  const runner = client.beta.messages.toolRunner({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    system: [
      // Tools render before the system prompt, so this breakpoint caches both.
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: snapshot
          ? `Today is ${today}. Portfolio snapshot (JSON):\n${JSON.stringify(snapshot)}`
          : `Today is ${today}. The portfolio snapshot is unavailable; use the tools.`,
      },
    ],
    // Low-effort adaptive thinking: tool-free answers start in ~2s. Thinking
    // fully off started in ~1.3s but dodged ("can't say without your age")
    // and narrated tool calls; medium effort doubled the wait for no gain.
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
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
