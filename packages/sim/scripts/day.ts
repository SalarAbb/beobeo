/**
 * One simulated day against the RUNNING app (pnpm dev must be up):
 *   1. each persona signs in, catches up its habits since the last run, and
 *      executes them through tRPC (timed);
 *   2. its LLM mind may trade beyond habits and ask the companion a question,
 *      then rates the answer;
 *   3. a rotating few do a screenshot walkthrough reviewed with vision;
 *   4. every 5th day a fresh clone registers through the real sign-up UI.
 * Everything lands in ~/beobeo-sim/journal.db.
 *
 *   5. personas who feel curious today (seeded chance per persona) wander the app at random;
 *   6. at the end, every persona rates the whole day (overall + five dimensions).
 *
 * Run: pnpm sim:day [--date YYYY-MM-DD] [--only id,id] [--no-llm] [--no-ui]
 */
import "../src/env";
import { AppClient, AppError } from "../src/app/client";
import { deviceStorage, launchBrowser, newContext, signUpViaUi, walkthrough, type Shot } from "../src/app/browser";
import { explore, type ExploreResult } from "../src/app/explore";
import { exploreProfile, mulberry32, seedFrom } from "../src/explore-rules";
import { BudgetExceeded } from "../src/budget";
import { Journal, simDir } from "../src/journal";
import { decide, rateAnswer, rateExperience, reviewUi, type FeedbackItem } from "../src/mind";
import { loadPersonas, simEmail, simPassword, type Persona } from "../src/persona";
import {
  gitInfo,
  holdingsBrief,
  loadPolicyState,
  marketBrief,
  replayPolicy,
  rotation,
  savePolicyState,
  themesBrief,
} from "../src/run";
import { ensureAssets, findUserId, loadHoldings, loadPriceBook, loadSimUser, marketData, type AssetRow } from "../src/store";
import { budgetFor } from "../src/themes";
import { addDays, fmtQty, todayIso, type PriceBook } from "../src/world";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const date = opt("date") ?? todayIso();
const only = opt("only")?.split(",");
const useLlm = !flag("no-llm") && !!process.env.ANTHROPIC_API_KEY;
const useUi = !flag("no-ui");
const UI_REVIEWS_PER_DAY = Number(process.env.SIM_UI_REVIEWS_PER_DAY || 3);

const journal = new Journal();
const git = gitInfo();
const runId = journal.startRun("day", { simDate: date, ...git });
const shotsDir = simDir("screenshots", date);
const notes: string[] = [];
let budgetHit = false;

function recordFeedback(personaId: string, items: FeedbackItem[], screenshot?: string) {
  for (const f of items) {
    journal.feedback({ runId, personaId, ...f, screenshot, appSha: git.sha, date });
  }
}

/** Latency is journaled for every call; over-budget-for-this-persona becomes feedback without an LLM. */
function timed(p: Persona, target: string, ms: number) {
  const budget = budgetFor(target);
  journal.latency(runId, p.id, target, ms, budget);
  if (ms > p.patienceMs * 1.5) {
    recordFeedback(p.id, [
      {
        page: target.replace(/^(trpc|page):/, ""),
        kind: "latency",
        area: "perf",
        severity: ms > p.patienceMs * 3 ? 4 : 3,
        themeKey: `slow-${target.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
        title: `Slow: ${target}`,
        quote: `${target} took ${(ms / 1000).toFixed(1)}s — I'd given up waiting by then.`,
      },
    ]);
  }
}

async function guard<T>(what: string, f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      if (!budgetHit) notes.push(e.message);
      budgetHit = true;
      return null;
    }
    notes.push(`${what}: ${(e as Error).message}`);
    console.log(`    ⚠ ${what}: ${(e as Error).message}`);
    return null;
  }
}

// ------------------------------------------------------------------ app up?
try {
  await fetch(new AppClient().baseUrl, { signal: AbortSignal.timeout(15_000) });
} catch {
  console.error(`App not reachable at ${new AppClient().baseUrl} — start it with \`pnpm dev\`.`);
  journal.finishRun(runId, "failed", "app not reachable");
  process.exit(1);
}

