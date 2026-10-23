import { D, type EngineTransaction, type Numeric, type TransactionType } from "../src/types";

let nextId = 0;

export function txn(opts: {
  type: TransactionType;
  qty: Numeric;
  price?: Numeric | null;
  fees?: Numeric;
  at: string; // ISO date or datetime
  assetId?: string;
  id?: string;
}): EngineTransaction {
  return {
    id: opts.id ?? `t${nextId++}`,
    assetId: opts.assetId ?? "asset-1",
    type: opts.type,
    quantity: D(opts.qty),
    pricePerUnit:
      opts.price === null || opts.price === undefined ? null : D(opts.price),
    fees: D(opts.fees ?? 0),
    tradedAt: new Date(
      opts.at.includes("T") ? opts.at : `${opts.at}T00:00:00Z`,
    ),
  };
}
