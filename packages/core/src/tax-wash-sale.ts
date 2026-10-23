import type { Decimal } from "./types";

/** Trailing/leading window size for IRC §1091 (30 days each side of the sale). */
const WASH_SALE_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * A buy-side transaction that could trigger a wash sale, from ANY account
 * within the current tax-entity scope (taxable or tax-advantaged) — cross-
 * account detection is the whole point; brokers only see their own account.
 */
export interface RecentBuyTxn {
  assetId: string;
  accountId: string;
  accountName: string;
  /** Non-taxable account (IRA/401k/etc) — triggers the PERMANENT variant. */
  isTaxAdvantaged: boolean;
  tradedAt: Date;
  /** Heuristic: a same-asset/account dividend landed within ~5 days of this
   *  buy for a similar dollar amount. The schema has no distinct DRIP type,
   *  so this is a best-effort flag, not a certainty. */
  likelyDividendReinvestment: boolean;
}

/** Minimal shape a candidate loss lot must provide — kept structural (no
 *  import from tax-optimizer.ts) to avoid a circular dependency; TaxLot
 *  there satisfies this without any explicit relationship. */
export interface LossLotCandidate {
  lotId: string;
  assetId: string;
  symbol: string;
  /** Positive magnitude of the lot's unrealized loss. */
  lossUsd: Decimal;
}

export interface WashSaleBlock {
  lotId: string;
  assetId: string;
  symbol: string;
  disallowedLossUsd: Decimal;
  /** true = replacement bought in a tax-advantaged account: the loss is
   *  gone forever, no basis adjustment is possible anywhere (Rev. Rul.
   *  2008-5). false = merely deferred — the loss would move onto the
   *  replacement lot's basis if this plan were ever executed for real, but
   *  this module never writes that adjustment (it only plans). */
  permanentlyDisallowed: boolean;
  triggerAccountName: string;
  triggerDate: Date;
  likelyDividendReinvestment: boolean;
  reason: string;
}

/**
 * Block loss lots whose asset was also bought — in ANY account within
 * scope — within the trailing 30 days of `asOf` (the planning date). We
 * can't see the future, so the forward half of the 61-day window can't be
 * checked here; callers should show a standing "don't buy this for 30 days
 * after" caution alongside every loss sale instead.
 *
 * Simplification: when multiple qualifying buys exist, the CLOSEST one to
 * the sale date is cited, and the entire lot's loss is treated as blocked
 * (the IRS actually prorates by replacement share count — modeling that
 * needs per-buy share accounting this planning tool doesn't attempt; this
 * errs conservative, which is the safe direction for a "how much can I
 * actually deduct" estimate). Gain lots are never checked — wash sale only
 * disallows losses.
 */
export function detectWashSaleBlocks(
  lossLots: LossLotCandidate[],
  recentBuys: RecentBuyTxn[],
  asOf: Date,
): WashSaleBlock[] {
  const blocks: WashSaleBlock[] = [];
  const windowStart = asOf.getTime() - WASH_SALE_WINDOW_DAYS * DAY_MS;

  for (const lot of lossLots) {
    const qualifying = recentBuys
      .filter(
        (b) =>
          b.assetId === lot.assetId &&
          b.tradedAt.getTime() >= windowStart &&
          b.tradedAt.getTime() <= asOf.getTime(),
      )
      .sort((a, b) => b.tradedAt.getTime() - a.tradedAt.getTime()); // closest first
    const trigger = qualifying[0];
    if (!trigger) continue;

    const daysAgo = Math.round((asOf.getTime() - trigger.tradedAt.getTime()) / DAY_MS);
    const dateStr = trigger.tradedAt.toISOString().slice(0, 10);
    let reason =
      `You bought ${lot.symbol} in ${trigger.accountName} on ${dateStr} ` +
      `(${daysAgo} day${daysAgo === 1 ? "" : "s"} before this sale) — inside the ` +
      `30-day wash-sale window, so this loss is disallowed.`;
    if (trigger.isTaxAdvantaged) {
      reason +=
        ` Because that purchase was in a tax-advantaged account, the loss is ` +
        `PERMANENTLY disallowed — there's no basis adjustment possible anywhere ` +
        `to recover it (Rev. Rul. 2008-5).`;
    }
    if (trigger.likelyDividendReinvestment) {
      reason += ` That purchase looks like it may have been a dividend reinvestment — an easy one to miss.`;
    }

    blocks.push({
      lotId: lot.lotId,
      assetId: lot.assetId,
      symbol: lot.symbol,
      disallowedLossUsd: lot.lossUsd,
      permanentlyDisallowed: trigger.isTaxAdvantaged,
      triggerAccountName: trigger.accountName,
      triggerDate: trigger.tradedAt,
      likelyDividendReinvestment: trigger.likelyDividendReinvestment,
      reason,
    });
  }

  return blocks;
}
