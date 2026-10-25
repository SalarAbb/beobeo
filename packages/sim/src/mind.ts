import { readFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Shot } from "./app/browser";
import type { Journal } from "./journal";
import { askStructured } from "./llm";
import type { Persona } from "./persona";

/** One piece of feedback about the app, in the persona's own words. */
export const feedbackItem = z.object({
  page: z.string().describe("Route the feedback is about, e.g. /dashboard, or 'chat', 'signup', 'general'"),
  kind: z.enum(["bug", "friction", "wish", "aesthetic", "praise", "latency"]),
  area: z.enum(["ui", "ux", "feature", "perf", "correctness"]),
  severity: z.number().int().min(1).max(5).describe("1 = nit, 3 = annoying, 5 = would make me quit"),
  themeKey: z
    .string()
    .describe("kebab-case id. REUSE an existing theme key from the list when it's the same underlying ask; invent a new one only for a genuinely new ask"),
  title: z.string().describe("Neutral 3-8 word summary of the ask, product-manager style"),
  quote: z.string().describe("What you'd actually say, in your own voice, 1-2 sentences"),
});
export type FeedbackItem = z.infer<typeof feedbackItem>;

export function personaSystem(p: Persona): string {
  return `You are role-playing a REAL investor who uses "Beobeo", a portfolio tracker / investing companion web app. Stay fully in character. You are not an assistant and you are not polite by default.

WHO YOU ARE
${p.name}, ${p.age}. ${p.life}
- Tech comfort: ${p.techSavviness}/5. Patience for slow screens: ~${(p.patienceMs / 1000).toFixed(1)}s.
- Taste: ${p.aesthetic}
- Strategy: ${p.strategy}
- Risk tolerance: ${p.riskTolerance}. Tax: ${p.tax.filingStatus}, ~${p.tax.ordinaryRate}% ordinary / ${p.tax.ltcgRate}% long-term gains.
- Accounts: ${p.accounts.map((a) => `${a.name} (${a.type})`).join(", ")}
- Biases you genuinely have: ${p.biases.join("; ")}
- Goals: ${p.goals.join("; ")}
- Things you tend to wonder about: ${p.typicalQuestions.join(" | ")}

HOW TO BEHAVE
- Act like this person would, including their biases and blind spots — but stay economically rational for who they are: no trades you couldn't afford, no symbols outside what you'd realistically consider.
- You only know what you're shown: today's prices and earlier. Never assume future prices.
- Be honest and specific. Praise only what genuinely earns it; most days most things are just fine and not worth mentioning. Don't invent problems either.
- Talk the way this person talks. A 74-year-old retiree doesn't say "UX"; a quant does.`;
}

// ---------------------------------------------------------------- daily decision

export const decisionSchema = z.object({
  mood: z.string().describe("One sentence: how you feel about your money today"),
  trades: z
    .array(
      z.object({
        type: z.enum(["buy", "sell"]),
        symbol: z.string(),
        account: z.string(),
        usd: z.number().positive().describe("Dollar amount to buy, or dollar value to sell"),
        why: z.string(),
      }),
    )
    .describe("Discretionary trades BEYOND your automatic habits. Usually empty — most people don't trade most days."),
  question: z
    .string()
    .nullable()
    .describe("Something you'd type into the app's assistant today, or null. Ask about YOUR situation in your own words."),
});
export type Decision = z.infer<typeof decisionSchema>;

export interface DayContext {
  date: string;
  marketBrief: string;
  holdingsBrief: string;
  habitsToday: string;
  discretionaryLeftUsd: number;
  recentThoughts: string;
}

export function decide(
  p: Persona,
  ctx: DayContext,
  j: { journal: Journal; runId: number },
): Promise<Decision | null> {
  return askStructured({
    ...j,
    personaId: p.id,
    purpose: "decision",
    schema: decisionSchema,
    system: personaSystem(p),
    estimateUsd: 0.03,
    reserveUsd: 0.5,
    content: `Today is ${ctx.date}.

MARKET (only what you'd know by today's close)
${ctx.marketBrief}

YOUR PORTFOLIO
${ctx.holdingsBrief}

YOUR AUTOMATIC HABITS TODAY
${ctx.habitsToday || "(nothing scheduled today)"}

Discretionary cash you could still put to work this month: $${ctx.discretionaryLeftUsd.toFixed(0)}.
Recent days, in your own words: ${ctx.recentThoughts || "(nothing yet)"}

Decide what (if anything) you do today beyond your habits, and whether you'd ask the app anything. Use only symbols from the market list and your own account names.`,
  });
}

// ---------------------------------------------------------------- chat answer rating

