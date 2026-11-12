/**
 * Build the evolution site from the journal, the persona files, PLAN.md and REQUESTS.md.
 * Three layers, each saying something the others don't:
 *
 *   index.html          Start here: what the loop is, how it works, who the personas are,
 *                       how to read the reports. Changes only when the system itself does.
 *   days/<date>.html    One page per simulated day, only that day's news: the delta vs. the
 *                       day before, what shipped that night, new themes, whether yesterday's
 *                       fix held, and what the personas did and said.
 *   progress.html       Everything so far: your requests, the change log, trends over every
 *                       day, open/shipped themes and the plan.
 *
 * /evolve regenerates and republishes it at the end of every cycle; run it by hand any time.
 *
 * Run: pnpm sim:report [--ref <git-ref>]
 * PLAN.md and REQUESTS.md are read from the working tree, unless an unmerged evolve/* branch
 * is newer than HEAD: then from that branch, so the site shows the plan as the loop left it.
 * Writes packages/sim/.out/site/ (publishable) and mirrors it to ~/beobeo-sim/site/.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Journal, simDir } from "../src/journal";
import { loadPersonas } from "../src/persona";
import { gitInfo } from "../src/run";
import { DAILY_BUDGET_USD } from "../src/budget";
import { budgetFor, percentile, rankThemes, scoreParts, type ThemeStats } from "../src/themes";
import { addDays, todayIso } from "../src/world";
import { FEATURES } from "../src/features";

const repo = new URL("../../../", import.meta.url).pathname;
const j = new Journal();
const git = gitInfo();
const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Which story each persona walked out of. */
const REALM: Record<string, "Westeros" | "Hogwarts"> = {
  samwell: "Westeros", arya: "Westeros", petyr: "Westeros", olenna: "Westeros", barristan: "Westeros",
  augusta: "Hogwarts", fred: "Hogwarts", minerva: "Hogwarts", gilderoy: "Hogwarts", luna: "Hogwarts", hermione: "Hogwarts", molly: "Hogwarts",
};

