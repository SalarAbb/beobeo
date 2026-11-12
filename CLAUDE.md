# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> ## ⚠️ Keep this file fresh, and short — non-negotiable
>
> **This file is the rulebook; [`docs/notes.md`](docs/notes.md) is the long version.** Every change that alters the architecture, schema, commands, conventions, env vars, dependencies or roadmap updates this file in the same change: the rule or fact itself, in a line or two. The story behind it (the incident, the mission, the numbers measured, the design that was rejected) goes in `docs/notes.md` under the matching heading. This file is loaded into every `/evolve` round, so every line here costs every round: keep it to what a change could break. Delete what's no longer true, in both files.
>
> **Before changing an area, read its section in `docs/notes.md`** (`grep -n "<topic>" docs/notes.md`). It records why things are the way they are, including designs the user rejected; a rule here that looks odd almost always has a reason there.

## What this is

> **The user's own website asks live in `REQUESTS.md`** (R-001…, quoted in their words, each with a "Done means" checklist). They outrank persona feedback, and every `/evolve` cycle advances the top open one. **Planning lives in `PLAN.md`** — principles every change is judged against, the loop, the ranked backlog, and the evolution log. `IDEAS.md` is raw idea material.

Beobeo — a multi-user financial companion / portfolio tracker (stocks, ETFs, funds, crypto). Differentiators: best-in-class position detail (lots, cost basis, per-year realized gains) with finance-grade visualizations, and a DCA counterfactual ("would the same dollars in SPY have done better?"). A mobile app (Expo/React Native) is planned later — which is why all domain logic is framework-free — and it's intended to eventually serve public users.

## Commands

```sh
pnpm dev          # dev server (apps/web on :3000)
pnpm build        # production build (only apps/web builds; packages are consumed as TS source)
pnpm typecheck    # tsc --noEmit across all packages (turbo); apps/web runs `next typegen` first (a new layout/page otherwise fails on stale .next/types route unions). Turbo cache occasionally stale-hits; when in doubt: cd <pkg> && pnpm exec tsc --noEmit
pnpm lint         # eslint; React-compiler rules enforced (react-hooks/purity, set-state-in-effect)
pnpm test         # vitest across packages (core, market-data, importers, sim, db)
pnpm --filter @beobeo/core test                                # one package
pnpm --filter @beobeo/core exec vitest run test/lots.test.ts   # one file
pnpm db:push      # drizzle-kit push schema to Postgres (no migration files yet — push workflow)
pnpm db:generate  # generate SQL migrations (unused so far)
pnpm db:seed      # WIPES + recreates demo user with 20 txns (demo@beobeo.dev / demo-password-123)
pnpm --filter @beobeo/db studio                # drizzle studio
pnpm --filter @beobeo/market-data backfill     # fill price_history for every asset that has transactions
pnpm sim:bootstrap [id...]  # (re)create sim personas + replay their habits from joinedOn (DB only, no LLM)
pnpm sim:day [--only a,b] [--no-llm] [--no-ui] [--date D]  # one simulated day against the RUNNING app
pnpm sim:digest             # ranked themes/latency/answers → ~/beobeo-sim/digests/<date>.md
pnpm sim:insights           # cross-day pattern tables over the journal
pnpm sim:theme ship|wontfix|open <key...> [--branch b] [--note n] | list
pnpm sim:report [--ref r]   # rebuild the evolution site (start page + progress + one page per day) → packages/sim/.out/site/ and ~/beobeo-sim/site/
pnpm sim:mission [--persona id] [--feature id] [--count n]   # run goal-directed missions by hand (re-run a mission-found bug after fixing it)
pnpm sim:ask --persona <id> [--cold] "<question>"   # one chat question as a persona (after the page-open warm-up; --cold skips it) → first-token/total/tools (server log has the [chat] breakdown)
pnpm sim:reset [--journal]  # delete sim+*@beobeo.sim users (journal history kept)
pnpm --filter @beobeo/sim shoot --persona <id> --routes /a,/b [--click '<css>'] [--income N | --pay N] [--band F] [--twin]   # light/dark/mobile screenshots as a persona (--click opens e.g. a dialog first; --income = taxable income typed into Tax Profile → Your income, --pay = pay typed there; --band = setup's band with lower edge F tapped, no pay; --twin = as the disposable mission twin sim+<id>-m, so clicks may save, e.g. walking /welcome's steps)
pnpm --filter @beobeo/sim probe --persona <id> [--route /dashboard] [--runs 2]   # time a page load as a persona (the sim's page: latency = until network idle) and list the requests it waited on, last to finish first; read the dev log (~/beobeo-sim/logs/dev-<date>.log) next to it
pnpm evolve                 # full cycle (scripts/evolve.sh): merge yesterday's branch, worktree + :3100 dev server, sim + digest, rounds of `claude -p /evolve`, checks, same-day merge
scripts/evolve.sh --evolve-only   # skip the sim, reuse today's digest, just build more rounds
scripts/install-launchd.sh [--remove]   # arm/disarm the twice-daily cycle, 08:00 and 20:00 (LaunchAgent dev.beobeo.evolve)
```

