import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Everything the simulation observes lives here — outside the repo, on this Mac. */
export const SIM_HOME = process.env.SIM_HOME || join(homedir(), "beobeo-sim");

/** A directory under SIM_HOME, created if missing. */
export function simDir(...parts: string[]): string {
  const p = join(SIM_HOME, ...parts);
  mkdirSync(p, { recursive: true });
  return p;
}

/** A file path under SIM_HOME whose parent directory exists. */
export function simFile(...parts: string[]): string {
  return join(simDir(...parts.slice(0, -1)), parts.at(-1)!);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS personas (
  id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, version)
);
CREATE TABLE IF NOT EXISTS sim_users (
  email TEXT PRIMARY KEY, persona_id TEXT NOT NULL, user_id TEXT,
  kind TEXT NOT NULL,              -- persona | registration
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS policy_state (
  persona_id TEXT PRIMARY KEY, json TEXT NOT NULL, last_date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,              -- bootstrap | day | digest | evolve
  sim_date TEXT, app_branch TEXT, app_sha TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running', notes TEXT
);
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, persona_id TEXT NOT NULL,
  sim_date TEXT NOT NULL,
  kind TEXT NOT NULL,              -- trade | signup | signin | navigate | ui_trade | thought
  detail TEXT NOT NULL,            -- JSON
  ok INTEGER NOT NULL, error TEXT, latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, persona_id TEXT NOT NULL,
  question TEXT NOT NULL, answer TEXT, tools TEXT,
  first_token_ms INTEGER, total_ms INTEGER,
  rating INTEGER, rating_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, persona_id TEXT NOT NULL,
  page TEXT, kind TEXT NOT NULL,   -- bug | friction | wish | aesthetic | praise | latency
  area TEXT NOT NULL,              -- ui | ux | feature | perf | correctness
  severity INTEGER NOT NULL,       -- 1 (nit) .. 5 (blocker)
  theme_key TEXT NOT NULL, title TEXT NOT NULL, quote TEXT NOT NULL,
  screenshot TEXT, app_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS latency (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, persona_id TEXT NOT NULL,
  target TEXT NOT NULL, ms INTEGER NOT NULL, budget_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS themes (
  key TEXT PRIMARY KEY, title TEXT NOT NULL, area TEXT NOT NULL, kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open | shipped | resolved | wontfix
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  shipped_on TEXT, shipped_branch TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, persona_id TEXT,
  purpose TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, usd REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS experience (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, persona_id TEXT NOT NULL, sim_date TEXT NOT NULL,
  overall INTEGER NOT NULL,        -- 1..5: how was using Beobeo today, all things considered
  ease INTEGER NOT NULL, speed INTEGER NOT NULL, trust INTEGER NOT NULL, usefulness INTEGER NOT NULL, look INTEGER NOT NULL,
  why TEXT NOT NULL, recommend INTEGER NOT NULL,
  explored INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, persona_id TEXT NOT NULL, sim_date TEXT NOT NULL,
  feature TEXT NOT NULL,           -- id from src/features.ts
  goal TEXT NOT NULL, expectation TEXT NOT NULL,
  viewport TEXT NOT NULL, scheme TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',  -- running | achieved | struggled | failed | aborted
  difficulty INTEGER,              -- 1 (effortless) .. 5 (gave up)
  steps INTEGER NOT NULL DEFAULT 0, ms INTEGER,
  summary TEXT, verdict TEXT,      -- verdict = full debrief JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- What got exercised, from where: the mission's target, features it touched on the way, or a random wander.
CREATE TABLE IF NOT EXISTS coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, persona_id TEXT NOT NULL, sim_date TEXT NOT NULL,
  feature TEXT NOT NULL, source TEXT NOT NULL,  -- mission | touched | explore
  mission_id INTEGER, outcome TEXT,             -- achieved | struggled | failed | visited
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS coverage_feature_idx ON coverage(feature, sim_date);
CREATE INDEX IF NOT EXISTS experience_day_idx ON experience(sim_date);
CREATE INDEX IF NOT EXISTS feedback_theme_idx ON feedback(theme_key);
CREATE INDEX IF NOT EXISTS costs_day_idx ON costs(created_at);
`;

export type SqlValue = string | number | null;

export class Journal {
  readonly db: DatabaseSync;

  constructor(file = simFile("journal.db")) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  run(sql: string, ...params: SqlValue[]): number {
    return Number(this.db.prepare(sql).run(...params).lastInsertRowid);
  }

  all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  startRun(kind: string, meta: { simDate?: string; branch?: string; sha?: string } = {}): number {
    return this.run(
      "INSERT INTO runs (kind, sim_date, app_branch, app_sha) VALUES (?, ?, ?, ?)",
      kind,
      meta.simDate ?? null,
      meta.branch ?? null,
      meta.sha ?? null,
    );
  }

  finishRun(id: number, status: "ok" | "failed" | "partial", notes?: string): void {
    this.run(
      "UPDATE runs SET finished_at = datetime('now'), status = ?, notes = ? WHERE id = ?",
      status,
      notes ?? null,
      id,
    );
  }

  recordPersona(id: string, version: number, json: unknown): void {
    this.run("INSERT OR IGNORE INTO personas (id, version, json) VALUES (?, ?, ?)", id, version, JSON.stringify(json));
  }

  action(a: {
    runId: number;
    personaId: string;
    simDate: string;
    kind: string;
    detail: unknown;
    ok: boolean;
    error?: string;
    latencyMs?: number;
  }): void {
    this.run(
      "INSERT INTO actions (run_id, persona_id, sim_date, kind, detail, ok, error, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      a.runId,
      a.personaId,
      a.simDate,
      a.kind,
      JSON.stringify(a.detail),
      a.ok ? 1 : 0,
      a.error ?? null,
      a.latencyMs ?? null,
    );
  }

  latency(runId: number, personaId: string, target: string, ms: number, budgetMs?: number): void {
    this.run(
      "INSERT INTO latency (run_id, persona_id, target, ms, budget_ms) VALUES (?, ?, ?, ?, ?)",
      runId,
      personaId,
      target,
      Math.round(ms),
      budgetMs ?? null,
    );
  }

  feedback(f: {
    runId: number;
    personaId: string;
    page?: string;
    kind: string;
    area: string;
    severity: number;
    themeKey: string;
    title: string;
    quote: string;
    screenshot?: string;
    appSha?: string;
    date: string;
  }): void {
    this.run(
      "INSERT INTO feedback (run_id, persona_id, page, kind, area, severity, theme_key, title, quote, screenshot, app_sha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      f.runId,
      f.personaId,
      f.page ?? null,
      f.kind,
      f.area,
      f.severity,
      f.themeKey,
      f.title,
      f.quote,
      f.screenshot ?? null,
      f.appSha ?? null,
    );
    // Upsert the theme: first sighting creates it; any sighting bumps last_seen.
    // A sighting of a SHIPPED theme reopens it — the fix didn't land for this persona.
    this.run(
      `INSERT INTO themes (key, title, area, kind, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET last_seen = excluded.last_seen,
         status = CASE WHEN themes.status IN ('shipped','resolved') AND ? != 'praise' THEN 'open' ELSE themes.status END`,
      f.themeKey,
      f.title,
      f.area,
      f.kind,
      f.date,
      f.date,
      f.kind,
    );
  }

  question(q: {
    runId: number;
    personaId: string;
    question: string;
    answer?: string;
    tools?: string[];
    firstTokenMs?: number;
    totalMs?: number;
    rating?: number;
    ratingNote?: string;
  }): void {
    this.run(
      "INSERT INTO questions (run_id, persona_id, question, answer, tools, first_token_ms, total_ms, rating, rating_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      q.runId,
      q.personaId,
      q.question,
      q.answer ?? null,
      JSON.stringify(q.tools ?? []),
      q.firstTokenMs ?? null,
      q.totalMs ?? null,
      q.rating ?? null,
      q.ratingNote ?? null,
    );
  }

  cost(c: { runId: number; personaId?: string; purpose: string; model: string; inputTokens: number; outputTokens: number; usd: number }): void {
    this.run(
      "INSERT INTO costs (run_id, persona_id, purpose, model, input_tokens, output_tokens, usd) VALUES (?, ?, ?, ?, ?, ?, ?)",
      c.runId,
      c.personaId ?? null,
      c.purpose,
      c.model,
      c.inputTokens,
      c.outputTokens,
      c.usd,
    );
  }

  experience(e: {
    runId: number; personaId: string; date: string; overall: number;
    ease: number; speed: number; trust: number; usefulness: number; look: number;
    why: string; recommend: boolean; explored: boolean;
  }): void {
    this.run(
      "INSERT INTO experience (run_id, persona_id, sim_date, overall, ease, speed, trust, usefulness, look, why, recommend, explored) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      e.runId, e.personaId, e.date, e.overall, e.ease, e.speed, e.trust, e.usefulness, e.look, e.why, e.recommend ? 1 : 0, e.explored ? 1 : 0,
    );
  }

  startMission(m: { runId: number; personaId: string; date: string; feature: string; goal: string; expectation: string; viewport: string; scheme: string }): number {
    return this.run(
      "INSERT INTO missions (run_id, persona_id, sim_date, feature, goal, expectation, viewport, scheme) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      m.runId, m.personaId, m.date, m.feature, m.goal, m.expectation, m.viewport, m.scheme,
    );
  }

  finishMission(id: number, f: { status: string; difficulty: number | null; steps: number; ms: number; summary: string; verdict: unknown }): void {
    this.run(
      "UPDATE missions SET status = ?, difficulty = ?, steps = ?, ms = ?, summary = ?, verdict = ? WHERE id = ?",
      f.status, f.difficulty, f.steps, Math.round(f.ms), f.summary, JSON.stringify(f.verdict), id,
    );
  }

  coverage(c: { runId: number; personaId: string; date: string; feature: string; source: "mission" | "touched" | "explore"; missionId?: number; outcome: string }): void {
    this.run(
      "INSERT INTO coverage (run_id, persona_id, sim_date, feature, source, mission_id, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)",
      c.runId, c.personaId, c.date, c.feature, c.source, c.missionId ?? null, c.outcome,
    );
  }

  /** Days since each feature was last the TARGET or a touched part of a mission (wandering doesn't count: it can't use a flow). */
  daysSinceTried(date: string): Map<string, number> {
    const rows = this.all<{ feature: string; days: number }>(
      "SELECT feature, CAST(julianday(?) - julianday(MAX(sim_date)) AS INTEGER) days FROM coverage WHERE source IN ('mission','touched') GROUP BY feature",
      date,
    );
    return new Map(rows.map((r) => [r.feature, Math.max(0, r.days)]));
  }

  /** USD spent on LLM calls since local midnight (the daily budget window). */
  spentToday(): number {
    const row = this.get<{ usd: number | null }>(
      "SELECT SUM(usd) AS usd FROM costs WHERE date(created_at, 'localtime') = date('now', 'localtime')",
    );
    return row?.usd ?? 0;
  }

  openThemes(limit = 60): { key: string; title: string; area: string; kind: string; status: string }[] {
    return this.all(
      "SELECT key, title, area, kind, status FROM themes WHERE status != 'wontfix' ORDER BY last_seen DESC LIMIT ?",
      limit,
    );
  }
}
