/**
 * Cross-day pattern queries over the whole journal — the "find cool
 * patterns" lens. Prints plain tables; add queries here as questions arise.
 *
 * Run: pnpm sim:insights
 */
import { Journal } from "../src/journal";

const j = new Journal();

function table(title: string, rows: Record<string, unknown>[]) {
  console.log(`\n== ${title} ==`);
  if (rows.length === 0) console.log("(none)");
  else console.table(rows);
}

table(
  "Most widely-shared asks (all time)",
  j.all(
    `SELECT theme_key, MAX(title) title, COUNT(DISTINCT persona_id) personas, COUNT(*) sightings,
            ROUND(AVG(severity), 1) sev, MIN(date(created_at)) first, MAX(date(created_at)) last
       FROM feedback WHERE kind != 'praise' GROUP BY theme_key ORDER BY personas DESC, sightings DESC LIMIT 20`,
  ),
);

table(
  "What each persona cares about (top area/kind)",
  j.all(
    `SELECT persona_id, area, kind, COUNT(*) n FROM feedback GROUP BY persona_id, area, kind
     HAVING n = (SELECT MAX(c) FROM (SELECT COUNT(*) c FROM feedback f2 WHERE f2.persona_id = feedback.persona_id GROUP BY area, kind))
     ORDER BY persona_id`,
  ),
);

table(
  "Fixes that didn't stick (raised again after shipping)",
  j.all(
    `SELECT t.key, t.shipped_on, t.shipped_branch, COUNT(f.id) raised_since
       FROM themes t JOIN feedback f ON f.theme_key = t.key AND date(f.created_at) > t.shipped_on
      WHERE t.shipped_on IS NOT NULL GROUP BY t.key ORDER BY raised_since DESC`,
  ),
);

table(
  "Daily companion answer quality",
  j.all(
    `SELECT date(created_at) day, COUNT(*) questions, ROUND(AVG(rating), 2) avg_rating,
            ROUND(AVG(first_token_ms)) avg_first_token_ms
       FROM questions GROUP BY day ORDER BY day DESC LIMIT 30`,
  ),
);

table(
  "Daily latency over budget",
  j.all(
    `SELECT date(created_at) day, target, COUNT(*) n, SUM(ms > budget_ms) over_budget, MAX(ms) worst_ms
       FROM latency WHERE budget_ms IS NOT NULL GROUP BY day, target HAVING over_budget > 0 ORDER BY day DESC, over_budget DESC LIMIT 40`,
  ),
);

table(
  "Would-keep-using after UI review",
  j.all(
    `SELECT persona_id, COUNT(*) reviews, SUM(json_extract(detail, '$.wouldKeepUsing')) keep
       FROM actions WHERE kind = 'review' GROUP BY persona_id ORDER BY keep * 1.0 / reviews`,
  ),
);

table(
  "LLM spend by day",
  j.all(`SELECT date(created_at, 'localtime') day, ROUND(SUM(usd), 2) usd, COUNT(*) calls FROM costs GROUP BY day ORDER BY day DESC LIMIT 14`),
);
