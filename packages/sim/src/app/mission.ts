import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { BrowserContext, Page } from "playwright";
import { z } from "zod";
import { routeKey } from "../explore-rules";
import { FEATURES, type Feature } from "../features";
import type { Journal } from "../journal";
import { askStructured } from "../llm";
import { feedbackItem, personaSystem } from "../mind";
import type { Persona } from "../persona";
import { APP_URL } from "./client";

/**
 * A mission: one persona, one real goal, the real app in a real browser. Unlike the random
 * wander, the persona reads the screen, decides, states what it EXPECTS before every action and
 * compares the outcome after, so it finds what's broken or confusing in flows that need real input
 * (an amount, a form, a file) and a careful reading of the result. It runs on a disposable copy of
 * the persona's data (`cloneSimUser`), so it may save, edit, delete and import freely.
 */

const MAX_STEPS = Number(process.env.SIM_MISSION_MAX_STEPS || 18);

// ---------------------------------------------------------------- what the persona sees

export interface Control {
  ref: string;
  role: string;
  name: string;
  value?: string;
  state?: string;
}

export interface Observation {
  route: string;
  url: string;
  elements: Control[];
  text: string;
  dialog: boolean;
  popup: boolean;
}

/** Tag every visible control with a ref and describe it the way a screen reader would. */
/** The SUM a spreadsheet shows under each dollar column, over every row: a
 *  persona summing 13 rows in its head was $100 off and reported the file wrong. */
function columnSums(lines: string[]): string {
  const split = (l: string) => [...l.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1]!).slice(0, -1);
  const header = split(lines[0] ?? "");
  const rows = lines.slice(1).map(split);
  const sums = header.flatMap((h, i) => {
    if (!/proceeds|cost basis|gain|value|amount|fees/i.test(h)) return [];
    const vals = rows.map((r) => Number(r[i])).filter((v) => Number.isFinite(v));
    return vals.length ? [`${h} ${vals.reduce((s, v) => s + v, 0).toFixed(2)}`] : [];
  });
  return sums.length ? `\nColumn sums over all ${rows.length} rows (your spreadsheet's SUM): ${sums.join(" · ")}` : "";
}

