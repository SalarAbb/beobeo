import { and, desc, eq, ilike } from "drizzle-orm";
import { db, schema } from "@beobeo/db";
import {
  adjustForSplits,
  allocationDrift,
  buysVsBenchmark,
  fillToTarget,
  D,
  projectGrowth,
  realizedByYear,
  toIsoDate,
  type Decimal,
} from "@beobeo/core";
import { primePortfolioAgentCache, type PortfolioApi } from "@beobeo/agent";
import { cached, userCacheKey, warm } from "./cache";
import { getMarketData } from "./market-data";
import {
  computeDcaComparisonLive,
  computeMetrics,
  computeOverview,
  computePosition,
  computeTimeseries,
  leadIn,
  loadEngineTransactions,
  replayAsset,
} from "./portfolio";
import {
  computeAccountHoldings,
  computeTaxLotsList,
  computeTaxNow,
  computeTaxPlan,
  computeTaxProfile,
} from "./tax-center";
import { computeNextBuy } from "./next-buy";
import { computeDividendEstimate } from "./dividends";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** {VTI: 60} → {VTI: 0.6}, tickers upper-cased like the holdings. */
const fractions = (pcts: Record<string, number>) =>
  Object.fromEntries(Object.entries(pcts).map(([k, p]) => [k.toUpperCase(), p / 100]));

/** Resolve a symbol to an asset the user actually holds/held. */
async function findUserAsset(userId: string, symbol: string) {
  const rows = await db
    .selectDistinct({ asset: schema.assets })
    .from(schema.transactions)
    .innerJoin(schema.assets, eq(schema.transactions.assetId, schema.assets.id))
    .where(
      and(
        eq(schema.transactions.userId, userId),
        ilike(schema.assets.symbol, symbol),
      ),
    );
  return rows[0]?.asset ?? null;
}

/** Saving pace from the daily series: first trade and net put in, all time and last 12 months. */
function contributionsFrom(series: { date: string; invested: number }[]) {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return null;
  const yearAgo = toIsoDate(new Date(Date.now() - 365 * 86_400_000));
  const atYearAgo = series.findLast((p) => p.date <= yearAgo);
  return {
    firstTradeDate: first.date,
    netInvestedAllTime: last.invested,
    netInvestedLast12Months: last.invested - (atYearAgo?.invested ?? 0),
  };
}

/** "2041-03" from a number of months after today. */
function monthsFromNow(months: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 7);
}

/**
 * What the agent reads before its first step. Cached as one entry (2 min) so
 * the warm-up's cache prime and the question that follows send the same text:
 * rebuilt from the 60s overview, a live quote would move a cent between them
 * and the question would miss the prompt cache.
 */
function loadContextSnapshot(userId: string, portfolioId?: string) {
  return cached(userCacheKey(userId, "chat-snapshot", portfolioId ?? "all"), 120, () =>
    loadContextSnapshotUncached(userId, portfolioId),
  );
}

