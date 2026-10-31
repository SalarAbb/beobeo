import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Throttle } from "../src/rate-limit";

/** A call that resolves `ms` after it starts, logging start and end times. */
function job(log: string[], name: string, ms: number) {
  return () => {
    log.push(`${name} start @${Date.now()}`);
    return new Promise<string>((r) =>
      setTimeout(() => {
        log.push(`${name} end @${Date.now()}`);
        r(name);
      }, ms),
    );
  };
}

describe("Throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });
  afterEach(() => vi.useRealTimers());

  it("by default runs one call at a time, the next starting after the last ends and the interval passed", async () => {
    const t = new Throttle(100);
    const log: string[] = [];
    const all = Promise.all([t.run(job(log, "a", 300)), t.run(job(log, "b", 50)), t.run(job(log, "c", 10))]);
    await vi.runAllTimersAsync();
    expect(await all).toEqual(["a", "b", "c"]);
    expect(log).toEqual([
      "a start @10000",
      "a end @10300",
      "b start @10300",
      "b end @10350",
      "c start @10400", // 100ms after b started
      "c end @10410",
    ]);
  });

  it("with concurrency, overlaps calls, keeps them spaced and in order, and never exceeds the limit", async () => {
    const t = new Throttle(100, 2);
    const log: string[] = [];
    const all = Promise.all(["a", "b", "c", "d"].map((n) => t.run(job(log, n, 250))));
    await vi.runAllTimersAsync();
    expect(await all).toEqual(["a", "b", "c", "d"]);
    expect(log).toEqual([
      "a start @10000",
      "b start @10100",
      "a end @10250",
      "c start @10250", // a slot freed; 150ms since b started
      "b end @10350",
      "d start @10350",
      "c end @10500",
      "d end @10600",
    ]);
  });

  it("a failed call frees its slot and doesn't stop the queue", async () => {
    const t = new Throttle(0);
    const failed = t.run(() => Promise.reject(new Error("boom")));
    const next = t.run(async () => "ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
