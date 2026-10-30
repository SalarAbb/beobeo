import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@beobeo/db";
import { invalidateUserComputations } from "../cache";
import { loadAccountList } from "../transactions-list";
import { protectedProcedure, router } from "../trpc";

const accountTypeSchema = z.enum([
  "taxable",
  "traditional_ira",
  "roth_ira",
  "401k",
  "other_tax_advantaged",
]);

export const accountsRouter = router({
  list: protectedProcedure
    .input(z.object({ portfolioId: z.uuid().optional() }).default({}))
    .query(({ ctx, input }) => loadAccountList(ctx.userId, input.portfolioId)),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        institution: z.string().max(100).optional(),
        currency: z.string().length(3).default("USD"),
        portfolioId: z.uuid().optional(),
        accountType: accountTypeSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Every account belongs to a portfolio; default to the user's first
      // (creating "Main" for brand-new users).
      let portfolioId = input.portfolioId;
      if (portfolioId) {
        const owned = await ctx.db
          .select({ id: schema.portfolios.id })
          .from(schema.portfolios)
          .where(
            and(
              eq(schema.portfolios.id, portfolioId),
              eq(schema.portfolios.userId, ctx.userId),
            ),
          );
        if (owned.length === 0) portfolioId = undefined;
      }
      if (!portfolioId) {
        const existing = await ctx.db
          .select({ id: schema.portfolios.id })
          .from(schema.portfolios)
          .where(eq(schema.portfolios.userId, ctx.userId))
          .orderBy(schema.portfolios.createdAt)
          .limit(1);
        portfolioId =
          existing[0]?.id ??
          (
            await ctx.db
              .insert(schema.portfolios)
              .values({ userId: ctx.userId, name: "Main" })
              .returning()
          )[0]!.id;
      }
      const [account] = await ctx.db
        .insert(schema.accounts)
        .values({ ...input, portfolioId, userId: ctx.userId })
        .returning();
      // Cached tax/next-buy views read the account list.
      await invalidateUserComputations(ctx.userId);
      return account!;
    }),

  /** Several accounts in one round trip (welcome step 2): one create per
   *  account, in order, kept step 3 waiting on "Adding your accounts…"
   *  (hermione, mission 40). They go into the user's first portfolio. */
  createMany: protectedProcedure
    .input(
      z
        .array(z.object({ name: z.string().min(1).max(100), accountType: accountTypeSchema }))
        .min(1)
        .max(10),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({ id: schema.portfolios.id })
        .from(schema.portfolios)
        .where(eq(schema.portfolios.userId, ctx.userId))
        .orderBy(schema.portfolios.createdAt)
        .limit(1);
      const portfolioId =
        existing[0]?.id ??
        (
          await ctx.db
            .insert(schema.portfolios)
            .values({ userId: ctx.userId, name: "Main" })
            .returning()
        )[0]!.id;
      // One insert shares one now(); a millisecond apart keeps the list (sorted
      // by createdAt) in the order they were ticked, so the add form
      // preselects the first.
      const now = Date.now();
      const accounts = await ctx.db
        .insert(schema.accounts)
        .values(
          input.map((a, i) => ({
            ...a,
            currency: "USD",
            portfolioId,
            userId: ctx.userId,
            createdAt: new Date(now + i),
          })),
        )
        .returning();
      await invalidateUserComputations(ctx.userId);
      return accounts;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Deleting an account cascades its transactions — computed views change.
      await ctx.db
        .delete(schema.accounts)
        .where(
          and(eq(schema.accounts.id, input.id), eq(schema.accounts.userId, ctx.userId)),
        );
      await invalidateUserComputations(ctx.userId);
    }),

  /** Set an account's taxable/tax-advantaged type — drives the Tax Center's
   *  sellable-lot universe and wash-sale IRA detection. */
  update: protectedProcedure
    .input(
      z.object({
        id: z.uuid(),
        accountType: accountTypeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.accounts)
        .set({ accountType: input.accountType })
        .where(
          and(eq(schema.accounts.id, input.id), eq(schema.accounts.userId, ctx.userId)),
        );
      await invalidateUserComputations(ctx.userId);
    }),
});
