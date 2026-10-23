# IDEAS.md — Beobeo product ideas

> A running idea book for turning Beobeo from "a place that shows my holdings" into
> "the thing that makes me a better investor." Not a roadmap — a source of raw material.
> Each idea says *what it is*, *why it's different*, *what it leans on that we already
> have*, and *how hard it is*. Prioritized shortlist at the bottom.

## The one insight this whole file is built on

Almost every portfolio tracker is a **read-only mirror**: it shows you a number
(your balance) that you could already see in your brokerage. It answers *"what do I
have?"* and stops.

Beobeo already computes something almost nobody else does at the retail level: a
**lot-level replay** of your entire investing life. We know, for every share you've
ever owned, its exact cost basis, its acquisition date, whether it's long- or
short-term, when you sold it and for how much, and — via `replayDca` — what the same
dollars would have done elsewhere. That is a *causal model of your decisions*, not a
snapshot of your balance.

**That model lets us answer questions no mirror can:**
- *Was that a good decision?* (not just "did it go up")
- *What did this choice cost me vs. the road not taken?*
- *What should I do next, and exactly how, down to which lot?*
- *Why is this number what it is?* (trace any figure back to the transactions that made it)

Every idea below is chosen because it exploits that model. The ones with a 🔒 are
**structurally hard for competitors** because they require the lot-level truth we
already have. The ones with a 🤖 are **agent-native** — they turn our chat agent from
a Q&A box into a proactive participant.

---

## Theme 1 — Decision quality (the real differentiator)

Tracking tells you *what happened*. This theme tells you *whether you're any good*,
and separates skill from luck. This is Beobeo's sharpest possible wedge because it's
built entirely on data we already replay.

### 1.1 The Behavior Gap 🔒
**What:** Show two returns side by side: **time-weighted return (TWR)** — how your
*picks* performed — and **money-weighted return (MWR / XIRR)** — how *you* actually
did given your timing of contributions and withdrawals. The gap between them is the
"behavior gap" (Dalbar's famous finding: the average investor underperforms their own
funds by ~3%/yr purely through bad timing). Almost no retail app surfaces this, and
it's the single most honest mirror you can hold up to someone.

**Why novel:** Brokerages show one blended number that quietly hides whether your
timing helped or hurt. We can say: *"Your funds returned 11.2%/yr. You captured
8.1%. The 3.1% gap is timing — you added money after rallies and sat out dips. That
cost you ~$14,200 over 4 years."*

**Leans on:** `portfolioTimeSeries` (already daily-valued → TWR by chaining daily
returns), `xirr` (already implemented → MWR). Both engines exist; this is an assembly
+ a chart.

**Surface:** A stat pair on the dashboard, plus a "Timing" card that highlights the 3
best and 3 worst-timed contributions.

**Effort:** Low. This is mostly wiring two things we already compute.

### 1.2 Return attribution — allocation vs. selection vs. timing 🔒
**What:** Decompose total return into *why* you made money. Brinson-style
attribution: how much came from **being in the right asset classes** (allocation), how
much from **picking the right names within them** (selection), and how much from
**when you moved** (timing/interaction). "You beat a 60/40 by 4.1 pts: +5.0 from
overweighting tech, −1.4 from stock selection inside tech, +0.5 from timing."

**Why novel:** This is institutional performance-attribution machinery, never exposed
to retail. It reframes "I'm up 20%" into "here's the *source* of my edge, so I know
what to keep doing."

**Leans on:** lot engine (positions over time), price history, a reference allocation.

**Effort:** Medium. Needs a benchmark decomposition and per-period weights.

### 1.3 Ghost portfolios — "the road not taken" 🔒🤖
**What:** Generalize the DCA counterfactual into a first-class **counterfactual
engine** that answers any "what if I had…" with a real replayed series:
- *"What if I'd never sold?"* — resurrect every sold lot at today's price → your
  **"diamond hands" P/L**: the true cost (or benefit) of every exit you made.
- *"What if I'd held instead of trading in and out?"* — buy-and-hold ghost.
- *"What if I'd rebalanced quarterly to my target weights?"*
- *"What if I'd reinvested every dividend (DRIP)?"*
- *"What if I'd put my worst pick's money into my best idea?"*

Each renders as a faint "ghost" line next to your actual equity curve.

**Why novel:** We already have the hardest piece (`replayDca` with flows, splits,
XIRR). No competitor lets you interrogate your *own alternate histories*. This turns
regret into a quantified, learnable signal instead of a vague feeling.

