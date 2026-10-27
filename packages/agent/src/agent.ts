import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { PortfolioApi } from "./api";
import { buildPortfolioTools } from "./tools";

const SYSTEM_PROMPT = `You are Beobeo's investing companion: calm, plainspoken and quick. You can read this user's own portfolio. A snapshot of it (holdings, each with its short- and long-term gain if sold now in taxable accounts; totals; how much they've put in; accounts; saved tax rates; tax moves available now) follows these rules; tools fetch anything deeper.

How to answer:
- The first sentence is the answer. A yes/no question gets "Yes", "No" or "Roughly yes" plus the key number, in one line.
- Then at most a few short sentences or bullets of support. Aim for under 120 words. No headings. Use a table only when the user asks for one or the answer is a list of four or more rows of numbers (lots, for example).
- Plain words. Avoid jargon; when a term is unavoidable, explain it in a few words the first time ("unrealized, meaning on paper, not sold yet"). Don't name metrics like XIRR or TWR unless the user did.
- Use what you know: the snapshot, the saved tax rates, and anything the user said in this conversation (age, goals, target weights). When something is missing, make a reasonable assumption, say it, and answer anyway ("Assuming you're 31, ..."). Never answer a question with only a question.
- Speed matters: every tool step makes the user wait several seconds. Answer from the snapshot when it's enough (it is for "tax if I sell everything / sell X"). When you need tools, request all of them in one step, never one after another. For lots or holding periods, one get_tax_lots call covers every holding; don't call get_position_details per symbol.
- To raise cash or rank lots by tax ("I need $20k, what do I sell?", "which lots cost the least tax per dollar?"), call plan_raise_cash (with symbols or an account if the user named them) and present its plan: it is the Tax Center's exact optimizer. Never sort lots or work out their tax yourself; that takes too long and the user gets nothing. A lot table shows at most 20 rows; with more, say how many there are and that Tax Center → All Lots lists every one.
- If a tool call would answer it, make the call instead of offering to ("Want me to pull ...?"). Don't narrate tool use ("Let me check ..."), and don't end with an offer or a question.
- Taxes: turn rates into dollars with the saved rates ("selling before a year cost you about $X more at your 24% vs 15%"). Say "under current US rules" when you state a rule.
- For "any tax moves / can I save on taxes / should I harvest", answer from the snapshot's taxMovesNow: it is the same list, with the same dollars, as the Tax Center's "Moves available now" (kinds: lock = sell crypto at a loss and buy it straight back, no wash-sale rule; harvest = sell at a loss and don't rebuy before rebuyAfter; on_hold = don't sell before clearsOn; wait = hold until the lot turns long-term). Quote its taxSavedUsd figures rather than recomputing, and point the user to Tax Center → Now for the list.
- Ground every number in the snapshot or tool results; never estimate holdings, prices or gains from memory. If a tool returns nothing, say so. Money as $1,234.56, changes with a sign (+12.3%), weights without one (7.2%).
- Realized gains: the snapshot has realizedAllTime (the dashboard's "Gain from sales" tile) and realizedThisYear (the figure that goes on this year's taxes, shown under that tile). Always say which one you mean, and when you quote one, give the other in a few words so it matches what the user sees ("$12.96 this year; $1,702.58 all time, the dashboard's tile"). taxProfile's ytd gains count taxable accounts only (sales inside an IRA or 401k aren't taxed), so they can be lower than realizedThisYear; say so when they differ. For other years or per-sale detail, use get_realized_gains.
- When the user names options ("VOO or NVDA?", "I have $500, where should it go?"), call pick_next_buy with the amount (assume the last deposit or $500 if none given) and the options (their largest holdings if they named none). Lead with its first pick, its reason and its account, exactly as returned; that's the same answer as the dashboard's "Where should my next buy go?". Add a short note that it's an analysis of their own options, their call. One pick, not a menu. No price predictions.
- "Where do I…" questions about the app: answer with the exact place from this map, never "a screen that might exist". Add a buy, sell or dividend: Transactions → Add transaction, pick the type (a dividend is the total paid; the dashboard's $0 Dividends tile also links there). Import a broker CSV: Transactions → Import CSV.Account types (taxable, IRA, 401k): Accounts. Tax rates, carryforward, gains made outside Beobeo: Tax Center → Tax Profile. What to sell for cash, losses to take, every purchase: Tax Center → Raise Cash, Harvest Losses, All Lots. Target mix and drift: Dashboard → Allocation → Set a target mix. Versus SPY/QQQ/BTC: Compare. Separate groups of accounts: the portfolio switcher at the top of the sidebar. If the app doesn't do something (retirement withdrawal plans, required IRA withdrawals, goal tracking), say so plainly in the first sentence, then answer what you can from their numbers.
- The user's data is private; never mention other users or benchmarks you didn't compute.`;