/** Holdings, totals, accounts, tax rates and moves. */
async function loadContextSnapshotUncached(userId: string, portfolioId?: string) {
  const accountFilter = [eq(schema.accounts.userId, userId)];
  if (portfolioId) accountFilter.push(eq(schema.accounts.portfolioId, portfolioId));
  const [overview, series, tax, taxLots, taxNow, accountHoldings, accountRows] = await Promise.all([
    computeOverview(userId, portfolioId),
    computeTimeseries(userId, undefined, portfolioId).catch(() => []),
    computeTaxProfile(userId, portfolioId).catch(() => null),
    computeTaxLotsList(userId, portfolioId).catch(() => []),
    computeTaxNow(userId, portfolioId).catch(() => null),
    computeAccountHoldings(userId, portfolioId).catch(() => []),
    db
      .select({ name: schema.accounts.name, type: schema.accounts.accountType })
      .from(schema.accounts)
      .where(and(...accountFilter)),
  ]);
  const { value } = overview.totals;
  // "Am I on track?" needs the saving pace; without it the agent spent a
  // slow round trip paging through transactions to estimate it.
  const contributions = contributionsFrom(series);
  // "What would I owe if I sold X?" / "split it by BTC, ETH and SOL, which
  // part is long-term?" need each holding's units and gain by term, the next
  // date more of it turns long-term and its tax if sold alone. Without them
  // the agent fetched every lot (fred, 2026-11-01: get_tax_lots put ~5k
  // uncached tokens in front of the answer, 5.2s to the first word).
  const taxable = new Map<
    string,
    {
      shortTerm: { units: number; gain: number };
      longTerm: { units: number; gain: number };
      next: { on: string; units: number } | null;
    }
  >();
  for (const l of taxLots) {
    const t = taxable.get(l.assetId) ?? {
      shortTerm: { units: 0, gain: 0 },
      longTerm: { units: 0, gain: 0 },
      next: null,
    };
    const side = l.isLongTerm ? t.longTerm : t.shortTerm;
    side.units += l.quantity;
    side.gain += l.unrealizedGain;
    if (!l.isLongTerm) {
      if (!t.next || l.longTermOn < t.next.on) t.next = { on: l.longTermOn, units: l.quantity };
      else if (l.longTermOn === t.next.on) t.next.units += l.quantity;
    }
    taxable.set(l.assetId, t);
  }
  const units = (n: number) => Number(n.toFixed(8));
  /** The taxable part of one holding, sold today on its own. */
  const ifSoldToday = (assetId: string) => {
    const t = taxable.get(assetId);
    if (!t) return {};
    const alone = taxNow?.sellAllByAsset[assetId];
    return {
      ifSoldToday: {
        taxableAccounts: alone?.accounts ?? [],
        heldOverAYear: { units: units(t.longTerm.units), gainUsd: round2(t.longTerm.gain) },
        heldUnderAYear: { units: units(t.shortTerm.units), gainUsd: round2(t.shortTerm.gain) },
        nextTurnsLongTerm: t.next && { on: t.next.on, units: units(t.next.units) },
        ...(alone && { taxUsd: round2(alone.taxUsd) }),
      },
    };
  };
  // "What's in my IRA?" / "answer from the brokerage alone": without each
  // account's holdings the agent said it couldn't tell taxable from IRA.
  const heldIn = new Map(accountHoldings.map((a) => [a.accountName, a]));
  const accounts = accountRows.map((a) => {
    const held = heldIn.get(a.name);
    return {
      name: a.name,
      type: a.type,
      value: held?.value ?? 0,
      costBasis: held?.costBasis ?? 0,
      holdings: (held?.holdings ?? []).map((h) => ({
        symbol: h.symbol,
        quantity: h.quantity,
        costBasis: h.costBasis,
        marketValue: h.marketValue,
      })),
    };
  });
  return {
    contributions,
    totals: {
      value,
      costBasis: overview.totals.cost,
      unrealized: overview.totals.unrealized,
      unrealizedPct: overview.totals.unrealizedPct,
      realizedAllTime: overview.totals.realized,
      realizedThisYear: round2(overview.totals.realizedThisYear),
      dividendsAllTime: overview.totals.dividends,
    },
    holdings: overview.holdings.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      class: h.class,
      quantity: h.quantity,
      avgCost: h.avgCost,
      costBasis: h.costBasis,
      price: h.price,
      priceDate: h.priceDate,
      marketValue: h.marketValue,
      weightPct: value > 0 && h.marketValue !== null ? (h.marketValue / value) * 100 : null,
      unrealized: h.unrealizedGain,
      unrealizedPct: h.unrealizedGainPct,
      ...ifSoldToday(h.assetId),
    })),
    dataIssues: overview.dataIssues,
    accounts,
    taxProfile: tax && {
      // Federal + state, the same combination the Tax Center uses.
      shortTermRatePct: tax.federalOrdinaryRatePct + tax.stateOrdinaryRatePct,
      longTermRatePct: tax.federalLtcgRatePct + tax.stateLtcgRatePct,
      ytdShortTermGain: tax.ytdShortTermOverride ?? tax.ytdShortTermComputed,
      ytdLongTermGain: tax.ytdLongTermOverride ?? tax.ytdLongTermComputed,
      carryforwardShortTerm: tax.carryforwardShortTerm,
      carryforwardLongTerm: tax.carryforwardLongTerm,
    },
    // The Tax Center's "Moves available now" list, so "any tax moves I
    // should make?" gets the same lines and dollars as the page.
    taxMovesNow: taxNow && {
      moves: taxNow.moves,
      ratesUsed: taxNow.ratesUsed,
      sellMovesTaxSavedUsd: round2(taxNow.movesTaxSavedUsd),
      sellMovesLossBreakdown: taxNow.movesBreakdown,
      incomeDeductionRoomUsd: round2(taxNow.deductionRoomUsd),
      daysLeftInTaxYear: taxNow.daysLeftInTaxYear,
    },
    // The Now tab's "If you sold everything today": every taxable purchase
    // sold on top of this year's sales, retirement accounts left out.
    taxIfSoldEverything: taxNow?.sellAll && {
      ...taxNow.sellAll,
      proceedsUsd: round2(taxNow.sellAll.proceedsUsd),
      costBasisUsd: round2(taxNow.sellAll.costBasisUsd),
      shortTermGainUsd: round2(taxNow.sellAll.shortTermGainUsd),
      longTermGainUsd: round2(taxNow.sellAll.longTermGainUsd),
      taxUsd: round2(taxNow.sellAll.taxUsd),
    },
  };
}

