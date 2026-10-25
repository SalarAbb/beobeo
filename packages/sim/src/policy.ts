import type { Holdings } from "./holdings";
import type { Persona, Rule } from "./persona";
import { daysBetween, type IsoDate, type PriceBook } from "./world";

export interface TradeIntent {
  type: "buy" | "sell";
  account: string;
  symbol: string;
  qty: number;
  price: number;
  /** Which habit produced it — "dca", "harvest", "mind", … */
  reason: string;
}

/**
 * Per-rule memory so cadences fire once per period and cooldowns hold.
 * Plain JSON so the day runner can persist it in the journal between runs.
 */
export interface PolicyState {
  /** ruleIndex → last period key fired (cadence rules). */
  periods: Record<string, string>;
  /** `${ruleIndex}:${symbol}` → last ISO date fired (cooldown rules). */
  fired: Record<string, IsoDate>;
}

export const emptyPolicyState = (): PolicyState => ({ periods: {}, fired: {} });

type Cadence = "week" | "biweek" | "month" | "quarter";

function isoWeek(date: IsoDate): { year: number; week: number } {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { year: d.getUTCFullYear(), week: Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

/**
 * The period a date belongs to, and whether the rule's trigger day has been
 * reached within it. "Reached" (>=) rather than "equals" so a weekend or
 * holiday trigger fires on the next trading day instead of being skipped.
 */
export function cadencePeriod(date: IsoDate, every: Cadence, day: number): { key: string; due: boolean } {
  const d = new Date(`${date}T00:00:00Z`);
  const dom = d.getUTCDate();
  const month = d.getUTCMonth();
  switch (every) {
    case "week":
    case "biweek": {
      const { year, week } = isoWeek(date);
      const weekday = d.getUTCDay() || 7;
      const key = every === "week" ? `${year}-W${week}` : `${year}-B${Math.floor(week / 2)}`;
      // Biweek: only the even week of each pair is eligible.
      const eligible = every === "week" || week % 2 === 0;
      return { key, due: eligible && weekday >= day };
    }
    case "month":
      return { key: `${d.getUTCFullYear()}-${month + 1}`, due: dom >= day };
    case "quarter":
      return {
        key: `${d.getUTCFullYear()}-Q${Math.floor(month / 3) + 1}`,
        // Only the first month of the quarter.
        due: month % 3 === 0 && dom >= day,
      };
  }
}

function buy(rule: Rule & { account: string }, symbol: string, usd: number, price: number, reason: string): TradeIntent {
  return { type: "buy", account: rule.account, symbol, qty: usd / price, price, reason };
}

/**
 * The persona's mechanical habits for one day. Pure: same inputs, same
 * trades. Mutates `state` to record what fired (callers persist it).
 */
export function runPolicy(
  persona: Persona,
  holdings: Holdings,
  market: PriceBook,
  date: IsoDate,
  state: PolicyState,
): TradeIntent[] {
  const out: TradeIntent[] = [];

  persona.policy.forEach((rule, i) => {
    const idx = String(i);
    const cooled = (symbol: string, cooldown: number) => {
      const last = state.fired[`${idx}:${symbol}`];
      return !last || daysBetween(last, date) >= cooldown;
    };
    const mark = (symbol: string) => (state.fired[`${idx}:${symbol}`] = date);

    switch (rule.kind) {
      case "dca": {
        if (!market.tradesOn(rule.symbol, date)) return;
        const { key, due } = cadencePeriod(date, rule.every, rule.day);
        if (!due || state.periods[idx] === key) return;
        state.periods[idx] = key;
        const price = market.closeAsOf(rule.symbol, date)!.close;
        out.push(buy(rule, rule.symbol, rule.amountUsd, price, "dca"));
        return;
      }
      case "dip_buy": {
        for (const symbol of rule.symbols) {
          if (!market.tradesOn(symbol, date) || !cooled(symbol, rule.cooldownDays)) continue;
          const chg = market.changePct(symbol, date, rule.lookbackDays);
          if (chg === null || chg > -rule.dropPct) continue;
          mark(symbol);
          out.push(buy(rule, symbol, rule.amountUsd, market.closeAsOf(symbol, date)!.close, "dip_buy"));
        }
        return;
      }
      case "momentum": {
        const { key, due } = cadencePeriod(date, rule.every, rule.day);
        if (!due || state.periods[idx] === key) return;
        let best: { symbol: string; chg: number } | null = null;
        for (const symbol of rule.symbols) {
          if (!market.tradesOn(symbol, date)) continue;
          const chg = market.changePct(symbol, date, rule.lookbackDays);
          if (chg !== null && (!best || chg > best.chg)) best = { symbol, chg };
        }
        if (!best) return; // nothing traded today; retry tomorrow
        state.periods[idx] = key;
        out.push(buy(rule, best.symbol, rule.amountUsd, market.closeAsOf(best.symbol, date)!.close, "momentum"));
        return;
      }
      case "take_profit": {
        for (const symbol of rule.symbols) {
          const pos = holdings.get(rule.account, symbol);
          if (!pos || pos.qty <= 0 || !market.tradesOn(symbol, date) || !cooled(symbol, rule.cooldownDays)) continue;
          const price = market.closeAsOf(symbol, date)!.close;
          const gainPct = (pos.qty * price / pos.cost - 1) * 100;
          if (gainPct < rule.gainPct) continue;
          mark(symbol);
          out.push({ type: "sell", account: rule.account, symbol, qty: pos.qty * rule.sellFraction, price, reason: "take_profit" });
        }
        return;
      }
      case "harvest": {
        for (const symbol of rule.symbols) {
          const pos = holdings.get(rule.account, symbol);
          if (!pos || pos.qty <= 0 || !market.tradesOn(symbol, date) || !cooled(symbol, rule.cooldownDays)) continue;
          const price = market.closeAsOf(symbol, date)!.close;
          const value = pos.qty * price;
          if ((1 - value / pos.cost) * 100 < rule.lossPct) continue;
          mark(symbol);
          out.push({ type: "sell", account: rule.account, symbol, qty: pos.qty, price, reason: "harvest" });
          const sub = rule.substitutes[symbol];
          const subPrice = sub ? market.closeAsOf(sub, date) : null;
          if (sub && subPrice && market.tradesOn(sub, date)) {
            out.push(buy(rule, sub, value, subPrice.close, "harvest_rebuy"));
          }
        }
        return;
      }
      case "rebalance": {
        const symbols = Object.keys(rule.targets);
        if (!symbols.every((s) => market.tradesOn(s, date))) return;
        const { key, due } = cadencePeriod(date, rule.every, rule.day);
        if (!due || state.periods[idx] === key) return;
        state.periods[idx] = key;
        out.push(...rebalanceBuys(rule, holdings, market, date));
        return;
      }
    }
  });

  return out;
}

/**
 * Split a contribution to pull weights toward targets: fund each sleeve's
 * shortfall (vs. target × post-contribution total) pro rata; if nothing is
 * short, split by target weight. Contribution-only — never sells.
 */
export function rebalanceBuys(
  rule: Extract<Rule, { kind: "rebalance" }>,
  holdings: Holdings,
  market: PriceBook,
  date: IsoDate,
): TradeIntent[] {
  const symbols = Object.keys(rule.targets);
  const wSum = symbols.reduce((s, x) => s + rule.targets[x]!, 0);
  const price = (s: string) => market.closeAsOf(s, date)!.close;
  const current = new Map(symbols.map((s) => [s, (holdings.get(rule.account, s)?.qty ?? 0) * price(s)]));
  const total = [...current.values()].reduce((a, b) => a + b, 0) + rule.amountUsd;
  const short = new Map(
    symbols.map((s) => [s, Math.max(0, (rule.targets[s]! / wSum) * total - current.get(s)!)]),
  );
  const shortSum = [...short.values()].reduce((a, b) => a + b, 0);
  return symbols
    .map((s) => {
      const share = shortSum > 0 ? short.get(s)! / shortSum : rule.targets[s]! / wSum;
      return buy(rule, s, rule.amountUsd * share, price(s), "rebalance");
    })
    .filter((t) => t.qty * t.price >= 1);
}