export const ratingSchema = z.object({
  rating: z.number().int().min(1).max(5).describe("1 = useless/wrong, 3 = ok, 5 = exactly what I needed"),
  note: z.string().describe("Why, in your own voice"),
  feedback: z.array(feedbackItem).describe("Only if the exchange revealed something worth telling the makers. Often empty."),
});

export function rateAnswer(
  p: Persona,
  x: { question: string; answer: string; firstTokenMs: number | null; totalMs: number; holdingsBrief: string; themes: string },
  j: { journal: Journal; runId: number },
) {
  return askStructured({
    ...j,
    personaId: p.id,
    purpose: "rate_answer",
    schema: ratingSchema,
    system: personaSystem(p),
    estimateUsd: 0.03,
    reserveUsd: 0.5,
    content: `You asked the Beobeo assistant: "${x.question}"

It started answering after ${x.firstTokenMs === null ? "never (no text)" : `${(x.firstTokenMs / 1000).toFixed(1)}s`} and finished after ${(x.totalMs / 1000).toFixed(1)}s. Its answer:
---
${x.answer || "(empty)"}
---

For reference, what you actually hold:
${x.holdingsBrief}

Existing feedback themes (reuse a key when it's the same ask):
${x.themes}

Rate the answer as yourself. Did it actually help YOU decide or understand? Was it too long, too jargony, wrong about your numbers, or dodging the question?`,
  });
}

// ---------------------------------------------------------------- visual UI review

export const reviewSchema = z.object({
  firstImpression: z.string().describe("Your gut reaction in one or two sentences, in your own voice"),
  wouldKeepUsing: z.boolean(),
  feedback: z.array(feedbackItem).describe("The 2-6 things that matter most to YOU. Specific, page-anchored."),
});
export type Review = z.infer<typeof reviewSchema>;

export function reviewUi(
  p: Persona,
  shots: Shot[],
  x: { holdingsBrief: string; themes: string; mission: string },
  j: { journal: Journal; runId: number },
): Promise<Review | null> {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const s of shots) {
    content.push({
      type: "text",
      text: `Screen: ${s.route} (${s.viewport}, ${s.scheme} mode) — took ${(s.ms / 1000).toFixed(1)}s to finish loading`,
    });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: readFileSync(s.file).toString("base64") },
    });
  }
  content.push({
    type: "text",
    text: `You just opened Beobeo to: ${x.mission}

What you actually hold (so you can check the numbers):
${x.holdingsBrief}

Existing feedback themes (reuse a key when it's the same ask):
${x.themes}

React as yourself. Look at layout, clutter, what's confusing, what's missing for what YOU wanted to do, what's lovely, whether numbers look right, and how long things took. Be concrete — name the element.`,
  });
  return askStructured({
    ...j,
    personaId: p.id,
    purpose: "ui_review",
    schema: reviewSchema,
    system: personaSystem(p),
    estimateUsd: 0.12,
    effort: "medium",
    content,
  });
}

// ---------------------------------------------------------------- daily experience rating

const score = z.number().int().min(1).max(5);
export const experienceSchema = z.object({
  overall: score.describe("All things considered, how was using Beobeo today? 1 = awful, 3 = fine, 5 = delightful"),
  ease: score.describe("Could you do what you came to do without friction or confusion?"),
  speed: score.describe("Did it feel fast enough for YOUR patience?"),
  trust: score.describe("Did the numbers and answers feel right and consistent?"),
  usefulness: score.describe("Did it help you understand or decide something about your money?"),
  look: score.describe("How did it look and feel to you (clutter, calm, readability)?"),
  why: z.string().describe("One or two sentences in your own voice: what most shaped today's score"),
  recommend: z.boolean().describe("Would you recommend Beobeo to a friend like you, today?"),
});
export type Experience = z.infer<typeof experienceSchema>;

/**
 * End-of-day rating of the whole experience, grounded in what actually
 * happened to this persona today (not a generic opinion), with yesterday's
 * score for continuity so changes are deliberate, not noise.
 */
export function rateExperience(
  p: Persona,
  x: { date: string; diary: string; yesterday: string | null },
  j: { journal: Journal; runId: number },
): Promise<Experience | null> {
  return askStructured({
    ...j,
    personaId: p.id,
    purpose: "experience",
    schema: experienceSchema,
    system: personaSystem(p),
    estimateUsd: 0.02,
    reserveUsd: 0.3,
    content: `It's the end of ${x.date}. Here's everything that happened when you used Beobeo today:

${x.diary}

${x.yesterday ? `Yesterday you rated your experience: ${x.yesterday}. Only move your scores if today actually felt different.` : "This is the first time you're rating it."}

Rate today's experience as yourself. Judge only what you experienced today, against your own standards and patience.`,
  });
}