## Stack (update versions when bumping)

- **Runtime/tooling:** Node 26, pnpm 11 (workspace + Turborepo 2), TypeScript 5.9 strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`)
- **Web:** Next.js 16.2 (App Router, React 19.2), Tailwind CSS v4 (CSS-first config in `globals.css`), shadcn/ui (new-york, components vendored in `src/components/ui`)
- **Type (R-001, via `next/font/google` in root `layout.tsx`):** Hanken Grotesk only, for everything (`font-sans`, and `font-display` maps to it too). No other web font. See "Type system".
- **API:** tRPC v11 + superjson + TanStack Query v5 (`@trpc/tanstack-react-query` — `useTRPC()` hook pattern, NOT the older `api.x.useQuery` codegen style). The client link is `httpBatchStreamLink` (2026-10-28): each query in a batch resolves on its own, so a fast query never waits for the slowest one in its batch (procedures can't set response headers/cookies once streaming starts; auth goes through Better Auth routes, not tRPC)
- **Auth:** Better Auth 1.6 (email/password + optional Google), Drizzle adapter
- **DB:** Postgres 18 on Neon (serverless HTTP driver `@neondatabase/serverless` 1.x), Drizzle ORM 0.45
- **Money math:** decimal.js (precision 40) in `@beobeo/core`; Postgres `numeric` columns travel as strings
- **Charts:** lightweight-charts v5 (time series; note v5 API `chart.addSeries(AreaSeries, opts)`), Recharts 3 (donut, bars)
- **Agent:** `@anthropic-ai/sdk` (beta tool runner + `betaZodTool`), model `claude-opus-4-8`, adaptive thinking at low effort, streaming, preloaded portfolio snapshot
- **CSV:** papaparse
- **Tests:** Vitest 4
- **Simulation:** Playwright 1.64 (drives the installed Google Chrome via `channel: "chrome"`, falls back to bundled Chromium), Node's built-in `node:sqlite` for the journal (no native deps), persona minds on `claude-sonnet-5-5`

## Environment

Root `.env` (gitignored) is the single source; `apps/web/.env` is a **symlink** to it (Next only loads env from the app dir). Scripts (`seed`, `backfill`, `drizzle.config.ts`) load it via `dotenv` with `path: "../../.env"` — note the ESM import-hoisting trap: `import { db }` executes before `config()`, so scripts must dynamic-`import("./client")` after dotenv (see `packages/db/src/seed.ts`).

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon Postgres |
| `BETTER_AUTH_SECRET` | yes | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | yes | `http://localhost:3000` in dev |
| `TIINGO_API_KEY` | yes (equities) | primary stock/ETF prices + symbol search |
| `ALPHA_VANTAGE_API_KEY` | no | equity fallback (25 req/day free) |
| `COINGECKO_API_KEY` | no | crypto fallback + crypto search; **user declined (paid)** — crypto works keyless via Coinbase Exchange |
| `GOOGLE_CLIENT_ID/SECRET` | no | Google OAuth; button auto-appears when set. Redirect URI: `<origin>/api/auth/callback/google` |
| `APPLE_CLIENT_ID/SECRET` | no | Apple Sign-In, **dormant until deployed** — Apple requires paid dev account + HTTPS return URL (no localhost). ID = Services ID; secret = self-signed ES256 JWT (max 6-month validity, regenerate before expiry) |
| `ANTHROPIC_API_KEY` | for chat | agent; server-side only, never exposed to client. Also powers sim persona minds |
| `SIM_HOME` | no | sim journal/screenshots/digests/reports/logs dir, default `~/beobeo-sim` |
| `SIM_APP_URL` | no | app the personas use, default `http://localhost:3000` (evolve.sh sets `:3100`) |
| `SIM_DAILY_BUDGET_USD` | no | hard daily cap on persona LLM spend, default 5 |
| `SIM_PERSONA_MODEL` / `SIM_UI_REVIEWS_PER_DAY` | no | default `claude-sonnet-5-5` / 3 |
| `SIM_MISSIONS_PER_DAY` / `SIM_MISSION_MAX_STEPS` | no | daily goal-directed missions (default 3; ~$0.20–0.30 each) / max browser steps per mission (24; a feature can ask for more) |
| `SIM_EVENING_MISSIONS` | no | missions the day's second (20:00) cycle runs instead of a second persona day (default 3) |
| `EVOLVE_HOURS` / `EVOLVE_MAX_ROUNDS` | no | evolve.sh build-phase budget: wall-clock hours (default 3) and max rounds (12) |
| `EVOLVE_MIN_ROUND_MINUTES` | no | no new round starts with less than this left before the deadline (default 10; two rounds that started at 14:10 for a 14:11 deadline shipped nothing) |
| `EVOLVE_WORKTREE` / `EVOLVE_BASE` / `SIM_PORT` | no | evolve.sh: worktree path (default `../beobeo-evolve`), base branch (default `main`), dev port (3100) |

