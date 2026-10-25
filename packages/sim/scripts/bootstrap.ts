/**
 * Give every persona a realistic history: replay their deterministic habits
 * day by day from `joinedOn` through yesterday against REAL closes, and write
 * the resulting trades straight into the DB (policy only — no LLM, ~free).
 * Destructive for sim users only: each persona's account is recreated.
 *
 * Run: pnpm sim:bootstrap [persona-id ...]
 */
import "../src/env";
import { Journal } from "../src/journal";
import { loadPersonas, qtyDecimals, simEmail, simPassword } from "../src/persona";
import { emptyPolicyState } from "../src/policy";
import { Holdings } from "../src/holdings";
import { gitInfo, replayPolicy, savePolicyState } from "../src/run";
import { ensureAssets, insertTxns, loadPriceBook, recreateSimUser } from "../src/store";
import { addDays, todayIso } from "../src/world";

const only = new Set(process.argv.slice(2));
const journal = new Journal();
const yesterday = addDays(todayIso(), -1);
const runId = journal.startRun("bootstrap", { simDate: yesterday, ...gitInfo() });

let failures = 0;
for (const persona of loadPersonas()) {
  if (only.size > 0 && !only.has(persona.id)) continue;
  process.stdout.write(`${persona.id.padEnd(16)} `);
  try {
    journal.recordPersona(persona.id, persona.version, persona);
    const email = simEmail(persona.id);
    const sim = await recreateSimUser(persona, email, simPassword(persona.id));
    journal.run(
      "INSERT INTO sim_users (email, persona_id, user_id, kind) VALUES (?, ?, ?, 'persona') ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id",
      email,
      persona.id,
      sim.userId,
    );
    const assets = await ensureAssets(persona.universe);
    const book = await loadPriceBook([...assets.values()], addDays(persona.joinedOn, -400), yesterday);
    const missing = persona.universe.filter((i) => !book.closeAsOf(i.symbol, yesterday)).map((i) => i.symbol);

    const state = emptyPolicyState();
    const fills = replayPolicy(persona, new Holdings(qtyDecimals(persona)), book, state, addDays(persona.joinedOn, -1), yesterday);
    await insertTxns(
      sim.userId,
      fills.map((f) => ({
        accountId: sim.accounts.get(f.account)!,
        assetId: assets.get(f.symbol)!.id,
        type: f.type,
        qty: f.qty,
        price: f.price,
        // Evening UTC on the trade date — after the US close, same calendar day.
        tradedAt: new Date(`${f.date}T20:00:00Z`),
        note: `sim:${f.reason}`,
        isCrypto: assets.get(f.symbol)!.class === "crypto",
      })),
    );
    savePolicyState(journal, persona.id, state, yesterday);
    journal.action({
      runId,
      personaId: persona.id,
      simDate: yesterday,
      kind: "bootstrap",
      detail: { trades: fills.length, from: persona.joinedOn, missingPrices: missing },
      ok: missing.length === 0,
      error: missing.length ? `no prices for ${missing.join(",")}` : undefined,
    });
    console.log(`${fills.length} trades since ${persona.joinedOn}${missing.length ? `  ⚠ no prices: ${missing.join(", ")}` : ""}`);
  } catch (e) {
    failures++;
    console.log(`FAILED: ${(e as Error).message}`);
    journal.action({ runId, personaId: persona.id, simDate: yesterday, kind: "bootstrap", detail: {}, ok: false, error: (e as Error).message });
  }
}
journal.finishRun(runId, failures ? "partial" : "ok");
process.exit(failures ? 1 : 0);
