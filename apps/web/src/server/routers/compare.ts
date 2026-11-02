import { z } from "zod";
import { loadBenchmarkPresets } from "@/server/benchmark-presets";
import { computeDcaComparisonLive } from "@/server/portfolio";
import { protectedProcedure, router } from "../trpc";

export const compareRouter = router({
  /**
   * Replay the (optionally scoped) portfolio's actual cash flows into up to
   * four independent benchmarks — same dates, same dollars per benchmark.
   */
  dca: protectedProcedure
    .input(
      z.object({
        benchmarkIds: z.array(z.uuid()).min(1).max(4),
        /** Omit/empty = all assets. */
        scopeAssetIds: z.array(z.uuid()).max(50).optional(),
        /** Omit = all portfolios. */
        portfolioId: z.uuid().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      computeDcaComparisonLive(ctx.userId, {
        benchmarkIds: input.benchmarkIds,
        scopeAssetIds:
          input.scopeAssetIds && input.scopeAssetIds.length > 0
            ? input.scopeAssetIds
            : undefined,
        portfolioId: input.portfolioId,
      }),
    ),

  /** Common benchmark assets, creating them on first use. */
  presets: protectedProcedure.query(() => loadBenchmarkPresets()),
});
