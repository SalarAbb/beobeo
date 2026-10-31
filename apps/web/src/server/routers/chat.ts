import { and, asc, desc, eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { schema } from "@beobeo/db";
import { warmContextSnapshot } from "../agent-api";
import { protectedProcedure, router } from "../trpc";

export const chatRouter = router({
  threads: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(schema.chatThreads)
      .where(eq(schema.chatThreads.userId, ctx.userId))
      .orderBy(desc(schema.chatThreads.updatedAt))
      .limit(50),
  ),

  messages: protectedProcedure
    .input(z.object({ threadId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const thread = await ctx.db
        .select({ id: schema.chatThreads.id })
        .from(schema.chatThreads)
        .where(
          and(
            eq(schema.chatThreads.id, input.threadId),
            eq(schema.chatThreads.userId, ctx.userId),
          ),
        );
      if (thread.length === 0) return [];
      return ctx.db
        .select()
        .from(schema.chatMessages)
        .where(eq(schema.chatMessages.threadId, input.threadId))
        .orderBy(asc(schema.chatMessages.createdAt));
    }),

  /**
   * Preload what the next question's snapshot reads (see warmContextSnapshot).
   * Answers at once and keeps working after the response (`after`): nothing
   * waits on the result, and awaiting it held the chat page's network open
   * for the 2.3s a cold snapshot + prompt-cache prime takes.
   */
  warm: protectedProcedure
    .input(z.object({ portfolioId: z.uuid().optional() }))
    .mutation(({ ctx, input }) => {
      after(() => warmContextSnapshot(ctx.userId, input.portfolioId).catch(() => {}));
      return null;
    }),

  removeThread: protectedProcedure
    .input(z.object({ threadId: z.uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.db
        .delete(schema.chatThreads)
        .where(
          and(
            eq(schema.chatThreads.id, input.threadId),
            eq(schema.chatThreads.userId, ctx.userId),
          ),
        ),
    ),
});
