# REQUESTS.md — website improvements you asked for

> Your own asks for the product, kept apart from what the simulated personas suggest
> (those live in the journal and the digest). Every `/evolve` cycle works on the top open
> request **before** any persona theme, and a request is only `shipped` when every
> "Done means" line is true. Newest requests go at the bottom, with the next number.
>
> Status: `open` → `in progress` → `shipped` (or `declined`, with the reason in Notes).
> A "Done means" line that has become true is prefixed with `✓ `; the page counts them.
> The live evolution page renders this file, so keep the format.

## R-001 · Give the app the evolution page's look
- **Asked:** 2026-10-23
- **Status:** in progress
- **Shipped on:** —
- **In your words:** "Keep similar aesthetics for the website btw, in terms of font/coloring." "Use similar aesthetics of this html file (font/colors/visualization) in the actual website's UI."
- **Done means:**
  - ✓ One font for the whole app, Hanken Grotesk (logo, titles, text, numbers with tabular digits), loaded with `next/font`. Serif titles/numbers and mono numbers were tried and rejected as inconsistent (2026-10-25).
  - ✓ Light and dark tokens from `packages/sim/report/style.css` (cool indigo-biased neutrals, one ai-iro indigo accent, semantic good/warn/bad) live in `apps/web/src/app/globals.css`
  - ✓ Hairline rules and quiet surfaces replace stacked shadows and cards; generous spacing
  - ✓ Charts keep the validated `viz.ts` palette; chips, pills and tooltips match the page's style
  - Every page screenshotted in light, dark and at phone width, and the personas' look scores don't drop
- **Notes:** Ship page by page (dashboard first). The evolution page itself is the reference. 2026-10-25 (`evolve/2026-10-25`): fonts and light/dark tokens are live app-wide, card shadows are gone, and pills and the nav use the indigo accent. The dashboard is fully restyled (hairline summary strip, serif section titles over rules, mono numerals) and was checked in light, dark and at phone width. Remaining: convert transactions, tax center, compare, chat, accounts, account, positions and auth pages the same way, then confirm look scores held. 2026-10-25 round 1: the position, transactions, accounts and account pages are converted (shared `page-section.tsx` blocks), checked in light, dark and at phone width. Remaining: tax center, compare, chat, auth. 2026-10-25 round 3: the tax center is converted (all five tabs, plain verdict first, empty sections hidden), checked in light, dark and at phone width. Remaining: compare, chat, auth. 2026-10-25 round 3 (second pass): compare is converted (verdict sentence first, one hairline strip instead of four cards, sections over rules, pill chips), checked in light, dark and at phone width. Remaining: chat, auth. 2026-10-25 round 5: chat (a transcript with hairline turns instead of bubbles, dated conversations, a "Past chats" menu on phones) and sign-in/sign-up (serif title, form on a hairline surface) are converted and checked in light, dark and at phone width. Every page is now in the new look. The last line waits on the personas' next look scores.

## R-002 · Keep expert metrics discoverable, not front-facing
- **Asked:** 2026-10-23
- **Status:** in progress
- **Shipped on:** —
- **In your words:** "Sharpe ratio is great but most users don't care about it so should be discoverable but not front facing." "We want to remove too much unnecessary info."
- **Done means:**
  - ✓ The dashboard's first screen shows value, gain or loss, the chart and holdings, and nothing a beginner has to decode
  - ✓ Sharpe, volatility, TWR, XIRR and the behavior gap sit one deliberate tap away ("Performance details"), with exact values on hover for experts
  - Luna, Augusta and Olenna stop raising jargon themes; Hermione can still reach every number
- **Notes:** 2026-10-25 (`evolve/2026-10-25`): the metrics grid is folded behind a closed "Performance details" pill under the chart, with plain labels (technical terms only in the hover card) and one sentence on why the three return numbers differ. Tiles say "Gain on holdings" / "Gain from sales" instead of "Unrealized/Realized P/L". The last line waits on the personas' next days. 2026-10-27 round 3 (`evolve/2026-10-27`): the jargon complaints moved to Compare (luna: "Yearly rate XIRR, TWR, Sharpe… feels like homework", and "−7.62% a year" next to "+1.28%" while down $5). Compare's head-to-head now follows the same rule: plain names only, with the term and explanation in a card that opens on hover or tap and compares your number with each benchmark. A new "Gain on your money" row matches the dollars above, and the yearly rate is hidden until there's a year of history. The dashboard's cards now open on a phone tap too. 2026-10-27 round 17: a holding's own page follows the same rule. Its figures say Gain on holdings, What you paid and Gain from sales instead of "Unrealized P/L", "Cost basis" and "Realized P/L", and tapping one shows the technical term with your own number. Tapping "ETF" (or Stock, Mutual fund, Crypto) next to the name says what that is. The tables say when you bought, units, price paid and whether you owned it over a year.

## R-003 · Proactive tax moves ("free money" alerts)
- **Asked:** 2026-10-23
- **Status:** in progress
- **Shipped on:** —
- **In your words:** "At any moment in time, I want recommendations if I can do any tax advantage moves: e.g., ETH is down and I have some realized tax gains? Tell me I can sell and buy my ETH to lock some capital losses to offset my gains for free. Or tens of other things you can think of."
- **Done means:**
  - ✓ Crypto is exempt from the wash-sale rule in the engine (configurable, with golden tests)
  - A quiet "Moves available now" card lists each opportunity with its dollar value: crypto loss locks against realized gains, lots about to turn long-term, unused $3,000 deduction, 0% long-term gain room, year-end deadline, wash-sale traps
  - ✓ Every number is deterministic and explainable; the assistant can point to the same list
