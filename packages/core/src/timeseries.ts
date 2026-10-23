import {
  DAY_MS,
  ZERO,
  toIsoDate,
  type Decimal,
  type EngineTransaction,
  type IsoDate,
} from "./types";

/** Daily close prices for one asset, keyed by ISO date. */
export type PriceSeries = Map<IsoDate, Decimal>;

export interface DailyPoint {
  date: IsoDate;
  /** Mark-to-market portfolio value. */
  value: Decimal;
  /** Cumulative net cash contributed (buys + fees − sell proceeds). */
  invested: Decimal;
}

/**
 * Daily portfolio value from first transaction (or `from`) to `to`, inclusive.
 * Prices are forward-filled across non-trading days; an asset with no price
 * seen yet contributes 0 until its first close appears.
 */
export function portfolioTimeSeries(opts: {
  /** All transactions across assets, sorted by tradedAt ascending. */
  txns: EngineTransaction[];
  /** assetId → (date → close) */
  prices: Map<string, PriceSeries>;
  from?: IsoDate;
  to: IsoDate;
}): DailyPoint[] {
  const { txns, prices, to } = opts;
  if (txns.length === 0) return [];

  const first = opts.from ?? toIsoDate(txns[0]!.tradedAt);
  const holdings = new Map<string, Decimal>();
  const lastPrice = new Map<string, Decimal>();
  let invested = ZERO;
  let txnIdx = 0;

  // Seed forward-fill with each asset's newest close BEFORE the window —
  // otherwise a position opened today (no close yet) values at 0 even though
  // yesterday's close is known.
  for (const [assetId, priceSeries] of prices) {
    let newest: IsoDate | null = null;
    for (const date of priceSeries.keys()) {
      if (date < first && (newest === null || date > newest)) newest = date;
    }
    if (newest !== null) lastPrice.set(assetId, priceSeries.get(newest)!);
  }

  const series: DailyPoint[] = [];
  const startMs = Date.parse(`${first}T00:00:00Z`);
  const endMs = Date.parse(`${to}T00:00:00Z`);

  for (let dayMs = startMs; dayMs <= endMs; dayMs += DAY_MS) {
    const day = toIsoDate(new Date(dayMs));

    // Apply every transaction dated on or before this day.
    while (txnIdx < txns.length) {
      const txn = txns[txnIdx]!;
      if (toIsoDate(txn.tradedAt) > day) break;
      applyTxn(txn, holdings);
      invested = invested.add(investedDelta(txn));
      txnIdx++;
    }

    // Forward-fill prices.
    for (const [assetId, priceSeries] of prices) {
      const close = priceSeries.get(day);
      if (close !== undefined) lastPrice.set(assetId, close);
    }

    let value = ZERO;
    for (const [assetId, qty] of holdings) {
      const price = lastPrice.get(assetId);
      if (price !== undefined && qty.gt(0)) {
        value = value.add(qty.mul(price));
      }
    }

    series.push({ date: day, value, invested });
  }

  return series;
}

function applyTxn(
  txn: EngineTransaction,
  holdings: Map<string, Decimal>,
): void {
  const current = holdings.get(txn.assetId) ?? ZERO;
  switch (txn.type) {
    case "buy":
    case "transfer_in":
      holdings.set(txn.assetId, current.add(txn.quantity));
      break;
    case "sell":
    case "transfer_out":
      holdings.set(txn.assetId, current.sub(txn.quantity));
      break;
    case "split":
      holdings.set(txn.assetId, current.mul(txn.quantity));
      break;
    case "dividend":
    case "fee":
      break;
  }
}

function investedDelta(txn: EngineTransaction): Decimal {
  const price = txn.pricePerUnit ?? ZERO;
  switch (txn.type) {
    case "buy":
    case "transfer_in":
      return txn.quantity.mul(price).add(txn.fees);
    case "sell":
    case "transfer_out":
      return txn.quantity.mul(price).sub(txn.fees).neg();
    case "fee":
      return txn.fees;
    case "split":
    case "dividend":
      return ZERO;
  }
}
