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
11. **Evolve fast, but reversibly.** As many verified improvements per day as the
    time budget allows (no daily quota, and today's work is never deferred to
    tomorrow), each its own commit, each verified, each logged. Never a rewrite.
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
  and say whether it helped (theme resolved?)      (merged next morning)       builds, verifies
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
- **Autonomous merging** — the loop runs unattended for weeks (the user's call:
  "if I'm gone a month, I expect dramatic improvements"). Each cycle starts by
  merging the previous cycles' `evolve/*` branches into `salarabb/phase_1`, but only
  those whose report says `Checks: PASSED`, then branches today's work from there.
  A failed branch stays unmerged for a human, and nothing builds on it. When the
  user says "merge", merge right away.
- **Rounds, not a quota** — the build phase is a loop of fresh `/evolve` sessions,
  one improvement each (odd rounds: your top request; even rounds: the top persona
  theme), until `EVOLVE_HOURS` (default 3) runs out, `EVOLVE_MAX_ROUNDS` (12) is hit,
  or a round finds nothing worthwhile left. Then `evolve.sh` runs the full checks
  and, if they pass, merges the branch into `salarabb/phase_1` the same day.
- **Safety valve** — `/evolve` itself never pushes, merges, or touches `.env`
  (`evolve.sh` does the merging). With 3 branches that couldn't be merged, or two
  failed check runs, it only *proposes*.

Live page: https://claude.ai/artifact/Sid1FrbP4DgVRcLwQbRopD (regenerated and republished every cycle; `pnpm sim:report`).

Commands: `pnpm sim:bootstrap`, `pnpm sim:day`, `pnpm sim:digest`,
`pnpm sim:insights`, `pnpm sim:reset`, `pnpm evolve` (full cycle).

## Backlog

**Your own requests live in `REQUESTS.md` and always come first.** This backlog holds
work that comes from the plan and from the personas. It's ranked, and the loop re-ranks
it against each digest; items cite the theme keys that motivated them.

