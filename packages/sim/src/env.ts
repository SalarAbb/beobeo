/**
 * Side-effect module: load the repo-root .env. Import it FIRST in every
 * script — ES modules evaluate imports in order, so anything imported after
 * this (e.g. @beobeo/db, which reads DATABASE_URL at load) sees the env.
 */
import { config } from "dotenv";

config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });
