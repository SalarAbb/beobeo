---
description: One self-evolution cycle — read the persona digest, ship 1–3 improvements on an evolve/ branch, verify, report.
argument-hint: "[digest-path] [implement|propose] [start-ref]"
---

You are running Beobeo's daily self-evolution cycle (see `PLAN.md` → "The loop").
Arguments: `$ARGUMENTS` — digest path (default: today's `~/beobeo-sim/digests/<today>.md`),
mode (`implement` default, or `propose`), and the ref the personas just used.

If invoked interactively with no digest for today, first run `pnpm sim:day` (the app must
be running — ask the user to `pnpm dev` if it isn't) then `pnpm sim:digest`.

## 1. Read, in this order
1. `REQUESTS.md` — the user's own asks; they outrank everything below.
2. `PLAN.md` — **Principles are binding.** Every change must be defensible against them; when
   an ask conflicts with a principle, the principle wins and the theme gets `wontfix` with a note.
3. The digest. Look at screenshots it cites (Read the PNGs) for any UI theme you act on.
4. `CLAUDE.md` — conventions, gotchas, rules (money is Decimal, multi-tenancy, viz tokens, cache invalidation…).

## 2. Choose 1–3 items
- **`REQUESTS.md` comes first.** Every cycle advances the top request whose status is `open`
  or `in progress` (one per cycle; a big one can span cycles, so set it to `in progress` and
  note what remains). Mark it `shipped` with the date only when every "Done means" line is
  true; otherwise leave it `in progress`. Never edit "In your words".
- Then fill the remaining slots from the top of the ranked themes and the PLAN.md backlog. Prefer **broad, cheap,
  high-confidence** wins. Aim for a balance across UI / UX / feature over a week (check the
  PLAN.md evolution log for what recent cycles did).
- Latency 🔴 rows over budget and any `would not keep using` are high priority.
- A shipped theme that's ❌ raised again means the fix didn't land — understand why before redoing it.
- Skip anything needing a product decision only the user can make (new paid data source, legal
  framing of advice, deleting a feature) — list it under "Needs you" in the report instead.
- Engine/tax-math changes require hand-computed golden tests in `packages/core/test/` first.

## 3. Implement (mode `implement` only)
- `git checkout -b evolve/<today>` from the current HEAD (it's already the start ref). If that branch
  exists, use `evolve/<today>-2`.
- Small, focused diffs that read like the surrounding code. No rewrites, no new dependencies unless
  unavoidable (say why in the report).
- Verify: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all must pass. For any UI change,
  screenshot it as a relevant persona: `pnpm --filter @beobeo/sim shoot --persona <id> --routes /a,/b`
  (the dev server at `$SIM_APP_URL` hot-reloads your edits) and Read the images — check light, dark,
  and mobile. Fix what looks wrong.
- Update `CLAUDE.md` for anything technical that changed (non-negotiable — see its header) and
  append to `PLAN.md` → Evolution log (newest first): date · branch · what shipped · theme keys ·
  expected signal. Re-rank/trim the PLAN.md backlog if the digest changed priorities.
- Commit (one or a few commits, clear messages). **Never push, merge, reset, or touch `.env`.** You don't merge, but your branch WILL be merged into the main line automatically tomorrow morning if your report says `Checks: PASSED`, with no human review. The loop is meant to run unattended for weeks, so only ship what you'd be comfortable landing unreviewed; anything risky or needing a human decision goes under "Needs you" instead of into the code.
- Mark what you shipped: `pnpm sim:theme ship <key...> --branch evolve/<today>`; mark rejected asks
  `pnpm sim:theme wontfix <key> --note "<principle #n: why>"`.

In mode `propose`: don't create a branch or edit code; write the report with the concrete plan
for each item instead (files, approach, risks).

## 4. Report → `~/beobeo-sim/reports/<today>.md`
```
# Evolve report — <date>
Branch: evolve/<date> (stacked on <start-ref>)   Mode: implement|propose
Checks: PASSED | FAILED (<which>)

## Shipped
- <item> — request R-00n or themes: <keys> — why (persona quotes) — what changed (files) — screenshots
## Considered, not done
- <item> — reason (principle / needs user / too big → backlog)
## Needs you
- decisions only the user can make
## Persona realism notes
- anything that looked unrealistic in persona behavior (feeds /evolve-agents)
```
The first line after the title block must be `Checks: PASSED` or `Checks: FAILED` exactly — the
cycle script's safety valve greps for it.

## 5. Republish the live evolution page
Run `pnpm sim:report` after your PLAN.md edits, so the capability map, backlog and log are
current. It builds `packages/sim/.out/site/` in three layers: `index.html` (start here: how the
loop works, rarely changes), `progress.html` (everything so far: requests, change log, trends,
plan) and `days/<date>.html` (one per day, only that day's delta and what shipped that night,
which comes from your PLAN.md log entry dated today plus this report). Publish it with the
Artifact tool: `file_path` = `packages/sim/.out/site/index.html`, `root` = `packages/sim/.out/site`,
`files` = `progress.html` and every `days/*.html` path, and `url` = the contents of
`~/beobeo-sim/evolution-url.txt`, so the same link updates. If the Artifact tool isn't available
in this run, say so under "Needs you" so the person can republish from an interactive session. Read the artifact first if the
tool asks. Keep the PLAN.md **Capability map** table accurate: flip a
row's status when a cycle changes it. The page renders that table directly.
Finish by printing the report path and the page link.
