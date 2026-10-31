import { z } from "zod";
import {
  computeMetrics,
  computeOverview,
  computePosition,
  computeSales,
  computeTimeseries,
} from "@/server/portfolio";
import { computeNextBuy } from "@/server/next-buy";
import { computeDividendEstimate } from "@/server/dividends";
import { protectedProcedure, router } from "../trpc";

const scope = z.object({ portfolioId: z.uuid().optional() }).default({});
const overviewInput = z
  .object({
    portfolioId: z.uuid().optional(),
    window: z.enum(["1d", "1w", "1m", "ytd", "1y", "all"]).default("all"),
  })
  .default({ window: "all" });

export const portfolioRouter = router({
  overview: protectedProcedure
    .input(overviewInput)
    .query(({ ctx, input }) =>
      computeOverview(ctx.userId, input.portfolioId, input.window),
    ),

  metrics: protectedProcedure
    .input(overviewInput)
    .query(({ ctx, input }) =>
      computeMetrics(ctx.userId, input.portfolioId, input.window),
    ),

  timeseries: protectedProcedure
    .input(scope)
    .query(({ ctx, input }) =>
      computeTimeseries(ctx.userId, undefined, input.portfolioId),
    ),

  position: protectedProcedure
    .input(z.object({ assetId: z.uuid(), portfolioId: z.uuid().optional() }))
    .query(({ ctx, input }) =>
      computePosition(ctx.userId, input.assetId, input.portfolioId),
    ),

  /** One asset's sales and the purchases each used (a sale's details on /transactions). */
  sales: protectedProcedure
    .input(z.object({ assetId: z.uuid(), portfolioId: z.uuid().optional() }))
    .query(({ ctx, input }) =>
      computeSales(ctx.userId, input.assetId, input.portfolioId),
    ),

  /** Yearly dividend income from what's held now (last 12 months' payouts). */
  dividends: protectedProcedure
    .input(scope)
    .query(({ ctx, input }) => computeDividendEstimate(ctx.userId, input.portfolioId)),

  /** "I have $n — where should it go?" — ranked picks among the user's candidates. */
  nextBuy: protectedProcedure
    .input(
      z.object({
        portfolioId: z.uuid().optional(),
        amountUsd: z.number().positive().max(1e9),
        assetIds: z.array(z.uuid()).min(1).max(5),
        targets: z.record(z.string(), z.number().min(0).max(1)).nullish(),
      }),
    )
    .query(({ ctx, input }) => computeNextBuy(ctx.userId, input)),
});
