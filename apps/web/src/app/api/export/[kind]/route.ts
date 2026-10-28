import { z } from "zod";
import { toIsoDate } from "@beobeo/core";
import { auth } from "@/lib/auth";
import { buildExport, EXPORT_KINDS } from "@/server/export";

const FILE: Record<(typeof EXPORT_KINDS)[number], string> = {
  transactions: "transactions",
  realized: "realized-gains",
  lots: "open-purchases",
};

/** GET /api/export/<transactions|realized|lots>[?portfolio=<id>] → a CSV
 *  download of the signed-in user's data (Transactions → Export). */
export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const kind = z.enum(EXPORT_KINDS).safeParse((await ctx.params).kind);
  const portfolio = z.uuid().optional().safeParse(
    new URL(req.url).searchParams.get("portfolio") ?? undefined,
  );
  if (!kind.success || !portfolio.success) return new Response("Not found", { status: 404 });

  const body = await buildExport(session.user.id, kind.data, portfolio.data);
  const name = `beobeo-${FILE[kind.data]}-${toIsoDate(new Date())}.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
