/**
 * Theme lifecycle — used by /evolve after it ships a fix, so tomorrow's
 * digest can check whether the personas stop asking.
 *
 *   pnpm sim:theme ship <key> [<key>...] --branch evolve/2026-10-24
 *   pnpm sim:theme wontfix <key> --note "conflicts with principle 2"
 *   pnpm sim:theme list
 */
import { Journal } from "../src/journal";
import { todayIso } from "../src/world";

const [cmd, ...rest] = process.argv.slice(2);
const opt = (n: string) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest.splice(i, 2)[1] : undefined;
};
const branch = opt("branch");
const note = opt("note");
const keys = rest;
const j = new Journal();

if (cmd === "list") {
  console.table(j.all("SELECT key, title, status, first_seen, last_seen, shipped_on, shipped_branch FROM themes ORDER BY last_seen DESC"));
} else if (cmd === "ship" || cmd === "wontfix" || cmd === "open") {
  for (const key of keys) {
    const changed =
      cmd === "ship"
        ? j.db.prepare("UPDATE themes SET status = 'shipped', shipped_on = ?, shipped_branch = ?, notes = COALESCE(?, notes) WHERE key = ?").run(todayIso(), branch ?? null, note ?? null, key).changes
        : j.db.prepare("UPDATE themes SET status = ?, notes = COALESCE(?, notes) WHERE key = ?").run(cmd, note ?? null, key).changes;
    console.log(`${key}: ${changed ? cmd : "NOT FOUND"}`);
  }
} else {
  console.error("usage: sim:theme ship|wontfix|open <key...> [--branch b] [--note n] | list");
  process.exit(1);
}
