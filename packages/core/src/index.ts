export {
  D,
  Decimal,
  ZERO,
  DAY_MS,
  toIsoDate,
  EngineError,
  type Numeric,
  type TransactionType,
  type EngineTransaction,
  type Lot,
  type RealizedGain,
  type IsoDate,
} from "./types";
export { buildLots, isLongTerm, type LotEngineResult } from "./lots";
export { positionFromLots, type PositionSnapshot } from "./position";
export { realizedByYear, type YearlyRealized } from "./realized";
export {
  portfolioTimeSeries,
  type DailyPoint,
  type PriceSeries,
} from "./timeseries";
export { xirr, type DatedCashFlow } from "./xirr";
export {
  dailyReturns,
  chainReturns,
  annualize,
  maxDrawdown,
  currentDrawdown,
  valueDrawdown,
  materialDrawdown,
  volatility,
  sharpe,
  bestWorstDay,
  type MetricSeriesPoint,
  type DailyReturn,
} from "./metrics";
export { adjustForSplits, splitFactorAfter, type SplitEvent } from "./splits";
export { buysVsBenchmark, type BuyVsBenchmark } from "./buys-vs-benchmark";
export {
  extractCashFlows,
  replayDca,
  type CashFlow,
  type BenchmarkComponent,
  type DcaReplayResult,
} from "./dca";
export {
  allocationDrift,
  fillToTarget,
  type AllocationHolding,
  type TargetMix,
  type DriftRow,
} from "./allocation";
export {
  totalTax,
  explainNetting,
  type TaxRates,
  type NettingBreakdown,
} from "./tax-netting";
export {
  detectWashSaleBlocks,
  isWashSaleExempt,
  DEFAULT_WASH_SALE_EXEMPT_CLASSES,
  type WashSaleOpts,
  type RecentBuyTxn,
  type LossLotCandidate,
  type WashSaleBlock,
} from "./tax-wash-sale";
export {
  planSale,
  planFifo,
  planHighestCostFirst,
  ripeningSoon,
  summarizeHarvest,
  taxOwedSoFar,
  lossLocks,
  type LossLock,
  taxMoves,
  type TaxMove,
  type TaxMoves,
  type TaxLot,
  type TaxProfile,
  type RipeningInfo,
  type PlannedSale,
  type TaxPlan,
  type PlanSaleOpts,
  type HarvestBreakdown,
  zeroRateGains,
  profileAtIncome,
  type IncomeInfo,
  type ZeroRateGain,
} from "./tax-optimizer";
export {
  bracketOptions,
  ltcgRateAt,
  ltcgZeroUpTo,
  FILING_STATUS_LABEL,
  type FilingStatus,
  type BracketOption,
} from "./tax-brackets";
export {
  pickNextBuy,
  placeAccount,
  NEXT_BUY_WEIGHTS,
  NEXT_BUY_TARGET_WEIGHTS,
  type NextBuyCandidate,
  type NextBuyAccount,
  type NextBuyAccountType,
  type NextBuyPick,
} from "./next-buy";
