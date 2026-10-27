import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { DEFAULT_TIMEOUTS, withTimeout } from "./fetch-timeout";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

neonConfig.fetchFunction = withTimeout(fetch, {
  ...DEFAULT_TIMEOUTS,
  onTimeout: ({ attempt, read, ms }) =>
    console.warn(
      `[db] ${read ? "read" : "write"} timed out after ${ms / 1000}s` +
        (read && attempt === 1 ? ", retrying once" : ""),
    ),
});

export const db = drizzle(neon(databaseUrl), { schema });

export type Db = typeof db;
