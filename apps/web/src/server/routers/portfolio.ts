import { z } from "zod";
import {
  computeMetrics,
  computeOverview,
  computePosition,
  computeTimeseries,
} from "@/server/portfolio";
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
});
