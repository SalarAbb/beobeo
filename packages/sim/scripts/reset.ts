/**
 * Delete every sim user (and, cascading, their accounts/transactions/chats)
 * from the app DB. The journal is KEPT — it's the research record — unless
 * --journal is passed, which also clears policy state and the user registry
 * (feedback/themes history is never touched).
 *
 * Run: pnpm sim:reset [--journal]
 */
import "../src/env";
import { Journal } from "../src/journal";
import { deleteSimUsers } from "../src/store";

const n = await deleteSimUsers();
console.log(`Deleted ${n} sim user(s) (sim+*@beobeo.sim).`);
if (process.argv.includes("--journal")) {
  const j = new Journal();
  j.run("DELETE FROM policy_state");
  j.run("DELETE FROM sim_users");
  console.log("Cleared policy state and sim user registry (history kept).");
}
process.exit(0);