const personas = loadPersonas().filter((p) => !only || only.includes(p.id));
const sessions = new Map<string, { client: AppClient; brief: string; book: PriceBook; diary: string[]; explored: ExploreResult | null }>();
const browser = useUi ? await launchBrowser() : null;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const slug = (r: string) => r.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "root";

for (const p of personas) {
  console.log(`\n▸ ${p.name} (${p.id})`);
  journal.recordPersona(p.id, p.version, p);
  const email = simEmail(p.id);
  const userId = await findUserId(email);
  if (!userId) {
    console.log("    not bootstrapped yet — run `pnpm sim:bootstrap " + p.id + "` first");
    notes.push(`${p.id}: not bootstrapped`);
    continue;
  }

  // ---- sign in like a person would
  const client = new AppClient();
  const diary: string[] = [];
  const signedIn = await guard("sign-in", async () => {
    const r = await client.signIn(email, simPassword(p.id));
    timed(p, "auth:sign-in", r.ms);
    diary.push(`Signed in (${secs(r.ms)}).`);
    return true;
  });
  if (!signedIn) continue;

  const sim = await loadSimUser(userId);
  const assets = await ensureAssets(p.universe);
  const { holdings } = await loadHoldings(sim);
  const { state, lastDate } = loadPolicyState(journal, p.id);
  const from = lastDate ?? addDays(date, -1);
  const book = await loadPriceBook([...assets.values()], addDays(date, -400), date);
  if (date === todayIso()) await injectLiveQuotes(book, [...assets.values()], date);

  // ---- habits since the last run, executed through the real API
  const fills = replayPolicy(p, holdings, book, state, from, date);
  for (const f of fills) await executeTrade(p, client, sim.accounts, assets, f, f.date, `sim:${f.reason}`);
  savePolicyState(journal, p.id, state, date);
  const habitsToday = fills
    .map((f) => `${f.type} ${f.symbol} $${(f.qty * f.price).toFixed(0)} in ${f.account} (${f.reason}${f.date !== date ? `, ${f.date}` : ""})`)
    .join("\n");
  console.log(`    habits: ${fills.length} trade(s)`);
  if (fills.length) diary.push(`Your automatic habits ran: ${fills.map((f) => `${f.type} ${f.symbol} $${(f.qty * f.price).toFixed(0)}`).join(", ")}.`);

  // ---- what the dashboard costs this persona
  const overview = await guard("overview", async () => {
    const r = await client.query<Overview>("portfolio.overview", { window: "all" });
    timed(p, "trpc:portfolio.overview", r.ms);
    diary.push(`Your dashboard numbers loaded in ${secs(r.ms)}.`);
    return r.data;
  });
  await guard("timeseries", async () => timed(p, "trpc:portfolio.timeseries", (await client.query("portfolio.timeseries", {})).ms));

  // Personas judge the app against what the app itself shows them (their own
  // avg-cost ledger at live quotes would manufacture "numbers don't match" noise).
  const brief = overview ? appBrief(overview) : holdingsBrief(holdings, book, date);
  if (!overview) diary.push("Your dashboard failed to load.");

  // ---- curiosity: some days a persona wanders the app (seeded, so it can be replayed)
  const profile = exploreProfile(p);
  const rng = mulberry32(seedFrom(`${p.id}:${date}`));
  let explored: ExploreResult | null = null;
  if (browser && rng() < profile.chance) {
    const scheme = p.aesthetic.toLowerCase().includes("dark mode") ? "dark" : "light";
    const ctx = await newContext(browser, {
      viewport: rng() < 0.25 ? "mobile" : "desktop", scheme, cookies: client.cookieList, storage: deviceStorage(p, client.userId),
    });
    explored = await explore(ctx, { rng, profile, symbols: p.universe.map((u) => u.symbol), outDir: shotsDir, tag: p.id }).catch((e) => {
      notes.push(`${p.id}: exploration crashed: ${(e as Error).message}`);
      return null;
    });
    await ctx.close();
  }
  if (explored) recordExploration(p, explored, diary);
  sessions.set(p.id, { client, brief, book, diary, explored });
  if (!useLlm || budgetHit) continue;

  mind: {

  // ---- the mind: discretionary trades + a question
  const spentThisMonth = journal.get<{ usd: number | null }>(
    "SELECT SUM(json_extract(detail, '$.usd')) AS usd FROM actions WHERE persona_id = ? AND kind = 'trade' AND json_extract(detail, '$.reason') = 'mind' AND substr(sim_date, 1, 7) = ?",
    p.id,
    date.slice(0, 7),
  )?.usd ?? 0;
  const recent = journal
    .all<{ detail: string }>(
      "SELECT detail FROM actions WHERE persona_id = ? AND kind = 'thought' ORDER BY id DESC LIMIT 5",
      p.id,
    )
    .map((r) => (JSON.parse(r.detail) as { mood: string; date: string }))
    .map((t) => `${t.date}: ${t.mood}`)
    .join(" | ");
  // What they already asked and how it went. Without this every persona re-asked
  // near-identical questions daily (audit 2026-10-25); real people follow up or move on.
  const asked = journal
    .all<{ sim_date: string; question: string; rating: number | null; note: string | null }>(
      "SELECT r.sim_date, q.question, q.rating, q.rating_note AS note FROM questions q JOIN runs r ON r.id = q.run_id WHERE q.persona_id = ? ORDER BY q.id DESC LIMIT 3",
      p.id,
    )
    .map((q) => `${q.sim_date}: you asked "${q.question}"${q.rating ? ` and rated the answer ${q.rating}/5 (${(q.note ?? "").slice(0, 160)})` : ""}`)
    .join("\n");
  const decision = await guard("decide", () =>
    decide(
      p,
      {
        date,
        marketBrief: marketBrief(p, book, date),
        holdingsBrief: brief,
        habitsToday,
        discretionaryLeftUsd: Math.max(0, p.discretionaryUsdPerMonth - spentThisMonth),
        recentThoughts: recent,
        recentQuestions: asked,
        accountNames: p.accounts.map((a) => a.name),
      },
      { journal, runId },
    ),
  );
  if (!decision) break mind;
  journal.action({ runId, personaId: p.id, simDate: date, kind: "thought", detail: { date, mood: decision.mood, question: decision.question }, ok: true });
  console.log(`    mood: ${decision.mood}`);

  let left = Math.max(0, p.discretionaryUsdPerMonth - spentThisMonth);
  for (const t of decision.trades) {
    const inst = p.universe.find((i) => i.symbol === t.symbol.toUpperCase());
    const close = inst ? book.closeAsOf(inst.symbol, date) : null;
    // The prompt lists accounts as "Webull (taxable)"; the mind sometimes echoes the suffix back.
    const acct = [...sim.accounts.keys()].find((a) => a.toLowerCase() === t.account.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase());
    if (acct) t.account = acct;
    if (!inst || !close || !acct) {
      notes.push(`${p.id}: mind proposed invalid trade ${t.type} ${t.symbol} in ${t.account}`);
      continue;
    }
    const usd = t.type === "buy" ? Math.min(t.usd, left) : t.usd;
    if (usd < 1) continue;
    const fill = holdings.apply({ type: t.type, account: t.account, symbol: inst.symbol, qty: usd / close.close, price: close.close });
    if (!fill) continue;
    if (t.type === "buy") left -= usd;
    await executeTrade(p, client, sim.accounts, assets, { ...fill, reason: "mind" }, date, `sim:mind — ${t.why.slice(0, 200)}`);
    diary.push(`You decided to ${t.type} $${usd.toFixed(0)} of ${inst.symbol} and entered it in the app.`);
    console.log(`    mind: ${t.type} ${inst.symbol} $${usd.toFixed(0)} — ${t.why}`);
  }

  if (decision.question && !budgetHit) {
    const q = decision.question;
    console.log(`    asks: ${q}`);
    const answer = await client.chat(q);
    if (answer.firstTokenMs !== null) timed(p, "chat:first-token", answer.firstTokenMs);
    journal.latency(runId, p.id, "chat:total", answer.totalMs);
    const rating = await guard("rate", () =>
      rateAnswer(
        p,
        { question: q, answer: answer.text, firstTokenMs: answer.firstTokenMs, totalMs: answer.totalMs, holdingsBrief: brief, themes: themesBrief(journal) },
        { journal, runId },
      ),
    );
    journal.question({
      runId,
      personaId: p.id,
      question: q,
      answer: answer.text || answer.error,
      tools: answer.tools,
      firstTokenMs: answer.firstTokenMs ?? undefined,
      totalMs: Math.round(answer.totalMs),
      rating: rating?.rating,
      ratingNote: rating?.note,
    });
    diary.push(
      `You asked the assistant: "${q}". ${answer.firstTokenMs === null ? "It never started answering." : `It started answering after ${secs(answer.firstTokenMs)} and finished after ${secs(answer.totalMs)}.`}` +
        (rating ? ` You rated the answer ${rating.rating}/5: ${rating.note}` : ""),
    );
    if (rating) {
      recordFeedback(p.id, rating.feedback);
      console.log(`    rated answer ${rating.rating}/5 — ${rating.note}`);
    }
  }
  }
}

