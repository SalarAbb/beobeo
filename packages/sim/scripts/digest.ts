/**
 * Turn the journal into the morning brief /evolve reads: ranked themes
 * (breadth × persistence × pain), latency vs. budget, answer quality, and
 * whether recently shipped fixes actually landed.
 *
 * Run: pnpm sim:digest [--date YYYY-MM-DD] [--days 7]
 * Writes ~/beobeo-sim/digests/<date>.md and prints its path.
 */
import { writeFileSync } from "node:fs";
import { Journal, simFile } from "../src/journal";
import { budgetFor, percentile, rankThemes, type ThemeStats } from "../src/themes";
import { addDays, todayIso } from "../src/world";

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const date = opt("date") ?? todayIso();
const windowDays = Number(opt("days") ?? 7);
const since = addDays(date, -windowDays + 1);

const j = new Journal();
const runId = j.startRun("digest", { simDate: date });
const out: string[] = [];
const line = (s = "") => out.push(s);

line(`# Beobeo sim digest — ${date}`);
line();
line(`Window: ${since} → ${date}. Source: \`${simFile("journal.db")}\`.`);
line();

// ---------------------------------------------------------------- runs
const runs = j.all<{ id: number; kind: string; status: string; app_branch: string; app_sha: string; notes: string | null }>(
  "SELECT id, kind, status, app_branch, app_sha, notes FROM runs WHERE kind = 'day' AND sim_date = ? ORDER BY id",
  date,
);
const dayRunIds = runs.map((r) => r.id);
const inRuns = dayRunIds.length ? `run_id IN (${dayRunIds.join(",")})` : "0";
line(`## Today`);
if (runs.length === 0) line(`_No sim:day run for ${date}._`);
for (const r of runs) line(`- run #${r.id} on \`${r.app_branch}@${r.app_sha}\` — **${r.status}**${r.notes ? ` (${r.notes.split("\n").length} note(s))` : ""}`);
const trades = j.get<{ n: number; failed: number; mind: number }>(
  `SELECT COUNT(*) n, SUM(ok = 0) failed, SUM(json_extract(detail, '$.reason') = 'mind') mind FROM actions WHERE kind = 'trade' AND ${inRuns}`,
)!;
const spend = j.get<{ usd: number | null }>(`SELECT SUM(usd) usd FROM costs WHERE ${inRuns}`)!;
line(`- Trades: ${trades.n} (${trades.mind ?? 0} discretionary, ${trades.failed ?? 0} failed) · LLM spend: $${(spend.usd ?? 0).toFixed(2)}`);
const reviews = j.all<{ persona_id: string; detail: string }>(`SELECT persona_id, detail FROM actions WHERE kind = 'review' AND ${inRuns}`);
for (const r of reviews) {
  const d = JSON.parse(r.detail) as { firstImpression: string; wouldKeepUsing: boolean; mission: string };
  line(`- **${r.persona_id}** (${d.mission}) — "${d.firstImpression}" ${d.wouldKeepUsing ? "" : "⚠ *would not keep using*"}`);
}
const signups = j.all<{ persona_id: string; ok: number; latency_ms: number; error: string | null }>(`SELECT persona_id, ok, latency_ms, error FROM actions WHERE kind = 'signup' AND ${inRuns}`);
for (const s of signups) line(`- Fresh sign-up as ${s.persona_id}: ${s.ok ? `ok in ${(s.latency_ms / 1000).toFixed(1)}s` : `**FAILED** — ${s.error}`}`);
line();

// ---------------------------------------------------------------- experience (the number that matters most)
const exp = j.all<{ persona_id: string; overall: number; ease: number; speed: number; trust: number; usefulness: number; look: number; why: string; explored: number }>(
  `SELECT persona_id, overall, ease, speed, trust, usefulness, look, why, explored FROM experience WHERE ${inRuns} ORDER BY overall, persona_id`,
);
if (exp.length) {
  const avg = (k: "overall" | "ease" | "speed" | "trust" | "usefulness" | "look") => (exp.reduce((t, e) => t + e[k], 0) / exp.length).toFixed(1);
  const prevDay = j.get<{ overall: number | null; d: string }>("SELECT AVG(overall) overall, sim_date d FROM experience WHERE sim_date < ? GROUP BY sim_date ORDER BY sim_date DESC LIMIT 1", date);
  line(`## Experience — ${avg("overall")}/5${prevDay?.overall != null ? ` (was ${prevDay.overall.toFixed(1)} on ${prevDay.d})` : ""}`);
  line(`ease ${avg("ease")} · speed ${avg("speed")} · trust ${avg("trust")} · usefulness ${avg("usefulness")} · look ${avg("look")}. Weakest dimension = best lever.`);
  for (const e of exp) line(`- ${e.overall}/5 **${e.persona_id}**${e.explored ? " (explored)" : ""}: ${e.why}`);
  line();
}
const wander = j.all<{ persona_id: string; steps: number; pages: number; errs: number }>(
  `SELECT persona_id, COUNT(*) steps, COUNT(DISTINCT json_extract(detail,'$.to')) pages, SUM(ok = 0) errs FROM actions WHERE kind = 'explore' AND ${inRuns} GROUP BY persona_id`,
);
if (wander.length) {
  line(`## Exploration`);
  line(wander.map((w) => `${w.persona_id}: ${w.steps} steps, ${w.pages} pages${w.errs ? `, ${w.errs} failed steps` : ""}`).join(" · "));
  line();
}

