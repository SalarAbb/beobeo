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
  { id: "dashboard.performance", route: "/dashboard", does: "Open the performance details and understand annual return, total return, risk and timing", fits: ["expert"] },
  { id: "dashboard.holdings", route: "/dashboard", does: "Sort your holdings and open one to see its details" },
  { id: "dashboard.allocation", route: "/dashboard", does: "See how your money is split across holdings and compare it with the mix you want", fits: ["dca"] },
  { id: "dashboard.target-mix", route: "/dashboard", does: "Set or change your target mix (the percentages you want in each holding)", fits: ["dca", "expert"] },
  { id: "dashboard.next-deposit", route: "/dashboard", does: "Find out where your next deposit should go, for an amount you choose", fits: ["dca", "beginner"] },
  { id: "position.detail", route: "/dashboard", does: "Open one holding and check its price history, your buys and sells, your cost, and gains from past sales" },
  { id: "transactions.browse", route: "/transactions", does: "Find a specific past trade in your transaction history" },
  { id: "transactions.add", route: "/transactions", does: "Record a trade you just made at your broker (search the asset, amount, price, date, account)" },
  { id: "transactions.fix", route: "/transactions", does: "Fix a trade you entered wrongly (wrong quantity, price or date), or remove a duplicate and undo if you slip" },
  { id: "transactions.import", route: "/transactions", does: "Import trades from your broker's CSV export (a file is provided to you)", fits: ["expert", "multi-account"] },
  { id: "tax.now", route: "/tax-center", does: "See what your sales this year mean for taxes, and any moves available right now (e.g. selling crypto at a loss and buying it straight back)", fits: ["tax", "crypto"] },
  { id: "tax.raise-cash", route: "/tax-center", does: "You need a specific amount of cash: find which shares to sell to pay the least tax, and check the plan makes sense", fits: ["tax", "seller"] },
  { id: "tax.harvest", route: "/tax-center", does: "Find losses you could take to lower your tax bill, and understand what the savings depend on", fits: ["tax", "crypto"] },
  { id: "tax.lots", route: "/tax-center", does: "Browse every tax lot: when you bought it, what you paid, short or long term", fits: ["tax", "expert"] },
  { id: "tax.profile", route: "/tax-center", does: "Tell the app your tax rates, gains you made outside the app and any loss carried forward, then see the numbers change", fits: ["tax"] },
  { id: "compare.benchmark", route: "/compare", does: "See whether the same deposits into an index fund would have done better than your picks" },
  { id: "compare.custom", route: "/compare", does: "Compare yourself against an asset of your choosing that isn't offered by default", fits: ["expert", "crypto"] },
  { id: "compare.scope", route: "/compare", does: "Compare only part of your portfolio (a few holdings) against a benchmark", fits: ["expert"] },
  { id: "chat.ask", route: "/chat", does: "Ask the assistant a real question about your own money and judge whether the answer is right and useful" },
  { id: "chat.followup", route: "/chat", does: "Have a short back-and-forth with the assistant, then come back to an earlier conversation" },
  { id: "accounts.types", route: "/accounts", does: "Make sure each of your accounts is marked correctly (taxable, IRA, Roth, 401k) and see why it matters", fits: ["multi-account", "tax"] },
  { id: "portfolios.manage", route: "/dashboard", does: "Switch between portfolios, or create a separate portfolio (e.g. for a child or a side account) and view it alone", fits: ["multi-account", "expert"] },
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