// ------------------------------------------------------------------ UI walkthroughs + registration probe
if (browser && useLlm && !budgetHit) {
  try {
    const reviewers = rotation(personas.filter((p) => sessions.has(p.id)), date, UI_REVIEWS_PER_DAY);
    for (const p of reviewers) {
      if (budgetHit) break;
      const s = sessions.get(p.id)!;
      console.log(`\n◆ UI review: ${p.name}`);
      const shots: Shot[] = [];
      const scheme = p.aesthetic.toLowerCase().includes("dark mode") ? "dark" : "light";
      // Review what they actually wandered into today, when they explored; otherwise the core pages.
      if ((s.explored?.shots.length ?? 0) >= 2) shots.push(...s.explored!.shots.slice(0, 3));
      else {
        const desktop = await newContext(browser, {
          viewport: "desktop", scheme, cookies: s.client.cookieList, storage: deviceStorage(p, s.client.userId),
        });
        shots.push(...(await walkthrough(desktop, ["/dashboard", "/tax-center", "/transactions"], shotsDir, `${p.id}-desktop-${scheme}`)));
        await desktop.close();
      }
      const mobile = await newContext(browser, {
        viewport: "mobile", scheme, cookies: s.client.cookieList, storage: deviceStorage(p, s.client.userId),
      });
      shots.push(...(await walkthrough(mobile, ["/dashboard"], shotsDir, `${p.id}-mobile-${scheme}`)));
      await mobile.close();
      for (const sh of shots) {
        timed(p, `page:${sh.route}`, sh.ms);
        journal.action({ runId, personaId: p.id, simDate: date, kind: "navigate", detail: sh, ok: !sh.finalUrl.includes("/signin"), latencyMs: Math.round(sh.ms) });
      }
      const mission = p.typicalQuestions[Math.floor(Date.parse(date) / 86_400_000) % p.typicalQuestions.length]!;
      const review = await guard("review", () =>
        reviewUi(p, shots, { holdingsBrief: s.brief, themes: themesBrief(journal), mission: `find out: "${mission}"` }, { journal, runId }),
      );
      if (review) {
        journal.action({ runId, personaId: p.id, simDate: date, kind: "review", detail: { firstImpression: review.firstImpression, wouldKeepUsing: review.wouldKeepUsing, mission }, ok: true });
        recordFeedback(p.id, review.feedback, shots[0]?.file);
        s.diary.push(`You looked carefully through ${shots.map((x) => x.route).join(", ")}. Your impression: ${review.firstImpression}`);
        console.log(`    "${review.firstImpression}" — ${review.feedback.length} note(s)`);
      }
    }

    // Every 5th day: a brand-new account through the real sign-up form.
    const dayNo = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
    if (dayNo % 5 === 0 && !budgetHit) {
      const p = rotation(personas, date, 1)[0]!;
      console.log(`\n✚ Fresh registration as ${p.name}`);
      const ctx = await newContext(browser, { viewport: "desktop", scheme: "light" });
      const res = await signUpViaUi(ctx, { name: p.name, email: simEmail(p.id, `-reg${date.replaceAll("-", "")}`), password: simPassword(p.id) }, shotsDir, `${p.id}-register`);
      await ctx.close();
      timed(p, "signup", res.ms);
      journal.action({ runId, personaId: p.id, simDate: date, kind: "signup", detail: { landedOn: res.landedOn, shots: res.shots.map((s) => s.file) }, ok: res.ok, error: res.error, latencyMs: Math.round(res.ms) });
      if (res.ok) {
        const review = await guard("signup-review", () =>
          reviewUi(p, res.shots, { holdingsBrief: "(brand-new account, nothing added yet)", themes: themesBrief(journal), mission: "sign up for the first time and get set up — including telling it about your accounts and taxes" }, { journal, runId }),
        );
        if (review) recordFeedback(p.id, review.feedback, res.shots.at(-1)?.file);
      } else {
        recordFeedback(p.id, [{ page: "signup", kind: "bug", area: "ux", severity: 5, themeKey: "signup-fails", title: "Sign-up does not complete", quote: `I couldn't create an account: ${res.error}` }]);
      }
    }
  } catch (e) {
    notes.push(`ui: ${(e as Error).message}`);
  }
}
await browser?.close();