// ---------------------------------------------------------------- themes
const stats = j.all<ThemeStats>(
  `SELECT t.key, t.title, t.area, t.kind, t.status,
          COUNT(DISTINCT f.persona_id) personas,
          COUNT(DISTINCT date(f.created_at)) days,
          SUM(date(f.created_at) >= ?) recent,
          AVG(f.severity) avgSeverity, MAX(f.severity) maxSeverity
     FROM themes t JOIN feedback f ON f.theme_key = t.key
    GROUP BY t.key
   HAVING SUM(date(f.created_at) >= ?) > 0`,
  since,
  since,
);
const ranked = rankThemes(stats);
line(`## Ranked themes (last ${windowDays} days)`);
line();
line(`Score = 3×personas + 2×log2(1+days) + avg severity (+3 if any 5) — PLAN.md principle 12.`);
line();
if (ranked.length === 0) line(`_No feedback in window._`);
for (const [i, t] of ranked.slice(0, 20).entries()) {
  line(`### ${i + 1}. \`${t.key}\` — ${t.title}  (score ${t.score})`);
  line(`${t.area} · ${t.kind} · ${t.personas} persona(s) · ${t.days} day(s) · sev avg ${t.avgSeverity.toFixed(1)} / max ${t.maxSeverity} · status **${t.status}**`);
  const quotes = j.all<{ persona_id: string; quote: string; page: string | null; screenshot: string | null }>(
    "SELECT persona_id, quote, page, screenshot FROM feedback WHERE theme_key = ? AND date(created_at) >= ? ORDER BY severity DESC, id DESC LIMIT 3",
    t.key,
    since,
  );
  for (const q of quotes) line(`> **${q.persona_id}** on ${q.page ?? "?"}: ${q.quote}${q.screenshot ? `  \n> ↳ \`${q.screenshot}\`` : ""}`);
  line();
}

const praise = j.all<{ title: string; n: number }>(
  "SELECT title, COUNT(*) n FROM feedback WHERE kind = 'praise' AND date(created_at) >= ? GROUP BY theme_key ORDER BY n DESC LIMIT 5",
  since,
);
if (praise.length) {
  line(`## Keep (praised — don't regress)`);
  for (const p of praise) line(`- ${p.title} (${p.n}×)`);
  line();
}

// ---------------------------------------------------------------- shipped fixes check
const shipped = j.all<{ key: string; title: string; status: string; shipped_on: string; shipped_branch: string }>(
  "SELECT key, title, status, shipped_on, shipped_branch FROM themes WHERE shipped_on IS NOT NULL AND shipped_on >= ? ORDER BY shipped_on DESC",
  addDays(date, -30),
);
if (shipped.length) {
  line(`## Did recent fixes land?`);
  for (const s of shipped) {
    const after = j.get<{ n: number }>("SELECT COUNT(*) n FROM feedback WHERE theme_key = ? AND date(created_at) > ?", s.key, s.shipped_on)!.n;
    line(`- \`${s.key}\` shipped ${s.shipped_on} on \`${s.shipped_branch}\`: ${after === 0 ? "✅ not raised since" : `❌ raised ${after}× since (status: ${s.status})`}`);
  }
  line();
}

// ---------------------------------------------------------------- latency
const lat = j.all<{ target: string; ms: number }>("SELECT target, ms FROM latency WHERE date(created_at) >= ?", since);
const byTarget = new Map<string, number[]>();
for (const l of lat) byTarget.set(l.target, [...(byTarget.get(l.target) ?? []), l.ms]);
line(`## Latency (PLAN.md principle 5)`);
line();
line(`| target | n | p50 | p95 | budget | |`);
line(`|---|---|---|---|---|---|`);
for (const [target, xs] of [...byTarget].sort((a, b) => (percentile(b[1], 95) ?? 0) - (percentile(a[1], 95) ?? 0))) {
  const p95 = percentile(xs, 95)!;
  const budget = budgetFor(target);
  line(`| ${target} | ${xs.length} | ${percentile(xs, 50)} | ${p95} | ${budget ?? "—"} | ${budget && p95 > budget ? "🔴" : budget ? "🟢" : ""} |`);
}
line();

// ---------------------------------------------------------------- companion answers
const qs = j.all<{ persona_id: string; question: string; rating: number | null; rating_note: string | null; first_token_ms: number | null }>(
  `SELECT persona_id, question, rating, rating_note, first_token_ms FROM questions WHERE ${inRuns} ORDER BY rating ASC`,
);
if (qs.length) {
  const rated = qs.filter((q) => q.rating !== null);
  line(`## Companion answers — avg ${rated.length ? (rated.reduce((s, q) => s + q.rating!, 0) / rated.length).toFixed(1) : "—"}/5`);
  for (const q of qs) line(`- ${q.rating ?? "?"}/5 **${q.persona_id}**: "${q.question}" — ${q.rating_note ?? ""}`);
  line();
}

const file = simFile("digests", `${date}.md`);
writeFileSync(file, out.join("\n"));
j.finishRun(runId, "ok");
console.log(file);
