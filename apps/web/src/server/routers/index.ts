import { publicProcedure, router } from "../trpc";
import { accountsRouter } from "./accounts";
import { assetsRouter } from "./assets";
import { chatRouter } from "./chat";
import { compareRouter } from "./compare";
import { importerRouter } from "./importer";
import { portfolioRouter } from "./portfolio";
import { portfoliosRouter } from "./portfolios";
import { taxRouter } from "./tax";
import { transactionsRouter } from "./transactions";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),
  accounts: accountsRouter,
  assets: assetsRouter,
  transactions: transactionsRouter,
  portfolio: portfolioRouter,
  portfolios: portfoliosRouter,
  compare: compareRouter,
  importer: importerRouter,
  tax: taxRouter,
  chat: chatRouter,
});

export type AppRouter = typeof appRouter;
