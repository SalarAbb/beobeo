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
          ┌────────── 08:00 + 20:00 launchd (or `pnpm evolve` / /evolve) ──────────┐
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
   snapshot, low-effort thinking, verdict-first prompt); second slice 2026-10-26
   (per-holding short/long-term gain in the snapshot, one-call `get_tax_lots`, turn
   timings in the server log, 90s cap). Left: a lot-table answer still takes ~20s
   after its one tool call, pure-math answers think ~9s, the snapshot costs ~1.5s
   cold. Next: preload this year's realized gains by sale, warm the snapshot on page
   load, and remember facts the user stated (age, targets) across threads. Themes:
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
| Product | Lot-level portfolio tracking (FIFO, splits, realized by year) | built | core engine, 120 golden tests |
| Product | Tax Center: raise cash, harvest losses, wash-sale radar | built | deterministic, no LLM |
| Product | DCA counterfactual vs. benchmarks | built | compare page, up to 4 benchmarks |
| Product | Chat companion grounded in your data | partial | rated 3.0/5 before the snapshot + verdict-first prompt (2026-10-25); tax "if I sold" answers need no tool and lots come in one call (2026-10-26); "what do I sell for $X" gets the Raise Cash plan via `plan_raise_cash` instead of a silent 79s (2026-10-27); a lot-table answer still ~20s, pure math ~9s to the first word (backlog #1) |
| Product | Crypto wash-sale exemption | built | engine default, configurable, golden tests (2026-10-26) |
| Product | Proactive tax moves (free-money alerts) | partial | "Moves available now" on the Now tab lists crypto sell-and-buy-back locks in dollars (2026-10-26); unused $3,000, 0% LT room, year-end and wash-sale traps not in the list yet, chat can't see it (R-003) |
| Product | "I have $n" picks one of your candidates | partial | dashboard "Where should my next buy go?" + chat `pick_next_buy`, same core `pickNextBuy` (2026-10-26); waiting for the personas to try it (R-004) |
| Product | Tax setup during sign-up | partial | `/welcome` after sign-up: rough bracket → tax profile rates, account kinds, first holding (2026-10-26); filing status isn't stored yet (needs a column + `db:push`), probes still to confirm (R-005) |
| Product | Expert metrics discoverable, not front-facing | partial | Behind a closed "Performance details" disclosure on the dashboard (R-002); waiting for the personas to confirm |
| Product | Allocation vs. target mix + where the next deposit goes | partial | dashboard drift table and deposit split (2026-10-25); targets saved on the device only, so chat can't see them (backlog #2) |
| Product | Dividend income view | missing | backlog #4 (Olenna) |
| Product | Keyboard layer (⌘K, shortcuts) | missing | backlog #5 (Hermione) |
| Product | Phone layout | partial | top-bar shell and dashboard fit 400px; other pages not yet checked at phone width |
| Product | Visual identity matching the evolution page | built | every page converted (2026-10-25); R-001 waits on the personas' look scores holding |
| Simulator | Personas with habits (policy) and judgment (LLM mind) | built | 11 personas, incl. one retiree drawing down monthly |
| Simulator | Real prices, no lookahead, live quotes today | built | Tiingo and Coinbase via the app's cache |
| Simulator | Trades through the app's API | built | timed |
| Simulator | Goal-directed missions in the real UI (forms, imports, plans; expect-then-check) | built | 3/day on disposable twin accounts, `pnpm sim:mission` |
| Simulator | Coverage map: every flow × day, missions target blind spots | built | `src/features.ts` catalog, Progress page |
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
| Loop | Twice-daily schedule (08:00 + 20:00; evening = missions + more rounds) | done | armed via scripts/install-launchd.sh |
| Loop | Live evolution page | built | regenerated every cycle |
| Loop | Three-layer site: start page, cumulative progress, daily deltas | built | ~/beobeo-sim/site, published as one artifact |
| Loop | Your requests tracked apart from persona feedback | built | REQUESTS.md, worked first every cycle |

## Evolution log

One entry per cycle, newest first: date · branch · what shipped · theme ids
answered · before/after signal.

- **2026-10-27 · Chat's portfolio snapshot is ready before Send.** The dev log showed every turn spending 1–2.5s building the snapshot before the model started. The chat page now warms it (`chat.warm`) on open and while the user types. The route starts it on arrival, alongside its thread writes, and the api memoizes it. Snapshot wait went 1.3s → 0ms; a no-tool answer's first token went 3.7s → 1.4s (`sim:ask`, cold vs. warmed). · theme `slow-chat-first-token` (11 personas, p50 4.4s) · expected: chat:first-token p50 under ~3s. Answers needing a tool step still pay ~2s per model round trip.

- **2026-10-27 · Compare's head-to-head speaks plainly (R-002).** Luna read "Yearly rate XIRR, TWR, Sharpe, max drawdown… homework" on Compare, and "−7.62% a year" next to "+1.28% total growth" scared her while she was down $5. Each row now shows only a plain name; the term, a one-line meaning, a yardstick and a takeaway that reads her own column against each benchmark ("Your ride was bumpier than SPY.") open on hover or tap. A new first row, "Gain on your money", matches the dollars above (−1.16% for her). The yearly rate is hidden until the history spans a year. The hover card is now one shared `MetricHover` component, which also makes the dashboard's Performance details cards open on a phone tap (before, they only opened on mouse hover). · request R-002, themes `dashboard-jargon-performance-risk`, `dashboard-annual-return-contradicts-total-return` · expected signal: no jargon or "which number is it" complaints from Compare; luna's and augusta's look and ease scores hold or rise.
- **2026-10-27 · Chat answers "what do I sell for $20k" instead of going silent.** Petyr asked for his lots sorted by tax per dollar raised and got "I'll pull your actual lots", then nothing for 79s, two days running. The turn log now records each model step's stop reason: after `get_tax_lots` the model spent its entire 4,096-token budget thinking through the ranking and wrote no answer. Chat now has a `plan_raise_cash` tool that returns the Tax Center's own Raise Cash plan (optionally limited to some symbols or one account), and the prompt tells the model never to rank lots or work out their tax itself. A step that still runs out of room says so and points to Tax Center. Re-run of his question: silence after 79s → the 25-lot plan, $525.93 tax and "$806.24 cheaper than oldest-first", in 26s. · themes `chat-lot-detail-answer-missing` (and the stall half of `slow-chat-first-token`) · expected signal: no lot or raise-cash question ends without numbers; petyr's chat rating rises from 1/5.
- **2026-10-27 · Setup never waits, and the first holding is typed in place.** Hermione's `welcome.setup` mission failed: step 1's Continue sat on "Saving…", "Type in a holding" seemed dead and then dropped her on /transactions, and the asset picker kept its list open with every row disabled while a Popular pick was being created, so more clicks flipped the selection. Now each step's save runs in the background while the next step shows (failures are reported on the next step), step 3 opens the add form right on the welcome page and lands on the dashboard after saving, step 2 hides account kinds an existing account already covers and waits for the list before drawing toggles, the income bands say they're 2026 brackets on taxable income, and the picker closes at once and shows the pick with a spinner. The sim's observer now sees a combobox's search box. Three re-runs: failed (5/5) → struggled at the add form's price math (4/5), with the wizard itself passing. · request R-005 · themes `onboarding-continue-stuck-saving`, `onboarding-type-holding-does-nothing`, `asset-combobox-options-disabled`, `onboarding-existing-accounts-unchecked-toggles`, `onboarding-bracket-mapping-unexplained` · expected signal: welcome missions reach the dashboard without calling a step stuck.
- **2026-10-27 · R-004 tried for real: next-buy probed in chat and by a mission.** Chat's `pick_next_buy` answered live in 5.5–9s with the dashboard's own pick (luna: NVDA over VOO; samwell: BND in the Roth IRA). The first mission on `dashboard.next-buy` (luna) struggled on two things, both fixed. The runner-up's reason "VOO is already 67.3% of your portfolio; this buy takes it to 73.3%" read as a reason against it. With two or more options the weight reason now compares: the top pick "keeps your money more spread out than VOO would", the others "spread your money less than NVDA" (core golden test updated, two added). The pick also kept showing the old amount for a moment after typing, so it now dims and says "Weighing $X…" until the new pick lands. · request R-004 · themes `next-buy-reason-contradicts-pick`, `next-buy-amount-prefilled-not-updating` · expected signal: next-buy missions stop calling the reason contradictory or the amount stuck.
- **2026-10-27 · A $0 dividend total says why.** The dashboard's Dividends tile showed a bare $0.00 next to SCHD, O and KO, and olenna read it as "not tracking them". At $0 it now says "None recorded · add a payout"; the link opens Add transaction already set to Dividend with quantity 1, so the amount field is the total received. On a window it says "None recorded in this period". New mission feature `transactions.dividend`. · theme `dividend-data-not-syncing-zero` · expected signal: no more "$0 dividends looks wrong" notes; the first dividend missions record a payout and see the total change.
- **2026-10-26 · A stalled database request can't hang a page anymore.** The Neon HTTP driver had no timeout. One `accounts.list,transactions.list` request sat for 8.6 minutes before a 500, and the same request answered in 1.3s right after; Tax Center's p95 was ~16 minutes. Every DB request now has a deadline (`@beobeo/db` `fetch-timeout.ts`, via `neonConfig.fetchFunction`): a SELECT gets 15s and is retried once, which is the retry that answered fast in practice. A write or batch gets 60s and is never retried, because a timed-out write may still have committed. A dev-log line `[db] read timed out…` marks each stall. Price providers got the same treatment (a 20s deadline per call), after a dashboard load took 10.7 minutes with the DB deadline already in place: the provider throttles serialize calls, so one hung Tiingo/Coinbase request stalled every read queued behind it. When a load still fails, the dashboard, transactions, compare and position pages show "Couldn't load … Try again" (the Tax Center's `TabError`). Before this, a failed dashboard load said "No holdings yet. Add your first transaction" and a failed transactions list said "No transactions yet", which reads as lost data. 5 tests, plus a forced timeout against the real DB (read retried once, failed in 27ms). · themes `transactions-500-accounts-list`, `error-transactions`, `switcher-dropdown-hang-after-create` · expected signal: no step or page latency in the minutes; latency p95s drop from 100s–1000s to under 30s.
- **2026-10-26 · Tax Center tabs keep what you typed and never show a bare grey box.** Raise Cash's amount, plan and do-not-sell list, and Harvest's loss cap, survive a trip to All Lots and back (petyr's $20,000 kept snapping back to $10,000). Changing the amount keeps the old plan up, dimmed, with "Planning $X…" or "Press Plan to update it for $Y", instead of an empty grey block. Every tab's loading state says what it's loading, and a failed query shows "Couldn't load… Try again" where the skeleton used to stay up forever. Other tabs' data is fetched in the background when the page opens. All Lots points to Transactions for sold shares (barristan expected them there). · themes `raise-cash-amount-resets-on-tab-switch`, `raise-cash-stale-plan-blank-block`, `tax-center-tabs-blank-placeholder`, `tax-profile-rate-not-editable` · expected signal: tax.* missions stop reporting grey boxes and lost amounts.
- **2026-10-26 · Chat keeps your conversation.** Leaving Chat and coming back reopens the conversation you had open (remembered per user on the device) instead of a blank "What would you like to know?". Picking a past chat now shows "Opening your conversation…" while it loads, where it used to flash the empty new-chat screen, which augusta read as "my conversation was lost" (mission 11, 18 steps, never sure she'd found it). Threads prefetch on hover. Checked in a browser (desktop and phone): reopened in ~0.8–1.3s, same thread after a round trip through the dashboard, and New chat clears it. Re-ran her mission: every pick showed her answer (no blank flashes). · themes `chat-past-chats-list-click-goes-blank`, `chat-returns-blank-after-navigation` · expected signal: chat.followup missions achieve without "blank chat" issues.

- **2026-10-26 · Three calm setup steps after sign-up (R-005).** Sign-up (email or a first Google sign-in) now lands on `/welcome` instead of an empty dashboard. Step 1: how you file (Single / Married, jointly / Head of household) and a rough taxable-income band ("$50k – $106k · 22% bracket"), plus an optional state rate; it fills the tax profile's federal ordinary and long-term rates from new core `bracketOptions` (2026 IRS thresholds, 4 hand-checked tests: e.g. single under $50,400 → 0% on long-term gains because the 0% bracket runs to $49,450). Step 2: tap the kinds of account you have (Brokerage preselected, Crypto exchange, Roth IRA, Traditional IRA, 401(k)); each becomes an account of the right type (`accounts.create` takes `accountType`). Step 3: type in a holding or import a CSV (`/transactions?add=1` / `?import=1` open the dialog), or skip to the app. Every step is skippable; skipping keeps the 24%/15% default and the auto-created "Default" account. A portfolio's own tax profile now starts from the rates saved on "all" instead of 24/15. The sim's registration probe walks the three steps (screenshots per step); mission feature `welcome.setup`. · R-005 · expected signal: registration probes land on the dashboard with no friction notes; new users' Tax Center quotes their bracket, not 24%.

- **2026-10-26 · A tap on a transaction opens it; it can't delete it.** Barristan tapped a row on his phone and deleted a VTI trade (the inline trash icon sat at the row's edge), and hermione's delete hit the neighboring QQQ buy. The trash icons are gone from rows. Tapping a row opens a details dialog: the record, the dollar amount (also a new Amount column in the list, replacing Fees) and, for a sale, the purchases it used and its short/long-term gain ("This sale realized a gain of $1,131.06, all long-term"), matched through a new `sourceTxnId` on the position's realized entries. Delete lives in the dialog behind a confirm step that names the trade. The undo toast now names quantity and date and stays up 10s. `shoot` gained `--click` for dialog screenshots. Re-run of barristan's mission: no accidental delete, and he found the lots and gain, but the lots area read as blank while a cold replay loaded, so it now says "Working out which purchases this sale used…" and the replay is prefetched on hover. · `transactions-delete-targets-shift`, `transactions-show-amount-lots-gain` · expected signal: no mission reports an accidental or wrong-row delete; `transactions.browse` missions find a sale's gain.

- **2026-10-26 · "Where should my next buy go?" picks one (R-004, first slice).** New core `pickNextBuy` scores each of the user's 1–5 options as 60% fit (with a target mix: the share of the deposit still short of target, untargeted = 0; without one: 1 − weight after the buy) plus 40% dip (70% position in the 1-year range, 30% under the user's average cost). It returns them ranked, each with one plain reason ("BND is $700 short of its 20% target.", "SOL is just 14.5% of your portfolio, so this spreads your money") and an account from `placeAccount`: crypto goes to taxable, bond funds to an IRA, everything else to wherever the user already holds it. Ten hand-computed golden tests. The dashboard ends with a section of the same name. It starts from the three largest holdings and the last deposit, so it answers before anything is typed, and it has "Show me another", a "How this was picked" popover and a persistent "analysis of your own options" note. Chat gets `pick_next_buy` on the same engine. Feature `dashboard.next-buy` is added for missions. · R-004 · expected signal: missions on `dashboard.next-buy` achieve their goal and trust the pick; "VOO or NVDA?" chat answers name one pick with the dashboard's reason.
- **2026-10-26 · One realized-gains story across dashboard, Tax Center and chat.** The Tax Center built its lots without the provider splits the dashboard injects. Gilderoy's NFLX had an unrecorded split, so its post-split sale oversold and the whole asset silently dropped out: the Tax Center showed $305 this year, while the dashboard's own year-to-date figure was $12.96. It now merges the same splits (`mergeKnownSplits`) and reads $394.32 short-term + −$381.36 long-term = $12.96. The rest of the mismatch was scope. The dashboard tile was all-time ($1,703) with no label, and chat answered for this year. The tile now says "All time · $12.96 this year", and the chat snapshot carries `realizedThisYear` beside `realizedAllTime`. The prompt makes the agent name which figure it means, give the other one, and note that tax figures leave out IRA sales. · `realized-loss-mismatch-dashboard-vs-chat` · expected signal: no "which number do I put on my taxes" feedback; fred/gilderoy chat realized answers quote the dashboard's figures.

- **2026-10-26 · One "Moves available now" list (R-003, second slice).** A new core `taxMoves` turns every tax opportunity into one list ranked by dollars: crypto sell-and-buy-back locks, then plain loss sales valued on top of them (with "don't buy back before" dates), then losses on hold under the wash-sale rule ("Don't sell BND before Nov 7", valued as if sold that day), then lots about to turn long-term ("Hold 2 purchases of VTI until Nov 7–Dec 8"). Lock and harvest lines sum exactly to the joint saving, and a breakdown bar plus "$X of this year's $3,000 deduction still unused" sit under the list. Three hand-computed golden tests. The Now tab's three separate sections (losses you could take, losses on hold, hold a little longer) collapsed into this one list. The chat snapshot carries the same list (`taxMovesNow`), so "any tax moves?" quotes the page's numbers. `Section` became `grid-cols-1`, because long nowrap rows pushed phone pages wider than the screen. Not in it yet: 0% long-term room, which needs income and filing status (R-005). · R-003 · expected signal: tax-curious personas (hermione, fred, arya) name a specific move from the Now tab; no "what should I do about taxes" themes left unanswered.
- **2026-10-26 · Chat: tax questions without the per-symbol round trips.** The server now logs where each chat turn's time goes (`[chat] snapshot · first text · model calls · tools`). On Fred's 68s question it showed 1.6s of snapshot, ~3.5s of tools and ~37s of model round trips: one `get_position_details` per coin, each followed by another model step. Fixes: (1) every snapshot holding carries `taxableGainIfSoldNow` {shortTerm, longTerm} from the Tax Center's own lots, so "what would I owe if I sold everything" needs no tool; (2) a new `get_tax_lots` tool returns every taxable lot in one call (the same lots as the Tax Center's All Lots), with filters (symbols, losses only, term, turns long-term by) and a columnar result, because hundreds of DCA lots with keys repeated on every row made the model read for two minutes; (3) the prompt says to answer from the snapshot when it's enough and to request all tools in one step; (4) the Anthropic client gets a 90s timeout and one retry, after a stalled stream held a turn for 13 minutes. Measured with the new `pnpm sim:ask`: Fred 42.7s → 7.1s to the first word (0 tools instead of 3, same numbers); Hermione's lot question 8 tool calls / 32s → 1 call, 25s total, and the answer now lists exactly the ten lots that ripen this quarter (before, it said "six" and called June lots "this quarter"). Not fixed: pure-reasoning answers (Samwell's compounding) still think for ~9s at low effort. · `slow-chat-first-token`, `chat-lot-detail-answer-missing` · expected signal: chat:first-token p95 under 15s; no 30s+ first words on tax/lot questions; hermione/arya lot answers judged verifiable.

- **2026-10-26 · Crypto has no wash-sale rule; "Moves available now" starts with sell-and-buy-back.** The tax engine now treats crypto as exempt from the wash-sale rule (configurable default `["crypto"]`, so a recent ETH buy no longer puts an ETH loss on hold). New tested core `lossLocks` runs the harvest engine on crypto loss lots only and groups them per coin. The Tax Center's Now tab opens a "Moves available now" section: "Sell and buy back 0.053 BTC · books an $887 loss · saves ~$240", with a standing note that buying back resets the cost lower, so the tax is deferred rather than erased. Moves worth under $5 are hidden (the spread costs more). Those coins leave the plain "Losses you could take" list so nothing shows twice, and "Hold a little longer" now lists only lots where waiting actually saves tax; before, Fred's BTC loss lots appeared there too, contradicting the sell advice. Seven new golden tests (cross-netting, the $3,000 cap and carryforward hand-computed). · R-003 · expected signal: fred/arya mention booking crypto losses; no "on hold" notes for crypto.

- **2026-10-26 · Missions + coverage (simulator).** Personas now pursue real goals in real flows, chosen from a catalog of every flow in the app by staleness × fit, and drive the browser step by step on a disposable copy of their account, stating expectations before each action. First runs, unprompted: Raise Cash forgets its amount on tab switch and shows no per-lot rows; an overlapping date-only CSV imported every trade twice (dedupe fixed: 36h window when prices match, cent-tolerant prices); the import preview doesn't flag duplicates; rows shift under the cursor after a delete. Expected signal: coverage map fills within a week; mission-found themes rank alongside persona complaints.
- **2026-10-25 · Chat and sign-in in the evolution look (every page converted).** Chat reads as a transcript instead of bubbles: the question is a quiet indigo pill, the answer is prose on the page, and turns are split by hairlines. Tool use shows as one eyebrow line ("Looked at · position details"). The page has a serif header with New chat. Conversations carry their date, because the same question asked twice gave identical titles. On phones, where there's no conversations column, a "Past chats" menu reopens them; before this, phones couldn't reach old chats at all. Suggestions and the composer are pills. In chat tables only numeric cells are mono, so words stay in sans. Sign-in and sign-up share an `AuthShell`: serif wordmark and title, the form on a hairline surface, the switch link below, and a password hint. · R-001 · expected signal: chat look scores hold or rise; no persona notes about lost chats on phones; registration probes note nothing about the form.
- **2026-10-25 · Allocation vs. your target mix, and where the next deposit goes.** The dashboard's Allocation section takes a target mix ("Set a target mix": one % per holding, must add up to 100). With one set, it opens with a verdict ("You're on target: every holding is within 2 points of your mix", or "Furthest off: VXUS is 4.2 points under its 30% target", or an untargeted holding named). Next to the donut, a now / target / off-by table with a bullet bar per row flags drift of 5 points or more. Below that, "Your next deposit of $[last deposit] goes into VTI $3,222 · VXUS $1,936 · BND $842": new tested core `allocationDrift`/`fillToTarget`, which fills the most underweight sleeve first and never needs a sell. First slice: targets are saved on the device (localStorage), because a new table needs a `db:push` the unattended loop isn't allowed to run. Sim personas with a `rebalance` rule start with their targets saved, so Minerva and Hermione see it. · `allocation-vs-target-drift` (minerva, *would not keep using*), part of `dashboard-no-next-step-guidance` · expected signal: minerva's dashboard notes turn to the drift table and the $6,000 split; hermione's "drift vs my 10% BTC target" is answered on the dashboard (chat still can't see targets).
- **2026-10-25 · Compare in the evolution look, verdict first.** The compare page now opens with one plain sentence ("Your portfolio is behind SPY by $1,976.96"; with several benchmarks it lists who you're ahead of and behind, each with the dollar gap). The four bordered cards became one hairline strip (your value + invested, then one tile per benchmark whose sub-line is your edge), and the chart and the head-to-head table sit in serif sections over rules. Chips and the scope trigger are pills, the "Comparing:" label no longer orphans on phones, and the head-to-head rows use the dashboard's plain names (Yearly rate, Total growth, Swings, Reward for risk). The tiles dropped their per-benchmark XIRR, which the table's first row already shows. · R-001 · expected signal: compare look/ease scores hold or rise; no "which number do I read" notes on compare.
- **2026-10-25 · Expert metrics one tap away, plain dashboard labels.** The dashboard's "Performance & risk" grid (yearly rate, growth of picks, timing effect, Sharpe, volatility, concentration) now sits behind a closed "Performance details" pill under the chart. Opening it starts with one sentence on why the yearly rate, the growth of your picks and the timing effect differ. Every label is plain, and the technical term (XIRR, TWR, Sharpe…) appears only in the hover card. The summary tiles say "Gain on holdings", "Gain from sales" and "Change · 1M" instead of "Unrealized/Realized P/L". On phones the tiles' hero numbers no longer truncate ("$120,247.…"). · R-002, `dashboard-jargon-performance-risk`, `dashboard-annual-return-contradicts-total-return` · expected signal: luna/augusta/fred stop raising dashboard jargon and "numbers disagree" notes; hermione still quotes TWR/XIRR.
- **2026-10-25 · Tax Center in the evolution look, zero states quieted.** All five tabs converted (R-001): page header, sideways-scrolling tab pills, hairline stat strips, serif sections over rules, ledger-style All Lots, sectioned Tax Profile. Each tab now opens with a plain verdict sentence ("You owe no capital-gains tax right now: you haven't sold anything at a gain this year", new tested core `taxOwedSoFar`), and sections appear only when they hold something, so no more "-$0.00" (fixed app-wide in `fmtUsd`) or rows of $0.00 boxes. On-hold losses are grouped per symbol and name the triggering buy, its account and the date it's safe to sell (petyr's ask). Tabs deep-link with `?tab=`. · R-001, `tax-center-noisy-zero-states` · expected signal: luna/augusta/petyr stop raising tax-center zero-state and jargon notes; look score holds or rises.
- **2026-10-25 · Chat: snapshot preloaded, verdict first.** Every chat turn now starts with a portfolio snapshot (holdings and weights, totals, how much was put in and how fast, accounts, saved tax rates) in the system prompt, so most questions need no tool call. Thinking runs at low effort, and the prompt was rewritten: answer in the first sentence, ~120 words, plain words, state assumptions instead of asking, turn saved tax rates into dollars, and lean toward one of the user's named options. Probed on 5 sim personas before → after: total time Luna 22s → 6.7s (first word 1.9s, no tool calls), Samwell over 60s → 15s with "Roughly yes" up front, Fred ~20s → 8s, Gilderoy 37s → 17s, Olenna 35s → 21s. Tool-heavy questions still take 5–15s to the first word. · `slow-chat-first-token`, `chat-too-long-jargony`, `chat-no-direct-on-track-answer`, `chat-ignores-stated-tax-profile` · expected signal: chat:first-token p50 under 3s, chat:total p50 under 12s, fewer "wall of text" notes.

- **2026-10-25 · R-001 phase 2: position, transactions, accounts, account pages.** The dashboard's building blocks (`PageHeader`, `Section`, `StatStrip`, `StatTile`) moved to a shared `page-section.tsx`, and four more pages now use them: hairline stat strips, serif section titles over rules, mono numerals, and quiet type pills on transactions. Found and fixed along the way: the position page crashed for anyone with two trades on the same day (duplicate avg-cost step timestamps), and past 12 trades the marker quantity labels smeared into an unreadable band, so they're now plain arrows. · R-001 · expected signal: look scores hold or rise; no `error-/positions` themes.

- **2026-10-25 · Population (first `/evolve-agents` audit).** Evidence: 3 sim days, 30 questions, 20 experience ratings. Ratings were not too agreeable (answers 2.6→3.0/5, only one would-recommend), and voices were in character. Three realism problems turned up. (1) **Monotone:** 7 of 10 personas asked nearly the same question three days running (Minerva asked about "this quarter's $6,000" every day, despite her goal of under 5 minutes a quarter). The mind only saw its past moods, never its past questions. Now it sees its last 3 questions with its own rating notes, and is told to follow up, move on or ask nothing. `typicalQuestions` were widened for 9 personas (v4). Minerva and Luna got "glance and leave" biases. (2) **Incoherent trade:** Gilderoy's NFLX sell was rejected because the mind wrote "Webull (taxable)". The next day he "rotated the NFLX cash" into AAPL without ever having sold. Account names now match case-insensitively with the suffix stripped. (3) **Irrational for who she is:** Arya's crypto dip rule fired so often that she sits at 23% crypto against her own 15% cap. Her crypto dips are now 12% with a 21-day cooldown, plus a "stops adding rather than trims at a loss" bias. **New persona: Barristan Selmy (70, retired, v1).** He sells $3,500 a month from a taxable account and leaves his IRA alone. Gap: Raise Cash is the Tax Center's headline feature, and no persona ever needed to raise cash (every sim trade in the window was a buy). New policy rules `lump` (one-time deposit) and `withdraw` (cadenced sells from overweight sleeves) were added, with tests. Bootstrapped with 74 trades since 2024-01-02.

- **2026-10-25 · `evolve/2026-10-25`.** First loop cycle. (1) R-001 phase 1: the evolution page's fonts (Shippori Mincho / Hanken Grotesk / JetBrains Mono) and cool indigo tokens are live app-wide, card shadows are gone, and the dashboard was restyled into hairline-ruled chapters. (2) Phone shell: the sidebar becomes a top bar with a scrolling nav row, the dashboard no longer clips, and holdings drop Qty/Price on phones (`dashboard-mobile-clipped-layout`). (3) Undoable transaction delete plus labels on every icon button (`unlabeled-buttons-transactions`, backlog #2). Expected signal: mobile and unlabeled-button themes stop recurring, look scores hold or rise (3.4 baseline).
- **2026-10-23 · genesis · `salarabb/phase_1`.** The loop is built: PLAN.md, `packages/sim` (10 personas named after Game of Thrones and Harry Potter characters, about 1,100 real-price trades), journal, digest, `/evolve`, `/evolve-agents`, the live evolution page. The first simulated day surfaced chat latency, verbosity and the missing verdict as the top themes. Two simulator bugs (ledger comparison, rounding oversell) were found and fixed the same day.
