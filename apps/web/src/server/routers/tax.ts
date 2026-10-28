import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@beobeo/db";
import {
  computeTaxHarvest,
  computeTaxLotsList,
  computeTaxNow,
  computeTaxPlan,
  computeTaxProfile,
} from "@/server/tax-center";
import { loadOrCreateTaxProfile } from "@/server/tax/lots";
import { invalidateUserComputations } from "../cache";
import { protectedProcedure, router } from "../trpc";

const scope = z.object({ portfolioId: z.uuid().optional() }).default({});

export const taxRouter = router({
  profile: protectedProcedure
    .input(scope)
    .query(({ ctx, input }) => computeTaxProfile(ctx.userId, input.portfolioId)),

  updateProfile: protectedProcedure
    .input(
      z.object({
        portfolioId: z.uuid().optional(),
        federalOrdinaryRatePct: z.number().min(0).max(100).optional(),
        federalLtcgRatePct: z.number().min(0).max(100).optional(),
        stateOrdinaryRatePct: z.number().min(0).max(100).optional(),
        stateLtcgRatePct: z.number().min(0).max(100).optional(),
        stateTreatsLtcgAsOrdinary: z.boolean().optional(),
        carryforwardShortTerm: z.number().min(0).optional(),
        carryforwardLongTerm: z.number().min(0).optional(),
        carryforwardDiscountPct: z.number().min(0).max(100).optional(),
        // Explicit null clears back to "use the computed value".
        ytdShortTermOverride: z.number().nullable().optional(),
        ytdLongTermOverride: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const portfolioKey = input.portfolioId ?? "all";
      // Read-merge-write so an omitted field keeps its stored value instead
      // of risking a NULL write to a NOT NULL rate column.
      const existing = await loadOrCreateTaxProfile(ctx.userId, portfolioKey);
      const merged = {
        federalOrdinaryRatePct: String(
          input.federalOrdinaryRatePct ?? existing.federalOrdinaryRatePct,
        ),
        federalLtcgRatePct: String(input.federalLtcgRatePct ?? existing.federalLtcgRatePct),
        stateOrdinaryRatePct: String(
          input.stateOrdinaryRatePct ?? existing.stateOrdinaryRatePct,
        ),
        stateLtcgRatePct: String(input.stateLtcgRatePct ?? existing.stateLtcgRatePct),
        stateTreatsLtcgAsOrdinary:
          input.stateTreatsLtcgAsOrdinary ?? existing.stateTreatsLtcgAsOrdinary,
        carryforwardShortTerm: String(
          input.carryforwardShortTerm ?? existing.carryforwardShortTerm,
        ),
        carryforwardLongTerm: String(
          input.carryforwardLongTerm ?? existing.carryforwardLongTerm,
        ),
        carryforwardDiscountPct: String(
          input.carryforwardDiscountPct ?? existing.carryforwardDiscountPct,
        ),
        ytdShortTermOverride:
          input.ytdShortTermOverride === undefined
            ? existing.ytdShortTermOverride
            : input.ytdShortTermOverride === null
              ? null
              : String(input.ytdShortTermOverride),
        ytdLongTermOverride:
          input.ytdLongTermOverride === undefined
            ? existing.ytdLongTermOverride
            : input.ytdLongTermOverride === null
              ? null
              : String(input.ytdLongTermOverride),
        updatedAt: new Date(),
      };
      await ctx.db
        .update(schema.taxProfiles)
        .set(merged)
        .where(eq(schema.taxProfiles.id, existing.id));
      await invalidateUserComputations(ctx.userId);
      return computeTaxProfile(ctx.userId, input.portfolioId);
    }),

  lots: protectedProcedure
    .input(scope)
    .query(({ ctx, input }) => computeTaxLotsList(ctx.userId, input.portfolioId)),

  now: protectedProcedure
    .input(scope)
    .query(({ ctx, input }) => computeTaxNow(ctx.userId, input.portfolioId)),

  plan: protectedProcedure
    .input(
      z.object({
        portfolioId: z.uuid().optional(),
        targetProceeds: z.number().positive(),
        doNotSell: z.array(z.string()).max(200).optional(),
        accountId: z.uuid().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      computeTaxPlan(
        ctx.userId,
        input.portfolioId,
        input.targetProceeds,
        input.doNotSell,
        input.accountId,
      ),
    ),

  harvest: protectedProcedure
    .input(
      z.object({
        portfolioId: z.uuid().optional(),
        lossCapUsd: z.number().positive().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      computeTaxHarvest(ctx.userId, input.portfolioId, input.lossCapUsd),
    ),
});
