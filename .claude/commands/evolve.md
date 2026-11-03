---
description: One round of the daily self-evolution cycle — ship the next most valuable improvement on today's evolve/ branch, verify, log, report.
argument-hint: "[digest-path] [implement|propose] [start-ref] [round=N] [deadline=HH:MM]"
---

You are running ONE ROUND of Beobeo's daily self-evolution cycle (see `PLAN.md` → "The loop").
Arguments: `$ARGUMENTS` — digest path (default: today's `~/beobeo-sim/digests/<today>.md`),
mode (`implement` default, or `propose`), the ref the personas used, the round number and the
deadline for the whole cycle.

**The goal is the most real improvement per day.** `scripts/evolve.sh` calls you again and again,
each time in a fresh session, until the time budget runs out or you declare the queue empty. So:
do ONE item per round, do it fully and well, and leave the branch green. Don't defer work to
tomorrow because "the cycle already did enough"; there's no daily quota. The only reasons to stop
are the deadline, nothing worthwhile left, or everything left needing the user.

If invoked interactively with no digest for today, first run `pnpm sim:day` (the app must be
running — ask the user to `pnpm dev` if it isn't) then `pnpm sim:digest`.

## 1. Read, in this order
1. Today's report so far, `~/beobeo-sim/reports/<today>.md` (if it exists), and
   `git log --oneline <start-ref>..HEAD`: what earlier rounds already shipped today. Don't redo it.
   The loop runs twice a day (08:00 and 20:00); rounds are numbered across the day, so an evening
   round 7 follows the morning's rounds 1–6, whose work is already merged into the start ref
   (read the report for it, the git log won't show it). The evening digest adds that evening's
   missions, which tried the morning's changes: check them first.
2. `REQUESTS.md` — the user's own asks.
3. `PLAN.md` up to the Evolution log only (`sed -n '1,/^## Evolution log/p' PLAN.md`; the log
   itself is history, 100+ KB, and today's entries are in the report). **Principles are binding.** When an ask conflicts with a principle, the principle
   wins and the theme gets `wontfix` with a note.
4. The digest. Look at screenshots it cites (Read the PNGs) for any UI theme you act on.
5. `CLAUDE.md` (already loaded) — the rules. Before changing an area, read that area's section of
   `docs/notes.md` (`grep -n "<topic>" docs/notes.md`, then read around it), not the whole file:
   it records why things are as they are, including designs the user rejected.

## 2. Pick the ONE next item
- **Odd rounds: the user's top request** whose status is `open` or `in progress`. Take the next
  unfinished chunk (a big request spans rounds and days: set it `in progress` and tick its "Done
  means" lines as they become true, see below). If every open request is blocked on the user,
  treat the round as even.
- **Even rounds: the top persona theme** (or PLAN.md backlog item) not yet handled today.
  Latency 🔴 rows over budget and any `would not keep using` come first. Persona pain must not
  starve behind a long request.
- A shipped theme that's ❌ raised again means the fix didn't land — understand why before redoing it.
- **Mission-found issues come with repro steps** (quote tagged `[Mission n, feature. Steps…]`, details in `~/beobeo-sim/screenshots/<date>/mission-<n>.json`). After fixing one, re-run it to verify: `pnpm sim:mission --persona <id> --feature <feature>` (restart nothing: the :3100 server reloads app code, but restart it if you changed a `packages/*` module). The digest's Coverage line lists flows no mission has tried: never treat a never-tried flow as fine.
- **If you add or change a user-facing flow, add/update its entry in `packages/sim/src/features.ts`** (`FEATURES`), or missions will never test it.
- An item can be big (e.g. "chat answers fast, verdict first"); size is not a reason to skip it.
  Split it into a shippable first slice if the whole won't fit before the deadline.
- Skip anything needing a product decision only the user can make (new paid data source, legal
  framing of advice, deleting a feature): list it under "Needs you" and pick the next item.
- Engine/tax-math changes require hand-computed golden tests in `packages/core/test/` first.
- **If nothing worthwhile is left** (or all that's left needs the user), don't invent busywork:
  `touch ~/beobeo-sim/reports/.<today>.queue-empty`, write your round section saying so, and stop.

## 3. Implement (mode `implement` only)
- Round 1: `git checkout -b evolve/<today>` from the current HEAD (if it exists from an earlier run
  today, just `git checkout evolve/<today>`). Later rounds are already on it.
- Focused diffs that read like the surrounding code. No rewrites, no new dependencies unless
  unavoidable (say why).
- Verify before committing: `pnpm typecheck && pnpm lint && pnpm test`, plus `pnpm build` if you
  touched `apps/web`. For any UI change, screenshot it as a relevant persona:
  `pnpm --filter @beobeo/sim shoot --persona <id> --routes /a,/b` (the dev server at `$SIM_APP_URL`
  hot-reloads your edits) and Read the images — light, dark and mobile. Fix what looks wrong.
- **If you can't get it green**, don't commit broken work: `git stash push -u -m "abandoned: <item>"`
  (recoverable), note it under "Considered, not done", and move on.
- Update `CLAUDE.md` for anything technical that changed (non-negotiable — see its header): the
  rule or fact in a line or two. The story behind it (incident, mission, measurements) goes in
  `docs/notes.md` under the matching heading, never in `CLAUDE.md`.
  Append one entry to `PLAN.md` → Evolution log for this item (newest first):
  `- **<today> · <short title>.** what changed · request or theme keys · expected signal`.
  Re-rank/trim the PLAN.md backlog if priorities changed; keep the **Capability map** accurate.
- `REQUESTS.md`: when a "Done means" line becomes true, prefix it with `✓ ` (keep the text).
  Mark the request `shipped` with the date only when every line is ticked. Never edit "In your words".
- Commit (one item = one or a few commits, clear messages). **Never push, merge, reset, or touch
  `.env`.** The script merges the branch into the main line at the end of the cycle if the final
  full checks pass, with no human review — the loop runs unattended for weeks, so only ship what
  you'd be comfortable landing unreviewed.
- Mark what you shipped: `pnpm sim:theme ship <key...> --branch evolve/<today>`; mark rejected asks
  `pnpm sim:theme wontfix <key> --note "<principle #n: why>"`.

In mode `propose`: don't create a branch or edit code; write the concrete plan for the item
(files, approach, risks), then touch the queue-empty marker (proposals don't need more rounds).

## 4. Report → `~/beobeo-sim/reports/<today>.md`
Round 1 creates the file with this header (only if it doesn't exist yet); every round appends its own section below it.
```
# Evolve report — <date>
Branch: evolve/<date> (from <start-ref>)   Mode: implement|propose
Checks: PENDING

## Round <n> · <item title>
- **Shipped:** request R-00n or themes <keys> — why (persona quotes) — what changed (files) — screenshots
- **Considered, not done:** … (reason)
- **Needs you:** decisions only the user can make
- **Persona realism notes:** anything that looked unrealistic in persona behavior
```
Leave the `Checks:` line alone after round 1: the cycle script runs the final full checks
(typecheck, lint, test, build) after the last round and writes `Checks: PASSED|FAILED` itself.

Don't publish the evolution page from here; the script rebuilds it after the cycle, and it's
republished from interactive sessions. Finish by printing one line: what this round shipped.
