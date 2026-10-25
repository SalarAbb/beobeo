import { inArray } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@beobeo/db";
import { computeDcaComparison } from "@/server/portfolio";
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
      computeDcaComparison(ctx.userId, {
        benchmarkIds: input.benchmarkIds,
        scopeAssetIds:
          input.scopeAssetIds && input.scopeAssetIds.length > 0
            ? input.scopeAssetIds
            : undefined,
        portfolioId: input.portfolioId,
      }),
    ),

  /** Common benchmark assets, creating them on first use. */
  presets: protectedProcedure.query(async ({ ctx }) => {
    const wanted = [
      { symbol: "SPY", name: "SPDR S&P 500 ETF", class: "etf" as const },
      { symbol: "QQQ", name: "Invesco QQQ Trust", class: "etf" as const },
      { symbol: "BTC", name: "Bitcoin", class: "crypto" as const, providerRef: "bitcoin" },
    ];
    await ctx.db
      .insert(schema.assets)
      .values(wanted)
      .onConflictDoNothing({ target: [schema.assets.symbol, schema.assets.class] });
    const rows = await ctx.db
      .select()
      .from(schema.assets)
      .where(
        inArray(
          schema.assets.symbol,
          wanted.map((w) => w.symbol),
        ),
      );
    const order = new Map(wanted.map((w, i) => [`${w.symbol}:${w.class}`, i]));
    return rows
      .filter((r) => order.has(`${r.symbol}:${r.class}`))
      .sort(
        (a, b) =>
          order.get(`${a.symbol}:${a.class}`)! - order.get(`${b.symbol}:${b.class}`)!,
      )
      .map((r) => ({ id: r.id, symbol: r.symbol, name: r.name, class: r.class }));
  }),
});