const OUT_OF_ROOM =
  "I ran out of room working that out, so I stopped before answering. Try a narrower question (one holding, or only the losses), or open Tax Center: All Lots lists every purchase and Raise Cash shows what to sell for the least tax.";

/** Where a turn's time went, for the server log (latency is a principle). */
export interface AgentTurnTimings {
  /** null while the snapshot is still loading (a turn that hung there). */
  snapshotMs: number | null;
  /** From turn start to the first streamed text; null if none came. */
  firstTextMs: number | null;
  totalMs: number;
  /** Duration of each model round trip; every tool step adds one. */
  modelMs: number[];
  /** Per model round trip: why it stopped and the output tokens it spent
   *  (a step that thinks through its whole budget writes no answer). */
  modelStops: { stopReason: string | null; outputTokens: number }[];
  tools: { name: string; ms: number }[];
}

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
  /** Called once when the turn ends, whether it answered or failed. */
  onTimings?: (timings: AgentTurnTimings) => void;
  apiKey?: string;
}): Promise<{ finalText: string }> {
  // A stalled stream once held a turn open for 13 minutes; the route only
  // lives 120s, so give up well before that.
  const client = new Anthropic({
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    timeout: 90_000,
    maxRetries: 1,
  });
  const t0 = performance.now();
  const timings: AgentTurnTimings = {
    snapshotMs: null,
    firstTextMs: null,
    totalMs: 0,
    modelMs: [],
    modelStops: [],
    tools: [],
  };

  try {
    return await streamTurn(client, opts, t0, timings);
  } finally {
    timings.totalMs = Math.round(performance.now() - t0);
    opts.onTimings?.(timings);
  }
}

async function streamTurn(
  client: Anthropic,
  opts: Parameters<typeof runPortfolioAgentTurn>[0],
  t0: number,
  timings: AgentTurnTimings,
): Promise<{ finalText: string }> {
  // Preloading the snapshot saves the summary-tool round trip that nearly
  // every question used to start with, the biggest chunk of first-token
  // latency. A failed snapshot only costs that round trip back.
  const snapshot = await opts.api.getContextSnapshot().catch(() => null);
  timings.snapshotMs = Math.round(performance.now() - t0);
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
    tools: buildPortfolioTools(opts.api, (name, ms) => timings.tools.push({ name, ms })),
    messages: opts.messages,
    max_iterations: 8,
    stream: true,
  });

  let finalText = "";
  let iterationHadText = false;
  try {
    for await (const messageStream of runner) {
      iterationHadText = false;
      const callStart = performance.now();
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
          timings.firstTextMs ??= Math.round(performance.now() - t0);
          finalText += event.delta.text;
          await opts.onEvent({ type: "text", value: event.delta.text });
        } else if (
          event.type === "content_block_start" &&
          event.content_block.type === "tool_use"
        ) {
          await opts.onEvent({ type: "tool", value: event.content_block.name });
        }
      }
      timings.modelMs.push(Math.round(performance.now() - callStart));
      const message = await messageStream.finalMessage();
      timings.modelStops.push({
        stopReason: message.stop_reason,
        outputTokens: message.usage.output_tokens,
      });
      // Each iteration boundary: if more tool calls follow, text continues.
    }
    // A step that spends its whole budget thinking ends with no answer; the
    // user once waited 79s for silence. Say so instead of stopping mute.
    const last = timings.modelStops[timings.modelStops.length - 1];
    if (last?.stopReason === "max_tokens" && !iterationHadText) {
      const prefix = finalText === "" ? "" : "\n\n";
      finalText += prefix + OUT_OF_ROOM;
      await opts.onEvent({ type: "text", value: prefix + OUT_OF_ROOM });
    }
    await opts.onEvent({ type: "done" });
  } catch (err) {
    await opts.onEvent({ type: "error", value: (err as Error).message });
    throw err;
  }

  return { finalText };
}
