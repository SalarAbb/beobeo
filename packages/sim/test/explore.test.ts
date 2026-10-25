import { describe, expect, it } from "vitest";
import { exploreProfile, isSafeTarget, mulberry32, pickWeighted, routeKey, seedFrom } from "../src/explore-rules";
import { persona } from "./fixtures";

const t = (name: string, o: Partial<{ role: string | null; href: string | null; tag: string }> = {}) => ({ name, role: null, href: null, tag: "button", ...o });

describe("isSafeTarget — exploration never changes persona data", () => {
  it.each(["Delete", "Remove transaction", "Save", "Save transaction", "Sign out", "Send", "Create portfolio", "Import CSV", "New portfolio"])(
    "blocks %s",
    (name) => expect(isSafeTarget(t(name))).toBe(false),
  );
  it("blocks suggested chat prompts (clicking one sends a paid assistant turn)", () => {
    expect(isSafeTarget(t("What were my realized gains last year?"))).toBe(false);
  });
  it("blocks unlabeled buttons (an unlabeled trash icon deletes a transaction with no confirmation)", () => {
    expect(isSafeTarget(t(""))).toBe(false);
  });
  it("blocks instant-save selects and external / auth links", () => {
    expect(isSafeTarget(t("Taxable", { role: "combobox" }))).toBe(false);
    expect(isSafeTarget(t("Docs", { tag: "a", href: "https://example.com" }))).toBe(false);
    expect(isSafeTarget(t("Sign in", { tag: "a", href: "/signin" }))).toBe(false);
  });
  it("allows navigation, tabs and dialogs that only look", () => {
    expect(isSafeTarget(t("Tax Center", { tag: "a", href: "/tax-center" }))).toBe(true);
    expect(isSafeTarget(t("Harvest Losses", { role: "tab" }))).toBe(true);
    expect(isSafeTarget(t("Add transaction"))).toBe(true);
    expect(isSafeTarget(t("1M"))).toBe(true);
  });
});

describe("seeded randomness", () => {
  it("replays the same session for the same persona and day", () => {
    const a = mulberry32(seedFrom("hermione:2026-10-24"));
    const b = mulberry32(seedFrom("hermione:2026-10-24"));
    const c = mulberry32(seedFrom("hermione:2026-10-25"));
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
  it("pickWeighted follows the weights and never picks zero-weight items", () => {
    const rng = mulberry32(42);
    const counts = { a: 0, b: 0, z: 0 };
    for (let i = 0; i < 4000; i++) counts[pickWeighted(rng, [{ item: "a" as const, weight: 3 }, { item: "b" as const, weight: 1 }, { item: "z" as const, weight: 0 }])!]++;
    expect(counts.z).toBe(0);
    expect(counts.a / counts.b).toBeGreaterThan(2.5);
    expect(counts.a / counts.b).toBeLessThan(3.5);
  });
});

describe("profiles and routes", () => {
  it("derives curiosity from tech comfort when a persona has no explore config", () => {
    const p = persona([]);
    expect(exploreProfile(p)).toMatchObject({ chance: 0.6, steps: 10 });
  });
  it("groups position pages by route, not asset id", () => {
    expect(routeKey("/positions/9f2c1a7e-1b2c-4d5e-8f90-1234567890ab")).toBe("/positions/:id");
    expect(routeKey("/dashboard/")).toBe("/dashboard");
  });
});
