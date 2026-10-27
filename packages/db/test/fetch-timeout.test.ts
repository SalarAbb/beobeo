import { describe, expect, it } from "vitest";
import { isReadOnlyQuery, withTimeout } from "../src/fetch-timeout";

const select = JSON.stringify({ query: 'select "id" from "accounts" where "user_id" = $1', params: ["u"] });
const insert = JSON.stringify({ query: 'insert into "transactions" values ($1)', params: ["x"] });
const batch = JSON.stringify({ queries: [{ query: "select 1", params: [] }] });

/** A fetch that hangs until aborted for the first `stalls` calls, then answers. */
function stallingFetch(stalls: number) {
  let calls = 0;
  const impl = ((_input: unknown, init?: RequestInit) => {
    calls++;
    if (calls > stalls) return Promise.resolve(new Response("ok"));
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  }) as typeof fetch;
  return { impl, calls: () => calls };
}

const fast = { readMs: 20, writeMs: 20 };

describe("isReadOnlyQuery", () => {
  it("only treats a single SELECT as repeatable", () => {
    expect(isReadOnlyQuery(select)).toBe(true);
    expect(isReadOnlyQuery(JSON.stringify({ query: "  SELECT 1" }))).toBe(true);
    expect(isReadOnlyQuery(insert)).toBe(false);
    expect(isReadOnlyQuery(batch)).toBe(false);
    expect(isReadOnlyQuery("not json")).toBe(false);
    expect(isReadOnlyQuery(undefined)).toBe(false);
  });
});

describe("withTimeout", () => {
  it("retries a stalled read once and returns the retry's answer", async () => {
    const f = stallingFetch(1);
    const timeouts: number[] = [];
    const res = await withTimeout(f.impl, { ...fast, onTimeout: (i) => timeouts.push(i.attempt) })("u", {
      method: "POST",
      body: select,
    });
    expect(await res.text()).toBe("ok");
    expect(f.calls()).toBe(2);
    expect(timeouts).toEqual([1]);
  });

  it("gives up on a read after the second stall", async () => {
    const f = stallingFetch(5);
    await expect(withTimeout(f.impl, fast)("u", { body: select })).rejects.toThrow(/timed out/);
    expect(f.calls()).toBe(2);
  });

  it("never repeats a write or a batch", async () => {
    for (const body of [insert, batch]) {
      const f = stallingFetch(1);
      await expect(withTimeout(f.impl, fast)("u", { body })).rejects.toThrow(/timed out/);
      expect(f.calls()).toBe(1);
    }
  });

  it("passes other failures through untouched, without retrying", async () => {
    let calls = 0;
    const failing = (() => {
      calls++;
      return Promise.reject(new TypeError("fetch failed"));
    }) as typeof fetch;
    await expect(withTimeout(failing, fast)("u", { body: select })).rejects.toThrow("fetch failed");
    expect(calls).toBe(1);
  });
});
