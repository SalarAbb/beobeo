import { and, desc, eq, ilike } from "drizzle-orm";
import { db, schema } from "@beobeo/db";
import {
  adjustForSplits,
  buildLots,
  buysVsBenchmark,
  D,
  realizedByYear,
  toIsoDate,
  type Decimal,
} from "@beobeo/core";
import type { PortfolioApi } from "@beobeo/agent";
import { getMarketData } from "./market-data";
import {
  computeDcaComparison,
  computeOverview,
  computePosition,
  computeTimeseries,
  leadIn,
  loadEngineTransactions,
} from "./portfolio";
import {
  computeTaxLotsList,
  computeTaxNow,
  computeTaxPlan,
  computeTaxProfile,
} from "./tax-center";
import { computeNextBuy } from "./next-buy";

const round2 = (n: number) => Math.round(n * 100) / 100;

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

/** What the agent reads before its first step (holdings, totals, accounts, tax rates and moves). */
async function loadContextSnapshot(userId: string, portfolioId?: string) {
  const accountFilter = [eq(schema.accounts.userId, userId)];
  if (portfolioId) accountFilter.push(eq(schema.accounts.portfolioId, portfolioId));
  const [overview, series, tax, taxLots, taxNow, accounts] = await Promise.all([
    computeOverview(userId, portfolioId),
    computeTimeseries(userId, undefined, portfolioId).catch(() => []),
    computeTaxProfile(userId, portfolioId).catch(() => null),
    computeTaxLotsList(userId, portfolioId).catch(() => []),
    computeTaxNow(userId, portfolioId).catch(() => null),
    db
      .select({ name: schema.accounts.name, type: schema.accounts.accountType })
      .from(schema.accounts)
      .where(and(...accountFilter)),
  ]);
  const { value } = overview.totals;
  // "Am I on track?" needs the saving pace; without it the agent spent a
  // slow round trip paging through transactions to estimate it.
  const first = series[0];
  const last = series[series.length - 1];
  const yearAgo = toIsoDate(new Date(Date.now() - 365 * 86_400_000));
  const atYearAgo = series.findLast((p) => p.date <= yearAgo);
  const contributions = first && last && {
    firstTradeDate: first.date,
    netInvestedAllTime: last.invested,
    netInvestedLast12Months: last.invested - (atYearAgo?.invested ?? 0),
  };
  // "What would I owe if I sold X?" needs each holding's short/long-term
  // split; without it the agent fetched lots one symbol per round trip.
  const taxable = new Map<string, { shortTerm: number; longTerm: number }>();
  for (const l of taxLots) {
    const t = taxable.get(l.symbol) ?? { shortTerm: 0, longTerm: 0 };
    if (l.isLongTerm) t.longTerm += l.unrealizedGain;
    else t.shortTerm += l.unrealizedGain;
    taxable.set(l.symbol, t);
  }
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
      ...(taxable.has(h.symbol) && {
        taxableGainIfSoldNow: {
          shortTerm: round2(taxable.get(h.symbol)!.shortTerm),
          longTerm: round2(taxable.get(h.symbol)!.longTerm),
        },
      }),
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
      sellMovesTaxSavedUsd: round2(taxNow.movesTaxSavedUsd),
      sellMovesLossBreakdown: taxNow.movesBreakdown,
      incomeDeductionRoomUsd: round2(taxNow.deductionRoomUsd),
      daysLeftInTaxYear: taxNow.daysLeftInTaxYear,
    },
  };
}

/**
 * Fill the computation cache the snapshot reads, so a question asked soon
 * after costs no snapshot wait. The chat page calls this on open and while
 * the user types.
 */
export async function warmContextSnapshot(userId: string, portfolioId?: string) {
  await loadContextSnapshot(userId, portfolioId);
}

/** Read-only PortfolioApi bound to one authenticated user. */
export function makePortfolioApi(userId: string, portfolioId?: string): PortfolioApi {
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
        .map((l) => {
          // The day after the anniversary is the first safely long-term sale date.
          const d = new Date(l.openedAt);
          d.setUTCFullYear(d.getUTCFullYear() + 1);
          d.setUTCDate(d.getUTCDate() + 1);
          return { ...l, longTermOn: l.isLongTerm ? null : toIsoDate(d) };
        })
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
        buildLots(assetTxns).realized.map((g) => ({
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
      const { picks } = await computeNextBuy(userId, { portfolioId, amountUsd, assetIds });
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
        note: "Target mixes are saved on the user's device, so this ranking ignores them.",
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
      const result = await computeDcaComparison(userId, {
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
      const to = toIsoDate(new Date());
      const from = toIsoDate(new Date(Date.now() - days * 86_400_000));
      const prices = await getMarketData().getPrices(asset, from, to);
      return [...prices.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, close]) => ({ date, close: close.toNumber() }));
    },
  };
}
