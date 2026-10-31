import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import { debriefSchema } from "../src/app/mission";
import { ratesAtIncome } from "@beobeo/core/tax-brackets";
import { feedbackItem, roughPay } from "../src/mind";
import { loadPersonas } from "../src/persona";

const item = { page: "chat", kind: "bug", area: "perf", severity: 3, themeKey: "x", title: "t", quote: "q" };

describe("feedbackItem", () => {
  it("keeps a listed kind and area", () => {
    expect(feedbackItem.parse(item)).toMatchObject({ kind: "bug", area: "perf" });
  });

  it("reads an unlisted kind or area as a neutral bucket instead of failing", () => {
    expect(feedbackItem.parse({ ...item, kind: "perf", area: "speed" })).toMatchObject({ kind: "friction", area: "ux" });
  });

  // The SDK's output format moves enums into the description, so the model isn't held to them;
  // the list must still be in what it reads.
  it("still shows the model the closed lists", () => {
    const schema = JSON.stringify(zodOutputFormat(debriefSchema));
    for (const word of ["aesthetic", "correctness", "struggled"]) expect(schema).toContain(word);
  });

  it("reads an unlisted debrief status as struggled", () => {
    const debrief = { status: "partial", difficulty: 3, summary: "s", trusted: true, issues: [], touched: [], suggestion: null };
    expect(debriefSchema.parse(debrief).status).toBe("struggled");
  });
});

describe("roughPay", () => {
  it("gives every persona a pay that lands in its own bracket", () => {
    for (const p of loadPersonas()) {
      const r = roughPay(p);
      expect(r, p.id).not.toBeNull();
      const rates = ratesAtIncome(p.tax.filingStatus, r!.taxable);
      expect([p.id, rates.ordinaryRatePct, rates.ltcgRatePct]).toEqual([p.id, p.tax.ordinaryRate, p.tax.ltcgRate]);
    }
  });

  it("puts hermione (married, 32%) at about $490k of pay", () => {
    // 32% band $403,550–$512,450, middle $458,000 + $32,200 deduction = $490,200 → $490,000.
    expect(roughPay(loadPersonas().find((p) => p.id === "hermione")!)).toEqual({ pay: 490_000, taxable: 457_800 });
  });
});