export async function observe(page: Page): Promise<Observation> {
  // tsx/esbuild wraps named functions in a `__name` helper that doesn't exist in the page. A string
  // evaluate isn't transpiled, so it can define the helper first.
  await page.evaluate("globalThis.__name ??= (f) => f");
  // Let closing layers finish their exit animation. A ticker list still fading
  // out after a pick was read as open, the persona clicked its vanishing row,
  // and reported "the picker click times out" (missions 39, 46).
  await page
    .waitForFunction(() => !document.querySelector("[role=listbox][data-state=closed], [role=menu][data-state=closed], [role=dialog][data-state=closed], [data-radix-popper-content-wrapper] > [data-state=closed]"), undefined, { timeout: 1_000 })
    .catch(() => undefined);
  const r = await page.evaluate(() => {
    document.querySelectorAll("[data-mref]").forEach((el) => el.removeAttribute("data-mref"));
    // What's in front of the person: an open dropdown/menu (rendered in its own layer), else a dialog, else the page.
    const visible = (e: Element | null) =>
      !!e && (e as HTMLElement).getBoundingClientRect().height > 0 && !e.closest("[data-state=closed]");
    const list = [...document.querySelectorAll<HTMLElement>("[role=listbox], [role=menu]")].find(visible) ?? null;
    // The whole popover layer, so a combobox's search box beside its list is reachable too.
    const popup = list?.closest<HTMLElement>("[data-radix-popper-content-wrapper]") ?? list;
    // The topmost open one: a date popover (role=dialog) opened inside the add form is portaled after
    // it, and scoping to the first left its calendar unlisted, so the persona couldn't backdate (mission 89).
    const dialog = [...document.querySelectorAll<HTMLElement>("[role=dialog], [role=alertdialog]")].filter(visible).at(-1) ?? null;
    const scope: ParentNode = popup ?? dialog ?? document;
    const sel = [
      "a[href]", "button", "input", "select", "textarea", "summary", "[contenteditable=true]",
      "[role=button]", "[role=tab]", "[role=menuitem]", "[role=option]", "[role=combobox]",
      "[role=checkbox]", "[role=switch]", "[role=radio]", "[role=slider]", "[role=link]",
    ].join(",");
    const els: { ref: string; role: string; name: string; value?: string; state?: string }[] = [];
    let n = 0;
    const labelFor = (el: HTMLElement) => {
      const id = el.getAttribute("id");
      const lab = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : el.closest("label");
      return lab?.textContent?.trim() ?? "";
    };
    for (const el of scope.querySelectorAll<HTMLElement>(sel)) {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const isFile = el instanceof HTMLInputElement && el.type === "file";
      // Skip what a person can't see: zero/1px boxes and aria-hidden copies (e.g. the native <select> a styled dropdown keeps behind it).
      if (!isFile && (rect.width < 4 || rect.height < 4 || cs.visibility === "hidden" || cs.display === "none" || (!popup && el.closest("[aria-hidden=true]")))) continue;
      if (el instanceof HTMLInputElement && el.type === "hidden") continue;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") ?? (tag === "a" ? "link" : tag === "input" ? `input:${(el as HTMLInputElement).type || "text"}` : tag);
      const name = (
        el.getAttribute("aria-label") ||
        (tag === "input" || tag === "textarea" || tag === "select" ? labelFor(el) || el.getAttribute("placeholder") || el.getAttribute("name") || "" : "") ||
        el.innerText ||
        el.getAttribute("title") ||
        ""
      ).replace(/\s+/g, " ").trim().slice(0, 80);
      const states: string[] = [];
      if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") states.push("disabled");
      for (const a of ["aria-pressed", "aria-checked", "aria-selected", "aria-expanded"]) {
        const v = el.getAttribute(a);
        if (v === "true") states.push(a.slice(5));
      }
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") && el.checked) states.push("checked");
      const value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el instanceof HTMLSelectElement ? el.selectedOptions[0]?.text : undefined;
      // Menu/dialog refs get their own prefix: numbering restarts per scope, and an open menu's first
      // item as "e0" read to the persona as the page's e0 (the logo), so it reported mis-tapping it.
      const ref = `${popup ? "m" : dialog ? "d" : "e"}${n++}`;
      el.setAttribute("data-mref", ref);
      els.push({ ref, role, name, ...(value ? { value: value.slice(0, 60) } : {}), ...(states.length ? { state: states.join(",") } : {}) });
      if (n >= 160) break;
    }
    const textRoot = popup ?? dialog ?? document.querySelector("main") ?? document.body;
    return { elements: els, text: (textRoot as HTMLElement).innerText.replace(/\n{3,}/g, "\n\n").slice(0, 4000), dialog: !!dialog, popup: !!popup };
  });
  const url = page.url();
  return { ...r, url, route: routeKey(new URL(url).pathname) };
}

function describe(o: Observation): string {
  const els = o.elements.map((e) => `[${e.ref}] ${e.role} "${e.name}"${e.value ? ` value="${e.value}"` : ""}${e.state ? ` (${e.state})` : ""}`).join("\n");
  return `PAGE ${o.route}${o.popup ? " — a dropdown list is open (only its options are listed; Escape closes it)" : o.dialog ? " — a dialog is open (only its contents are listed)" : ""}

CONTROLS (use these refs):
${els || "(none)"}

TEXT ON SCREEN:
${o.text || "(empty)"}`;
}

// ---------------------------------------------------------------- what the persona can do

export const stepSchema = z.object({
  noticed: z.string().describe("What you notice on this screen that matters for your goal, including anything that looks wrong or confusing. 1-2 sentences, in your voice."),
  lastStep: z.enum(["as-expected", "surprised", "first-step"]).describe("Did your previous action do what you expected?"),
  surprise: z.string().nullable().describe("If surprised: what you expected vs. what happened. Else null."),
  expect: z.string().describe("Before acting: what you expect your next action to do."),
  action: z.object({
    kind: z.enum(["click", "type", "select", "press", "goto", "scroll", "upload", "finish"]),
    ref: z.string().nullable().describe("Element ref from the CONTROLS list (click/type/select/upload)"),
    text: z.string().nullable().describe("type: the text to enter · select: the option's visible text · press: a key like Enter or Escape · goto: a path like /tax-center · scroll: up or down"),
  }),
});
export type Step = z.infer<typeof stepSchema>;

/** Never sign out (the mission would end) and never leave the app. Everything else is fair game: it's a disposable account. */
const FORBIDDEN = /\b(sign ?out|log ?out)\b/i;

