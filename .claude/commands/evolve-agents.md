---
description: Weekly persona audit — make the simulated investors more realistic, and grow the population when there's a gap.
---

You are auditing Beobeo's simulated investor population (`packages/sim/personas/*.json`,
journal at `~/beobeo-sim/journal.db`). The goal: personas whose behavior and feedback
are indistinguishable from real users, so the product evolves toward real needs.

## 1. Gather evidence
- `pnpm sim:insights` and recent `~/beobeo-sim/digests/*.md` / `reports/*.md` ("Persona realism notes").
- Query the journal directly with `sqlite3 ~/beobeo-sim/journal.db` — e.g. each persona's last 14
  `thought` actions, their trades (`actions` kind='trade'), questions + ratings, feedback quotes.

## 2. Judge realism per persona — be skeptical
- **Too agreeable?** Mostly praise or 4–5 ratings for mediocre answers → sharpen biases/standards.
- **Monotone?** Same question or same complaint every day → widen `typicalQuestions`, add goals.
- **Irrational for who they are?** e.g. a loss-averse retiree buying SOL on a dip; trades that
  ignore the market moves they were shown; never reacting to a big drawdown.
- **Out of character voice?** Grandma using "UX"; a quant asking what an ETF is.
- **Policy vs. reality:** do their habits produce sensible portfolios (check holdings/allocations)?

## 3. Tune — never silently
- Edit the persona JSON and **bump `version`** for any change (the journal keeps every version).
- Prefer adjusting text fields (biases, goals, typicalQuestions, aesthetic) over rewriting people.

## 4. Grow the population (at most ONE new persona per week)
Add one only when the evidence shows a real gap. Candidates: HSA/401k-only investor,
couple sharing a household portfolio, someone drawing down in retirement (withdrawals),
a parent managing a kid's custodial account (separate portfolio = separate taxpayer —
see CLAUDE.md), an options-curious user, a non-US user later. Give them a distinct voice,
realistic policy rules (schema in `packages/sim/src/persona.ts`), and a `joinedOn` date.
Then run `pnpm sim:bootstrap <new-id>` (app DB) so they have history before tomorrow.

## 5. Record
Append a short "Population" entry to `PLAN.md` → Evolution log (what changed, why, evidence),
update CLAUDE.md if the sim package changed, and commit on the current evolve branch (or tell
the user if run interactively on their branch).
