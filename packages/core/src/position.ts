import { ZERO, type Decimal, type Lot } from "./types";

export interface PositionSnapshot {
  quantity: Decimal;
  costBasis: Decimal;
  avgCostPerUnit: Decimal | null;
  marketValue: Decimal | null;
  unrealizedGain: Decimal | null;
  unrealizedGainPct: Decimal | null;
}

/** Aggregate open lots into a position snapshot, optionally marked to market. */
export function positionFromLots(
  lots: Lot[],
  currentPrice?: Decimal,
): PositionSnapshot {
  const quantity = lots.reduce((s, l) => s.add(l.quantity), ZERO);
  const costBasis = lots.reduce((s, l) => s.add(l.costBasis), ZERO);
  const avgCostPerUnit = quantity.gt(0) ? costBasis.div(quantity) : null;

  if (currentPrice === undefined) {
    return {
      quantity,
      costBasis,
      avgCostPerUnit,
      marketValue: null,
      unrealizedGain: null,
      unrealizedGainPct: null,
    };
  }

  const marketValue = quantity.mul(currentPrice);
  const unrealizedGain = marketValue.sub(costBasis);
  const unrealizedGainPct = costBasis.gt(0)
    ? unrealizedGain.div(costBasis).mul(100)
    : null;

  return {
    quantity,
    costBasis,
    avgCostPerUnit,
    marketValue,
    unrealizedGain,
    unrealizedGainPct,
  };
}
