import type { Persona } from "./persona";
import { pickWeighted } from "./explore-rules";

/**
 * Everything a person can actually DO in Beobeo, as flows rather than pages. Missions are drawn
 * from this list, weighted toward what hasn't been tried lately, so within about a week every flow
 * gets a real, goal-directed attempt. Keep it complete: a flow missing here is a blind spot.
 * When the app gains a flow, add it (the /evolve rules say so).
 */
export interface Feature {
  id: string;
  /** Where a person would start. */
  route: string;
  /** What it lets you do, in plain words: the planner turns this into a persona's goal. */
  does: string;
  /** Who'd naturally reach for it (matched against the persona; empty = anyone). */
  fits?: ("beginner" | "expert" | "tax" | "crypto" | "income" | "dca" | "seller" | "multi-account")[];
}

export const FEATURES: Feature[] = [
  { id: "dashboard.glance", route: "/dashboard", does: "See what your portfolio is worth and whether you're up or down, at a glance" },
  { id: "dashboard.window", route: "/dashboard", does: "Change the time window (1D, 1W, 1M, YTD, 1Y, All) to see how you did over a specific period" },
  { id: "dashboard.chart", route: "/dashboard", does: "Read the value-over-time chart: change its range, hover to see a past day's value versus what you'd put in" },
  { id: "dashboard.performance", route: "/dashboard", does: "Open the performance details and understand annual return, total return, risk and timing: which dates they cover, and how they fit together; tap a label to see what it means", fits: ["expert"] },
  { id: "dashboard.holdings", route: "/dashboard", does: "Sort your holdings (by value, or gain in dollars or in percent) and open one to see its details" },
  { id: "dashboard.allocation", route: "/dashboard", does: "See how your money is split across holdings and compare it with the mix you want", fits: ["dca"] },
  { id: "dashboard.target-mix", route: "/dashboard", does: "Set or change your target mix (the percentages you want in each holding)", fits: ["dca", "expert"] },
  { id: "dashboard.next-deposit", route: "/dashboard", does: "Find out where your next deposit should go, for an amount you choose", fits: ["dca", "beginner"] },
  { id: "dashboard.next-buy", route: "/dashboard", does: "You have an amount to invest and a few things in mind: name them under \"Where should my next buy go?\", get one pick with its reason and account, ask for another, and check how it was picked", fits: ["beginner", "dca"] },
  { id: "position.detail", route: "/dashboard", does: "Open one holding and check its price history, your buys and sells, your cost, each held purchase's gain and when it turns long-term, gains from past sales, and what selling all of it would cost in tax; tap a figure's label or the asset's kind (ETF, Stock…) to see what it means", fits: ["beginner"] },
  { id: "transactions.browse", route: "/transactions", does: "Find a specific past trade in your transaction history (narrow the list to one asset with Show) and open it to see its amount and, for a sale, the purchases it used and the gain" },
  { id: "transactions.add", route: "/transactions", does: "Record a trade you just made at your broker (search the asset, amount, price or the total it came to, date by mouse or keyboard, account), save it, and check it landed (the form closes at once and a message says when it's recorded)" },
  { id: "transactions.dividend", route: "/dashboard", does: "Record a dividend payout you just received (start from the dashboard's Dividends tile), then check the dashboard's dividend total and the Transactions list show it", fits: ["income"] },
  { id: "transactions.fix", route: "/transactions", does: "Fix a trade you entered wrongly (wrong quantity, price or date), or remove a duplicate (show one asset's trades, open the trade, delete, confirm; a same-day sell and buy-back pair is tagged swap, not a duplicate) and undo if you slip" },
  { id: "transactions.export", route: "/transactions", does: "Get your data out to check it against your broker or give it to your accountant: download your transactions, your realized gains by sale (proceeds, cost basis, gain, short or long term) or the purchases you still hold as a CSV (Transactions → Export), and check the file's numbers against what the app shows", fits: ["expert", "tax"] },
  { id: "transactions.import", route: "/transactions", does: "Import trades from your broker's CSV export (a file is provided to you)", fits: ["expert", "multi-account"] },
  { id: "tax.now", route: "/tax-center", does: "See what your sales this year mean for taxes (check the year's gains against each sale behind them and against the dashboard's all-time gain from sales), and the ranked list of moves available right now (sell crypto at a loss and buy it straight back, sell a losing fund, wait for a lot to turn long-term, losses on hold under the wash-sale rule, and gains you could take at 0% once your income is in Tax Profile), with the dollars each saves; then roughly what you'd owe if you sold everything today (only taxable accounts count)", fits: ["tax", "crypto"] },
  { id: "tax.raise-cash", route: "/tax-center", does: "You need a specific amount of cash: find which shares to sell to pay the least tax (down to the exact purchases to give your broker, and only from one account if you have several), change the amount, cross-check it against All Lots and come back (your amount and plan should still be there), and check the plan makes sense", fits: ["tax", "seller"] },
  { id: "tax.harvest", route: "/tax-center", does: "Find losses you could take to lower your tax bill, and understand what the savings depend on", fits: ["tax", "crypto"] },
  { id: "tax.lots", route: "/tax-center", does: "Browse every tax lot: when you bought it, what you paid per unit and in all, gain in $ and %, when it turns long-term; filter to one asset, or to only losses (or gains) bigger than a dollar amount, and check the totals", fits: ["tax", "expert"] },
  { id: "tax.profile", route: "/tax-center", does: "Tell the app your tax rates, your rough pay (Your income, which works out the taxable part, or taxable income if you itemize), gains you made outside the app and any loss carried forward, save them, then see the numbers on the Now tab change (its \"If you sold everything today\" tax moves with a carryforward or outside gains)", fits: ["tax"] },
  { id: "compare.benchmark", route: "/compare", does: "See whether the same deposits into an index fund would have done better than your picks, and understand what the head-to-head measures say about you" },
  { id: "compare.custom", route: "/compare", does: "Compare yourself against an asset of your choosing that isn't offered by default", fits: ["expert", "crypto"] },
  { id: "compare.scope", route: "/compare", does: "Compare only part of your portfolio (a few holdings) against a benchmark", fits: ["expert"] },
  { id: "chat.ask", route: "/chat", does: "Ask the assistant a real question about your own money and judge whether the answer is right and useful" },
  { id: "chat.followup", route: "/chat", does: "Have a short back-and-forth with the assistant, leave Chat and come back (the conversation should still be open), then reopen an earlier conversation from the list" },
  { id: "accounts.types", route: "/accounts", does: "Make sure each of your accounts is marked correctly (taxable, IRA, Roth, 401k) and see why it matters", fits: ["multi-account", "tax"] },
  { id: "portfolios.manage", route: "/dashboard", does: "Switch between portfolios, or create a separate portfolio (e.g. for a child or a side account) and view it alone", fits: ["multi-account", "expert"] },
  { id: "welcome.setup", route: "/welcome", does: "Go through the first-run setup as if you had just signed up: how you file and your rough pay (or taxable-income band), which kinds of accounts you have and what you call them, then add a first holding; afterwards check the Tax Center's Tax Profile shows your bracket and says why", fits: ["beginner", "tax"] },
  { id: "account.profile", route: "/account", does: "Check which account you're signed into, how you sign in, and how much is stored" },
  { id: "app.mobile", route: "/dashboard", does: "Do your usual check-in on your phone (small screen)", fits: ["beginner"] },
];