**Leans on:** `replayDca`, lot engine, `adjustForSplits`. The "never sold" ghost is
especially cheap — we already store the sold lots.

**Surface:** A "Roads not taken" panel on each position + a portfolio-wide toggle set
on the value chart. The agent can generate arbitrary ones on request
("what if I'd sold NVDA in January?").

**Effort:** Low–Medium (the engine exists; this is new replay inputs + UI).

### 1.4 Decision journal + thesis grading 🤖
**What:** When you record a buy/sell, optionally capture a one-line **thesis** ("buying
the dip, expecting recovery by earnings") and a **conviction** (1–5). Months later the
agent **grades the decision against what actually happened** and against your stated
thesis — not just "did it go up," but "did your *reasoning* hold?" Aggregate into a
personal scorecard: *your* win rate, your average edge when high-conviction vs. low,
whether your dip-buys actually work.

**Why novel:** Pros keep decision journals; no consumer app closes the loop
automatically. It converts a tracker into a **feedback system for judgment** — the
thing that actually compounds.

**Leans on:** a `thesis`/`conviction` field on transactions, lot engine for outcomes,
agent for grading.

**Effort:** Medium. Small schema add + agent tool + a scorecard page.

### 1.5 Luck vs. skill meter 🔒
**What:** Estimate how much of your return is repeatable skill vs. noise. Compare your
picks to a random same-weight basket / their sector, run a bootstrap over your trade
outcomes, and give an honest confidence band: *"Over 23 closed positions, your edge is
+2.1%/trade, but the spread is wide enough that we can't yet distinguish it from luck
(need ~40 trades)."*

**Why novel:** Directly counters overconfidence bias (the research is unanimous that
retail investors attribute luck to skill). Radical honesty is a brand.

**Effort:** Medium. Statistics over the realized-gains history we already compute.

---

## Theme 2 — Tax intelligence (our lot engine is a cheat code here)

Tax features are the one area where **lot-level data is mandatory** and most trackers
simply don't have it. We do. This is a moat we can occupy almost immediately.

### 2.1 Tax-lot optimizer / specific-lot sell simulator 🔒
**What:** Before you sell, pick *which lots* to sell to hit a goal. "Sell 50 shares of
AAPL" isn't one decision — it's a choice among lots with different bases and holding
periods. Show, side by side, what FIFO vs. HIFO vs. specific-lot selection does to your
realized gain, your **short-vs-long-term split**, and your resulting tax bill at your
marginal + LTCG rates. "Selling your 2021 lots instead of FIFO keeps this long-term and
saves you $1,840 in tax."

**Why novel:** This is the headline feature of specific-lot cost basis, and it's
invisible in nearly every consumer tracker. We already have the lots and holding
periods; this is the natural payoff of the engine.

**Leans on:** `buildLots`, `isLongTerm`, `positionFromLots`. Roadmap already lists
HIFO/specific-lot — this is the *interactive* face of it.

**Effort:** Medium.

### 2.2 Wash-sale radar 🔒🤖
**What:** Continuously watch the **±30-day window** around every loss. Warn *before*
you buy: "Buying VTI today disallows the $2,300 loss you harvested on VOO 12 days ago
(substantially identical? flag for review)." And after the fact, flag realized losses
that were disallowed and where the basis moved.

**Why novel:** Wash-sale tracking across a whole portfolio and calendar is genuinely
hard and requires exactly the dated-lot data we hold. It's a feature people pay
advisors for.

**Leans on:** transaction dates + lot engine + a same-day proximity check.

**Effort:** Medium.

### 2.3 Tax-loss harvesting scanner 🔒🤖
**What:** A dated, dollar-quantified inbox card: "You have $4,100 in unrealized losses
across 3 lots eligible to harvest without a wash sale. Harvesting offsets your $3,900
of YTD realized gains → est. tax saved $1,150. Suggested replacement to keep exposure:
[similar ETF]." One click to simulate; you record the trade yourself.

**Why novel:** Robo-advisors automate this but only *inside their walls*. Nobody does
it for a **self-directed investor across all their accounts**. That's the gap.

**Effort:** Medium (builds on 2.1 + 2.2).

### 2.4 Year-end gain/loss budgeting 🔒🤖
**What:** A November agent nudge: "You're at +$8,200 realized this year. You have room
to harvest $4,900 in losses to land at your target. You also have a lot going
long-term on Jan 14 — waiting 9 days on that sale saves $610." A tax-aware to-do list
for December.

**Why novel:** Turns the engine into a *calendar-aware planner*, not a report.

**Effort:** Medium.

### 2.5 After-tax return & tax-drag meter 🔒
**What:** Show returns **net of taxes** you'll actually owe (using holding periods +
your marginal/LTCG rates), and a "tax drag" number — how much annual return you lose to
turnover. Makes the cost of trading viscerally clear.

