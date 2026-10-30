import {
  D,
  Decimal,
  EngineError,
  ZERO,
  type EngineTransaction,
  type Lot,
  type RealizedGain,
} from "./types";

export interface LotEngineResult {
  /** Lots still open after replaying all transactions, FIFO order. */
  openLots: Lot[];
  /** One entry per sell-slice matched against a lot. */
  realized: RealizedGain[];
  /** Total dividend income received. */
  dividendIncome: Decimal;
  /** Standalone fees (type "fee") — not part of any lot's basis. */
  standaloneFees: Decimal;
}

/** True when `soldAt` is strictly more than one year after `acquiredAt`. */
export function isLongTerm(acquiredAt: Date, soldAt: Date): boolean {
  const oneYearLater = new Date(acquiredAt);
  oneYearLater.setUTCFullYear(oneYearLater.getUTCFullYear() + 1);
  return soldAt.getTime() > oneYearLater.getTime();
}

/**
 * Replay one asset's transactions (must be pre-sorted by tradedAt ascending)
 * into open lots + realized gains. FIFO matching on sells and transfers out.
 */
export function buildLots(txns: EngineTransaction[]): LotEngineResult {
  const openLots: Lot[] = [];
  const realized: RealizedGain[] = [];
  let dividendIncome = ZERO;
  let standaloneFees = ZERO;

  let prevTime = -Infinity;
  for (const txn of txns) {
    const t = txn.tradedAt.getTime();
    if (t < prevTime) {
      throw new EngineError(
        "UNSORTED_INPUT",
        `Transactions must be sorted by tradedAt (txn ${txn.id})`,
      );
    }
    prevTime = t;

    switch (txn.type) {
      case "buy": {
        requirePositive(txn);
        const price = requirePrice(txn);
        openLots.push({
          openedAt: txn.tradedAt,
          quantity: txn.quantity,
          costBasis: txn.quantity.mul(price).add(txn.fees),
          sourceTxnId: txn.id,
        });
        break;
      }

      case "sell": {
        requirePositive(txn);
        const price = requirePrice(txn);
        const grossProceeds = txn.quantity.mul(price);
        const netProceeds = grossProceeds.sub(txn.fees);
        const matched = consumeFifo(openLots, txn.quantity, txn);
        for (const slice of matched) {
          const share = slice.quantity.div(txn.quantity);
          const proceeds = netProceeds.mul(share);
          realized.push({
            assetId: txn.assetId,
            soldAt: txn.tradedAt,
            acquiredAt: slice.openedAt,
            quantity: slice.quantity,
            proceeds,
            costBasis: slice.costBasis,
            gain: proceeds.sub(slice.costBasis),
            longTerm: isLongTerm(slice.openedAt, txn.tradedAt),
            sourceTxnId: txn.id,
          });
        }
        break;
      }

      case "split": {
        // quantity = ratio (4 = 4-for-1, 0.25 = 1-for-4 reverse split)
        const ratio = txn.quantity;
        if (ratio.lte(0)) {
          throw new EngineError(
            "NEGATIVE_QUANTITY",
            `Split ratio must be positive (txn ${txn.id})`,
          );
        }
        for (const lot of openLots) {
          lot.quantity = lot.quantity.mul(ratio);
          // costBasis unchanged — basis per share divides by the ratio
        }
        break;
      }

      case "transfer_in": {
        requirePositive(txn);
        // Basis carries over if the user provided one; otherwise 0
        // (conservative — realizes the full proceeds as gain on sale).
        const price = txn.pricePerUnit ?? ZERO;
        openLots.push({
          openedAt: txn.tradedAt,
          quantity: txn.quantity,
          costBasis: txn.quantity.mul(price).add(txn.fees),
          sourceTxnId: txn.id,
        });
        break;
      }

      case "transfer_out": {
        requirePositive(txn);
        // Units leave with their basis; nothing is realized.
        consumeFifo(openLots, txn.quantity, txn);
        break;
      }

      case "dividend": {
        const price = txn.pricePerUnit ?? ZERO;
        dividendIncome = dividendIncome.add(txn.quantity.mul(price)).sub(txn.fees);
        break;
      }

      case "fee": {
        standaloneFees = standaloneFees.add(txn.fees);
        break;
      }
    }
  }

  return { openLots, realized, dividendIncome, standaloneFees };
}

