import { z } from "zod";
import { suggestCsvMapping } from "@beobeo/agent";
import { protectedProcedure, router } from "../trpc";

export const importerRouter = router({
  /**
   * AI column-mapping for unrecognized CSV exports (Delta, Schwab, …).
   * Only the header + a few sample rows leave the browser — never the full file.
   */
  suggestMapping: protectedProcedure
    .input(
      z.object({
        headers: z.array(z.string().max(200)).min(2).max(60),
        sampleRows: z.array(z.array(z.string().max(500)).max(60)).min(1).max(10),
      }),
    )
    .mutation(async ({ input }) => {
      const suggestion = await suggestCsvMapping(input);
      return {
        ...suggestion,
        // Arrays → record shape the parser consumes.
        typeMapRecord: Object.fromEntries(
          suggestion.typeMap.map((t) => [t.csvValue.toLowerCase(), t.type]),
        ),
        classMapRecord: Object.fromEntries(
          suggestion.classMap.map((c) => [c.csvValue.toLowerCase(), c.class]),
        ),
      };
    }),
});
