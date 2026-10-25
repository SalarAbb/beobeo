# PLAN.md — Beobeo's living plan

> The single planning file. **Principles** (how we decide), **the loop** (how the
> product improves itself), **backlog** (what's next, re-ranked daily by the loop),
> and the **evolution log** (what each cycle shipped and why).
> Raw idea material lives in `IDEAS.md`; architecture/conventions in `CLAUDE.md`.

## North star

Beobeo is an **investing companion**, not a portfolio mirror. At any moment you can
ask it two questions and get one calm, correct answer:

1. **"I have $n — where should it go?"** One pick (not ten), with one reason,
   grounded in what you already own, how the market moved, and which account it
   belongs in for tax.
2. **"Is there a free move I should make right now?"** Tax-loss locks (crypto has no
   wash-sale rule under current US law), lots about to turn long-term, unused
   $3,000 deductions, 0% long-term gain room, year-end deadlines.

Grandma can use it without reading a manual. A techie can drive it from the
keyboard and audit every number. Same app, layered depth.

## Principles

Every change — human or loop-made — is judged against these. When two conflict,
the earlier one wins.

1. **Kanso — simplicity.** Every element earns its place. If removing it loses
   nothing, remove it. Extra information is not free; it costs attention.
2. **Progressive disclosure.** The front surface shows what most people need.
   Depth (Sharpe, volatility, lots, raw numbers) is one deliberate tap away —
   never gone, never in the way. One app, no "pro mode" toggle.
3. **One answer, not ten.** The companion recommends one thing with one reason,
   and offers "show me another". No 10-way splits of $500.
4. **Ma — calm space.** Whitespace, quiet color, one accent. Gain/loss color only
   where meaning lives. Nothing blinks, nothing shouts.
5. **Speed is a feature.** Budgets: interaction p95 < 100 ms, warm page < 500 ms,
   cold page < 1.5 s, first chat token < 1.5 s. A regression is a bug.
6. **Every corner considered.** Empty, loading, error, offline, first-run, zero
   holdings, one holding, 500 holdings, same-day buy, split, oversell. A feature
   isn't done until its edge states are designed.
7. **Sensible defaults, everything editable.** Grandma never configures anything;
   the techie can override everything (keyboard shortcuts, ⌘K, exact inputs).
8. **Every number is explainable.** Any figure traces to its inputs with a hover
   or tap.
9. **Exactness where money is concerned.** Deterministic engines decide the
   numbers; the LLM only narrates. Golden tests come before UI.
10. **Honest, not salesy.** State the rule assumptions ("under current US rules…").
    Recommendations are framed as analysis of the user's own options with a short,
    persistent note. Needs legal review before any public launch.
11. **Evolve slowly and reversibly.** 1–3 changes per cycle, each on its own
    branch, each verified, each logged. Never a rewrite.
12. **Users are the signal.** An ask that appears across personas beats one loud
    persona; an ask that recurs across days beats a single day. A shipped fix is
    only "done" when the personas who asked stop asking.

## The loop

```
          ┌──────────────── 08:00 launchd (or `pnpm evolve` / /evolve) ────────────────┐
          ▼                                                                             │
  real market tick ──► personas act on the real app ──► journal (~/beobeo-sim) ──► digest
  (MarketDataService)   policy + LLM mind: trade,         SQLite: actions, questions,   │
                        ask chat, review screenshots,     feedback, latency, costs,     │
                        sign up fresh, time everything    themes                        ▼
                                                                          Claude Code /evolve
  tomorrow the personas meet the changed app  ◄── evolve/YYYY-MM-DD branch ◄── picks 1–3 items,
  and say whether it helped (theme resolved?)      (user reviews & merges)     builds, verifies
```

- **Population** — `packages/sim/personas/*.json`, versioned. Starts at 10, grows
  slowly (the weekly `/evolve-agents` audit adds one when it spots a gap).
- **Two layers per persona** — a deterministic *policy* (mechanical rules: "$250
  into VOO every Monday") used for history bootstrap, and an LLM *mind* (Sonnet)
  that only sees its persona, its own portfolio, and prices up to "today".
- **Touching the real app** — sign-up through the real UI (Playwright), trades
  via tRPC with a share through the real dialog, questions to `/api/chat`,
  rotating screenshot walkthroughs reviewed with vision, latency timed on
  everything.
- **Journal** — `~/beobeo-sim/journal.db` + `screenshots/`, `digests/`,
  `reports/`, `logs/`. `pnpm sim:insights` for cross-day patterns.
- **Budget** — hard stop at `SIM_DAILY_BUDGET_USD` (default $5); UI reviews are
  dropped first.
- **Safety valve** — `/evolve` never pushes, merges, or touches `.env`. With 5
  unmerged `evolve/*` branches or two failed check runs it only *proposes*.

Live page: https://claude.ai/artifact/Sid1FrbP4DgVRcLwQbRopD (regenerated and republished every cycle; `pnpm sim:report`).

Commands: `pnpm sim:bootstrap`, `pnpm sim:day`, `pnpm sim:digest`,
`pnpm sim:insights`, `pnpm sim:reset`, `pnpm evolve` (full cycle).

## Backlog

**Your own requests live in `REQUESTS.md` and always come first.** This backlog holds
work that comes from the plan and from the personas. It's ranked, and the loop re-ranks
it against each digest; items cite the theme keys that motivated them.

1. **Answer in a heartbeat, verdict first.** The assistant's first word takes 4.8 s
   typically and 28 s at worst; answers bury the yes/no under tables. Stream sooner,
   lead with a one-line verdict, keep tables for those who ask. Themes:
   `slow-chat-first-token`, `chat-too-long-jargony`, `chat-no-direct-on-track-answer`.
2. **Label every icon button; make destructive actions undoable.** The trash icon on
   `/transactions` has no accessible name and deletes instantly with no confirmation or
   undo. Found by the explorer's safety scan. Themes: `unlabeled-buttons-*`.
3. **Tolerate dust in imports.** A sell that exceeds buys by 0.000001 drops the whole
   position from the dashboard total while the chart still counts it. Clamp dust and say
   so, instead of excluding the asset. Theme: `dashboard-value-mismatch-excluded-qqq`.
4. **Dividend income view.** Income per month and year, yield on cost (Olenna). Needs
   simulated dividends first (see the gaps below). Theme: `income-view-monthly-dividends-yoc`.
5. **Power layer.** ⌘K command palette (add transaction, jump to symbol, switch
   portfolio) and keyboard shortcuts (Hermione).
6. **Latency instrumentation.** `Server-Timing` on tRPC and a dev overlay, so
   personas and humans see the same numbers.

**Loop / simulator gaps** (infrastructure, not product):

- Route ~30% of persona trades through the real add-transaction dialog
  (Playwright). Today every trade goes through tRPC, so the form UX is never exercised.
- The simulator doesn't generate dividend transactions, so Olenna's
  dashboard says $0 dividends. Model dividends from a provider's distribution
  history before trusting income-related feedback.
- Fixed 2026-10-23: personas now judge numbers against the app's own overview,
  not their private ledger. Ledger fills are rounded to app precision, so there
  are no more 1e-6 oversells.
- Arya's dip-buying ($17k) outweighs her DCA ($14k) over 21 months. Review in
  the first `/evolve-agents` audit.

## Capability map

What exists today versus what's missing. `/evolve` updates a row whenever a
cycle changes it. The live evolution page renders this table, so keep the
format: Status is `built`, `partial` or `missing`.

| Area | Capability | Status | Note |
|---|---|---|---|
| Product | Lot-level portfolio tracking (FIFO, splits, realized by year) | built | core engine, 96 golden tests |
| Product | Tax Center: raise cash, harvest losses, wash-sale radar | built | deterministic, no LLM |
| Product | DCA counterfactual vs. benchmarks | built | compare page, up to 4 benchmarks |
| Product | Chat companion grounded in your data | partial | personas rate it 2.6/5: slow first token, verbose, no verdict (backlog #1) |
| Product | Crypto wash-sale exemption | missing | part of R-003 |
| Product | Proactive tax moves (free-money alerts) | partial | Now tab shows ripening lots; no alerts yet (R-003) |
| Product | "I have $n" picks one of your candidates | missing | R-004 |
| Product | Tax setup during sign-up | missing | R-005 |
| Product | Expert metrics discoverable, not front-facing | partial | Sharpe and volatility still front-facing (R-002) |
| Product | Dividend income view | missing | backlog #4 (Olenna) |
| Product | Keyboard layer (⌘K, shortcuts) | missing | backlog #5 |
| Product | Phone layout | partial | sidebar clips content at 400px |
| Product | Visual identity matching the evolution page | missing | R-001 |
| Simulator | Personas with habits (policy) and judgment (LLM mind) | built | 10 personas |
| Simulator | Real prices, no lookahead, live quotes today | built | Tiingo and Coinbase via the app's cache |
| Simulator | Trades through the app's API | built | timed |
| Simulator | Trades through the real add-transaction form | missing | form UX never exercised |
| Simulator | Chat questions, rated by the asker | built | SSE, first-token timed |
| Simulator | Screenshot walkthroughs reviewed with vision | built | 3 personas per day |
| Simulator | Fresh sign-ups through the real form | built | every 5th day |
| Simulator | Random exploration of the app (seeded, per-persona curiosity) | built | errors, timings and unlabeled controls become themes |
| Simulator | Daily experience rating (overall + ease, speed, trust, usefulness, look) | built | tracked over time on the evolution page |
| Simulator | Dividend transactions | missing | Olenna's income feedback is unreliable until this exists |
| Loop | Journal, digest and insights | built | ~/beobeo-sim |
| Loop | Theme lifecycle (ship, reopen, artifact) | built | |
| Loop | /evolve ships on evolve/ branches | partial | built, first cycle not run yet |
| Loop | Weekly population audit (/evolve-agents) | partial | built, not run yet |
| Loop | Safety valve (propose-only) | built | 5 unmerged branches or 2 failed checks |
| Loop | Daily 08:00 schedule | partial | installer ready, not armed |
| Loop | Live evolution page | built | regenerated every cycle |
| Loop | Dated daily reports and page snapshots | built | ~/beobeo-sim/site, published with the page |
| Loop | Your requests tracked apart from persona feedback | built | REQUESTS.md, worked first every cycle |

## Evolution log

One entry per cycle, newest first: date · branch · what shipped · theme ids
answered · before/after signal.

- **2026-10-23 · genesis · `salarabb/phase_1`.** The loop is built: PLAN.md, `packages/sim` (10 personas named after Game of Thrones and Harry Potter characters, about 1,100 real-price trades), journal, digest, `/evolve`, `/evolve-agents`, the live evolution page. The first simulated day surfaced chat latency, verbosity and the missing verdict as the top themes. Two simulator bugs (ledger comparison, rounding oversell) were found and fixed the same day.