/** When each user's snapshot text was last written to the prompt cache. */
const globalForPrimes = globalThis as unknown as {
  __beobeoChatPrimes?: Map<string, { snapshot: string; at: number }>;
};
const primes = (globalForPrimes.__beobeoChatPrimes ??= new Map());
/** The prompt cache lives 5 minutes; prime again a little before that. */
const PRIME_EVERY_MS = 4 * 60_000;

/**
 * Get the next question ready: fill the computation cache the snapshot reads
 * (no snapshot wait), then write the prompt and the snapshot into the
 * Anthropic prompt cache (no prefill wait: the snapshot is thousands of
 * tokens the model otherwise reads before its first word). The chat page
 * calls this on open and while the user types, at most every 30s; a prime is
 * skipped while the same snapshot was primed in the last 4 minutes.
 */
export async function warmContextSnapshot(userId: string, portfolioId?: string) {
  // Dividends come from the provider one ticker at a time (memoized for the
  // day), so fetch them while the user types rather than inside a turn.
  warm(() => computeDividendEstimate(userId, portfolioId));
  const snapshot = await loadContextSnapshot(userId, portfolioId);
  if (!process.env.ANTHROPIC_API_KEY) return;
  const key = `${userId}:${portfolioId ?? "all"}`;
  const text = JSON.stringify(snapshot);
  const last = primes.get(key);
  if (last && last.snapshot === text && Date.now() - last.at < PRIME_EVERY_MS) return;
  primes.set(key, { snapshot: text, at: Date.now() });
  const t0 = performance.now();
  try {
    const usage = await primePortfolioAgentCache({ api: makePortfolioApi(userId, portfolioId) });
    console.log(
      `[chat] primed in ${Math.round(performance.now() - t0)}ms · cache write ${usage.cacheWriteTokens} tok, read ${usage.cacheReadTokens}, uncached ${usage.inputTokens}`,
    );
  } catch (err) {
    primes.delete(key);
    console.warn(`[chat] prime failed: ${(err as Error).message}`);
  }
}

/** Read-only PortfolioApi bound to one authenticated user. `savedTargets` is
 *  the target mix saved on the user's device (percent by ticker; the app keeps
 *  it in localStorage until it has a server table), sent with the question. */