export const FEATURE_IDS = new Set(FEATURES.map((f) => f.id));

/** Which `fits` tags describe this persona (derived from their profile, not hand-kept). */
export function personaTags(p: Persona): Set<NonNullable<Feature["fits"]>[number]> {
  const tags = new Set<NonNullable<Feature["fits"]>[number]>();
  // A beginner is new to apps OR new to investing (Luna is tech-comfortable but just opened her first account).
  if (p.techSavviness <= 2 || /\b(first (brokerage|account|job)|new to investing|beginner|doesn't know what|unsure whether)\b/i.test(`${p.life} ${p.strategy}`)) tags.add("beginner");
  if (p.techSavviness >= 4 && !tags.has("beginner")) tags.add("expert"); // an expert investor, not just tech-comfortable
  const kinds = new Set(p.policy.map((r) => r.kind));
  if (kinds.has("harvest") || p.tax.ordinaryRate >= 32) tags.add("tax");
  if (kinds.has("dca") || kinds.has("rebalance")) tags.add("dca");
  if (kinds.has("withdraw") || kinds.has("take_profit")) tags.add("seller");
  if (p.universe.some((u) => u.class === "crypto")) tags.add("crypto");
  if (/dividend|income/i.test(`${p.strategy} ${p.goals.join(" ")}`)) tags.add("income");
  if (p.accounts.length > 1) tags.add("multi-account");
  return tags;
}

/**
 * Choose today's mission feature for a persona. Weight = staleness × fit:
 * - staleness: days since anyone last attempted it (never = 14), so blind spots get covered first;
 * - fit: ×3 when the feature matches the persona, ×1 for general features, ×0.5 otherwise —
 *   off-profile attempts still happen (grandma trying the CSV import is a test too).
 * `lastTried` maps feature id → days since last attempt. Seeded rng: replayable.
 */
export function pickFeature(p: Persona, lastTried: Map<string, number>, rng: () => number, exclude: Set<string> = new Set()): Feature {
  const tags = personaTags(p);
  const items = FEATURES.filter((f) => !exclude.has(f.id)).map((f) => {
    const staleness = Math.min(14, lastTried.get(f.id) ?? 14) + 1;
    const fit = !f.fits?.length ? 1 : f.fits.some((t) => tags.has(t)) ? 3 : 0.5;
    return { item: f, weight: staleness * fit };
  });
  return pickWeighted(rng, items) ?? FEATURES[0]!;
}
