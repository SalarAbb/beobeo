import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { matchImportRows, pickImportAsset, splitDuplicates } from "@beobeo/importers";
import { z } from "zod";
import { schema } from "@beobeo/db";
import { invalidateUserComputations } from "../cache";
import { ownsAsset } from "./assets";
import { loadTransactionAssets, loadTransactionList } from "../transactions-list";
import { protectedProcedure, router } from "../trpc";

const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be a decimal number");
const positiveDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal")
  .refine((s) => Number(s) > 0 || s.startsWith("0."), {
    message: "must be positive",
  });

const transactionType = z.enum([
  "buy",
  "sell",
  "dividend",
  "split",
  "transfer_in",
  "transfer_out",
  "fee",
]);

export const transactionInput = z.object({
  accountId: z.uuid(),
  assetId: z.uuid(),
  type: transactionType,
  quantity: positiveDecimalString,
  pricePerUnit: decimalString.nullable(),
  fees: decimalString.default("0"),
  tradedAt: z.date(),
  note: z.string().max(500).optional(),
  source: z.string().max(50).default("manual"),
});

export const transactionsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          assetId: z.uuid().optional(),
          accountId: z.uuid().optional(),
          portfolioId: z.uuid().optional(),
          /** Only these kinds ("just the buys", olenna, mission 136). */
          types: z.array(transactionType).max(7).optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .default({ limit: 200 }),
    )
    .query(({ ctx, input }) => loadTransactionList(ctx.userId, input)),

  /** Every asset the user has a transaction in (within the portfolio), with
   *  how many: the list's asset filter, which must reach past its 200 rows. */
  assets: protectedProcedure
    .input(z.object({ portfolioId: z.uuid().optional() }).default({}))
    .query(({ ctx, input }) => loadTransactionAssets(ctx.userId, input.portfolioId)),

  create: protectedProcedure
    .input(transactionInput)
    .mutation(async ({ ctx, input }) => {
      await assertOwnAccount(ctx, input.accountId);
      const [txn] = await ctx.db
        .insert(schema.transactions)
        .values({ ...input, userId: ctx.userId })
        .returning();
      await invalidateUserComputations(ctx.userId);
      return txn!;
    }),

  bulkCreate: protectedProcedure
    .input(z.object({ transactions: z.array(transactionInput).min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const accountIds = [...new Set(input.transactions.map((t) => t.accountId))];
      for (const id of accountIds) await assertOwnAccount(ctx, id);
      // Overlapping exports must not double-count: skip rows the account already has.
      const times = input.transactions.map((t) => t.tradedAt.getTime());
      const existing = await ctx.db
        .select({
          accountId: schema.transactions.accountId,
          assetId: schema.transactions.assetId,
          type: schema.transactions.type,
          quantity: schema.transactions.quantity,
          pricePerUnit: schema.transactions.pricePerUnit,
          fees: schema.transactions.fees,
          tradedAt: schema.transactions.tradedAt,
        })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.userId, ctx.userId),
            inArray(schema.transactions.accountId, accountIds),
            inArray(schema.transactions.assetId, [...new Set(input.transactions.map((t) => t.assetId))]),
            // ±36h: splitDuplicates matches date-only exports to the same trade stored with its time.
            gte(schema.transactions.tradedAt, new Date(Math.min(...times) - 36 * 3_600_000)),
            lte(schema.transactions.tradedAt, new Date(Math.max(...times) + 36 * 3_600_000)),
          ),
        );
      const { fresh, duplicates } = splitDuplicates(input.transactions, existing);
      if (fresh.length === 0) return { inserted: 0, skipped: duplicates.length };
      const rows = await ctx.db
        .insert(schema.transactions)
        .values(fresh.map((t) => ({ ...t, userId: ctx.userId })))
        .returning({ id: schema.transactions.id });
      await invalidateUserComputations(ctx.userId);
      return { inserted: rows.length, skipped: duplicates.length };
    }),

  /**
   * The import preview, before anything is written: which existing asset each row's ticker
   * means (`pickImportAsset`, so a Robinhood "stock" lands on the user's own ETF) and which of
   * the user's accounts already holds the trade (`matchImportRows`, the chosen account first).
   * Rows matched in the chosen account are the ones `bulkCreate` skips. A mutation only so the
   * rows travel in a POST body (a 2,000-row file doesn't fit in a query URL); it writes nothing.
   */
  previewImport: protectedProcedure
    .input(
      z.object({
        accountId: z.uuid().optional(),
        rows: z
          .array(
            z.object({
              symbol: z.string().min(1).max(20).transform((s) => s.toUpperCase()),
              assetClass: z.enum(["stock", "etf", "fund", "crypto"]),
              type: transactionInput.shape.type,
              quantity: z.string(),
              pricePerUnit: z.string().nullable(),
              fees: z.string(),
              tradedAt: z.date(),
            }),
          )
          .min(1)
          .max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = schema.transactions;
      const symbols = [...new Set(input.rows.map((r) => r.symbol))];
      const [candidates, accounts] = await Promise.all([
        ctx.db
          .select({
            id: schema.assets.id,
            symbol: schema.assets.symbol,
            class: schema.assets.class,
            mine: ownsAsset(ctx.userId),
          })
          .from(schema.assets)
          .where(inArray(schema.assets.symbol, symbols)),
        ctx.db
          .select({ id: schema.accounts.id, name: schema.accounts.name })
          .from(schema.accounts)
          .where(eq(schema.accounts.userId, ctx.userId))
          .orderBy(schema.accounts.createdAt),
      ]);
      const assetIds = input.rows.map((r) =>
        pickImportAsset(r.assetClass, candidates.filter((c) => c.symbol === r.symbol)),
      );
      const known = [...new Set(assetIds.filter((id): id is string => id !== null))];
      const order = input.accountId
        ? [input.accountId, ...accounts.map((a) => a.id).filter((id) => id !== input.accountId)]
        : accounts.map((a) => a.id);
      let inAccount: (string | null)[] = input.rows.map(() => null);
      if (known.length > 0 && accounts.length > 0) {
        const times = input.rows.map((r) => r.tradedAt.getTime());
        const existing = await ctx.db
          .select({
            accountId: t.accountId,
            assetId: t.assetId,
            type: t.type,
            quantity: t.quantity,
            pricePerUnit: t.pricePerUnit,
            fees: t.fees,
            tradedAt: t.tradedAt,
          })
          .from(t)
          .where(
            and(
              eq(t.userId, ctx.userId),
              inArray(t.assetId, known),
              gte(t.tradedAt, new Date(Math.min(...times) - 36 * 3_600_000)),
              lte(t.tradedAt, new Date(Math.max(...times) + 36 * 3_600_000)),
            ),
          );
        const rows = input.rows.map((r, i) => ({ ...r, assetId: assetIds[i] ?? "" }));
        inAccount = matchImportRows(rows, existing, order);
      }
      const names = new Map(accounts.map((a) => [a.id, a.name]));
      return {
        rows: input.rows.map((_, i) => ({
          assetId: assetIds[i] ?? null,
          inAccountId: inAccount[i] ?? null,
          inAccountName: inAccount[i] ? (names.get(inAccount[i]!) ?? null) : null,
        })),
      };
    }),

  update: protectedProcedure
    // No `source`: an edit keeps the row's provenance (its default must never
    // stamp an imported row "manual").
    .input(z.object({ id: z.uuid(), data: transactionInput.omit({ source: true }).partial() }))
    .mutation(async ({ ctx, input }) => {
      if (input.data.accountId) await assertOwnAccount(ctx, input.data.accountId);
      const [txn] = await ctx.db
        .update(schema.transactions)
        .set(input.data)
        .where(
          and(
            eq(schema.transactions.id, input.id),
            eq(schema.transactions.userId, ctx.userId),
          ),
        )
        .returning();
      await invalidateUserComputations(ctx.userId);
      return txn ?? null;
    }),

  /** Undo of a delete: puts the row back under its old id. */
  restore: protectedProcedure
    .input(transactionInput.extend({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnAccount(ctx, input.accountId);
      await ctx.db
        .insert(schema.transactions)
        .values({ ...input, userId: ctx.userId })
        .onConflictDoNothing();
      await invalidateUserComputations(ctx.userId);
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.transactions)
        .where(
          and(
            eq(schema.transactions.id, input.id),
            eq(schema.transactions.userId, ctx.userId),
          ),
        );
      await invalidateUserComputations(ctx.userId);
    }),
});

async function assertOwnAccount(
  ctx: { db: typeof import("@beobeo/db").db; userId: string },
  accountId: string,
) {
  const rows = await ctx.db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(
      and(eq(schema.accounts.id, accountId), eq(schema.accounts.userId, ctx.userId)),
    );
  if (rows.length === 0) {
    const { TRPCError } = await import("@trpc/server");
    throw new TRPCError({ code: "FORBIDDEN", message: "Not your account" });
  }
}