const sh = (c: string) => {
  try {
    return execSync(c, { cwd: repo, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
};
const one = <T>(sql: string, ...p: (string | number)[]) => j.get<T>(sql, ...p)!;
const runIdsOn = (date: string) => j.all<{ id: number; app_branch: string; app_sha: string }>("SELECT id, app_branch, app_sha FROM runs WHERE kind = 'day' AND sim_date = ? ORDER BY id", date);
const within = (ids: { id: number }[], col = "run_id") => (ids.length ? `${col} IN (${ids.map((r) => r.id).join(",")})` : "0");

// ---------------------------------------------------------------- where PLAN.md / REQUESTS.md come from
const unmerged = (sh(`git for-each-ref --sort=-refname --format='%(refname:short)' --no-merged main 'refs/heads/evolve/*'`) ?? "").split("\n").filter(Boolean);
const planRef = opt("ref") ?? (unmerged[0] && sh(`git merge-base --is-ancestor ${unmerged[0]} HEAD && echo yes`) !== "yes" ? unmerged[0] : null);
const repoFile = (f: string) => (planRef ? sh(`git show ${planRef}:${f}`) ?? "" : existsSync(`${repo}${f}`) ? readFileSync(`${repo}${f}`, "utf8") : "");

// ---------------------------------------------------------------- days
const dayDates = j.all<{ d: string }>("SELECT DISTINCT sim_date d FROM runs WHERE kind = 'day' ORDER BY sim_date").map((r) => r.d);
const lastDay = dayDates.at(-1) ?? todayIso();
const since = addDays(lastDay, -6);

// ---------------------------------------------------------------- PLAN.md
const plan = repoFile("PLAN.md");
const section = (title: string) => {
  const m = plan.split(/^## /m).find((s) => s.startsWith(title));
  return m ? m.slice(title.length).trim() : "";
};
/** Numbered list items "1. **Title.** body…" (with indented continuation lines). */
const numbered = (md: string) => {
  const items: { title: string; body: string }[] = [];
  let cur: { title: string; body: string } | null = null;
  for (const line of md.split("\n")) {
    const m = /^\d+\.\s+\*\*(.+?)\*\*\s*(.*)$/.exec(line);
    if (m) {
      cur = { title: m[1]!.replace(/[.:]$/, ""), body: m[2]! };
      items.push(cur);
    } else if (cur && (/^\s+\S/.test(line) || line === "")) {
      cur.body += ` ${line.trim()}`;
    } else cur = null; // a non-indented line ends the list
  }
  return items.map((i) => ({ title: i.title, body: i.body.replace(/\s+/g, " ").replace(/^- /, "").trim() }));
};
const bullets = (md: string) =>
  md
    .split(/\n(?=- )/)
    .filter((b) => b.startsWith("- "))
    .map((b) => b.slice(2).replace(/\s+/g, " ").trim());
const [backlogMain, gapsMd = ""] = section("Backlog").split("**Loop / simulator gaps**");
const capabilities = section("Capability map")
  .split("\n")
  .filter((l) => /^\|\s*(Product|Simulator|Loop)\s*\|/.test(l))
  .map((l) => {
    const [area, cap, status, note] = l.split("|").slice(1, -1).map((c) => c.trim());
    return { area: area!, cap: cap!, status: status as "built" | "partial" | "missing", note: note ?? "" };
  });
/** Evolution log entries "**2026-10-25 · Title.** body". */
const log = bullets(section("Evolution log")).map((b) => {
  const m = /^\*\*(\d{4}-\d{2}-\d{2})\s*·\s*(.+?)\*\*\s*(.*)$/.exec(b);
  return m ? { date: m[1]!, title: m[2]!.replace(/\.$/, ""), body: m[3]! } : { date: null, title: "", body: b };
});
const planData = {
  northStar: section("North star").split("\n\n")[0]!.replace(/\s+/g, " "),
  principles: numbered(section("Principles")),
  backlog: numbered(backlogMain ?? ""),
  gaps: bullets(gapsMd),
  capabilities,
};

// ---------------------------------------------------------------- REQUESTS.md (the user's own asks)
const requests = repoFile("REQUESTS.md")
  .split(/^## /m)
  .slice(1)
  .map((block) => {
    const [head, ...rest] = block.split("\n");
    const m = /^(R-\d+)\s*·\s*(.+)$/.exec(head!.trim());
    if (!m) return null;
    const field = (k: string) => new RegExp(`^- \\*\\*${k}:\\*\\*\\s*(.*)$`, "m").exec(rest.join("\n"))?.[1]?.trim() ?? "";
    const done: { text: string; ok: boolean }[] = [];
    let inDone = false;
    for (const line of rest) {
      if (/^- \*\*Done means:\*\*/.test(line)) { inDone = true; continue; }
      if (/^- \*\*/.test(line)) inDone = false;
      else if (inDone && /^\s+- /.test(line)) {
        const text = line.replace(/^\s+- /, "").trim();
        done.push({ text: text.replace(/^✓\s*/, ""), ok: text.startsWith("✓") });
      }
    }
    return { id: m[1]!, title: m[2]!, asked: field("Asked"), status: field("Status"), shippedOn: field("Shipped on"), words: field("In your words"), notes: field("Notes"), done };
  })
  .filter((r): r is NonNullable<typeof r> => r !== null);

// ---------------------------------------------------------------- personas (who they are: stable facts only)
const personaFiles = loadPersonas();
const firstSeen = (id: string) => j.get<{ d: string }>("SELECT MIN(sim_date) d FROM actions WHERE persona_id = ? AND kind != 'bootstrap'", id)?.d ?? null;
const personas = personaFiles.map((p) => ({
  id: p.id,
  name: p.name,
  age: p.age,
  realm: REALM[p.id] ?? "Elsewhere",
  life: p.life,
  strategy: p.strategy,
  tech: p.techSavviness,
  patienceMs: p.patienceMs,
  risk: p.riskTolerance,
  accounts: p.accounts.map((a) => a.type),
  symbols: p.universe.map((u) => u.symbol),
  joinedOn: p.joinedOn,
  version: p.version,
  explore: p.explore?.chance ?? null,
  firstDay: firstSeen(p.id),
}));
const personaRefs = personas.map((p) => ({ id: p.id, name: p.name }));

// ---------------------------------------------------------------- per-day building blocks
const DIMS = ["overall", "ease", "speed", "trust", "usefulness", "look"] as const;
type Dim = (typeof DIMS)[number];
const expAvg = (ids: { id: number }[]) => {
  const r = j.get<Record<Dim, number | null> & { n: number; recommend: number | null }>(
    `SELECT COUNT(*) n, AVG(overall) overall, AVG(ease) ease, AVG(speed) speed, AVG(trust) trust, AVG(usefulness) usefulness, AVG(look) look, AVG(recommend) recommend
       FROM experience WHERE ${within(ids)}`,
  );
  return r && r.n ? r : null;
};
const answerAvg = (ids: { id: number }[]) => one<{ r: number | null }>(`SELECT AVG(rating) r FROM questions WHERE rating IS NOT NULL AND ${within(ids)}`).r;
const latencyOf = (ids: { id: number }[]) => {
  const rows = j.all<{ target: string; ms: number }>(`SELECT target, ms FROM latency WHERE ${within(ids)} AND target != 'chat:total'`);
  const m = new Map<string, number[]>();
  for (const l of rows) m.set(l.target, [...(m.get(l.target) ?? []), l.ms]);
  return new Map([...m].map(([t, xs]) => [t, { n: xs.length, p50: percentile(xs, 50)!, p95: percentile(xs, 95)! }]));
};
const themeKeysOn = (ids: { id: number }[]) =>
  new Set(
    j.all<{ k: string }>(
      `SELECT DISTINCT f.theme_key k FROM feedback f JOIN themes t ON t.key = f.theme_key WHERE ${within(ids, "f.run_id")} AND t.status != 'wontfix' AND f.kind != 'praise'`,
    ).map((r) => r.k),
  );
const reportMd = (d: string) => {
  const f = join(simDir("reports"), `${d}.md`);
  return existsSync(f) ? readFileSync(f, "utf8") : null;
};

function dayData(date: string, idx: number) {
  const ids = runIdsOn(date);
  const w = within(ids);
  const prev = dayDates[idx - 1] ?? null;
  const prevIds = prev ? runIdsOn(prev) : [];

  const trades = j
    .all<{ persona: string; detail: string }>(`SELECT persona_id persona, detail FROM actions WHERE kind = 'trade' AND ok = 1 AND ${w} ORDER BY id`)
    .map((r) => ({ persona: r.persona, ...(JSON.parse(r.detail) as { type: string; symbol: string; account: string; usd: number; reason: string; why?: string }) }));

  const exp = j.all<{ persona: string; overall: number; why: string; recommend: number; explored: number }>(
    `SELECT persona_id persona, overall, why, recommend, explored FROM experience WHERE ${w} ORDER BY id`,
  );
  const prevExp = new Map(j.all<{ persona: string; overall: number }>(`SELECT persona_id persona, overall FROM experience WHERE ${within(prevIds)}`).map((e) => [e.persona, e.overall]));

  const voices = personaFiles
    .map((p) => {
      const th = j.get<{ detail: string }>(`SELECT detail FROM actions WHERE persona_id = ? AND kind = 'thought' AND ${w} ORDER BY id DESC LIMIT 1`, p.id);
      const rv = j.get<{ detail: string }>(`SELECT detail FROM actions WHERE persona_id = ? AND kind = 'review' AND ${w} ORDER BY id DESC LIMIT 1`, p.id);
      const q = j.get<{ question: string; rating: number | null }>(`SELECT question, rating FROM questions WHERE persona_id = ? AND ${w} ORDER BY id DESC LIMIT 1`, p.id);
      const thought = th ? (JSON.parse(th.detail) as { mood: string; question: string | null }) : null;
      const review = rv ? (JSON.parse(rv.detail) as { firstImpression: string; wouldKeepUsing: boolean }) : null;
      const e = exp.findLast((x) => x.persona === p.id);
      return {
        persona: p.id,
        mood: thought?.mood ?? null,
        question: q?.question ?? thought?.question ?? null,
        rating: q?.rating ?? null,
        impression: review?.firstImpression ?? null,
        keep: review ? review.wouldKeepUsing : null,
        day: e?.overall ?? null,
        dayWas: prevExp.get(p.id) ?? null,
        why: e?.why ?? null,
      };
    })
    .filter((v) => v.mood || v.question || v.impression || v.why);

  // Themes: new today, raised again, gone quiet since yesterday.
  const today = themeKeysOn(ids);
  const before = themeKeysOn(prevIds);
  const themesToday = j
    .all<{ key: string; title: string; personas: number; severity: number; first_seen: string }>(
      `SELECT f.theme_key key, t.title, COUNT(DISTINCT f.persona_id) personas, AVG(f.severity) severity, t.first_seen
         FROM feedback f JOIN themes t ON t.key = f.theme_key
        WHERE ${within(ids, "f.run_id")} AND t.status != 'wontfix' AND f.kind != 'praise'
        GROUP BY f.theme_key ORDER BY personas DESC, severity DESC`,
    )
    .map((t) => ({
      ...t,
      isNew: t.first_seen === date,
      quotes: j.all<{ persona: string; quote: string }>(`SELECT persona_id persona, quote FROM feedback WHERE theme_key = ? AND ${w} ORDER BY severity DESC LIMIT 2`, t.key),
    }));
  const quiet = [...before]
    .filter((k) => !today.has(k))
    .map((k) => j.get<{ key: string; title: string; status: string; shipped_on: string | null }>("SELECT key, title, status, shipped_on FROM themes WHERE key = ?", k)!)
    .filter(Boolean)
    // "fixed" only if the fix shipped before this day's personas met the app
    .map((t) => ({ key: t.key, title: t.title, fixed: t.shipped_on !== null && t.shipped_on < date }));
  // Yesterday's fixes, judged by today's personas: did the theme come back?
  const judged = prev
    ? j
        .all<{ key: string; title: string; shipped_on: string; shipped_branch: string | null }>(
          "SELECT key, title, shipped_on, shipped_branch FROM themes WHERE shipped_on >= ? AND shipped_on < ? ORDER BY shipped_on",
          prev,
          date,
        )
        .map((t) => ({
          ...t,
          raised: today.has(t.key),
          quote: today.has(t.key) ? (j.get<{ persona: string; quote: string }>(`SELECT persona_id persona, quote FROM feedback WHERE theme_key = ? AND ${w} ORDER BY severity DESC LIMIT 1`, t.key) ?? null) : null,
        }))
    : [];

  const exploreRows = j.all<{ persona: string; detail: string }>(`SELECT persona_id persona, detail FROM actions WHERE kind = 'explore' AND ${w} ORDER BY id`);
  const exploration = new Map<string, { steps: { action: string; target: string; to: string; ms: number; error?: string }[] }>();
  for (const r of exploreRows) {
    const e = exploration.get(r.persona) ?? { steps: [] };
    e.steps.push(JSON.parse(r.detail));
    exploration.set(r.persona, e);
  }
  const exploreErrors = j.all<{ persona: string; page: string; quote: string }>(`SELECT persona_id persona, page, quote FROM feedback WHERE theme_key LIKE 'error-%' AND ${w}`);

  const lat = latencyOf(ids);
  const latPrev = latencyOf(prevIds);
  const answers = j.all<{ persona: string; rating: number; question: string; note: string; firstTokenMs: number | null }>(
    `SELECT persona_id persona, rating, question, rating_note note, first_token_ms firstTokenMs FROM questions WHERE rating IS NOT NULL AND ${w} ORDER BY rating, persona_id`,
  );
  const signups = j.all<{ ok: number; latency_ms: number | null; error: string | null }>(`SELECT ok, latency_ms, error FROM actions WHERE kind = 'signup' AND ${w}`);
  const missions = j
    .all<{ id: number; persona: string; feature: string; goal: string; status: string; difficulty: number | null; steps: number; summary: string | null; verdict: string | null; viewport: string }>(
      "SELECT id, persona_id persona, feature, goal, status, difficulty, steps, summary, verdict, viewport FROM missions WHERE sim_date = ? ORDER BY id",
      date,
    )
    .map((m) => {
      const v = m.verdict ? (JSON.parse(m.verdict) as { plan?: { misbelief?: string | null }; outOfSteps?: boolean; debrief?: { issues?: { title: string; severity: number; expected: string; actual: string }[]; trusted?: boolean; suggestion?: string | null } }) : null;
      const path = j
        .all<{ detail: string }>("SELECT detail FROM actions WHERE kind = 'mission_step' AND json_extract(detail, '$.missionId') = ? ORDER BY id", m.id)
        .map((r) => JSON.parse(r.detail) as { route: string; action: { kind: string; text: string | null }; error: string | null; surprise: string | null });
      const { verdict: _v, ...rest } = m;
      return { ...rest, issues: v?.debrief?.issues ?? [], trusted: v?.debrief?.trusted ?? null, suggestion: v?.debrief?.suggestion ?? null, outOfSteps: v?.outOfSteps ?? false, misbelief: v?.plan?.misbelief ?? null, path: path.map((s) => ({ route: s.route, kind: s.action.kind, text: s.action.text, error: !!s.error, surprise: s.surprise })) };
    });

  return {
    date,
    dayNumber: idx + 1,
    prev,
    next: dayDates[idx + 1] ?? null,
    latest: lastDay,
    generatedAt: new Date().toISOString(),
    appRef: ids.at(-1) ? `${ids.at(-1)!.app_branch}@${ids.at(-1)!.app_sha}` : "unknown",
    personas: personaRefs,
    personasActive: one<{ n: number }>(`SELECT COUNT(DISTINCT persona_id) n FROM actions WHERE ${w}`).n,
    spend: one<{ usd: number | null }>(`SELECT SUM(usd) usd FROM costs WHERE ${w}`).usd ?? 0,
    feedbackCount: one<{ n: number }>(`SELECT COUNT(*) n FROM feedback WHERE ${w}`).n,
    delta: {
      exp: expAvg(ids),
      expWas: expAvg(prevIds),
      answers: answerAvg(ids),
      answersWas: prevIds.length ? answerAvg(prevIds) : null,
      quiet,
      judged,
      // A budget breach that wasn't one the day before.
      newlySlow: [...lat]
        .filter(([t, l]) => {
          const b = budgetFor(t);
          const p = latPrev.get(t);
          return b !== undefined && l.p95 > b && p !== undefined && p.p95 <= b;
        })
        .map(([t]) => t),
    },
    tonight: log.filter((e) => e.date === date),
    evolveReport: reportMd(date),
    trades,
    voices,
    themes: themesToday,
    latency: [...lat]
      .map(([target, l]) => ({ target, ...l, budget: budgetFor(target) ?? null, prevP95: latPrev.get(target)?.p95 ?? null }))
      .sort((a, b) => b.p95 / (b.budget ?? 1e9) - a.p95 / (a.budget ?? 1e9)),
    answers,
    signups,
    missions,
    exploration: [...exploration].map(([persona, e]) => ({ persona, ...e, errors: exploreErrors.filter((x) => x.persona === persona) })),
  };
}

const pages = dayDates.map((d, i) => dayData(d, i));
const history = pages
  .map((p) => ({
    date: p.date,
    trades: p.trades.length,
    feedback: p.feedbackCount,
    newThemes: p.themes.filter((t) => t.isNew).length,
    experience: p.delta.exp?.overall ?? null,
    answers: p.delta.answers,
    spend: p.spend,
    shipped: p.tonight.length > 0 || p.evolveReport !== null,
    headline: p.tonight.map((e) => e.title),
  }))
  .reverse();

// ---------------------------------------------------------------- cumulative: themes
const stats = j.all<ThemeStats>(
  `SELECT t.key, t.title, t.area, t.kind, t.status,
          COUNT(DISTINCT f.persona_id) personas, COUNT(DISTINCT date(f.created_at)) days,
          SUM(date(f.created_at) >= ?) recent, AVG(f.severity) avgSeverity, MAX(f.severity) maxSeverity
     FROM themes t JOIN feedback f ON f.theme_key = t.key GROUP BY t.key HAVING SUM(date(f.created_at) >= ?) > 0`,
  since,
  since,
);
const themes = rankThemes(stats)
  .slice(0, 12)
  .map((t) => ({
    ...t,
    parts: scoreParts(t),
    who: j.all<{ p: string }>("SELECT DISTINCT persona_id p FROM feedback WHERE theme_key = ?", t.key).map((r) => r.p),
    quotes: j.all<{ persona: string; quote: string }>("SELECT persona_id persona, quote FROM feedback WHERE theme_key = ? ORDER BY severity DESC, id DESC LIMIT 2", t.key),
  }));
const shippedThemes = j
  .all<{ key: string; title: string; status: string; shipped_on: string; shipped_branch: string | null }>(
    "SELECT key, title, status, shipped_on, shipped_branch FROM themes WHERE shipped_on IS NOT NULL ORDER BY shipped_on DESC, key",
  )
  .map((t) => ({ ...t, raisedSince: one<{ n: number }>("SELECT COUNT(*) n FROM feedback f JOIN runs r ON r.id = f.run_id WHERE f.theme_key = ? AND r.sim_date > ?", t.key, t.shipped_on).n, daysSince: dayDates.filter((d) => d > t.shipped_on).length }));
const artifacts = j.all<{ key: string; title: string; notes: string | null }>("SELECT key, title, notes FROM themes WHERE status = 'wontfix' ORDER BY last_seen DESC");
const praise = j.all<{ title: string; n: number }>("SELECT title, COUNT(*) n FROM feedback WHERE kind = 'praise' GROUP BY theme_key ORDER BY n DESC LIMIT 4");

// ---------------------------------------------------------------- cumulative: experience, latency, answers
const expDays = j.all<Record<Dim, number> & { date: string; n: number; recommend: number }>(
  `SELECT sim_date date, COUNT(*) n, AVG(overall) overall, AVG(ease) ease, AVG(speed) speed, AVG(trust) trust,
          AVG(usefulness) usefulness, AVG(look) look, AVG(recommend) recommend
     FROM experience GROUP BY sim_date ORDER BY sim_date`,
);
const expGrid = j.all<{ persona: string; date: string; overall: number; why: string }>(
  `SELECT persona_id persona, sim_date date, overall, why FROM experience e
    WHERE id = (SELECT MAX(id) FROM experience x WHERE x.persona_id = e.persona_id AND x.sim_date = e.sim_date)
    ORDER BY sim_date`,
);
const firstIds = dayDates[0] ? runIdsOn(dayDates[0]) : [];
const firstLat = latencyOf(firstIds);
const lat7 = j.all<{ target: string; ms: number }>(
  `SELECT l.target, l.ms FROM latency l JOIN runs r ON r.id = l.run_id WHERE r.kind = 'day' AND r.sim_date >= ? AND l.target != 'chat:total'`,
  since,
);
const byTarget = new Map<string, number[]>();
for (const l of lat7) byTarget.set(l.target, [...(byTarget.get(l.target) ?? []), l.ms]);
const latency = [...byTarget]
  .map(([target, xs]) => ({ target, n: xs.length, p50: percentile(xs, 50)!, p95: percentile(xs, 95)!, budget: budgetFor(target) ?? null, firstP95: firstLat.get(target)?.p95 ?? null }))
  .sort((a, b) => b.p95 / (b.budget ?? 1e9) - a.p95 / (a.budget ?? 1e9));
// Coverage map: every flow in the catalog × the last 21 days (best outcome that day).
const RANK: Record<string, number> = { achieved: 4, struggled: 3, failed: 2, visited: 1 };
const covRows = j.all<{ feature: string; date: string; outcome: string; source: string }>("SELECT feature, sim_date date, outcome, source FROM coverage");
const covDates = [...new Set([...dayDates, ...covRows.map((r) => r.date)])].sort().slice(-21);
const coverage = {
  dates: covDates,
  features: FEATURES.map((f) => {
    const mine = covRows.filter((r) => r.feature === f.id);
    const cells = covDates.map((d) => mine.filter((r) => r.date === d).reduce<string | null>((best, r) => ((RANK[r.outcome] ?? 0) > (best ? (RANK[best] ?? 0) : 0) ? r.outcome : best), null));
    const tried = mine.filter((r) => r.source !== "explore");
    return { id: f.id, does: f.does, route: f.route, cells, attempts: tried.filter((r) => r.source === "mission").length, last: tried.map((r) => r.date).sort().at(-1) ?? null };
  }),
};
const daily = pages.map((p) => ({ date: p.date, feedback: p.feedbackCount, answers: p.delta.answers, spend: p.spend, trades: p.trades.length }));

const site = {
  generatedAt: new Date().toISOString(),
  git,
  planRef: planRef ?? `${git.branch} (working tree)`,
  latest: lastDay,
  dayCount: dayDates.length,
  loopArmed: sh(`launchctl print gui/${process.getuid?.() ?? 501}/dev.beobeo.evolve`) !== null,
  unmerged,
  budget: DAILY_BUDGET_USD,
  spentToday: j.spentToday(),
  spentTotal: one<{ usd: number | null }>("SELECT SUM(usd) usd FROM costs").usd ?? 0,
  personas,
};

// ---------------------------------------------------------------- render
const asset = (f: string) => readFileSync(new URL(`../report/${f}`, import.meta.url), "utf8");
const css = asset("style.css");
const common = asset("common.js");
const json = (x: unknown) => JSON.stringify(x).replace(/</g, "\\u003c");
const fill = (tpl: string, d: unknown) =>
  tpl.replace("/*__CSS__*/", () => css).replace("/*__COMMON_JS__*/", () => common).replace("/*__DATA__*/null", () => json(d));
/** The index is an artifact body (the viewer adds the document shell); the offline mirror needs a real document. */
const wrapDoc = (body: string) =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>[hidden]{display:none!important}</style></head><body>\n${body}\n</body></html>`;

const index = fill(asset("start.html"), { ...site, plan: { northStar: planData.northStar, principles: planData.principles }, days: history.map((h) => ({ date: h.date, headline: h.headline })) });
const progress = fill(asset("progress.html"), {
  ...site,
  requests,
  log,
  history,
  daily,
  experience: { days: expDays, grid: expGrid },
  themes,
  shippedThemes,
  artifacts,
  praise,
  latency,
  coverage,
  plan: planData,
});

const out = new URL("../.out/site/", import.meta.url).pathname;
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "days"), { recursive: true });
writeFileSync(join(out, "index.html"), index);
writeFileSync(join(out, "progress.html"), progress);
for (const p of pages) writeFileSync(join(out, "days", `${p.date}.html`), fill(asset("day.html"), p).replace("/*__TITLE__*/", `Beobeo · ${p.date}`));

// Mirror to ~/beobeo-sim/site for offline browsing (index as a full document there).
const siteHome = simDir("site");
cpSync(join(out, "days"), join(siteHome, "days"), { recursive: true });
writeFileSync(join(siteHome, "progress.html"), progress);
writeFileSync(join(siteHome, "index.html"), wrapDoc(index));
console.log(`${join(out, "index.html")}  (plan from ${site.planRef})`);