export function makePortfolioApi(
  userId: string,
  portfolioId?: string,
  savedTargets?: Record<string, number> | null,
): PortfolioApi {
  // Memoized per api instance: the chat route starts the snapshot as soon as
  // the request arrives, alongside its thread writes, and the turn picks up
  // the same promise.
  let snapshot: Promise<unknown> | undefined;
  return {
    getContextSnapshot() {
      snapshot ??= loadContextSnapshot(userId, portfolioId);
      snapshot.catch(() => (snapshot = undefined));
      return snapshot;
    },

    async getPortfolioSummary() {
      return computeOverview(userId, portfolioId);
    },

    async getPositionDetails(symbol) {
      const asset = await findUserAsset(userId, symbol);
      if (!asset) return { error: `No position found for ${symbol}` };
      const position = await computePosition(userId, asset.id, portfolioId);
      if (!position) return { error: `No position found for ${symbol}` };
      // Trim the price series — the agent doesn't need 900 rows of tape.
      return { ...position, priceSeries: position.priceSeries.slice(-30) };
    },

    async getTaxLots({ symbols, onlyLosses, term, turnsLongTermBy }) {
      const wanted = symbols?.map((s) => s.toUpperCase());
      const rows = (await computeTaxLotsList(userId, portfolioId))
        .map((l) => ({ ...l, longTermOn: l.isLongTerm ? null : l.longTermOn }))
        .filter(
          (l) =>
            (!wanted || wanted.includes(l.symbol.toUpperCase())) &&
            (!onlyLosses || l.unrealizedGain < 0) &&
            (!term || (term === "long") === l.isLongTerm) &&
            (!turnsLongTermBy || (l.longTermOn !== null && l.longTermOn <= turnsLongTermBy)),
        )
        .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.openedAt.localeCompare(b.openedAt));
      // Columnar: a long DCA history is hundreds of lots, and repeating the
      // keys on every row tripled the tokens the model had to read.
      return {
        count: rows.length,
        columns: ["symbol", "account", "bought", "quantity", "costBasis", "valueNow", "gainIfSoldNow", "term", "longTermOn"],
        rows: rows.map((l) => [
          l.symbol,
          l.accountName,
          l.openedAt.slice(0, 10),
          l.quantity,
          round2(l.costBasis),
          round2(l.marketValue),
          round2(l.unrealizedGain),
          l.isLongTerm ? "long" : "short",
          l.longTermOn,
        ]),
      };
    },

    async getTransactions({ symbol, limit = 50 }) {
      const conditions = [eq(schema.transactions.userId, userId)];
      if (portfolioId) conditions.push(eq(schema.accounts.portfolioId, portfolioId));
      if (symbol) {
        const asset = await findUserAsset(userId, symbol);
        if (!asset) return { error: `No transactions found for ${symbol}` };
        conditions.push(eq(schema.transactions.assetId, asset.id));
      }
      const rows = await db
        .select({
          symbol: schema.assets.symbol,
          type: schema.transactions.type,
          quantity: schema.transactions.quantity,
          pricePerUnit: schema.transactions.pricePerUnit,
          fees: schema.transactions.fees,
          tradedAt: schema.transactions.tradedAt,
          note: schema.transactions.note,
          account: schema.accounts.name,
        })
        .from(schema.transactions)
        .innerJoin(schema.assets, eq(schema.transactions.assetId, schema.assets.id))
        .innerJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
        .where(and(...conditions))
        .orderBy(desc(schema.transactions.tradedAt))
        .limit(limit);
      return rows.map((r) => ({ ...r, tradedAt: toIsoDate(r.tradedAt) }));
    },

    async getRealizedGains(year) {
      const { txns, assets } = await loadEngineTransactions(db, userId, undefined, undefined, portfolioId);
      const perAsset = new Map<string, typeof txns>();
      for (const t of txns) {
        const g = perAsset.get(t.assetId);
        if (g) g.push(t);
        else perAsset.set(t.assetId, [t]);
      }
      const allRealized = [...perAsset.entries()].flatMap(([assetId, assetTxns]) =>
        replayAsset(assetTxns).realized.map((g) => ({
          ...g,
          symbol: assets.get(assetId)!.symbol,
        })),
      );
      // Totals are summed here: adding up a year of withdrawals in its head
      // once kept the model thinking for 14s before its first word.
      const years = realizedByYear(allRealized)
        .filter((y) => year === undefined || y.year === year)
        .map((y) => {
          const entries = y.entries as (typeof allRealized)[number][];
          const months = new Map<string, { proceeds: Decimal; gain: Decimal }>();
          for (const g of entries) {
            const key = toIsoDate(g.soldAt).slice(0, 7);
            const m = months.get(key) ?? { proceeds: D(0), gain: D(0) };
            months.set(key, { proceeds: m.proceeds.add(g.proceeds), gain: m.gain.add(g.gain) });
          }
          const sum = (pick: (g: (typeof entries)[number]) => Decimal) =>
            round2(entries.reduce((s, g) => s.add(pick(g)), D(0)).toNumber());
          return {
            year: y.year,
            proceeds: sum((g) => g.proceeds),
            costBasis: sum((g) => g.costBasis),
            gain: round2(y.total.toNumber()),
            shortTermGain: round2(y.shortTerm.toNumber()),
            longTermGain: round2(y.longTerm.toNumber()),
            byMonth: [...months.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([month, m]) => ({
                month,
                proceeds: round2(m.proceeds.toNumber()),
                gain: round2(m.gain.toNumber()),
              })),
            // Columnar, one row per lot sold from, oldest sale first.
            columns: ["symbol", "sold", "bought", "quantity", "proceeds", "costBasis", "gain", "term"],
            sales: entries
              .sort((a, b) => a.soldAt.getTime() - b.soldAt.getTime())
              .map((g) => [
                g.symbol,
                toIsoDate(g.soldAt),
                toIsoDate(g.acquiredAt),
                g.quantity.toNumber(),
                round2(g.proceeds.toNumber()),
                round2(g.costBasis.toNumber()),
                round2(g.gain.toNumber()),
                g.longTerm ? "long" : "short",
              ]),
          };
        });
      return {
        years,
        note: "Every account, retirement accounts included (their sales aren't taxed); the snapshot's taxProfile ytd gains are the taxable part.",
      };
    },

    async checkTargetMix({ targets, depositUsd }) {
      const given = targets && Object.keys(targets).length > 0;
      const pcts = given ? targets : savedTargets;
      const overview = await computeOverview(userId, portfolioId);
      const holdings = overview.holdings
        .filter((h) => (h.marketValue ?? 0) > 0)
        .map((h) => ({ key: h.symbol.toUpperCase(), value: h.marketValue ?? 0 }));
      if (!pcts || Object.keys(pcts).length === 0) {
        const total = holdings.reduce((s, h) => s + h.value, 0);
        return {
          error:
            "No target mix saved on this device (Dashboard → Allocation → Set a target mix) and none given in the conversation.",
          weightsNow: {
            columns: ["symbol", "valueNow", "weightNowPct"],
            rows: holdings
              .sort((a, b) => b.value - a.value)
              .map((h) => [h.key, round2(h.value), total > 0 ? round2((h.value / total) * 100) : 0]),
          },
        };
      }
      const mix = fractions(pcts);
      const targetsSumPct = round2(Object.values(pcts).reduce((s, p) => s + p, 0));
      const { total, rows } = allocationDrift(holdings, mix);
      const furthest = rows.reduce((a, b) => (Math.abs(b.drift) > Math.abs(a.drift) ? b : a));
      const untargeted = rows.filter((r) => r.target === 0 && r.value > 0).map((r) => r.key);
      const buys = depositUsd ? fillToTarget(holdings, mix, depositUsd) : [];
      return {
        targetsFrom: given ? "the conversation" : "the mix saved on Dashboard → Allocation",
        targetsSumPct,
        ...(Math.abs(targetsSumPct - 100) > 0.5 && {
          note: `The targets add up to ${targetsSumPct}%, not 100%.`,
        }),
        // Say these out loud: a quarter of a portfolio silently at "0% target"
        // read as a quirk of the app (hermione, mission 109).
        ...(untargeted.length > 0 && {
          heldWithNoTarget: {
            symbols: untargeted,
            meaning: "Not in the target mix, so they count as 0% target and show as over by their whole value; a deposit never goes to them.",
          },
        }),
        portfolioValue: round2(total),
        furthestOff: furthest.key,
        // offByPts: + = over target. toTargetUsd: + = buy this much, − = over by this much.
        columns: ["symbol", "valueNow", "weightNowPct", "targetPct", "offByPts", "toTargetUsd"],
        rows: rows.map((r) => [
          r.key,
          round2(r.value),
          round2(r.current * 100),
          round2(r.target * 100),
          round2(r.drift * 100),
          round2(r.gapUsd),
        ]),
        ...(depositUsd && {
          depositSplit: {
            depositUsd,
            buys: buys.map((b) => [b.key, b.amountUsd]),
            how: "Tops up the holding furthest under its target first, then the next once they're level, and never needs a sale (the dashboard's next-deposit split).",
            // "BTC is under target yet gets $0 — tell me why" (mission 109).
            underTargetButNothing: rows
              .filter((r) => r.target > 0 && r.gapUsd > 0 && !buys.some((b) => b.key === r.key))
              .map((r) => r.key),
            underTargetButNothingWhy: "Closer to target than the others; this deposit runs out before they catch up to it.",
          },
        }),
      };
    },

    async estimateDividendIncome() {
      const e = await computeDividendEstimate(userId, portfolioId);
      const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return {
        asOf: e.asOf,
        method: "Cash paid per share over the last 12 months × shares held now. Trailing, not a forecast.",
        yearlyUsd: e.yearlyUsd,
        monthlyAverageUsd: e.monthlyAverageUsd,
        yieldOnHoldingsValuePct: e.yieldOnValuePct,
        yieldOnCostPct: e.yieldOnCostPct,
        yieldOnWholePortfolioPct: e.yieldOnPortfolioPct,
        byExDividendMonth: e.byMonth.map((m) => [MONTHS[m.month - 1], m.usd]),
        columns: ["symbol", "shares", "perShareLast12Months", "paymentsAYear", "yearlyUsd", "yieldOnValuePct", "yieldOnCostPct", "lastExDate"],
        rows: e.holdings.map((h) => [
          h.key,
          h.quantity,
          h.perShareYearly,
          h.paymentsPerYear,
          h.yearlyUsd,
          h.yieldOnValuePct,
          h.yieldOnCostPct,
          h.lastExDate,
        ]),
        paidNothingLast12Months: e.noPayments,
        noDataFor: e.unavailable,
        recordedInAppLast12MonthsUsd: e.recordedLast12MonthsUsd,
      };
    },

    async pickNextBuy(amountUsd, symbols) {
      const resolved = await Promise.all(
        symbols.map(async (s) => {
          const own = await findUserAsset(userId, s);
          if (own) return own;
          const rows = await db.select().from(schema.assets).where(ilike(schema.assets.symbol, s));
          return rows[0] ?? null;
        }),
      );
      const notFound = symbols.filter((_, i) => !resolved[i]);
      const assetIds = resolved.flatMap((a) => (a ? [a.id] : []));
      if (assetIds.length === 0) {
        return { error: `Unknown symbols: ${notFound.join(", ")}. Add them on the dashboard's "Where should my next buy go?" first.` };
      }
      const targets = savedTargets && fractions(savedTargets);
      const { picks } = await computeNextBuy(userId, { portfolioId, amountUsd, assetIds, targets });
      return {
        amountUsd,
        picks: picks.map((p) => ({
          symbol: p.key,
          reason: p.reason,
          account: p.account ? { name: p.account.name, why: p.account.why } : null,
          weightNowPct: round2(p.weightNow * 100),
          weightAfterPct: round2(p.weightAfter * 100),
          belowOneYearHighPct: p.offHigh === null ? null : round2(-p.offHigh * 100),
          vsYourAvgCostPct: p.vsCost === null ? null : round2(p.vsCost * 100),
          score: round2(p.score),
        })),
        ...(notFound.length > 0 ? { notFound } : {}),
        ...(targets && { rankedAgainstSavedTargetMixPct: savedTargets }),
      };
    },

    async planRaiseCash({ amountUsd, symbols, account }) {
      // The optimizer's doNotSell takes symbols, asset ids or lot ids: a
      // symbol or account limit becomes "don't sell" for everything outside it.
      const lots = await computeTaxLotsList(userId, portfolioId);
      const wanted = symbols?.map((s) => s.toUpperCase());
      const accountKey = account
        ?.toLowerCase()
        .replace(/\(taxable\)\s*$/, "")
        .trim();
      const inScope = (l: (typeof lots)[number]) =>
        (!wanted || wanted.includes(l.symbol.toUpperCase())) &&
        (!accountKey || l.accountName.toLowerCase().includes(accountKey));
      if (!lots.some(inScope)) {
        return {
          error: "No taxable lots match that limit.",
          taxableAccounts: [...new Set(lots.map((l) => l.accountName))],
          taxableSymbols: [...new Set(lots.map((l) => l.symbol))],
        };
      }
      const doNotSell = lots.filter((l) => !inScope(l)).map((l) => l.lotId);
      const plan = await computeTaxPlan(userId, portfolioId, amountUsd, doNotSell);
      const { optimized } = plan;
      return {
        amountUsd,
        cashRaised: round2(optimized.totalProceeds),
        shortfall: round2(optimized.shortfall),
        realizedGain: round2(optimized.sales.reduce((s, x) => s + x.realizedGain, 0)),
        taxCost: round2(optimized.totalTaxCost),
        keptAfterTax: round2(optimized.totalAfterTax),
        // The page's headline: the broker's default order on the same lots.
        fifoWouldCostMoreUsd: round2(plan.headlineSavingsVsFifo),
        lotsOnHoldForWashSale: optimized.blocked.length,
        // Columnar, in the order the optimizer sells them.
        columns: ["symbol", "account", "bought", "sellUnits", "proceeds", "gain", "term", "tax"],
        sales: optimized.sales.map((s) => [
          s.lot.symbol,
          s.lot.accountName,
          s.lot.openedAt.slice(0, 10),
          s.sellQuantity,
          round2(s.proceeds),
          round2(s.realizedGain),
          s.isLongTerm ? "long" : "short",
          round2(s.taxCost),
        ]),
        note: "Same plan as Tax Center → Raise Cash, at the saved tax rates. Tax on a loss is negative (it saves tax).",
      };
    },

    async projectGrowth({ targetUsd, years = 20, monthlyUsd, yearlyReturnPct, yearlyRaisePct, account }) {
      const [overview, series, metrics, accountHoldings] = await Promise.all([
        computeOverview(userId, portfolioId),
        computeTimeseries(userId, undefined, portfolioId).catch(() => []),
        computeMetrics(userId, portfolioId).catch(() => null),
        account ? computeAccountHoldings(userId, portfolioId).catch(() => []) : Promise.resolve([]),
      ]);
      let startValue = overview.totals.value;
      let startIs = "the whole portfolio's value now";
      if (account) {
        const key = account.toLowerCase().replace(/\(taxable\)\s*$/, "").trim();
        const matched = accountHoldings.filter((a) => a.accountName.toLowerCase().includes(key));
        if (matched.length === 0) {
          return { error: `No account matches "${account}".`, accounts: accountHoldings.map((a) => a.accountName) };
        }
        startValue = matched.reduce((s, a) => s + a.value, 0);
        startIs = `the value now of ${matched.map((a) => a.accountName).join(" + ")}`;
      }
      // Without a stated amount, the user's own pace: what went in (net of
      // sales) over the last 12 months. samwell couldn't tell where a quoted
      // "$389 a week" came from.
      const pace = contributionsFrom(series);
      const monthly = monthlyUsd ?? Math.round((pace?.netInvestedLast12Months ?? 0) / 12);
      const monthlyIs =
        monthlyUsd !== undefined
          ? "the amount the user gave"
          : `the user's pace: $${Math.round(pace?.netInvestedLast12Months ?? 0).toLocaleString("en-US")} put in, net of sales, over the last 12 months ÷ 12`;
      const raise = yearlyRaisePct ?? (monthly < 0 ? 3 : 0);
      const rates =
        yearlyReturnPct !== undefined
          ? [{ label: "your rate", pct: yearlyReturnPct }]
          : [
              { label: "cautious", pct: 4 },
              { label: "middle", pct: 6 },
              { label: "strong", pct: 8 },
            ];
      const scenarios = rates.map((r) => ({ ...r, firstYearsPct: undefined as number[] | undefined }));
      // Withdrawing makes the order of returns matter: a fall early on sells
      // more units at low prices (barristan: "show me if the first years are bad").
      const middle = rates[Math.floor(rates.length / 2)]!;
      if (monthly < 0) scenarios.push({ label: "bad start", pct: middle.pct, firstYearsPct: [-20, -10] });

      const when = (months: number | null) =>
        months === null ? null : { years: round2(months / 12), month: monthsFromNow(months) };
      return {
        assumptions: {
          startValueUsd: round2(startValue),
          startIs,
          monthlyUsd: monthly,
          monthlyIs,
          monthlyRisesPctPerYear: raise,
          years,
          returns:
            "Yearly returns before tax, fees and inflation, compounded monthly; no dividend yield added on top (the app has no yield data).",
          // The portfolio's own growth rate, as a reference, not a forecast.
          yourPastYearlyRatePct:
            metrics?.twrAnnualized != null && (metrics.spanDays ?? 0) >= 365 ? round2(metrics.twrAnnualized) : null,
          yourPastSince: metrics?.from ?? null,
        },
        ...(targetUsd !== undefined ? { targetUsd } : {}),
        scenarios: scenarios.map((s) => {
          const p = projectGrowth({
            startValue,
            monthly,
            yearlyReturnPct: s.pct,
            years,
            firstYearsPct: s.firstYearsPct,
            yearlyRaisePct: raise,
            target: targetUsd,
          });
          return {
            label: s.label,
            yearlyReturnPct: s.pct,
            ...(s.firstYearsPct ? { firstTwoYearsPct: s.firstYearsPct } : {}),
            valueAfterYearsUsd: Math.round(p.endValue),
            putInUsd: Math.round(p.putIn),
            growthUsd: Math.round(p.growth),
            ...(targetUsd !== undefined ? { reachesTarget: when(p.targetInMonths) ?? "not within 100 years" } : {}),
            ...(monthly < 0 ? { runsOut: when(p.runsOutInMonths) ?? "lasts over 100 years" } : {}),
          };
        }),
      };
    },

    async runDcaComparison(benchmarkSymbol) {
      const rows = await db
        .select()
        .from(schema.assets)
        .where(ilike(schema.assets.symbol, benchmarkSymbol));
      const asset = rows[0];
      if (!asset) {
        return {
          error: `Unknown benchmark ${benchmarkSymbol}. Available: SPY, VOO, QQQ, BTC, or any asset in the user's portfolio.`,
        };
      }
      const result = await computeDcaComparisonLive(userId, {
        benchmarkIds: [asset.id],
        portfolioId,
      });
      // Curves are for charts; the agent needs the endpoints and returns.
      const bench = result.benchmarks[0];
      const lastP = result.portfolio[result.portfolio.length - 1];
      const lastB = bench?.series[bench.series.length - 1];
      return {
        benchmark: bench?.symbol ?? asset.symbol,
        portfolioFinalValue: lastP?.value ?? null,
        benchmarkFinalValue: lastB?.value ?? null,
        totalInvested: lastP?.invested ?? null,
        portfolioAnnualReturn: result.portfolioXirr,
        benchmarkAnnualReturn: bench?.xirr ?? null,
        difference:
          lastP && lastB ? D(lastP.value).sub(lastB.value).toNumber() : null,
      };
    },

    async compareBuysToBenchmark({ benchmarkSymbol, symbols, since }) {
      const [benchRows, { txns, assets }] = await Promise.all([
        db.select().from(schema.assets).where(ilike(schema.assets.symbol, benchmarkSymbol)),
        loadEngineTransactions(db, userId, undefined, undefined, portfolioId),
      ]);
      const bench = benchRows[0];
      if (!bench) {
        return { error: `Unknown benchmark ${benchmarkSymbol}. Try SPY, VOO, QQQ or BTC.` };
      }
      const wanted = symbols?.map((s) => s.toUpperCase());
      const inScope = (assetId: string) =>
        !wanted || wanted.includes(assets.get(assetId)!.symbol.toUpperCase());
      const buys = txns.filter((t) => t.type === "buy" && inScope(t.assetId));
      if (buys.length === 0) return { error: "No buys match that." };
      const from = toIsoDate(buys[0]!.tradedAt);
      const to = toIsoDate(new Date());
      const market = getMarketData();
      const held = [...new Set(buys.map((t) => t.assetId))].map((id) => assets.get(id)!);
      const [latest, benchPrices, benchSplits] = await Promise.all([
        market.getLatestPrices(held, to),
        market.getPricesBulk([bench], leadIn(from), to),
        market.getSplits([bench.id]).catch(() => new Map<string, { date: string; ratio: string }[]>()),
      ]);
      const rows = buysVsBenchmark(
        // Split transactions stay in so later splits scale each buy's units.
        txns.filter((t) => t.type === "split" || buys.includes(t)),
        new Map([...latest.entries()].map(([id, p]) => [id, D(p.close)])),
        adjustForSplits(benchPrices.get(bench.id) ?? new Map(), benchSplits.get(bench.id) ?? []),
      ).filter((r) => !since || r.date >= since);
      const priced = rows.filter((r) => r.edge !== null);
      const total = (pick: (r: (typeof rows)[number]) => Decimal | null) =>
        round2(priced.reduce((s, r) => s.add(pick(r)!), D(0)).toNumber());
      // A long DCA history is hundreds of buys; the worst and best ends
      // answer the question, the totals cover the rest.
      const shown = rows.length > 40 ? [...rows.slice(0, 20), ...rows.slice(-20)] : rows;
      return {
        benchmark: bench.symbol,
        buys: rows.length,
        beatBenchmark: priced.filter((r) => r.edge!.gt(0)).length,
        totals: {
          cost: total((r) => r.cost),
          valueNow: total((r) => r.valueNow),
          benchmarkValueNow: total((r) => r.benchmarkValueNow),
          edge: total((r) => r.edge),
        },
        ...(shown.length < rows.length && {
          showing: `the 20 worst and 20 best of ${rows.length} buys`,
        }),
        columns: ["symbol", "bought", "cost", "valueNow", "benchmarkValueNow", "edge"],
        rows: shown.map((r) => [
          assets.get(r.assetId)!.symbol,
          r.date,
          round2(r.cost.toNumber()),
          r.valueNow && round2(r.valueNow.toNumber()),
          r.benchmarkValueNow && round2(r.benchmarkValueNow.toNumber()),
          r.edge && round2(r.edge.toNumber()),
        ]),
        note: "Each buy is valued as if still held, sales ignored; worst edge first. Edge < 0 means the same dollars in the benchmark that day would be worth more now.",
      };
    },

    async getPriceHistory(symbol, days) {
      const asset = await findUserAsset(userId, symbol);
      if (!asset) return { error: `No asset found for ${symbol}` };
      const md = getMarketData();
      const to = toIsoDate(new Date());
      const from = toIsoDate(new Date(Date.now() - days * 86_400_000));
      const [prices, latest, splits] = await Promise.all([
        md.getPrices(asset, from, to),
        md.getLatestPrices([asset], to),
        md.getSplits([asset.id]),
      ]);
      // Present-day units, so a change across a split isn't a fake crash.
      const closes = [...adjustForSplits(prices, splits.get(asset.id) ?? []).entries()].sort(
        ([a], [b]) => (a < b ? -1 : 1),
      );
      if (closes.length === 0) return { symbol: asset.symbol, error: "No prices cached yet" };
      const last = closes.at(-1)!;
      const quote = latest.get(asset.id);
      const live = quote && quote.date > last[0] ? quote : null;
      // The changes run from the latest price (today's quote when there is
      // one) back to the close N trading days before it, so the model quotes
      // them instead of working percentages out of the closes in its head
      // (a "did it drop 5% over 5 days?" turn spent 7s thinking).
      const points: [string, Decimal][] = live ? [...closes, [live.date, D(live.close)]] : closes;
      const [nowDate, now] = points.at(-1)!;
      const pct = (base: Decimal) => round2(now.div(base).minus(1).times(100).toNumber());
      const changes = (
        [
          ["1 trading day", 1],
          ["5 trading days", 5],
          ["1 month (21 trading days)", 21],
          ["3 months (63 trading days)", 63],
          ["1 year (252 trading days)", 252],
        ] as const
      ).flatMap(([label, n]) => {
        const ref = points[points.length - 1 - n];
        return ref ? [{ over: label, fromDate: ref[0], fromClose: ref[1].toNumber(), pct: pct(ref[1]) }] : [];
      });
      const high = points.reduce((a, b) => (b[1].gt(a[1]) ? b : a));
      const low = points.reduce((a, b) => (b[1].lt(a[1]) ? b : a));
      return {
        symbol: asset.symbol,
        latest: {
          price: now.toNumber(),
          date: nowDate,
          kind: live ? "today's quote (moves until the close)" : "last daily close",
        },
        lastClose: { date: last[0], close: last[1].toNumber() },
        changes,
        rangeInWindow: {
          high: { date: high[0], close: high[1].toNumber(), pctBelow: -pct(high[1]) },
          low: { date: low[0], close: low[1].toNumber(), pctAbove: pct(low[1]) },
        },
        columns: ["date", "close"],
        closes: closes.map(([date, close]) => [date, close.toNumber()]),
        note: "Changes are latest price ÷ the close N trading days earlier − 1, already computed; quote them, don't recompute. Closes are split-adjusted.",
      };
    },
  };
}