// ------------------------------------------------------------------ how was today, all things considered?
if (useLlm) {
  console.log("\n★ Experience ratings");
  for (const p of personas) {
    const s = sessions.get(p.id);
    if (!s || budgetHit) continue;
    const prev = journal.get<{ overall: number; why: string; sim_date: string }>(
      "SELECT overall, why, sim_date FROM experience WHERE persona_id = ? AND sim_date < ? ORDER BY sim_date DESC, id DESC LIMIT 1",
      p.id,
      date,
    );
    const exp = await guard("experience", () =>
      rateExperience(p, { date, diary: s.diary.map((l) => `- ${l}`).join("\n"), yesterday: prev ? `${prev.overall}/5 on ${prev.sim_date} ("${prev.why}")` : null }, { journal, runId }),
    );
    if (!exp) continue;
    journal.experience({ runId, personaId: p.id, date, ...exp, explored: s.explored !== null });
    console.log(`    ${p.name.padEnd(20)} ${exp.overall}/5  ease ${exp.ease} · speed ${exp.speed} · trust ${exp.trust} · useful ${exp.usefulness} · look ${exp.look} — ${exp.why}`);
  }
}

journal.finishRun(runId, notes.length ? "partial" : "ok", notes.join("\n") || undefined);
const spent = journal.spentToday();
console.log(`\nDone. LLM spend today: $${spent.toFixed(2)}${budgetHit ? " (budget reached — optional work skipped)" : ""}${notes.length ? `\n${notes.length} note(s):\n  ${notes.join("\n  ")}` : ""}`);
process.exit(0);

