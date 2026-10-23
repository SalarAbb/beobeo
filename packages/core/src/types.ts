import Decimal from "decimal.js";

// High precision for chained crypto-quantity math.
Decimal.set({ precision: 40 });

export { Decimal };

export type Numeric = Decimal | string | number;

/** Normalize any numeric input to a Decimal. */
export const D = (v: Numeric): Decimal => new Decimal(v);

export const ZERO = new Decimal(0);

export type TransactionType =
  | "buy"
  | "sell"
  | "dividend"
  | "split"
  | "transfer_in"
  | "transfer_out"
  | "fee";

/**
 * The engine's view of a transaction — decoupled from the DB row.
 *
 * Conventions:
 * - buy/sell/transfer_*: `quantity` = units of the asset, `pricePerUnit` = unit price.
 * - split: `quantity` = ratio (4 means 4-for-1), `pricePerUnit` unused.
 * - dividend: cash amount = quantity × pricePerUnit (importers typically set quantity=1,
 *   pricePerUnit=total).
 * - fee: standalone account fee in `fees`; no lot effect.
 */
export interface EngineTransaction {
  id: string;
  assetId: string;
  type: TransactionType;
  quantity: Decimal;
  pricePerUnit: Decimal | null;
  fees: Decimal;
  tradedAt: Date;
}

/** An open tax lot. */
export interface Lot {
  /** Acquisition date — survives splits (holding period is preserved). */
  openedAt: Date;
  /** Remaining units in this lot. */
  quantity: Decimal;
  /** Total cost basis for the remaining units (fees included). */
  costBasis: Decimal;
  /** The buy/transfer_in transaction that opened the lot. */
  sourceTxnId: string;
}

/** One matched sell slice against one lot. */
export interface RealizedGain {
  assetId: string;
  soldAt: Date;
  acquiredAt: Date;
  quantity: Decimal;
  /** Sale proceeds for this slice, net of the fee share. */
  proceeds: Decimal;
  /** Cost basis consumed from the matched lot. */
  costBasis: Decimal;
  /** proceeds − costBasis */
  gain: Decimal;
  /** Held strictly more than one year (US long-term rule). */
  longTerm: boolean;
  /** The sell transaction. */
  sourceTxnId: string;
}

export class EngineError extends Error {
  constructor(
    public readonly code:
      | "OVERSELL"
      | "NEGATIVE_QUANTITY"
      | "MISSING_PRICE"
      | "UNSORTED_INPUT",
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/** ISO calendar date, e.g. "2026-07-10". All series use UTC dates. */
export type IsoDate = string;

export const toIsoDate = (d: Date): IsoDate => d.toISOString().slice(0, 10);

export const DAY_MS = 86_400_000;