/**
 * `buildLots` per account, merged: a sale only uses the purchases of the
 * account it happened in, the way a broker (and the Tax Center) matches it.
 * One FIFO queue across accounts let a taxable sale use an IRA's older,
 * cheaper shares, so the dashboard's gain from sales and cost differed from
 * the Tax Center and the exports (petyr, mission 63: −$1,482 vs −$1,522.90).
 * A transaction with no `accountId` (a provider split) applies to every
 * account. Open lots come back oldest first, realized slices by sale date
 * (stable, so one sale's slices stay together and in FIFO order).
 * Throws like `buildLots` when one account's history oversells.
 */
export function buildLotsByAccount(txns: EngineTransaction[]): LotEngineResult {
  const accounts: string[] = [];
  for (const t of txns) {
    if (t.accountId !== undefined && !accounts.includes(t.accountId)) accounts.push(t.accountId);
  }
  if (accounts.length <= 1) return buildLots(txns);

  const results = accounts.map((a) =>
    buildLots(txns.filter((t) => t.accountId === undefined || t.accountId === a)),
  );
  return {
    openLots: results
      .flatMap((r) => r.openLots)
      .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime()),
    realized: results
      .flatMap((r) => r.realized)
      .sort((a, b) => a.soldAt.getTime() - b.soldAt.getTime()),
    dividendIncome: results.reduce((s, r) => s.add(r.dividendIncome), ZERO),
    standaloneFees: results.reduce((s, r) => s.add(r.standaloneFees), ZERO),
  };
}

interface MatchedSlice {
  openedAt: Date;
  quantity: Decimal;
  costBasis: Decimal;
}

/**
 * Remove `quantity` units from the front of the lot queue (FIFO), mutating
 * `openLots`. Returns the matched slices with their proportional basis.
 * Throws OVERSELL if the lots can't cover the quantity.
 */
function consumeFifo(
  openLots: Lot[],
  quantity: Decimal,
  txn: EngineTransaction,
): MatchedSlice[] {
  const available = openLots.reduce((sum, l) => sum.add(l.quantity), ZERO);
  if (quantity.gt(available)) {
    throw new EngineError(
      "OVERSELL",
      `Transaction ${txn.id} removes ${quantity.toString()} units but only ${available.toString()} are held`,
    );
  }

  const slices: MatchedSlice[] = [];
  let remaining = quantity;
  while (remaining.gt(0)) {
    const lot = openLots[0];
    if (!lot) break; // unreachable given the oversell check
    if (lot.quantity.lte(remaining)) {
      slices.push({
        openedAt: lot.openedAt,
        quantity: lot.quantity,
        costBasis: lot.costBasis,
      });
      remaining = remaining.sub(lot.quantity);
      openLots.shift();
    } else {
      const basisShare = lot.costBasis.mul(remaining).div(lot.quantity);
      slices.push({
        openedAt: lot.openedAt,
        quantity: remaining,
        costBasis: basisShare,
      });
      lot.quantity = lot.quantity.sub(remaining);
      lot.costBasis = lot.costBasis.sub(basisShare);
      remaining = D(0);
    }
  }
  return slices;
}

function requirePositive(txn: EngineTransaction): void {
  if (txn.quantity.lte(0)) {
    throw new EngineError(
      "NEGATIVE_QUANTITY",
      `Transaction ${txn.id} has non-positive quantity`,
    );
  }
}

function requirePrice(txn: EngineTransaction): Decimal {
  if (txn.pricePerUnit === null) {
    throw new EngineError(
      "MISSING_PRICE",
      `Transaction ${txn.id} (${txn.type}) requires pricePerUnit`,
    );
  }
  return txn.pricePerUnit;
}