// ------------------------------------------------------------------ helpers

/** Journal a wander: every step, timings, errors and unlabeled controls become data; the persona remembers the path. */
function recordExploration(p: Persona, x: ExploreResult, diary: string[]) {
  for (const st of x.steps) {
    journal.action({ runId, personaId: p.id, simDate: date, kind: "explore", detail: st, ok: !st.error, error: st.error, latencyMs: st.ms });
    if (!st.error) timed(p, st.action === "goto" ? `page:${st.to}` : `interact:${st.from}`, st.ms);
  }
  const seenErr = new Set<string>();
  for (const e of x.errors) {
    if (seenErr.has(e.route + e.message)) continue;
    seenErr.add(e.route + e.message);
    recordFeedback(p.id, [{ page: e.route, kind: "bug", area: "correctness", severity: 4, themeKey: `error-${slug(e.route)}`, title: `Error on ${e.route}`, quote: `Something broke while I was on ${e.route}: ${e.message}` }]);
  }
  for (const [route, n] of x.unlabeled) {
    recordFeedback(p.id, [{ page: route, kind: "friction", area: "ux", severity: 2, themeKey: `unlabeled-buttons-${slug(route)}`, title: `Unlabeled buttons on ${route}`, quote: `${n} button${n === 1 ? "" : "s"} on ${route} ${n === 1 ? "has" : "have"} no label, so I can't tell what ${n === 1 ? "it does" : "they do"} before clicking.` }]);
  }
  const path = x.steps.filter((st) => !st.error).map((st) => (st.action === "goto" ? `went to ${st.to}` : st.action === "escape" ? "pressed Escape" : st.action === "fill" ? `typed "${st.target}"` : `clicked "${st.target}"`) + ` (${secs(st.ms)})`);
  diary.push(`You wandered around the app: ${path.join(" → ")}.`);
  if (x.errors.length) diary.push(`Along the way something went wrong: ${[...seenErr].length} error(s), e.g. ${x.errors[0]!.message} on ${x.errors[0]!.route}.`);
  console.log(`    explored: ${x.steps.length} steps · ${new Set(x.steps.map((st) => st.to)).size} pages · ${x.errors.length} errors · ${[...x.unlabeled.values()].reduce((a, b) => a + b, 0)} unlabeled buttons`);
}