async function act(page: Page, a: Step["action"], o: Observation, csvFile: string | null): Promise<string | null> {
  const el = a.ref ? page.locator(`[data-mref="${a.ref}"]`) : null;
  const meta = a.ref ? o.elements.find((e) => e.ref === a.ref) : undefined;
  if (a.ref && !meta) return `there is no control ${a.ref} on screen`;
  if (meta && FORBIDDEN.test(meta.name)) return "signing out isn't part of this mission";
  switch (a.kind) {
    case "click":
      await el!.click({ timeout: 6000 });
      return null;
    case "type":
      await el!.fill(a.text ?? "", { timeout: 6000 });
      return null;
    case "select":
      if (meta!.role === "select") await el!.selectOption({ label: a.text ?? "" }, { timeout: 6000 });
      else {
        await el!.click({ timeout: 6000 });
        await page.getByRole("option", { name: a.text ?? "" }).first().click({ timeout: 6000 });
      }
      return null;
    case "press":
      await page.keyboard.press(a.text || "Enter");
      return null;
    case "goto": {
      const path = (a.text ?? "/dashboard").trim();
      if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/api")) return "that address is outside the app";
      await page.goto(`${APP_URL}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return null;
    }
    case "scroll":
      await page.mouse.wheel(0, (a.text ?? "down").includes("up") ? -700 : 700);
      return null;
    case "upload": {
      if (!csvFile) return "you don't have a file to upload for this mission";
      const target = el ?? page.locator('input[type="file"]').first();
      await target.setInputFiles(csvFile, { timeout: 6000 });
      return null;
    }
    case "finish":
      return null;
  }
}

// ---------------------------------------------------------------- planning and debrief

export const planSchema = z.object({
  goal: z.string().describe("Your concrete goal in first person, with real specifics from YOUR situation (amounts, symbols you hold, dates). One or two sentences."),
  expectation: z.string().describe("What you'd expect to see if the app handles this well."),
  checks: z.string().describe("What you'll double-check before trusting the result (a number to verify, a total that should add up, a rule you know)."),
});
export type Plan = z.infer<typeof planSchema>;

export const debriefSchema = z.object({
  status: z.enum(["achieved", "struggled", "failed"]).catch("struggled").describe("achieved = done without real trouble; struggled = done but it was hard or you're not sure it's right; failed = couldn't do it or gave up"),
  difficulty: z.number().int().min(1).max(5).describe("1 = effortless, 5 = gave up"),
  summary: z.string().describe("Two sentences in your voice: what you tried and how it went."),
  trusted: z.boolean().describe("Do you trust the numbers you ended up with? Did your checks pass?"),
  issues: z
    .array(
      feedbackItem.extend({
        steps: z.string().describe("How to reproduce: the clicks and inputs that led to it"),
        expected: z.string(),
        actual: z.string(),
      }),
    )
    .describe("Real problems you hit: bugs, wrong numbers, confusing or missing things. Empty if none. Be specific; don't invent."),
  touched: z.array(z.string()).describe(`Feature ids you actually used on the way, from: ${FEATURES.map((f) => f.id).join(", ")}`),
  suggestion: z.string().nullable().describe("The one change that would have helped you most, or null."),
});
export type Debrief = z.infer<typeof debriefSchema>;

const MISSION_RULES = `
YOU ARE NOW USING THE APP IN A REAL BROWSER, to get something real done.
Each turn you get the current screen: its controls (with refs) and its text, plus a screenshot. You choose ONE action.
- Think like a careful, constructive person: before every action, say what you expect it to do; next turn, say whether it did. A surprise is valuable: describe it precisely.
- Verify what matters. Check numbers against what you know about your own money, totals that should add up, and things that should agree across pages.
- When something is confusing, do what a real person would: look around, hover, try another path, read the help text. Don't give up at the first hiccup, and don't push on past the point where you would in real life.
- Use only refs from the CONTROLS list. Typing replaces what's in the box. Use "goto" with a path (like /tax-center) to jump to a section, as if using the menu.
- This is your own account. Saving, editing and deleting are fine when your goal needs them.
- Choose "finish" when you've achieved the goal, when you're sure it can't be done, or when you'd give up in real life.`;

function brief(feature: Feature, plan: Plan): string {
  return `YOUR MISSION (${feature.id}): ${plan.goal}\nYou'd expect: ${plan.expectation}\nYou'll double-check: ${plan.checks}`;
}

// ---------------------------------------------------------------- the mission loop

export interface MissionResult {
  missionId: number;
  plan: Plan;
  steps: { i: number; route: string; action: Step["action"]; expect: string; noticed: string; surprise: string | null; error: string | null; ms: number; shot: string }[];
  debrief: Debrief | null;
  appErrors: { route: string; message: string }[];
  ms: number;
}

export async function runMission(
  ctx: BrowserContext,
  o: {
    persona: Persona;
    feature: Feature;
    holdingsBrief: string;
    themes: string;
    csvFile: string | null;
    /** What the persona knows about the file: its account and which rows are new. */
    csvNote?: string | null;
    viewport: "desktop" | "mobile";
    scheme: "light" | "dark";
    outDir: string;
    date: string;
    journal: Journal;
    runId: number;
  },
): Promise<MissionResult | null> {
  const { persona: p, feature, journal, runId } = o;
  // Hold back budget for the day's experience ratings, which come after missions.
  const llm = { journal, runId, personaId: p.id, reserveUsd: 0.5 };
  const system = `${personaSystem(p)}\n${MISSION_RULES}`;

  const plan = await askStructured({
    ...llm,
    purpose: "mission_plan",
    schema: planSchema,
    system: personaSystem(p),
    estimateUsd: 0.02,
    content: `Today is ${o.date}. You open Beobeo because you want to: ${feature.does}.
Make it concrete and real for YOU: what exactly do you want to find out or get done today? Use your real holdings and numbers.

What the app currently shows you hold:
${o.holdingsBrief}${o.csvFile ? `\n\nYou have a CSV export of your recent stock trades on your computer (${o.csvFile.split("/").pop()}). It's in Robinhood's export format (your broker's own export isn't one the app reads yet, so you converted it), and it overlaps with trades you've already entered.${o.csvNote ? ` ${o.csvNote}` : ""}` : ""}`,
  });
  if (!plan) return null;

  const missionId = journal.startMission({ runId, personaId: p.id, date: o.date, feature: feature.id, goal: plan.goal, expectation: plan.expectation, viewport: o.viewport, scheme: o.scheme });
  try {
    const page = await ctx.newPage();
    const appErrors: MissionResult["appErrors"] = [];
    const here = () => routeKey(new URL(page.url()).pathname);
    page.on("pageerror", (e) => appErrors.push({ route: here(), message: e.message.slice(0, 300) }));
    page.on("response", (r) => {
      const u = r.url();
      if (r.status() >= 500 || (u.includes("/api/trpc") && r.status() >= 400 && r.status() !== 401)) appErrors.push({ route: here(), message: `${r.status()} ${new URL(u).pathname}`.slice(0, 300) });
    });
    // A downloaded file (Transactions → Export) is shown to the persona on the
    // next step, the way it would open in their spreadsheet; otherwise an
    // export is a click with nothing to judge.
    const downloads: string[] = [];
    page.on("download", (d) => {
      void d.path().then(
        (path) => {
          const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
          downloads.push(`You downloaded ${d.suggestedFilename()} (${lines.length - 1} rows). Opened in your spreadsheet${lines.length > 31 ? ", the first 30 rows" : ""}:\n${lines.slice(0, 31).join("\n")}${columnSums(lines)}`);
        },
        () => downloads.push(`A download of ${d.suggestedFilename()} failed.`),
      );
    });

    const t0 = performance.now();
    await page.goto(`${APP_URL}${feature.route}`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    let lastMs = Math.round(performance.now() - t0);

    const steps: MissionResult["steps"] = [];
    let failures = 0;
    for (let i = 1; i <= MAX_STEPS; i++) {
      const obs = await observe(page);
      const shot = join(o.outDir, `mission-${missionId}-${String(i).padStart(2, "0")}.jpg`);
      await page.screenshot({ path: shot, type: "jpeg", quality: 55 }).catch(() => undefined);
      const errsNow = appErrors.length;
      const history = steps.slice(-8).map((s) => `${s.i}. on ${s.route}: ${s.action.kind}${s.action.ref ? ` ${s.action.ref}` : ""}${s.action.text ? ` "${s.action.text}"` : ""} — expected: ${s.expect}${s.error ? ` — FAILED: ${s.error}` : ""}${s.surprise ? ` — surprise: ${s.surprise}` : ""}`).join("\n");
      const content: Anthropic.ContentBlockParam[] = [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: readFileSync(shot).toString("base64") } },
        {
          type: "text",
          text: `${brief(feature, plan)}

  What you know about your own money:
  ${o.holdingsBrief}${o.csvNote ? `\n  About your CSV file: ${o.csvNote}` : ""}

  Steps so far:
  ${history || "(none yet: you just arrived)"}
  ${steps.at(-1)?.error ? `\nYour last action didn't work: ${steps.at(-1)!.error}` : ""}${downloads.length ? `\n${downloads.splice(0).join("\n\n")}\n` : ""}
  That last screen took ${(lastMs / 1000).toFixed(1)}s to settle.

  ${describe(obs)}

  Step ${i} of at most ${MAX_STEPS}. Choose your next action.`,
        },
      ];
      const step = await askStructured({ ...llm, purpose: "mission_step", schema: stepSchema, system, estimateUsd: 0.03, effort: "low", maxTokens: 2000, content });
      if (!step) break;

      let error: string | null = null;
      const ta = performance.now();
      if (step.action.kind !== "finish") {
        try {
          error = await act(page, step.action, obs, o.csvFile);
          await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
          await page.waitForTimeout(250);
        } catch (e) {
          error = (e as Error).message.split("\n")[0]!.slice(0, 200);
        }
      }
      lastMs = Math.round(performance.now() - ta);
      if (appErrors.length > errsNow) error = `${error ? `${error}; ` : ""}the app reported an error: ${appErrors.at(-1)!.message}`;
      steps.push({ i, route: obs.route, action: step.action, expect: step.expect, noticed: step.noticed, surprise: step.surprise, error, ms: lastMs, shot });
      journal.action({ runId, personaId: p.id, simDate: o.date, kind: "mission_step", detail: { missionId, ...steps.at(-1)! }, ok: !error, error: error ?? undefined, latencyMs: lastMs });
      console.log(`      ${String(i).padStart(2)}. ${obs.route.padEnd(14)} ${step.action.kind}${step.action.ref ? ` ${step.action.ref}` : ""}${step.action.text ? ` "${step.action.text.slice(0, 40)}"` : ""}${error ? `  ✗ ${error.slice(0, 80)}` : ""}${step.surprise ? `  ⚑ ${step.surprise.slice(0, 80)}` : ""}`);
      if (step.action.kind === "finish") break;
      failures = error ? failures + 1 : 0;
      if (failures >= 3) break;
    }

    // Debrief: look back over the whole attempt, with the final screen.
    const finalShot = join(o.outDir, `mission-${missionId}-final.jpg`);
    await page.screenshot({ path: finalShot, type: "jpeg", quality: 55 }).catch(() => undefined);
    const log = steps.map((s) => `${s.i}. [${s.route}] noticed: ${s.noticed} | expected: ${s.expect} | did: ${s.action.kind}${s.action.text ? ` "${s.action.text}"` : ""}${s.error ? ` | FAILED: ${s.error}` : ""}${s.surprise ? ` | SURPRISE: ${s.surprise}` : ""} (${(s.ms / 1000).toFixed(1)}s)`).join("\n");
    const debrief = await askStructured({
      ...llm,
      purpose: "mission_debrief",
      schema: debriefSchema,
      system: personaSystem(p),
      estimateUsd: 0.05,
      effort: "medium",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: readFileSync(finalShot).toString("base64") } },
        {
          type: "text",
          text: `${brief(feature, plan)}

  Here is everything you did, step by step:
  ${log || "(nothing: you couldn't get started)"}
  ${appErrors.length ? `\nErrors the app reported behind the scenes: ${appErrors.map((e) => `${e.message} on ${e.route}`).join("; ")}` : ""}

  The screenshot is where you ended up. Look back honestly: did you get it done, was it right, what got in your way?

  Existing feedback themes (reuse a key when it's the same problem):
  ${o.themes}`,
        },
      ],
    });
    await page.close();
    const ms = performance.now() - t0;
    const status = debrief?.status ?? "aborted";
    journal.finishMission(missionId, { status, difficulty: debrief?.difficulty ?? null, steps: steps.length, ms, summary: debrief?.summary ?? "(no debrief)", verdict: { plan, debrief, appErrors } });
    writeFileSync(join(o.outDir, `mission-${missionId}.json`), JSON.stringify({ persona: p.id, feature: feature.id, plan, steps, debrief, appErrors }, null, 2));
    return { missionId, plan, steps, debrief, appErrors, ms };
  } catch (e) {
    // A crash mid-mission (browser, budget) must not leave the mission looking like it's still running.
    journal.finishMission(missionId, { status: "aborted", difficulty: null, steps: 0, ms: 0, summary: `aborted: ${(e as Error).message.slice(0, 200)}`, verdict: { plan } });
    throw e;
  }
}