## Monorepo layout & data flow

```
transactions (DB, source of truth)
  → @beobeo/core (pure replay: lots → basis/realized/series)
  → apps/web/src/server/portfolio.ts (assembly: engine + prices, Decimal→number at the edge)
  → tRPC routers → React pages/charts
prices: providers → MarketDataService (cache-first) → price_history (DB)
agent: chat UI → /api/chat (SSE) → @beobeo/agent tool runner → PortfolioApi (user-scoped impl in apps/web)

## Hard rules (every change)

- **Money is Decimal.** Never floats for money or quantities server-side; `Number()` only at the display/chart edge. Postgres `numeric` travels as strings. Metrics/rates/projections in core use plain numbers on purpose.
- **Multi-tenancy:** every domain query filters by `ctx.userId`. Only `assets`, `price_history` and `asset_splits` are shared. The agent resolves symbols only among assets the user has transacted.
- **Every user-data read accepts and applies `portfolioId`** (undefined = all portfolios). A portfolio is a tax-entity boundary (a child's account), so `tax_profiles` are per (user, portfolio).
- **Cache rules (`src/server/cache.ts`):** a mutation that changes a user's transactions/accounts calls `invalidateUserComputations`; a new cached computation keys through `userCacheKey(userId, …)` with `portfolioId ?? "all"` + sorted ids, and returns plain JSON (Decimal→number inside). Bump a key's version segment when its payload or a metric definition changes.
- **Never add a per-asset query loop over the Neon driver** (it serializes queries): batch into one SQL statement. Every provider request passes `signal: providerSignal()`.
- **A failed load never falls through to an empty state** ("No holdings yet" reads as lost data): use `TabError`/`TabLoading` (`tax-center/tab-state.tsx`), never a bare skeleton.
- **Plain words in the UI (R-002):** "Gain on holdings", "Net gain from sales", "purchases" not "lots", "a year or less / over a year" not short/long-term; the technical term lives only in a `MetricHover` card. Every number is explainable on hover/tap.
- **One font: Hanken Grotesk** (user-enforced, asked four times). Never load another web font; titles differ by size/weight. Numbers use `.figure` / `.data` (tabular).
- **Colors come from `src/lib/viz.ts` and the identity tokens in `globals.css`.** Categorical hues by stable entity order, never rank; gain/loss are semantic tokens; one axis per chart; no shadows on cards.
- **The dashboard shows no drawdown/peak metric and no best/worst day** (each rejected by the user). Don't reintroduce one without asking.
- **React-compiler lint:** no `Date.now()`/impure calls in render or `useMemo`; no sync setState in effects (derive at render, or `useSyncExternalStore`). Default dates use `localIsoDate()`, never `toISOString().slice(0,10)` (that's tomorrow on a US evening).
- **Destructive actions are undoable; icon-only buttons have `aria-label`** (the sim reports unlabeled ones). Transaction rows have no inline delete.
- **Forms never wait on a save:** Save closes at once and a sonner toast carries it (loading → done, with "Open it again"/"Undo"); repeat submits are ignored. A button stuck on "Saving…" reads as a hang. Setup's add form (`owned`) clears at once and chains its saves; the step lists each holding as saving → recorded (`onSaveState`) and never hides its options.
- **Real-user data will be inconsistent:** one asset's `EngineError` goes to `dataIssues[]`, never a 500 for the page.
- **Selections that should survive navigation use `useStoredState`** (`lib/use-stored-state.ts`); tabs unmount on switch.
- **When the app gains a flow, add it to `FEATURES`** in `packages/sim/src/features.ts`, or missions never test it. Keep the labels the sim clicks: "Create account", "Continue", "Skip, show me the app", the welcome step titles, and the `radio` role on income bands.
- **Git:** work on `main`; the loop commits only on `evolve/*` and `scripts/evolve.sh` merges. Never commit `.env` (only `.env.example`). Schema changes use `pnpm db:push` (no migrations yet), which a human runs.

## Engine and packages (details: `docs/notes.md` → Monorepo layout)

- **`packages/core`** — pure TS, no framework/DB. **Any engine change extends the hand-computed Vitest fixtures.**
  - `buildLots(txns, method = "fifo")`: FIFO or HIFO lot engine over one asset's pre-sorted txns (throws `UNSORTED_INPUT`; oversells throw `OVERSELL`, never clamp). `buildLotsByAccount` replays per account, each with its `EngineTransaction.lotMethod`. Split ratio lives in `quantity` (4 = 4-for-1); dividend cash = qty × price; `transfer_in` without price = zero basis; `isLongTerm` = strictly more than one year.
  - `portfolioTimeSeries`, `replayDca` (benchmark series must be split-adjusted first: `adjustForSplits`), `xirr` (null under ~2 days), `metrics.ts` (flow-adjusted, capital-weighted; `materialDrawdown` for Compare only), `buysVsBenchmark`, `allocation.ts` (`fillToTarget` water-filling), `next-buy.ts` (`pickNextBuy`, reasons built in core so dashboard and chat agree), `projection.ts`, `dividend-income.ts`, `tax-brackets.ts` (2026 thresholds: **re-check every November**).
  - Tax engine (`tax-netting.ts`, `tax-wash-sale.ts`, `tax-optimizer.ts`): deterministic, no LLM. A lot's tax is always `totalTax(state + lot) − totalTax(state)`, never a rate table; `explainNetting` is the single implementation. Wash-sale detection only reports (never writes a basis adjustment) and exempts crypto (`DEFAULT_WASH_SALE_EXEMPT_CLASSES`). `taxMoves`, `sellEverything`, `profileAtIncome`, `zeroRateGains` feed the Tax Center's Now tab.
  - Client-safe subpaths: `@beobeo/core/allocation`, `@beobeo/core/tax-brackets` (no decimal.js in the browser).
- **`packages/db`** — Drizzle schema in `src/schema/` (`auth_*` tables are Better Auth's). Domain: `portfolios`, `accounts` (`accountType`; `lotMethod` + `cryptoLotMethod`), `assets` (shared), `transactions` (`numeric(38,18)` qty, `numeric(38,10)` money, `source` provenance), `price_history`, `asset_splits`, `chat_threads`/`chat_messages`, `tax_profiles`. Every DB request has a deadline (`src/fetch-timeout.ts`: reads 15s + one retry, writes 60s, no retry). Scripts load `.env` via dotenv and dynamic-import the client afterwards (ESM hoisting).
- **`packages/market-data`** — `MarketDataService`, cache-first over `price_history`. Bulk APIs (`getPricesBulk`, `getLatestPrices`) are the primary ones. Unadjusted closes on purpose (splits are transactions). `getLatestPrices` overlays live quotes for today (60s memo, 2.5s budget). `getLatestPrice` fetches a 10-day window, never one day. Series loads use a 14-day lead-in. Providers: equities Tiingo → AlphaVantage; crypto Coinbase Exchange (keyless) → CoinGecko. Client-safe `@beobeo/market-data/popular`. Web uses the `getMarketData()` singleton.
- **`packages/importers`** — runs in the browser. Presets: Robinhood, Coinbase, Delta, generic mapping; unknown formats are AI-mapped (`suggestCsvMapping`, header + ≤8 rows only). `bulkCreate` skips rows the account already has (`splitDuplicates`). Quantities stay strings.
- **`packages/agent`** — never touches the DB; tools run against `PortfolioApi` (`apps/web/src/server/agent-api.ts`, user-scoped, read-only). Tools return totals so the model never sums rows; when a question type is slow because the model computes, add the total to a tool. Every turn gets a cached snapshot (`getContextSnapshot`) warmed on page open. The system prompt carries an **app map: keep it in sync when a flow moves or is renamed.** Turn timings log one `[chat] …` line per turn in the dev log.
- **`packages/sim`** — the loop's simulated users (see "The loop" below).
- **`site/`** — the public loop showcase (`index.html`, plain HTML, no build), deployed to https://salarabb.github.io/beobeo/ by `.github/workflows/pages.yml` on push to `main`. Its numbers are a snapshot (first 14 days); re-shoot `site/og.png` and `docs/loop-preview.png` when the page changes. The repo is MIT-licensed and public-ready: nothing personal (real portfolios, emails, the journal) is ever committed.

## Web app (`apps/web`; details: `docs/notes.md` → Gotchas, Visual identity)

- tRPC v11 with `useTRPC()` + TanStack Query; `httpBatchStreamLink`. `protectedProcedure` gives `ctx.userId`. Routers in `src/server/routers/`. Heavy computation in `src/server/portfolio.ts` / `tax-center.ts` behind `cached()`; concurrent identical runs share one (`sharedRun`).
- Page layouts (`dashboard/`, `transactions/`, `tax-center/`, `compare/`) warm their first batch's computations during the HTML request; the nav's `warm` map prefetches on hover. Add both for a new page whose first paint waits on a heavy query.
- Shared page building blocks: `components/page-section.tsx` (`PageHeader`, `Section`, `StatStrip`, `StatTile`) and `MetricHover`. The dashboard is the reference page.
- Tax Center: tabs Now / Raise Cash / Harvest Losses / All Lots / Tax Profile (`?tab=`); every tab leads with one plain verdict sentence and shows sections only when they have content. Sales match purchases per (account, asset) with the account's method (`replayByAccount`, `lotMethodFor`).
- Device-only state (until a human `db:push` adds server columns): target mix, income/filing status, the next-buy amount last typed, saved selections. The chat agent can't see device-only state.
- Auth: Better Auth with session cookie cache (5 min). Middleware does an optimistic redirect; the real check is in `(app)/layout.tsx` + tRPC. The app always shows who is signed in.
- Add-transaction dialog: outside clicks don't close it, price auto-fill is derived at render, entry by total is supported, dates use `date-picker.tsx` (never `<input type=date>`).
- Restart the dev server after changing a workspace package; if CSS changes don't show, stop it and `rm -rf apps/web/.next`.

## The loop (details: `PLAN.md` → The loop, `docs/notes.md` → packages/sim)

- `scripts/evolve.sh` runs twice a day (08:00, 20:00): merges passing `evolve/*` branches into `main`, simulates (morning: a persona day; evening: missions), digests, then runs rounds of `claude -p /evolve` in the `../beobeo-evolve` worktree on :3100, then checks and merges. Limits pause the cycle until the reset. `/evolve` must never push, merge, reset or touch `.env`.
- Personas: `packages/sim/personas/*.json`, named after Game of Thrones / Harry Potter characters (ids are first names; email `sim+<id>@beobeo.sim`). **Bump `version` on any persona edit.** Sim scripts `import "../src/env"` first.
- Missions (`src/app/mission.ts`): one feature from `FEATURES` per persona, on a disposable twin account. Status is only whether the task got done; `trusted` is separate; goals must use the persona's real data, except a labeled `misbelief` (about one in six); `outOfSteps` marks a run that hit the step limit (default 24, `maxSteps` per feature). After each action a mission waits (≤5s) for `[data-slot=skeleton]` and `TabLoading`'s spinner to clear (`networkidle` resolves at once on a client-side navigation), so a new loading indicator should be one of those.
- Sim-caused themes: `pnpm sim:theme wontfix <key> --note "SIM ARTIFACT: …"`.
- The evolution site (`pnpm sim:report`) parses PLAN.md's Capability map table and Evolution log: keep their format.

## Verification

- Engine: `pnpm --filter @beobeo/core test`. Full pass: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Visual: `pnpm --filter @beobeo/sim shoot --persona <id> --routes …` (light, dark, phone). Check fonts by computed `font-family` (Hanken Grotesk only).
- Smoke: sign in `demo@beobeo.dev` / `demo-password-123`, or as a persona via `curl` to `/api/auth/sign-in/email` with a cookie jar.
- Chat: `pnpm sim:ask --persona <id> "<question>"`; answers must match the page's numbers.

## Status & roadmap (KEEP THIS CURRENT)

Built: auth (email/password + Google; Apple dormant until deployed), dashboard, positions, transactions (manual, CSV import with de-duplication, export), Compare, Tax Center, chat agent, welcome setup, multi-portfolio, per-account sale matching (FIFO/HIFO, 2026-11-03), and the self-evolving loop (12 personas, missions, twice-daily cycles). History of each piece: `docs/notes.md` → Current status, and PLAN.md's Evolution log.

Next / deferred: specific-lot selection per sale (stocks sold by chosen lot still replay FIFO), Raise Cash's broker-default comparison for HIFO accounts, server tables for device-only state (needs `db:push`), SnapTrade sync, Expo app, multi-currency, deployment (Vercel + Neon), rate limiting before public launch, generated migrations before real users, and rotating the Neon credential.