interface Overview {
  holdings: { symbol: string; quantity: number; costBasis: number; marketValue: number | null; unrealizedGainPct: number | null; priceDate: string | null }[];
  dataIssues: { symbol: string; message?: string }[];
  totals: { value: number; cost: number; unrealizedPct: number | null; realized: number; dividends: number };
}

/** The persona's portfolio exactly as the app's dashboard shows it. */
function appBrief(o: Overview): string {
  const usd = (x: number) => `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const pct = (x: number | null) => (x === null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
  const lines = o.holdings.map(
    (h) => `${h.symbol}: ${h.quantity.toFixed(4)} units, cost ${usd(h.costBasis)}, now ${h.marketValue === null ? "no price" : usd(h.marketValue)} (${pct(h.unrealizedGainPct)})${h.priceDate ? ` · priced ${h.priceDate}` : ""}`,
  );
  const issues = o.dataIssues.length ? `\nThe app flags data issues for: ${o.dataIssues.map((d) => d.symbol).join(", ")}` : "";
  return `(as shown on your Beobeo dashboard)\n${lines.join("\n")}\nTOTAL: ${usd(o.totals.value)} on ${usd(o.totals.cost)} cost (${pct(o.totals.unrealizedPct)}) · realized ${usd(o.totals.realized)} · dividends ${usd(o.totals.dividends)}${issues}`;
}

/**
 * Real-time: today has no close yet, so personas trade at the live quote.
 * Crypto trades every day; equities only on weekdays (Tiingo's IEX endpoint
 * returns a stale last price on weekends). Exchange holidays aren't modeled.
 */
async function injectLiveQuotes(book: PriceBook, assets: AssetRow[], day: string) {
  const weekday = ![0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
  for (const a of assets) {
    if (book.tradesOn(a.symbol, day) || (a.class !== "crypto" && !weekday)) continue;
    const q = await marketData()
      .getPriceForDate({ id: a.id, symbol: a.symbol, class: a.class, providerRef: a.providerRef }, day)
      .catch(() => null);
    if (q?.source === "quote") book.setClose(a.symbol, day, Number(q.price));
  }
}

async function executeTrade(
  p: Persona,
  client: AppClient,
  accounts: Map<string, string>,
  assets: Map<string, AssetRow>,
  f: { type: "buy" | "sell"; account: string; symbol: string; qty: number; price: number; reason: string },
  day: string,
  note: string,
) {
  const asset = assets.get(f.symbol)!;
  const detail = {
    type: f.type, symbol: f.symbol, account: f.account, qty: f.qty, price: f.price, usd: f.qty * f.price, reason: f.reason,
    ...(f.reason === "mind" ? { why: note.replace(/^sim:mind — /, "") } : {}),
  };
  try {
    const r = await client.mutate("transactions.create", {
      accountId: accounts.get(f.account)!,
      assetId: asset.id,
      type: f.type,
      quantity: fmtQty(f.qty, asset.class === "crypto"),
      pricePerUnit: f.price.toFixed(f.price < 1 ? 8 : 4),
      fees: "0",
      tradedAt: new Date(`${day}T20:00:00Z`),
      note,
      source: "sim",
    });
    timed(p, "trpc:transactions.create", r.ms);
    journal.action({ runId, personaId: p.id, simDate: day, kind: "trade", detail, ok: true, latencyMs: Math.round(r.ms) });
  } catch (e) {
    const msg = (e as Error).message;
    journal.action({ runId, personaId: p.id, simDate: day, kind: "trade", detail, ok: false, error: msg, latencyMs: e instanceof AppError ? Math.round(e.ms) : undefined });
    notes.push(`${p.id}: trade failed ${f.type} ${f.symbol}: ${msg}`);
  }
}
