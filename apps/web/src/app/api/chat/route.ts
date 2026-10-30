import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@beobeo/db";
import { runPortfolioAgentTurn } from "@beobeo/agent";
import { makePortfolioApi } from "@/server/agent-api";
import { auth } from "@/lib/auth";

export const maxDuration = 120;

const bodySchema = z.object({
  threadId: z.uuid().optional(),
  message: z.string().min(1).max(4000),
  portfolioId: z.uuid().optional(),
});

/**
 * One conversational turn, streamed as SSE:
 *   event lines: {"type":"thread","value":<threadId>} | {"type":"text","value":<delta>}
 *              | {"type":"tool","value":<name>} | {"type":"done"} | {"type":"error","value":<msg>}
 */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const { message } = parsed.data;

  // The snapshot is the model's first input; start it now so it loads while
  // the thread is found and the question saved, not after.
  const api = makePortfolioApi(userId, parsed.data.portfolioId);
  void api.getContextSnapshot().catch(() => {});

  // Find or create the thread (scoped to this user), reading prior turns in
  // the same breath when it already exists.
  let threadId = parsed.data.threadId ?? null;
  let history: (typeof schema.chatMessages.$inferSelect)[] = [];
  if (threadId) {
    const [rows, prior] = await Promise.all([
      db
        .select({ id: schema.chatThreads.id })
        .from(schema.chatThreads)
        .where(
          and(eq(schema.chatThreads.id, threadId), eq(schema.chatThreads.userId, userId)),
        ),
      // Text-only persistence keeps replay simple and cacheable.
      db
        .select()
        .from(schema.chatMessages)
        .where(eq(schema.chatMessages.threadId, threadId))
        .orderBy(asc(schema.chatMessages.createdAt)),
    ]);
    if (rows.length === 0) return new Response("Not found", { status: 404 });
    history = prior;
  } else {
    const [thread] = await db
      .insert(schema.chatThreads)
      .values({ userId, title: message.slice(0, 80) })
      .returning();
    threadId = thread!.id;
  }

  await db.insert(schema.chatMessages).values({
    threadId,
    role: "user",
    content: { text: message },
  });

  const messages = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: (m.content as { text: string }).text,
    })),
    { role: "user" as const, content: message },
  ];

  const encoder = new TextEncoder();
  const finalThreadId = threadId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      send({ type: "thread", value: finalThreadId });

      try {
        const { finalText } = await runPortfolioAgentTurn({
          api,
          messages,
          onEvent: (event) => send(event),
          // Where the time went; latency is a principle, so every turn says.
          onTimings: (t) => {
            const tools = t.tools.map((x) => `${x.name} ${x.ms}ms`).join(", ");
            const calls = t.modelMs
              .map((ms, i) => {
                const stop = t.modelStops[i];
                return stop
                  ? `${ms}ms (${stop.stopReason}, ${stop.outputTokens} tok, in ${stop.inputTokens} + cached ${stop.cacheReadTokens} + written ${stop.cacheWriteTokens})`
                  : `${ms}ms`;
              })
              .join(" + ");
            console.info(
              `[chat] snapshot ${t.snapshotMs ?? "-"}ms · first text ${t.firstTextMs ?? "-"}ms · total ${t.totalMs}ms · model calls ${calls || "none"} · tools: ${tools || "none"}`,
            );
          },
        });

        await db.insert(schema.chatMessages).values({
          threadId: finalThreadId,
          role: "assistant",
          content: { text: finalText },
        });
        await db
          .update(schema.chatThreads)
          .set({ updatedAt: new Date() })
          .where(eq(schema.chatThreads.id, finalThreadId));
      } catch (err) {
        send({ type: "error", value: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
