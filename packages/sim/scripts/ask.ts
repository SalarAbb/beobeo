/**
 * Ask the running app's assistant one question as a persona and print the timing — to check a
 * chat-latency fix without a whole simulated day. The server log has the turn's breakdown
 * (`[chat] snapshot … · first text … · tools: …`).
 *
 * Run: pnpm sim:ask --persona fred "How much tax would I owe if I sold everything?"
 */
import "../src/env";
import { AppClient, APP_URL } from "../src/app/client";

const args = process.argv.slice(2);
const at = args.indexOf("--persona");
const persona = at >= 0 ? args[at + 1] : undefined;
const question = args.filter((_, i) => i !== at && i !== at + 1).join(" ");
if (!persona || !question) {
  console.error('usage: pnpm sim:ask --persona <id> "<question>"');
  process.exit(1);
}

const client = new AppClient(APP_URL);
await client.signIn(`sim+${persona}@beobeo.sim`, `sim-${persona}-pass-0`);
const r = await client.chat(question);
const s = (ms: number | null) => (ms === null ? "never" : `${(ms / 1000).toFixed(1)}s`);
console.log(r.text);
console.log(
  `\nfirst token ${s(r.firstTokenMs)} · total ${s(r.totalMs)} · tools: ${r.tools.join(", ") || "none"}${r.error ? ` · error: ${r.error}` : ""}`,
);