**Effort:** Low–Medium.

---

## Theme 3 — Risk & portfolio science, made legible

Retail apps either hide risk entirely or dump a Sharpe ratio with no context. The
opportunity is to make real portfolio science **legible and actionable** — every metric
paired with a plain-language "so what" and a suggested move.

### 3.1 Look-through concentration X-ray 🔒
**What:** Your ETFs hide your real exposure. If you hold VOO + QQQ + direct AAPL, you
own *a lot* more AAPL than you think. Decompose funds into their underlying holdings
and show your **true** single-name and sector concentration. "You believe you're
diversified, but AAPL+MSFT+NVDA are 24% of your effective portfolio once we look
through your ETFs."

**Why novel:** This is Morningstar X-Ray, which people pay for, and it's the #1 thing
that surprises DIY investors. Feasible with a fund-holdings data source.

**Leans on:** positions + a fund-constituents dataset (new data dependency).

**Effort:** Medium–High (needs holdings data; can start sector-only from cheaper data).

### 3.2 Risk contribution (not just weight) 🔒
**What:** A position can be 5% of your money but 20% of your risk. Show **marginal
contribution to volatility** per holding — who's actually driving your swings. "TSLA is
6% of value but 19% of your portfolio's volatility."

**Leans on:** price history → covariance matrix → risk decomposition.

**Effort:** Medium.

### 3.3 Correlation map + "effective number of bets" 🔒
**What:** A correlation heatmap of your holdings and a single **diversification score**
(effective number of independent bets). "You hold 12 things but they move like ~3.4
independent bets — you're less diversified than the count suggests."

**Effort:** Medium.

### 3.4 "Your portfolio vs. the efficient frontier" + one-trade nudges 🔒🤖
**What:** Plot your portfolio on a risk/return (Pareto) chart against the efficient
frontier built from your own asset universe. Then the agent suggests the **smallest
trade** that moves you toward the frontier: "Trimming NVDA 3% into bonds keeps expected
return flat while cutting volatility 1.8 pts — a strictly better spot." Marginal-Sharpe
nudges, not a robo-rebalance.

**Why novel:** Mean-variance optimization exists in pro tools; framing it as *"here's
one small nudge toward Pareto-optimal"* makes it usable and non-preachy. This directly
answers the goal's "pareto optimal portfolio" ask.

**Effort:** High (optimizer + careful, humble UX).

