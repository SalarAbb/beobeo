import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/explore-rules";
import { FEATURES, personaTags, pickFeature } from "../src/features";
import { loadPersonas } from "../src/persona";

const personas = loadPersonas();
const byId = (id: string) => personas.find((p) => p.id === id)!;
const neverTried = new Map<string, number>();
const allFresh = new Map(FEATURES.map((f) => [f.id, 0]));

describe("feature catalog", () => {
  it("has unique ids and app routes", () => {
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
    for (const f of FEATURES) expect(f.route.startsWith("/")).toBe(true);
  });
});

describe("personaTags", () => {
  it("derives tags from the profile", () => {
    expect(personaTags(byId("luna")).has("beginner")).toBe(true);
    expect(personaTags(byId("hermione")).has("expert")).toBe(true);
    expect(personaTags(byId("fred")).has("crypto")).toBe(true);
    expect(personaTags(byId("barristan")).has("seller")).toBe(true);
  });
});

describe("pickFeature", () => {
  it("is replayable for the same seed", () => {
    const a = pickFeature(byId("petyr"), neverTried, mulberry32(7)).id;
    const b = pickFeature(byId("petyr"), neverTried, mulberry32(7)).id;
    expect(a).toBe(b);
  });

  it("goes after the blind spot: the one feature never tried wins most draws", () => {
    const lastTried = new Map(allFresh);
    lastTried.delete("tax.profile"); // never tried; everything else tried today
    const rng = mulberry32(42);
    let hits = 0;
    for (let i = 0; i < 400; i++) if (pickFeature(byId("petyr"), lastTried, rng).id === "tax.profile") hits++;
    // weight 15×3 = 45 vs. 1×(3 or 1 or 0.5) for each of the others → well over a third of draws
    expect(hits / 400).toBeGreaterThan(0.35);
  });

  it("favors features that fit the persona, without excluding the rest", () => {
    const rng = mulberry32(3);
    const counts = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const id = pickFeature(byId("luna"), neverTried, rng).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    // Luna is a beginner: next-deposit (fits beginner) beats CSV import (expert-only), but import still happens.
    expect(counts.get("dashboard.next-deposit")!).toBeGreaterThan(counts.get("transactions.import")! * 3);
    expect(counts.get("transactions.import") ?? 0).toBeGreaterThan(0);
  });

  it("never hands out an excluded feature (two personas, two different features)", () => {
    const rng = mulberry32(9);
    const exclude = new Set(FEATURES.map((f) => f.id).filter((id) => id !== "chat.ask"));
    expect(pickFeature(byId("augusta"), neverTried, rng, exclude).id).toBe("chat.ask");
  });
});
