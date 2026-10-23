import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { schema } from "@beobeo/db";
import { protectedProcedure, router } from "../trpc";

export const portfoliosRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(schema.portfolios)
      .where(eq(schema.portfolios.userId, ctx.userId))
      .orderBy(asc(schema.portfolios.createdAt)),
  ),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(60) }))
    .mutation(async ({ ctx, input }) => {
      const [portfolio] = await ctx.db
        .insert(schema.portfolios)
        .values({ userId: ctx.userId, name: input.name })
        .returning();
      return portfolio!;
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.uuid(), name: z.string().min(1).max(60) }))
    .mutation(async ({ ctx, input }) => {
      const [portfolio] = await ctx.db
        .update(schema.portfolios)
        .set({ name: input.name })
        .where(
          and(
            eq(schema.portfolios.id, input.id),
            eq(schema.portfolios.userId, ctx.userId),
          ),
        )
        .returning();
      return portfolio ?? null;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [{ n }] = (await ctx.db
        .select({ n: count() })
        .from(schema.accounts)
        .where(
          and(
            eq(schema.accounts.portfolioId, input.id),
            eq(schema.accounts.userId, ctx.userId),
          ),
        )) as [{ n: number }];
      if (n > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This portfolio still contains accounts. Move or delete them first.",
        });
      }
      await ctx.db
        .delete(schema.portfolios)
        .where(
          and(
            eq(schema.portfolios.id, input.id),
            eq(schema.portfolios.userId, ctx.userId),
          ),
        );
    }),
});