### 3.5 Scenario stress tests / history replays 🔒🤖
**What:** "How would *today's* portfolio have done in the 2020 COVID crash? The 2022
rate shock? Dot-com?" Apply historical shock patterns to current holdings. Plus forward
**Monte Carlo cones** for goals ("70% chance you clear $250k by 2032 at current
contributions").

**Why novel:** Makes risk felt, not abstract. Turns "you're up" into "here's what a bad
year looks like *for you*, in dollars."

**Effort:** Medium (historical) / Medium (Monte Carlo).

### 3.6 Factor exposure 🔒
**What:** Regress your returns on standard factors (value/growth, size, momentum,
quality) and show your tilts. "You think you're a value investor; you're actually 70%
momentum." A mirror for your *style*, not just your holdings.

**Effort:** High (factor return data + regression).

---

## Theme 4 — The agent as a proactive chief-of-staff 🤖

Today the agent answers when asked. The leap is making it **notice, prioritize, and
propose** — always grounded in *your* lots, never generic market noise. This is where
"agentic insights/reminders/suggestions" from the goal live.

### 4.1 The Insight Inbox — dated, quantified, dismissible cards 🤖🔒
**What:** A triage feed (like an email inbox) where each card is a *specific, grounded,
dollar-quantified* observation about **your** portfolio, with a one-click simulate
action and a dismiss. Not "market volatility is up." Instead:
- "NVDA crossed 30% of your portfolio (was 18% in Jan). Concentration alert."
- "A lot of AAPL goes long-term in 9 days — waiting saves $610 in tax."
- "You've held $4,100 of harvestable losses for 3 weeks."
- "Your cash drag is 8% of the portfolio earning ~0%."
- "This dividend hits your account Thursday: $214."

**Why novel:** The grounding is the whole thing. Generic robo-alerts get ignored;
*"this specific dollar amount, from your specific lots, act by this date"* does not.
Every card traces to real data via our `PortfolioApi`.

**Leans on:** agent + `PortfolioApi` + a lightweight rules/triggers layer + a new
`insights` table.

**Effort:** Medium–High (worth it — this may be the flagship).

### 4.2 Event watchers & the "why it matters to *me*" digest 🤖
**What:** A weekly (or event-triggered) digest that filters the firehose to *your*
holdings and explains the personal stake: earnings for names you own, ex-dividend
dates, splits, 52-week extremes, a holding crossing your cost basis, a lot going
long-term. Each line ends in "…which matters because you hold 40 shares at a $150
basis."

**Effort:** Medium (needs a corporate-events/earnings feed; splits we already track).

### 4.3 Natural-language alert rules 🤖
**What:** "Tell me if any position drops more than 10% in a week, or if tech goes over
40% of my portfolio." The agent compiles plain English into a saved rule that runs
server-side and posts to the Insight Inbox (or push/email/Telegram — research shows
mobile alert channels are underserved).

**Effort:** Medium.

### 4.4 Trade sandbox — simulate before you commit 🤖🔒
**What:** A dry-run mode. Describe or draft a trade and instantly see its impact
**before recording it**: new allocation, tax hit (with lot selection from 2.1),
wash-sale flags, effect on concentration/risk contribution, and where it moves you on
the frontier. "If I sell 20 NVDA and buy SCHD…" → full impact preview.

**Why novel:** Every tracker is backward-looking; this makes Beobeo a **forward**
decision tool without ever placing an order. It's the safe, honest middle ground
between "just tracking" and "robo-advisor telling you what to do."

**Leans on:** everything — lot engine, tax module, risk module, all run on a
hypothetical transaction list.

**Effort:** Medium (huge leverage — it composes the other modules).

### 4.5 Portfolio "second opinion" on demand 🤖🔒
**What:** One button: "Review my portfolio." The agent produces a structured critique —
concentration, tax opportunities, cash drag, closet-indexing, fee drag, behavior-gap —
each point grounded in a tool call, with the numbers to back it. Not advice-to-buy;
**diagnosis**, which sidesteps the regulatory line while being genuinely useful.

**Effort:** Low–Medium (composes existing tools into a prompt + report layout).

---

## Theme 5 — Narrative & time (making the data feel *yours*)

The emotional hook. These change *how it feels* to open the app, which drives the habit
that makes everything else valuable.

### 5.1 Time-travel scrubber 🔒
**What:** A date slider on the dashboard. Drag it and the *entire* app — holdings,
allocation, P/L — reconstructs to that day. "Show me my portfolio the day before I
panic-sold." We can rebuild any historical state exactly because we replay from
transactions.

**Why novel:** Only possible with a replay engine. Most apps can't show you last
Tuesday, let alone two years ago. It's magical and cheap for us.

**Effort:** Low–Medium (the engine already takes an "as of" date implicitly).

### 5.2 Your investing story 🤖🔒
**What:** An auto-generated, annotated **narrative timeline** of your investing life:
first buy, best/worst decisions, the market events you lived through, your biggest
drawdown and recovery. "In March 2022 you kept buying through a 24% drawdown — that
discipline is worth +$X today." Wrapped-style, but true and personal.

**Effort:** Medium (agent narrates over the event/lot timeline).

### 5.3 "This day in your portfolio" & milestone cards 🤖
**What:** Ambient, low-effort delight — anniversaries of key buys, "you first crossed
$100k today," "one year ago you were down 15% and held." Milestone cards that reinforce
good behavior.

**Effort:** Low.

### 5.4 Shareable performance receipt (anonymized) 
**What:** A beautiful, exportable card of your *risk-adjusted* performance (returns,
Sharpe, behavior gap, top decision) — dollars hidden, percentages shown. Growth loop +
a reason to feel proud of *process*, not just P/L.

**Effort:** Low–Medium.

---

## Theme 6 — Income, cash & breadth (table stakes done well)

Necessary to be a complete "financial companion," even if less novel. Do these so the
novel stuff has a full canvas to sit on.

- **Dividend calendar + forward income projection** 🔒 — we have the shares and can pull
  dividend schedules; project 12-month income, show yield-on-cost (a number brokerages
  hide), and dividend-growth streaks. *Effort: Medium.*
- **Cash & yield tracking** — cash as a first-class position with its own drag/yield, so
  the risk and allocation views are honest. *Effort: Low–Medium.*
- **Net-worth / real assets** — real estate, private holdings, so it's a true financial
  companion. *Effort: Medium.*
- **Brokerage sync (SnapTrade)** — already on the roadmap; removes the manual-entry
  wall that kills retention. *Effort: High.* **The single biggest adoption unlock.**
- **Options & multi-currency** — roadmap; broadens the addressable user.

---

## Moat map — which ideas competitors *structurally* can't copy

| Requires…                          | Ideas that depend on it |
|------------------------------------|-------------------------|
| **Lot-level cost basis + dates**   | 1.1 behavior gap · 1.3 ghosts · 2.1 lot optimizer · 2.2 wash-sale · 2.4 year-end · 2.5 after-tax |
| **Replay-from-transactions engine**| 1.2 attribution · 1.3 ghosts · 5.1 time-travel · 5.2 story · 4.4 sandbox |
| **Agent wired to real portfolio**  | 4.1 inbox · 4.2 digest · 4.4 sandbox · 4.5 second opinion · everything grounded |
| **Price-history + math**           | 3.x risk suite |
| **New data dependency**            | 3.1 look-through (fund holdings) · 3.6 factors · 4.2 earnings feed · 6 dividends |

The top two rows are Beobeo's real moat: they're free for us and expensive for a
mirror-style tracker to bolt on, because they require having modeled every decision from
the start. **We already did the hard part.**

---

## Prioritized shortlist

Scored on *impact on how people interact with their portfolio* × *leverage on what we
already built* ÷ *effort*.

### Tier 1 — build next (high impact, mostly assembly of existing engines)
1. **Behavior Gap (1.1)** — cheapest profound insight we can ship; pure wiring of TWR +
   existing XIRR. The "aha" that defines the product's voice.
2. **Ghost portfolios (1.3)**, starting with **"what if I never sold"** — one new
   `replayDca`-style input over lots we already store; emotionally devastating in a good
   way.
3. **Insight Inbox (4.1)** — the flagship agentic surface; start with 4–5 grounded card
   types (concentration, going-long-term, harvestable losses, cash drag, dividend
   incoming).
4. **Tax-lot sell simulator (2.1)** — the payoff of our cost-basis engine; turns lots
   into money saved.
5. **Time-travel scrubber (5.1)** — cheap magic that shows off the replay engine.

### Tier 2 — high value, more work
6. **Trade sandbox (4.4)** — composes the tax + risk + allocation modules into a
   forward-looking decision tool.
7. **Wash-sale radar (2.2)** + **TLH scanner (2.3)** — advisor-grade, moat-heavy.
8. **Look-through X-ray (3.1)** — the "you're not as diversified as you think" shock.
9. **Decision journal + grading (1.4)** — turns tracking into a judgment feedback loop.
10. **Risk contribution + correlation (3.2 / 3.3)** — legible risk with a "so what."

### Tier 3 — big bets / needs new data or heavy math
11. **Efficient-frontier nudges (3.4)**, **factor exposure (3.6)**, **Monte Carlo goals
    (3.5)** — the quant frontier; humble UX is the hard part.
12. **Brokerage sync (6)** — not novel, but the biggest retention/adoption unlock.
13. **Return attribution (1.2)**, **investing story (5.2)** — polish that deepens the
    relationship.

### The north star
Chain the Tier 1 items and Beobeo stops being a mirror. It becomes the app that tells
you *how good you actually are* (behavior gap), *what your choices cost you* (ghosts),
*what to do next and exactly how* (inbox + lot optimizer), and *lets you stand inside
any moment of your own history* (time-travel) — each answer grounded, to the dollar, in
your real lots. No mirror can follow us there.

---

## Cross-cutting principle: every number is explainable 🔒

Whatever we build, keep one rule: **any figure in the app can be traced to the
transactions that produced it.** Click your cost basis → see the exact lots. Click a
realized-gain number → see the matched buy/sell pairs and fee allocation. Ask the agent
"why is my AAPL basis $147?" → it walks the FIFO chain.

Black-box trackers can't do this; our engine makes it nearly free. It's the trust layer
that makes every *other* number — especially the agent's suggestions — believable. In a
category full of hand-wavy dashboards, **radical explainability** is itself a feature.

---

*Living document. Add freely; prune when an idea ships or dies. Ideas grounded against
Beobeo's engine as of 2026-07-14.*
