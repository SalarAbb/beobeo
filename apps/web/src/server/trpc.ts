import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { db } from "@beobeo/db";
import { auth } from "@/lib/auth";

export async function createContext(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  return { db, session };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      userId: ctx.session.user.id,
    },
  });
});
