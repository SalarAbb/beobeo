import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq, ne } from "drizzle-orm";
import type { Browser } from "playwright";
import { db, schema } from "@beobeo/db";
import { AppClient } from "./app/client";
import { deviceStorage, newContext } from "./app/browser";
import { runMission, type MissionResult } from "./app/mission";
import { mulberry32, seedFrom } from "./explore-rules";
import { FEATURE_IDS, FEATURES, pickFeature, type Feature } from "./features";
import type { Journal } from "./journal";
import { simEmail, simPassword, type Persona } from "./persona";
import { appBrief, themesBrief, type Overview } from "./run";
import { cloneSimUser, findUserId } from "./store";

/**
 * Daily missions: which personas go on one, which feature each takes on (coverage-weighted, see
 * `pickFeature`), the disposable account they do it in, and what the debrief turns into
 * (feedback themes, coverage rows, a line in the persona's diary).
 */

export interface MissionOutcome {
  persona: Persona;
  feature: Feature;
  result: MissionResult | null;
  diaryLine: string;
}

/** Today's mission assignments: N personas (seeded shuffle), each a distinct feature. */
export function assignMissions(personas: Persona[], journal: Journal, date: string, n: number, forced?: { personaId?: string; featureId?: string }): { persona: Persona; feature: Feature }[] {
  const rng = mulberry32(seedFrom(`missions:${date}`));
  const pool = forced?.personaId ? personas.filter((p) => p.id === forced.personaId) : [...personas].sort(() => rng() - 0.5);
  const lastTried = journal.daysSinceTried(date);
  const taken = new Set<string>();
  return pool.slice(0, n).map((persona) => {
    const feature = forced?.featureId ? FEATURES.find((f) => f.id === forced.featureId)! : pickFeature(persona, lastTried, rng, taken);
    taken.add(feature.id);
    return { persona, feature };
  });
}

/** A broker export (Robinhood format) of the persona's latest stock trades plus two new buys: overlap tests de-duplication, new rows test the import. */
async function brokerCsv(userId: string, file: string, date: string): Promise<string | null> {
  const rows = await db
    .select({ t: schema.transactions, a: schema.assets })
    .from(schema.transactions)
    .innerJoin(schema.assets, eq(schema.transactions.assetId, schema.assets.id))
    .where(and(eq(schema.transactions.userId, userId), ne(schema.assets.class, "crypto")))
    .orderBy(desc(schema.transactions.tradedAt))
    .limit(6);
  const trades = rows.filter((r) => r.t.type === "buy" || r.t.type === "sell");
  if (trades.length === 0) return null;
  const us = (d: Date | string) => {
    const x = typeof d === "string" ? new Date(`${d}T15:00:00Z`) : d;
    return `${x.getUTCMonth() + 1}/${x.getUTCDate()}/${x.getUTCFullYear()}`;
  };
  const line = (d: Date | string, sym: string, name: string, code: string, qty: number, px: number) =>
    `${us(d)},${us(d)},${us(d)},${sym},${name.replace(/,/g, "")},${code},${qty},$${px.toFixed(2)},${code === "Buy" ? `($${(qty * px).toFixed(2)})` : `$${(qty * px).toFixed(2)}`}`;
  const out = ["Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount"];
  for (const { t, a } of trades.reverse()) out.push(line(t.tradedAt, a.symbol, a.name, t.type === "buy" ? "Buy" : "Sell", Number(t.quantity), Number(t.pricePerUnit ?? 0)));
  const last = trades.at(-1)!;
  for (const q of [2, 1]) out.push(line(date, last.a.symbol, last.a.name, "Buy", q, Number(last.t.pricePerUnit ?? 0)));
  writeFileSync(file, `${out.join("\n")}\n`);
  return file;
}

