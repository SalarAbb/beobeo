import { eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@beobeo/db";
import { getMarketData } from "@/server/market-data";
import { protectedProcedure, router } from "../trpc";

const assetClassSchema = z.enum(["stock", "etf", "fund", "crypto", "cash"]);

export const assetsRouter = router({
  /** Local-first search; falls through to provider search for new symbols. */
  search: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(50) }))
    .query(async ({ ctx, input }) => {
      const local = await ctx.db
        .select()
        .from(schema.assets)
        .where(
          or(
            ilike(schema.assets.symbol, `${input.query}%`),
            ilike(schema.assets.name, `%${input.query}%`),
          ),
        )
        .limit(10);

      let remote: {
        symbol: string;
        name: string;
        class: z.infer<typeof assetClassSchema>;
        providerRef?: string;
      }[] = [];
      if (local.length < 5) {
        try {
          remote = await getMarketData().search(input.query);
        } catch {
          // provider search is best-effort; local results still serve
        }
      }

      const seen = new Set(local.map((a) => `${a.symbol}:${a.class}`));
      return {
        local,
        remote: remote.filter((r) => !seen.has(`${r.symbol}:${r.class}`)).slice(0, 8),
      };
    }),

  /**
   * Suggested price for a transaction: intraday quote when the date is today,
   * otherwise the close on/before the date. Used to pre-fill the entry form.
   */
  priceOn: protectedProcedure
    .input(
      z.object({
        assetId: z.uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.id, input.assetId));
      const asset = rows[0];
      if (!asset) return null;
      try {
        return await getMarketData().getPriceForDate(asset, input.date);
      } catch {
        return null;
      }
    }),

  /** Find-or-create an asset by symbol+class (used by manual entry and CSV import). */
  ensure: protectedProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(20).transform((s) => s.toUpperCase()),
        name: z.string().min(1).max(200),
        class: assetClassSchema,
        providerRef: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [asset] = await ctx.db
        .insert(schema.assets)
        .values(input)
        .onConflictDoNothing({
          target: [schema.assets.symbol, schema.assets.class],
        })
        .returning();
      if (asset) return asset;
      const existing = await ctx.db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.symbol, input.symbol));
      return existing.find((a) => a.class === input.class)!;
    }),

  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.select().from(schema.assets).orderBy(schema.assets.symbol),
  ),
});