- **Notes:** 2026-10-26 round 1 (`evolve/2026-10-26`): crypto is exempt from wash-sale detection by default (`exemptAssetClasses`, 4 golden tests), and the Tax Center's Now tab opens a "Moves available now" section listing crypto sell-and-buy-back locks with the coins, the loss booked and the tax saved (`lossLocks`, 3 hand-computed golden tests), plus a note that buying back defers the tax rather than erasing it. Round 3: the Now tab is now one ranked list from core `taxMoves` (3 golden tests). It holds crypto locks, other loss sales with their "don't buy back before" date, losses on hold under the wash-sale rule ("Don't sell BND before Nov 7"), and lots about to turn long-term, each with the tax it saves. Under the list: the total, the unused part of the $3,000 deduction, and the Dec 31 deadline with days left. The chat snapshot carries the same list. Remaining for the card line: 0% long-term gain room, which needs income and filing status (comes with R-005's sign-up bracket step).

## R-004 · "I have $n — where should it go?"
- **Asked:** 2026-10-23
- **Status:** in progress
- **Shipped on:** —
- **In your words:** "If I want to add $n to my portfolio ... pick the right stock to invest ... focus is on simplicity, I don't want to invest the $n into 10 things." "For now we can start from picking one from user-proposed candidates and over time self-evolve into a better solution."
- **Done means:**
  - ✓ Enter an amount and 1–5 candidates; the app picks one with one plain reason (fit with what you hold, dip versus its own range and your cost, which account it belongs in), and "Show me another" gives the runner-up
  - ✓ Deterministic scoring in `packages/core` with tests; the assistant uses the same tool
  - ✓ A short persistent note frames it as analysis of your own options
- **Notes:** 2026-10-26 round 7 (`evolve/2026-10-26`): the dashboard ends with "Where should my next buy go?". It starts from your three largest holdings and your last deposit, names one with its reason and account, and has "Show me another" and "How this was picked". Core `pickNextBuy` has 10 golden tests, and chat's `pick_next_buy` uses the same engine. Every line is built; it stays in progress until personas have tried it (mission feature `dashboard.next-buy`) and the chat tool has been probed live (that probe couldn't run this round). 2026-10-27 round 13: chat's tool was probed live and matches the dashboard (luna "$100, VOO or NVDA?" → NVDA in 5.5s; samwell "$1,500, VTI, VXUS or BND?" → BND in the Roth IRA). The first mission (luna) struggled: the runner-up's reason read as a reason against it, and the pick lagged the typed amount. Both are fixed: lower picks now say why they rank lower, and the pick dims with "Weighing $X…" while it updates. It stays in progress until a next-buy mission goes smoothly. 2026-10-27 evening round 13: the second mission (luna) struggled again. Adding VTI as an option timed out because the ticker list moved its row while results loaded, and right after she typed $100 the sentence still said "$150". The list now holds still and the sentence names the amount you typed. Escape does close "How this was picked" in a browser.

## R-005 · Tax setup during sign-up
- **Asked:** 2026-10-23
- **Status:** in progress
- **Shipped on:** —
- **In your words:** "Tax angle type of thing should also be set in the beginning in registry ... think about SEAMLESS app design that users with minimalist backgrounds love."
- **Done means:**
  - ✓ After sign-up, three calm, skippable steps: filing status and rough bracket (pre-fills the tax profile), accounts and their types, first holding (manual, CSV or skip)
  - ✓ Sensible defaults when skipped; everything editable later
  - Fresh-registration probes complete it without friction notes
- **Notes:** 2026-10-26 round 9 (`evolve/2026-10-26`): sign-up now opens `/welcome`. Step 1 is how you file plus a rough income band, which sets the tax profile's rates (2026 IRS brackets, core `bracketOptions`), and an optional state rate. Step 2 is tapping the kinds of account you have, each created with its type. Step 3 is typing in or importing a first holding, or skipping. Each step can be skipped (default 24%/15%, "Default" account on first save), and all of it is editable in Tax Profile and Accounts. The sim's registration probe now walks all three steps. Filing status itself isn't saved yet: storing it needs a new column and a `db:push`. R-003's 0% long-term room will need it. 2026-10-27 round 1 (`evolve/2026-10-27`): the first `welcome.setup` mission failed (hermione: Continue stuck on "Saving…", "Type in a holding" seemed dead, a flaky ticker picker). No step waits on a save now, the holding form opens right inside setup and lands on the dashboard, step 2 no longer offers kinds you already have, and the picker closes as soon as you pick. The re-run gets through the whole wizard; what's left is the add form's price-only entry (she wanted to type a $25,000 total), which stays open until a setup mission goes smoothly. 2026-10-27 round 5: the add form has "Enter total" for buys and sells. Type the $25,000 your statement shows and the price per unit is worked out exactly, so the cost basis is $25,000.00, not $24,999.48. It stays in progress until a fresh setup mission goes smoothly. 2026-10-27 evening round 13: the next setup mission (hermione) got through all three steps and typed the $25,000 total, but clicking VOO in the ticker list timed out (the same moving-row bug as next buy, now fixed). She also reported Save hanging on "Saving…" (not looked into this round) and a Tax Profile at 24%/15% when she expected 32%. 24% is right for $250k filed jointly, since that band runs to about $404k, so the Tax Profile could say which band set it. 2026-10-27 evening round 15: the add form no longer waits on "Saving…". It closes when you press Save and a message says when the trade is recorded (a failure reopens it as you left it). It also opened on tomorrow's date on a US evening, and its calendar ignored the keyboard; both are fixed. A `transactions.add` mission afterwards (barristan) recorded his sale with the right date and saw "VTI sell recorded". It stays in progress until a fresh setup mission goes smoothly.