export async function runOneMission(
  browser: Browser,
  a: { persona: Persona; feature: Feature },
  o: { journal: Journal; runId: number; date: string; outDir: string; appSha: string },
): Promise<MissionOutcome> {
  const { persona: p, feature } = a;
  const { journal, runId, date } = o;
  console.log(`\n◎ Mission: ${p.name} → ${feature.id}`);
  const sourceId = await findUserId(simEmail(p.id));
  if (!sourceId) return { persona: p, feature, result: null, diaryLine: "" };

  // A disposable twin, so the mission can really save, edit, delete and import.
  // First-run setup starts from nothing, as a real sign-up does.
  const email = simEmail(p.id, "-m");
  const twin = await cloneSimUser(sourceId, p, email, simPassword(p.id), { empty: feature.id === "welcome.setup" });
  const client = new AppClient();
  await client.signIn(email, simPassword(p.id));
  let overview = await client.query<Overview>("portfolio.overview", { window: "all" });
  let freshNote = "";
  if (feature.id === "welcome.setup") {
    // The empty twin's dashboard says $0; the persona still knows what it owns.
    const own = new AppClient();
    await own.signIn(simEmail(p.id), simPassword(p.id));
    overview = await own.query<Overview>("portfolio.overview", { window: "all" });
    freshNote = "You have just created a brand-new Beobeo account: it has no accounts or holdings yet.\n";
  }
  const brief = freshNote
    ? freshNote + appBrief(overview.data).replace("(as shown on your Beobeo dashboard)", "(what you own at your brokers, not in Beobeo yet)")
    : appBrief(overview.data);
  const csvFile = feature.id === "transactions.import" ? await brokerCsv(twin.userId, join(o.outDir, `mission-${p.id}-broker-export.csv`), date) : null;

  const rng = mulberry32(seedFrom(`mission-view:${p.id}:${date}`));
  const viewport = feature.id === "app.mobile" || (p.techSavviness <= 2 && rng() < 0.3) ? "mobile" : "desktop";
  const scheme = /dark mode/i.test(p.aesthetic) ? "dark" : "light";
  const ctx = await newContext(browser, { viewport, scheme, cookies: client.cookieList, storage: deviceStorage(p, twin.userId) });
  const result = await runMission(ctx, {
    persona: p, feature, holdingsBrief: brief, themes: themesBrief(journal), csvFile,
    viewport, scheme, outDir: o.outDir, date, journal, runId,
  }).finally(() => ctx.close());
  if (!result) return { persona: p, feature, result: null, diaryLine: "" };

  const d = result.debrief;
  const outcome = d?.status ?? "failed";
  journal.coverage({ runId, personaId: p.id, date, feature: feature.id, source: "mission", missionId: result.missionId, outcome });
  for (const f of new Set(d?.touched ?? [])) {
    if (f !== feature.id && FEATURE_IDS.has(f)) journal.coverage({ runId, personaId: p.id, date, feature: f, source: "touched", missionId: result.missionId, outcome: "visited" });
  }
  // Problems become feedback themes, each with its repro steps so a fix can be checked by re-running the mission.
  const shotFor = (i: number) => result.steps.find((s) => s.i === i)?.shot ?? result.steps.at(-1)?.shot;
  for (const issue of d?.issues ?? []) {
    journal.feedback({
      runId, personaId: p.id, date, appSha: o.appSha, screenshot: shotFor(result.steps.length),
      page: issue.page, kind: issue.kind, area: issue.area, severity: issue.severity, themeKey: issue.themeKey, title: issue.title,
      quote: `${issue.quote} [Mission ${result.missionId}, ${feature.id}. Steps: ${issue.steps}. Expected: ${issue.expected}. Got: ${issue.actual}.]`,
    });
  }
  const seenErr = new Set<string>();
  for (const e of result.appErrors) {
    const key = `error-${e.route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root"}`;
    if (seenErr.has(key)) continue;
    seenErr.add(key);
    journal.feedback({ runId, personaId: p.id, date, appSha: o.appSha, page: e.route, kind: "bug", area: "correctness", severity: 4, themeKey: key, title: `Error on ${e.route}`, quote: `Something failed behind the scenes on ${e.route}: ${e.message} [Mission ${result.missionId}]` });
  }
  console.log(`    → ${outcome}${d ? ` (difficulty ${d.difficulty}/5, ${d.issues.length} issue(s))` : ""}: ${d?.summary ?? "no debrief"}`);
  const diaryLine = d
    ? `You set out to: ${result.plan.goal} It ${outcome === "achieved" ? "worked" : outcome === "struggled" ? "worked, but it was a struggle" : "didn't work"} (${result.steps.length} steps). ${d.summary}`
    : `You tried to ${feature.does.toLowerCase()} but couldn't get started.`;
  return { persona: p, feature, result, diaryLine };
}
