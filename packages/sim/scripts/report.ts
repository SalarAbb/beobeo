/**
 * Build the live evolution page: one self-contained HTML file rendered from
 * the journal, the persona files and PLAN.md. /evolve regenerates and
 * republishes it at the end of every cycle; run it by hand any time.
 *
 * Run: pnpm sim:report
 * Writes the site to packages/sim/.out/site/ (publishable: index.html + days/<date>.html +
 * snapshots/<date>.html) and mirrors it to ~/beobeo-sim/site/. Snapshots are permanent: each
 * run freezes today's index there, so the page's whole history survives.
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

const repo = new URL("../../../", import.meta.url).pathname;
const j = new Journal();
const git = gitInfo();

/** Which story each persona walked out of. */
const REALM: Record<string, "Westeros" | "Hogwarts"> = {
  samwell: "Westeros", arya: "Westeros", petyr: "Westeros", olenna: "Westeros",
  augusta: "Hogwarts", fred: "Hogwarts", minerva: "Hogwarts", gilderoy: "Hogwarts", luna: "Hogwarts", hermione: "Hogwarts",
};

const sh = (c: string) => {
  try {
    return execSync(c, { cwd: repo, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- latest cycle
const lastDay = j.get<{ sim_date: string }>("SELECT sim_date FROM runs WHERE kind = 'day' ORDER BY id DESC LIMIT 1")?.sim_date ?? todayIso();
const dayRuns = j.all<{ id: number; app_branch: string; app_sha: string }>("SELECT id, app_branch, app_sha FROM runs WHERE kind = 'day' AND sim_date = ?", lastDay);
const inRuns = dayRuns.length ? `run_id IN (${dayRuns.map((r) => r.id).join(",")})` : "0";
const one = <T>(sql: string, ...p: (string | number)[]) => j.get<T>(sql, ...p)!;
const since = addDays(lastDay, -6);

const cycle = {
  date: lastDay,
  dayNumber: one<{ n: number }>("SELECT COUNT(DISTINCT sim_date) n FROM runs WHERE kind = 'day'").n,
  appRef: dayRuns.at(-1) ? `${dayRuns.at(-1)!.app_branch}@${dayRuns.at(-1)!.app_sha}` : `${git.branch}@${git.sha}`,
  trades: one<{ n: number }>(`SELECT COUNT(*) n FROM actions WHERE kind = 'trade' AND ok = 1 AND ${inRuns}`).n,
  mindTrades: one<{ n: number }>(`SELECT COUNT(*) n FROM actions WHERE kind = 'trade' AND ok = 1 AND json_extract(detail,'$.reason') = 'mind' AND ${inRuns}`).n,
  questions: one<{ n: number }>(`SELECT COUNT(*) n FROM questions WHERE ${inRuns}`).n,
  avgRating: one<{ r: number | null }>(`SELECT AVG(rating) r FROM questions WHERE rating IS NOT NULL AND ${inRuns}`).r,
  reviews: one<{ n: number }>(`SELECT COUNT(*) n FROM actions WHERE kind = 'review' AND ${inRuns}`).n,
  signups: one<{ n: number }>(`SELECT COUNT(*) n FROM actions WHERE kind = 'signup' AND ${inRuns}`).n,
  feedback: one<{ n: number }>(`SELECT COUNT(*) n FROM feedback WHERE ${inRuns}`).n,
  timings: one<{ n: number }>(`SELECT COUNT(*) n FROM latency WHERE ${inRuns}`).n,
  spend: one<{ usd: number | null }>(`SELECT SUM(usd) usd FROM costs WHERE ${inRuns}`).usd ?? 0,
  themesOpen: one<{ n: number }>("SELECT COUNT(*) n FROM themes WHERE status = 'open'").n,
  themesShipped: one<{ n: number }>("SELECT COUNT(*) n FROM themes WHERE status IN ('shipped','resolved')").n,
  themesArtifact: one<{ n: number }>("SELECT COUNT(*) n FROM themes WHERE status = 'wontfix'").n,
};

const days = j.all<{ date: string; feedback: number; rating: number | null; spend: number | null }>(
  `SELECT r.sim_date date,
          (SELECT COUNT(*) FROM feedback f WHERE f.run_id IN (SELECT id FROM runs WHERE sim_date = r.sim_date AND kind='day')) feedback,
          (SELECT AVG(rating) FROM questions q WHERE q.run_id IN (SELECT id FROM runs WHERE sim_date = r.sim_date AND kind='day')) rating,
          (SELECT SUM(usd) FROM costs c WHERE c.run_id IN (SELECT id FROM runs WHERE sim_date = r.sim_date AND kind='day')) spend
     FROM runs r WHERE r.kind = 'day' GROUP BY r.sim_date ORDER BY r.sim_date`,
);

// ---------------------------------------------------------------- themes
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
    quotes: j.all<{ persona: string; quote: string; page: string | null }>(
      "SELECT persona_id persona, quote, page FROM feedback WHERE theme_key = ? ORDER BY severity DESC, id DESC LIMIT 2",
      t.key,
    ),
  }));
const artifacts = j.all<{ key: string; title: string; notes: string | null }>("SELECT key, title, notes FROM themes WHERE status = 'wontfix' ORDER BY last_seen DESC");
const praise = j.all<{ title: string; n: number }>("SELECT title, COUNT(*) n FROM feedback WHERE kind = 'praise' GROUP BY theme_key ORDER BY n DESC LIMIT 4");

// ---------------------------------------------------------------- personas
const personas = loadPersonas().map((p) => {
  const lastThought = j.get<{ detail: string }>("SELECT detail FROM actions WHERE persona_id = ? AND kind = 'thought' ORDER BY id DESC LIMIT 1", p.id);
  const lastReview = j.get<{ detail: string }>("SELECT detail FROM actions WHERE persona_id = ? AND kind = 'review' ORDER BY id DESC LIMIT 1", p.id);
  const boot = j.get<{ detail: string }>("SELECT detail FROM actions WHERE persona_id = ? AND kind = 'bootstrap' AND ok = 1 ORDER BY id DESC LIMIT 1", p.id);
  const bootTrades = boot ? (JSON.parse(boot.detail) as { trades: number }).trades : 0;
  const bootId = j.get<{ id: number }>("SELECT id FROM actions WHERE persona_id = ? AND kind = 'bootstrap' AND ok = 1 ORDER BY id DESC LIMIT 1", p.id)?.id ?? 0;
  return {
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
    trades: bootTrades + one<{ n: number }>("SELECT COUNT(*) n FROM actions WHERE persona_id = ? AND kind = 'trade' AND ok = 1 AND id > ?", p.id, bootId).n,
    notes: one<{ n: number }>("SELECT COUNT(*) n FROM feedback WHERE persona_id = ?", p.id).n,
    mood: lastThought ? (JSON.parse(lastThought.detail) as { mood: string }).mood : null,
    rating: j.get<{ r: number }>("SELECT rating r FROM questions WHERE persona_id = ? AND rating IS NOT NULL ORDER BY id DESC LIMIT 1", p.id)?.r ?? null,
    experience: j.get<{ overall: number; why: string }>("SELECT overall, why FROM experience WHERE persona_id = ? ORDER BY sim_date DESC, id DESC LIMIT 1", p.id) ?? null,
    keep: lastReview ? (JSON.parse(lastReview.detail) as { wouldKeepUsing: boolean }).wouldKeepUsing : null,
  };
});

// ---------------------------------------------------------------- latency & answers
const lat = j.all<{ target: string; ms: number }>("SELECT target, ms FROM latency WHERE date(created_at) >= ? AND target != 'chat:total'", since);
const byTarget = new Map<string, number[]>();
for (const l of lat) byTarget.set(l.target, [...(byTarget.get(l.target) ?? []), l.ms]);
const latency = [...byTarget]
  .map(([target, xs]) => ({ target, n: xs.length, p50: percentile(xs, 50)!, p95: percentile(xs, 95)!, budget: budgetFor(target) ?? null }))
  .sort((a, b) => b.p95 / (b.budget ?? 1e9) - a.p95 / (a.budget ?? 1e9));
const answers = j.all<{ persona: string; rating: number; question: string; note: string; firstTokenMs: number | null }>(
  `SELECT persona_id persona, rating, question, rating_note note, first_token_ms firstTokenMs FROM questions WHERE rating IS NOT NULL AND ${inRuns} ORDER BY rating, persona_id`,
);

// ---------------------------------------------------------------- PLAN.md
const plan = readFileSync(`${repo}PLAN.md`, "utf8");
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
const backlogMd = section("Backlog");
const [backlogMain, gapsMd = ""] = backlogMd.split("**Loop / simulator gaps**");
const capabilities = section("Capability map")
  .split("\n")
  .filter((l) => /^\|\s*(Product|Simulator|Loop)\s*\|/.test(l))
  .map((l) => {
    const [area, cap, status, note] = l.split("|").slice(1, -1).map((c) => c.trim());
    return { area: area!, cap: cap!, status: status as "built" | "partial" | "missing", note: note ?? "" };
  });

// ---------------------------------------------------------------- REQUESTS.md (the user's own asks)
const requestsMd = existsSync(`${repo}REQUESTS.md`) ? readFileSync(`${repo}REQUESTS.md`, "utf8") : "";
const requests = requestsMd
  .split(/^## /m)
  .slice(1)
  .map((block) => {
    const [head, ...rest] = block.split("\n");
    const m = /^(R-\d+)\s*·\s*(.+)$/.exec(head!.trim());
    if (!m) return null;
    const field = (k: string) => new RegExp(`^- \\*\\*${k}:\\*\\*\\s*(.*)$`, "m").exec(rest.join("\n"))?.[1]?.trim() ?? "";
    const done: string[] = [];
    let inDone = false;
    for (const line of rest) {
      if (/^- \*\*Done means:\*\*/.test(line)) { inDone = true; continue; }
      if (/^- \*\*/.test(line)) inDone = false;
      else if (inDone && /^\s+- /.test(line)) done.push(line.replace(/^\s+- /, "").trim());
    }
    return { id: m[1]!, title: m[2]!, asked: field("Asked"), status: field("Status"), shippedOn: field("Shipped on"), words: field("In your words"), notes: field("Notes"), done };
  })
  .filter((r): r is NonNullable<typeof r> => r !== null);

// ---------------------------------------------------------------- experience over time
const DIMS = ["overall", "ease", "speed", "trust", "usefulness", "look"] as const;
const expDays = j.all<Record<(typeof DIMS)[number], number> & { date: string; n: number; recommend: number }>(
  `SELECT sim_date date, COUNT(*) n, AVG(overall) overall, AVG(ease) ease, AVG(speed) speed, AVG(trust) trust,
          AVG(usefulness) usefulness, AVG(look) look, AVG(recommend) recommend
     FROM experience GROUP BY sim_date ORDER BY sim_date`,
);
const expGrid = j.all<{ persona: string; date: string; overall: number; why: string }>(
  // the latest rating per persona per day
  `SELECT persona_id persona, sim_date date, overall, why FROM experience e
    WHERE id = (SELECT MAX(id) FROM experience x WHERE x.persona_id = e.persona_id AND x.sim_date = e.sim_date)
    ORDER BY sim_date`,
);
const experience = { days: expDays, grid: expGrid };

const data = {
  generatedAt: new Date().toISOString(),
  git,
  loopArmed: sh(`launchctl print gui/${process.getuid?.() ?? 501}/dev.beobeo.evolve`) !== null,
  unmerged: (sh(`git for-each-ref --format='%(refname:short)' --no-merged salarabb/phase_1 'refs/heads/evolve/*'`) ?? "").split("\n").filter(Boolean),
  budget: DAILY_BUDGET_USD,
  spentToday: j.spentToday(),
  cycle,
  days,
  themes,
  artifacts,
  praise,
  personas,
  latency,
  answers,
  requests,
  experience,
  plan: {
    northStar: section("North star").split("\n\n")[0]!.replace(/\s+/g, " "),
    principles: numbered(section("Principles")),
    backlog: numbered(backlogMain ?? ""),
    gaps: bullets(gapsMd),
    capabilities,
    log: bullets(section("Evolution log")),
  },
};

// ---------------------------------------------------------------- daily history
const dayDates = j.all<{ d: string }>("SELECT DISTINCT sim_date d FROM runs WHERE kind = 'day' ORDER BY sim_date").map((r) => r.d);
const siteHome = simDir("site");
const snapshotDir = simDir("site", "snapshots");
const hasSnapshot = (d: string) => d === lastDay || existsSync(join(snapshotDir, `${d}.html`));
const reportMd = (d: string) => {
  const f = join(simDir("reports"), `${d}.md`);
  return existsSync(f) ? readFileSync(f, "utf8") : null;
};

function dayData(date: string, idx: number) {
  const ids = j.all<{ id: number; app_branch: string; app_sha: string }>("SELECT id, app_branch, app_sha FROM runs WHERE kind = 'day' AND sim_date = ? ORDER BY id", date);
  const within = ids.length ? `run_id IN (${ids.map((r) => r.id).join(",")})` : "0";
  const trades = j
    .all<{ persona: string; detail: string }>(`SELECT persona_id persona, detail FROM actions WHERE kind = 'trade' AND ok = 1 AND ${within} ORDER BY id`)
    .map((r) => ({ persona: r.persona, ...(JSON.parse(r.detail) as { type: string; symbol: string; account: string; usd: number; reason: string; why?: string }) }));
  const voices = loadPersonas()
    .map((p) => {
      const th = j.get<{ detail: string }>(`SELECT detail FROM actions WHERE persona_id = ? AND kind = 'thought' AND ${within} ORDER BY id DESC LIMIT 1`, p.id);
      const rv = j.get<{ detail: string }>(`SELECT detail FROM actions WHERE persona_id = ? AND kind = 'review' AND ${within} ORDER BY id DESC LIMIT 1`, p.id);
      const q = j.get<{ question: string; rating: number | null }>(`SELECT question, rating FROM questions WHERE persona_id = ? AND ${within} ORDER BY id DESC LIMIT 1`, p.id);
      const thought = th ? (JSON.parse(th.detail) as { mood: string; question: string | null }) : null;
      const review = rv ? (JSON.parse(rv.detail) as { firstImpression: string; wouldKeepUsing: boolean }) : null;
      return {
        persona: p.id,
        mood: thought?.mood ?? null,
        question: q?.question ?? thought?.question ?? null,
        rating: q?.rating ?? null,
        impression: review?.firstImpression ?? null,
        keep: review ? review.wouldKeepUsing : null,
      };
    })
    .filter((v) => v.mood || v.question || v.impression);
  const themesToday = j
    .all<{ key: string; title: string; personas: number; severity: number; first_seen: string }>(
      `SELECT f.theme_key key, t.title, COUNT(DISTINCT f.persona_id) personas, AVG(f.severity) severity, t.first_seen
         FROM feedback f JOIN themes t ON t.key = f.theme_key
        WHERE ${within.replace("run_id", "f.run_id")} AND t.status != 'wontfix' AND f.kind != 'praise'
        GROUP BY f.theme_key ORDER BY personas DESC, severity DESC`,
    )
    .map((t) => ({
      ...t,
      isNew: t.first_seen === date,
      quotes: j.all<{ persona: string; quote: string }>(`SELECT persona_id persona, quote FROM feedback WHERE theme_key = ? AND ${within} ORDER BY severity DESC LIMIT 2`, t.key),
    }));
  const exp = j.all<{ persona: string; overall: number; ease: number; speed: number; trust: number; usefulness: number; look: number; why: string; recommend: number; explored: number }>(
    `SELECT persona_id persona, overall, ease, speed, trust, usefulness, look, why, recommend, explored FROM experience WHERE ${within} ORDER BY id`,
  );
  const exploreRows = j.all<{ persona: string; detail: string }>(`SELECT persona_id persona, detail FROM actions WHERE kind = 'explore' AND ${within} ORDER BY id`);
  const exploration = new Map<string, { steps: { action: string; target: string; to: string; ms: number; error?: string }[] }>();
  for (const r of exploreRows) {
    const e = exploration.get(r.persona) ?? { steps: [] };
    e.steps.push(JSON.parse(r.detail));
    exploration.set(r.persona, e);
  }
  const exploreErrors = j.all<{ persona: string; page: string; quote: string }>(
    `SELECT persona_id persona, page, quote FROM feedback WHERE theme_key LIKE 'error-%' AND ${within}`,
  );
  const latRows = j.all<{ target: string; ms: number }>(`SELECT target, ms FROM latency WHERE ${within} AND target != 'chat:total'`);
  const lt = new Map<string, number[]>();
  for (const l of latRows) lt.set(l.target, [...(lt.get(l.target) ?? []), l.ms]);
  const dayAnswers = j.all<{ persona: string; rating: number; question: string; note: string; firstTokenMs: number | null }>(
    `SELECT persona_id persona, rating, question, rating_note note, first_token_ms firstTokenMs FROM questions WHERE rating IS NOT NULL AND ${within} ORDER BY rating, persona_id`,
  );
  return {
    date,
    dayNumber: idx + 1,
    prev: dayDates[idx - 1] ?? null,
    next: dayDates[idx + 1] ?? null,
    generatedAt: new Date().toISOString(),
    appRef: ids.at(-1) ? `${ids.at(-1)!.app_branch}@${ids.at(-1)!.app_sha}` : "unknown",
    snapshot: hasSnapshot(date),
    personas: personas.map((p) => ({ id: p.id, name: p.name })),
    personasActive: one<{ n: number }>(`SELECT COUNT(DISTINCT persona_id) n FROM actions WHERE ${within}`).n,
    spend: one<{ usd: number | null }>(`SELECT SUM(usd) usd FROM costs WHERE ${within}`).usd ?? 0,
    feedbackCount: one<{ n: number }>(`SELECT COUNT(*) n FROM feedback WHERE ${within}`).n,
    avgRating: dayAnswers.length ? dayAnswers.reduce((s, a) => s + a.rating, 0) / dayAnswers.length : null,
    trades,
    voices,
    themes: themesToday,
    latency: [...lt]
      .map(([target, xs]) => ({ target, n: xs.length, p50: percentile(xs, 50)!, p95: percentile(xs, 95)!, budget: budgetFor(target) ?? null }))
      .sort((a, b) => b.p95 / (b.budget ?? 1e9) - a.p95 / (a.budget ?? 1e9)),
    answers: dayAnswers,
    evolveReport: reportMd(date),
    experience: exp,
    exploration: [...exploration].map(([persona, e]) => ({ persona, ...e, errors: exploreErrors.filter((x) => x.persona === persona) })),
  };
}

const history = dayDates
  .map((date, idx) => {
    const d = dayData(date, idx);
    return {
      date,
      trades: d.trades.length,
      feedback: d.feedbackCount,
      rating: d.avgRating,
      spend: d.spend,
      shipped: one<{ n: number }>("SELECT COUNT(*) n FROM themes WHERE shipped_on = ?", date).n > 0,
      snapshot: d.snapshot,
      page: d,
    };
  })
  .reverse();

// ---------------------------------------------------------------- render
const asset = (f: string) => readFileSync(new URL(`../report/${f}`, import.meta.url), "utf8");
const css = asset("style.css");
const common = asset("common.js");
const json = (x: unknown) => JSON.stringify(x).replace(/</g, "\\u003c");
const fill = (tpl: string, d: unknown) =>
  tpl.replace("/*__CSS__*/", () => css).replace("/*__COMMON_JS__*/", () => common).replace("/*__DATA__*/null", () => json(d));

/** The index is an artifact body (the viewer adds the document shell); snapshots and the local copy need a real document. */
const wrapDoc = (body: string, base = "") =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${base ? `<base href="${base}">` : ""}<style>[hidden]{display:none!important}</style></head><body>\n${body}\n</body></html>`;

const index = fill(asset("template.html"), { ...data, asOf: lastDay, history: history.map(({ page: _, ...h }) => h) });
writeFileSync(join(snapshotDir, `${lastDay}.html`), wrapDoc(index, "../"));

const out = new URL("../.out/site/", import.meta.url).pathname;
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "days"), { recursive: true });
writeFileSync(join(out, "index.html"), index);
for (const h of history) writeFileSync(join(out, "days", `${h.date}.html`), fill(asset("day.html"), h.page).replace("/*__TITLE__*/", `Beobeo · ${h.date}`));
cpSync(snapshotDir, join(out, "snapshots"), { recursive: true });

// Mirror to ~/beobeo-sim/site so the history is browsable offline (index as a full document there).
cpSync(join(out, "days"), join(siteHome, "days"), { recursive: true });
writeFileSync(join(siteHome, "index.html"), wrapDoc(index));
console.log(join(out, "index.html"));
