import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceProvider } from "../src/types";

// The service imports the db client, which needs DATABASE_URL; live quotes never touch it.
vi.mock("@beobeo/db", () => ({ db: {}, schema: {} }));
const { MarketDataService } = await import("../src/service");

const BTC = { id: "btc", symbol: "BTC", class: "crypto" as const };
const ETH = { id: "eth", symbol: "ETH", class: "crypto" as const };

/** A crypto provider whose quotes resolve only when the test says so. */
function slowProvider() {
  const pending: { symbol: string; resolve: (p: string | null) => void }[] = [];
  const provider = {
    name: "fake",
    getIntradayQuote: vi.fn(
      (a: { symbol: string }) =>
        new Promise<string | null>((resolve) => pending.push({ symbol: a.symbol, resolve })),
    ),
  } as unknown as PriceProvider;
  const answer = async (prices: Record<string, string>) => {
    for (const p of pending.splice(0)) p.resolve(prices[p.symbol] ?? null);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { provider, pending, answer };
}

function service(provider: PriceProvider) {
  const svc = new MarketDataService({} as never, {});
  (svc as unknown as { crypto: PriceProvider[] }).crypto = [provider];
  return svc;
}

/** Resolves to "pending" if `p` hasn't settled within 200ms (well under the
 *  2.5s quote budget, so a read that waits on the provider reads "pending"). */
const settledSoon = <T>(p: Promise<T>) =>
  Promise.race([p, new Promise<"pending">((r) => setTimeout(() => r("pending"), 200))]);

describe("MarketDataService.getLiveQuotes", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 9, 30, 15) }));
  afterEach(() => vi.useRealTimers());

  it("waits for a first quote, then serves it from memory within a minute", async () => {
    const { provider, answer } = slowProvider();
    const svc = service(provider);
    const first = svc.getLiveQuotes([BTC]);
    expect(await settledSoon(first)).toBe("pending");
    await answer({ BTC: "77000" });
    expect((await first).get("btc")).toBe("77000");

    vi.setSystemTime(Date.now() + 30_000);
    expect((await svc.getLiveQuotes([BTC])).get("btc")).toBe("77000");
    expect(provider.getIntradayQuote).toHaveBeenCalledTimes(1);
  });

  it("serves a quote under 10 minutes old at once and refreshes it for the next read", async () => {
    const { provider, answer } = slowProvider();
    const svc = service(provider);
    const first = svc.getLiveQuotes([BTC, ETH]);
    await answer({ BTC: "77000", ETH: "3800" });
    await first;

    vi.setSystemTime(Date.now() + 5 * 60_000);
    const second = await settledSoon(svc.getLiveQuotes([BTC, ETH]));
    expect(second).not.toBe("pending");
    expect(second).toEqual(new Map([["btc", "77000"], ["eth", "3800"]]));
    expect(provider.getIntradayQuote).toHaveBeenCalledTimes(4);

    await answer({ BTC: "76500", ETH: "3790" });
    expect(await svc.getLiveQuotes([BTC, ETH])).toEqual(
      new Map([["btc", "76500"], ["eth", "3790"]]),
    );
    expect(provider.getIntradayQuote).toHaveBeenCalledTimes(4);
  });

  it("waits again once the last quote is over 10 minutes old", async () => {
    const { provider, answer } = slowProvider();
    const svc = service(provider);
    const first = svc.getLiveQuotes([BTC]);
    await answer({ BTC: "77000" });
    await first;

    vi.setSystemTime(Date.now() + 11 * 60_000);
    const late = svc.getLiveQuotes([BTC]);
    expect(await settledSoon(late)).toBe("pending");
    await answer({ BTC: "76000" });
    expect((await late).get("btc")).toBe("76000");
  });

  it("concurrent reads share one provider call per asset", async () => {
    const { provider, answer } = slowProvider();
    const svc = service(provider);
    const a = svc.getLiveQuotes([BTC, ETH]);
    const b = svc.getLiveQuotes([BTC]);
    expect(provider.getIntradayQuote).toHaveBeenCalledTimes(2);
    await answer({ BTC: "77000", ETH: "3800" });
    expect((await a).get("eth")).toBe("3800");
    expect((await b).get("btc")).toBe("77000");
  });
});
