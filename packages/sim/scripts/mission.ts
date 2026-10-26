/**
 * Run missions by hand against the running app — to watch one, or to re-run a reported problem
 * after a fix (`/evolve` uses this to verify mission-found bugs).
 *
 * Run: pnpm sim:mission [--persona petyr] [--feature tax.raise-cash] [--count 1] [--date D]
 * Without --feature, picks the least-recently-tried feature that fits the persona.
 */
import "../src/env";
import { launchBrowser } from "../src/app/browser";
import { FEATURE_IDS } from "../src/features";
import { Journal, simDir } from "../src/journal";
import { assignMissions, runOneMission } from "../src/missions";
import { loadPersonas } from "../src/persona";
import { gitInfo } from "../src/run";
import { todayIso } from "../src/world";

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const date = opt("date") ?? todayIso();
const featureId = opt("feature");
if (featureId && !FEATURE_IDS.has(featureId)) {
  console.error(`Unknown feature "${featureId}". Known: ${[...FEATURE_IDS].join(", ")}`);
  process.exit(1);
}
const journal = new Journal();
const git = gitInfo();
const runId = journal.startRun("mission", { simDate: date, ...git });
const assignments = assignMissions(loadPersonas(), journal, date, Number(opt("count") ?? 1), { personaId: opt("persona"), featureId });
const browser = await launchBrowser();
for (const a of assignments) {
  await runOneMission(browser, a, { journal, runId, date, outDir: simDir("screenshots", date), appSha: git.sha }).catch((e) => console.log(`    ⚠ ${(e as Error).message}`));
}
await browser.close();
journal.finishRun(runId, "ok");
console.log(`\nLLM spend today: $${journal.spentToday().toFixed(2)}`);
process.exit(0);