1. **Answer in a heartbeat, verdict first.** First slice shipped 2026-10-25 (preloaded
   snapshot, low-effort thinking, verdict-first prompt). Left: questions that need a
   tool still take 5–15 s to the first word. Next: preload what those tools return
   most often (this year's realized gains, lots turning long-term soon), and remember
   facts the user stated (age, targets) across threads. Themes:
   `slow-chat-first-token`, `chat-too-long-jargony`, `chat-no-direct-on-track-answer`.
2. **Target mix on the server.** Move device-saved target mixes into an
   `allocation_targets` table keyed (user, portfolioKey) like `tax_profiles`
   (needs one `pnpm db:push`, which only a human can run). Then put targets and
   drift in the chat snapshot, so "how far have I drifted?" gets the same numbers as
   the dashboard. Theme: `allocation-vs-target-drift`.
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
  history before trusting income-related feedback. The 2026-10-25 audit left
  `dividend-data-not-syncing-zero` open on purpose: "$0 with no explanation" also
  hits real users who enter trades by hand, but the sim makes it louder than it is.
- Every persona logs in and asks a question every day. Real users skip days. Revisit
  if digests start to over-weight daily-check behaviour.
- Fixed 2026-10-23: personas now judge numbers against the app's own overview,
  not their private ledger. Ledger fills are rounded to app precision, so there
  are no more 1e-6 oversells.

## Capability map

What exists today versus what's missing. `/evolve` updates a row whenever a
cycle changes it. The live evolution page renders this table, so keep the
format: Status is `built`, `partial` or `missing`.

| Area | Capability | Status | Note |
|---|---|---|---|
| Product | Lot-level portfolio tracking (FIFO, splits, realized by year) | built | core engine, 96 golden tests |
| Product | Tax Center: raise cash, harvest losses, wash-sale radar | built | deterministic, no LLM |
| Product | DCA counterfactual vs. benchmarks | built | compare page, up to 4 benchmarks |
| Product | Chat companion grounded in your data | partial | rated 3.0/5 before the snapshot + verdict-first prompt (2026-10-25); first word still 5–15s when a tool is needed (backlog #1) |
| Product | Crypto wash-sale exemption | missing | part of R-003 |
| Product | Proactive tax moves (free-money alerts) | partial | Now tab shows ripening lots; no alerts yet (R-003) |
| Product | "I have $n" picks one of your candidates | missing | R-004 |
| Product | Tax setup during sign-up | missing | R-005 |
| Product | Expert metrics discoverable, not front-facing | partial | Behind a closed "Performance details" disclosure on the dashboard (R-002); waiting for the personas to confirm |
| Product | Allocation vs. target mix + where the next deposit goes | partial | dashboard drift table and deposit split (2026-10-25); targets saved on the device only, so chat can't see them (backlog #2) |
| Product | Dividend income view | missing | backlog #4 (Olenna) |
| Product | Keyboard layer (⌘K, shortcuts) | missing | backlog #5 (Hermione) |
| Product | Phone layout | partial | top-bar shell and dashboard fit 400px; other pages not yet checked at phone width |
| Product | Visual identity matching the evolution page | partial | tokens, fonts, dashboard, position, transactions, accounts, account done; tax center, compare, chat, auth next (R-001) |
| Simulator | Personas with habits (policy) and judgment (LLM mind) | built | 11 personas, incl. one retiree drawing down monthly |
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
| Loop | /evolve ships on evolve/ branches | built | first cycle 2026-10-25 |
| Loop | Weekly population audit (/evolve-agents) | built | first run 2026-10-25 |
| Loop | Autonomous merge of passing branches | built | each morning, before the new cycle |
| Loop | Safety valve (propose-only) | built | 3 unmergeable branches or 2 failed checks |
| Loop | Daily 08:00 schedule | partial | installer ready, not armed |
| Loop | Live evolution page | built | regenerated every cycle |
| Loop | Three-layer site: start page, cumulative progress, daily deltas | built | ~/beobeo-sim/site, published as one artifact |
| Loop | Your requests tracked apart from persona feedback | built | REQUESTS.md, worked first every cycle |

## Evolution log

One entry per cycle, newest first: date · branch · what shipped · theme ids
answered · before/after signal.

- **2026-10-25 · Allocation vs. your target mix, and where the next deposit goes.** The dashboard's Allocation section takes a target mix ("Set a target mix": one % per holding, must add up to 100). With one set, it opens with a verdict ("You're on target: every holding is within 2 points of your mix", or "Furthest off: VXUS is 4.2 points under its 30% target", or an untargeted holding named). Next to the donut, a now / target / off-by table with a bullet bar per row flags drift of 5 points or more. Below that, "Your next deposit of $[last deposit] goes into VTI $3,222 · VXUS $1,936 · BND $842": new tested core `allocationDrift`/`fillToTarget`, which fills the most underweight sleeve first and never needs a sell. First slice: targets are saved on the device (localStorage), because a new table needs a `db:push` the unattended loop isn't allowed to run. Sim personas with a `rebalance` rule start with their targets saved, so Minerva and Hermione see it. · `allocation-vs-target-drift` (minerva, *would not keep using*), part of `dashboard-no-next-step-guidance` · expected signal: minerva's dashboard notes turn to the drift table and the $6,000 split; hermione's "drift vs my 10% BTC target" is answered on the dashboard (chat still can't see targets).
- **2026-10-25 · Compare in the evolution look, verdict first.** The compare page now opens with one plain sentence ("Your portfolio is behind SPY by $1,976.96"; with several benchmarks it lists who you're ahead of and behind, each with the dollar gap). The four bordered cards became one hairline strip (your value + invested, then one tile per benchmark whose sub-line is your edge), and the chart and the head-to-head table sit in serif sections over rules. Chips and the scope trigger are pills, the "Comparing:" label no longer orphans on phones, and the head-to-head rows use the dashboard's plain names (Yearly rate, Total growth, Swings, Reward for risk). The tiles dropped their per-benchmark XIRR, which the table's first row already shows. · R-001 · expected signal: compare look/ease scores hold or rise; no "which number do I read" notes on compare.
- **2026-10-25 · Expert metrics one tap away, plain dashboard labels.** The dashboard's "Performance & risk" grid (yearly rate, growth of picks, timing effect, Sharpe, volatility, concentration) now sits behind a closed "Performance details" pill under the chart. Opening it starts with one sentence on why the yearly rate, the growth of your picks and the timing effect differ. Every label is plain, and the technical term (XIRR, TWR, Sharpe…) appears only in the hover card. The summary tiles say "Gain on holdings", "Gain from sales" and "Change · 1M" instead of "Unrealized/Realized P/L". On phones the tiles' hero numbers no longer truncate ("$120,247.…"). · R-002, `dashboard-jargon-performance-risk`, `dashboard-annual-return-contradicts-total-return` · expected signal: luna/augusta/fred stop raising dashboard jargon and "numbers disagree" notes; hermione still quotes TWR/XIRR.
- **2026-10-25 · Tax Center in the evolution look, zero states quieted.** All five tabs converted (R-001): page header, sideways-scrolling tab pills, hairline stat strips, serif sections over rules, ledger-style All Lots, sectioned Tax Profile. Each tab now opens with a plain verdict sentence ("You owe no capital-gains tax right now: you haven't sold anything at a gain this year", new tested core `taxOwedSoFar`), and sections appear only when they hold something, so no more "-$0.00" (fixed app-wide in `fmtUsd`) or rows of $0.00 boxes. On-hold losses are grouped per symbol and name the triggering buy, its account and the date it's safe to sell (petyr's ask). Tabs deep-link with `?tab=`. · R-001, `tax-center-noisy-zero-states` · expected signal: luna/augusta/petyr stop raising tax-center zero-state and jargon notes; look score holds or rises.
- **2026-10-25 · Chat: snapshot preloaded, verdict first.** Every chat turn now starts with a portfolio snapshot (holdings and weights, totals, how much was put in and how fast, accounts, saved tax rates) in the system prompt, so most questions need no tool call. Thinking runs at low effort, and the prompt was rewritten: answer in the first sentence, ~120 words, plain words, state assumptions instead of asking, turn saved tax rates into dollars, and lean toward one of the user's named options. Probed on 5 sim personas before → after: total time Luna 22s → 6.7s (first word 1.9s, no tool calls), Samwell over 60s → 15s with "Roughly yes" up front, Fred ~20s → 8s, Gilderoy 37s → 17s, Olenna 35s → 21s. Tool-heavy questions still take 5–15s to the first word. · `slow-chat-first-token`, `chat-too-long-jargony`, `chat-no-direct-on-track-answer`, `chat-ignores-stated-tax-profile` · expected signal: chat:first-token p50 under 3s, chat:total p50 under 12s, fewer "wall of text" notes.

- **2026-10-25 · R-001 phase 2: position, transactions, accounts, account pages.** The dashboard's building blocks (`PageHeader`, `Section`, `StatStrip`, `StatTile`) moved to a shared `page-section.tsx`, and four more pages now use them: hairline stat strips, serif section titles over rules, mono numerals, and quiet type pills on transactions. Found and fixed along the way: the position page crashed for anyone with two trades on the same day (duplicate avg-cost step timestamps), and past 12 trades the marker quantity labels smeared into an unreadable band, so they're now plain arrows. · R-001 · expected signal: look scores hold or rise; no `error-/positions` themes.

- **2026-10-25 · Population (first `/evolve-agents` audit).** Evidence: 3 sim days, 30 questions, 20 experience ratings. Ratings were not too agreeable (answers 2.6→3.0/5, only one would-recommend), and voices were in character. Three realism problems turned up. (1) **Monotone:** 7 of 10 personas asked nearly the same question three days running (Minerva asked about "this quarter's $6,000" every day, despite her goal of under 5 minutes a quarter). The mind only saw its past moods, never its past questions. Now it sees its last 3 questions with its own rating notes, and is told to follow up, move on or ask nothing. `typicalQuestions` were widened for 9 personas (v4). Minerva and Luna got "glance and leave" biases. (2) **Incoherent trade:** Gilderoy's NFLX sell was rejected because the mind wrote "Webull (taxable)". The next day he "rotated the NFLX cash" into AAPL without ever having sold. Account names now match case-insensitively with the suffix stripped. (3) **Irrational for who she is:** Arya's crypto dip rule fired so often that she sits at 23% crypto against her own 15% cap. Her crypto dips are now 12% with a 21-day cooldown, plus a "stops adding rather than trims at a loss" bias. **New persona: Barristan Selmy (70, retired, v1).** He sells $3,500 a month from a taxable account and leaves his IRA alone. Gap: Raise Cash is the Tax Center's headline feature, and no persona ever needed to raise cash (every sim trade in the window was a buy). New policy rules `lump` (one-time deposit) and `withdraw` (cadenced sells from overweight sleeves) were added, with tests. Bootstrapped with 74 trades since 2024-01-02.

- **2026-10-25 · `evolve/2026-10-25`.** First loop cycle. (1) R-001 phase 1: the evolution page's fonts (Shippori Mincho / Hanken Grotesk / JetBrains Mono) and cool indigo tokens are live app-wide, card shadows are gone, and the dashboard was restyled into hairline-ruled chapters. (2) Phone shell: the sidebar becomes a top bar with a scrolling nav row, the dashboard no longer clips, and holdings drop Qty/Price on phones (`dashboard-mobile-clipped-layout`). (3) Undoable transaction delete plus labels on every icon button (`unlabeled-buttons-transactions`, backlog #2). Expected signal: mobile and unlabeled-button themes stop recurring, look scores hold or rise (3.4 baseline).
- **2026-10-23 · genesis · `salarabb/phase_1`.** The loop is built: PLAN.md, `packages/sim` (10 personas named after Game of Thrones and Harry Potter characters, about 1,100 real-price trades), journal, digest, `/evolve`, `/evolve-agents`, the live evolution page. The first simulated day surfaced chat latency, verbosity and the missing verdict as the top themes. Two simulator bugs (ledger comparison, rounding oversell) were found and fixed the same day.
