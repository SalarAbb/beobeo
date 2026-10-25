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
  - ✓ Shippori Mincho for headings and hero numbers (sparingly), Hanken Grotesk for body text, JetBrains Mono for data and numerals, loaded with `next/font`, applied by one rule on every page (`.figure` / `.data`, see CLAUDE.md "Type system"), never mixed ad hoc
  - ✓ Light and dark tokens from `packages/sim/report/style.css` (cool indigo-biased neutrals, one ai-iro indigo accent, semantic good/warn/bad) live in `apps/web/src/app/globals.css`
  - Hairline rules and quiet surfaces replace stacked shadows and cards; generous spacing
  - Charts keep the validated `viz.ts` palette; chips, pills and tooltips match the page's style
  - Every page screenshotted in light, dark and at phone width, and the personas' look scores don't drop
- **Notes:** Ship page by page (dashboard first). The evolution page itself is the reference. 2026-10-25 (`evolve/2026-10-25`): fonts and light/dark tokens are live app-wide, card shadows are gone, and pills and the nav use the indigo accent. The dashboard is fully restyled (hairline summary strip, serif section titles over rules, mono numerals) and was checked in light, dark and at phone width. Remaining: convert transactions, tax center, compare, chat, accounts, account, positions and auth pages the same way, then confirm look scores held. 2026-10-25 round 1: the position, transactions, accounts and account pages are converted (shared `page-section.tsx` blocks), checked in light, dark and at phone width. Remaining: tax center, compare, chat, auth. 2026-10-25 round 3: the tax center is converted (all five tabs, plain verdict first, empty sections hidden), checked in light, dark and at phone width. Remaining: compare, chat, auth.

## R-002 · Keep expert metrics discoverable, not front-facing
- **Asked:** 2026-10-23
- **Status:** open
- **Shipped on:** —
- **In your words:** "Sharpe ratio is great but most users don't care about it so should be discoverable but not front facing." "We want to remove too much unnecessary info."
- **Done means:**
  - The dashboard's first screen shows value, gain or loss, the chart and holdings, and nothing a beginner has to decode
  - Sharpe, volatility, TWR, XIRR and the behavior gap sit one deliberate tap away ("Performance details"), with exact values on hover for experts
  - Luna, Augusta and Olenna stop raising jargon themes; Hermione can still reach every number

## R-003 · Proactive tax moves ("free money" alerts)
- **Asked:** 2026-10-23
- **Status:** open
- **Shipped on:** —
- **In your words:** "At any moment in time, I want recommendations if I can do any tax advantage moves: e.g., ETH is down and I have some realized tax gains? Tell me I can sell and buy my ETH to lock some capital losses to offset my gains for free. Or tens of other things you can think of."
- **Done means:**
  - Crypto is exempt from the wash-sale rule in the engine (configurable, with golden tests)
  - A quiet "Moves available now" card lists each opportunity with its dollar value: crypto loss locks against realized gains, lots about to turn long-term, unused $3,000 deduction, 0% long-term gain room, year-end deadline, wash-sale traps
  - Every number is deterministic and explainable; the assistant can point to the same list

## R-004 · "I have $n — where should it go?"
- **Asked:** 2026-10-23
- **Status:** open
- **Shipped on:** —
- **In your words:** "If I want to add $n to my portfolio ... pick the right stock to invest ... focus is on simplicity, I don't want to invest the $n into 10 things." "For now we can start from picking one from user-proposed candidates and over time self-evolve into a better solution."
- **Done means:**
  - Enter an amount and 1–5 candidates; the app picks one with one plain reason (fit with what you hold, dip versus its own range and your cost, which account it belongs in), and "Show me another" gives the runner-up
  - Deterministic scoring in `packages/core` with tests; the assistant uses the same tool
  - A short persistent note frames it as analysis of your own options

## R-005 · Tax setup during sign-up
- **Asked:** 2026-10-23
- **Status:** open
- **Shipped on:** —
- **In your words:** "Tax angle type of thing should also be set in the beginning in registry ... think about SEAMLESS app design that users with minimalist backgrounds love."
- **Done means:**
  - After sign-up, three calm, skippable steps: filing status and rough bracket (pre-fills the tax profile), accounts and their types, first holding (manual, CSV or skip)
  - Sensible defaults when skipped; everything editable later
  - Fresh-registration probes complete it without friction notes
