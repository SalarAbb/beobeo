import { describe, expect, it, vi } from "vitest";
import { AlphaVantageProvider } from "../src/providers/alphavantage";
import { CoinGeckoProvider } from "../src/providers/coingecko";
import { TiingoProvider } from "../src/providers/tiingo";
import { ProviderError } from "../src/types";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("TiingoProvider", () => {
  it("parses daily closes as decimal strings", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse([
        { date: "2024-01-02T00:00:00.000Z", close: 185.64 },
        { date: "2024-01-03T00:00:00.000Z", close: 184.25 },
      ]),
    );
    const provider = new TiingoProvider("key", mockFetch);
    const closes = await provider.getDailyCloses(
      { symbol: "AAPL", class: "stock" },
      "2024-01-01",
      "2024-01-05",
    );
    expect(closes).toEqual([
      { date: "2024-01-02", close: "185.64" },
      { date: "2024-01-03", close: "184.25" },
    ]);
    expect(mockFetch.mock.calls[0]![0]).toContain("tiingo/daily/aapl/prices");
  });

  it("reads cash dividends from the EOD divCash column, ex-dates only", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse([
        { date: "2026-03-12T00:00:00.000Z", divCash: 0 },
        { date: "2026-03-13T00:00:00.000Z", divCash: 0.51 },
        { date: "2026-03-14T00:00:00.000Z" },
      ]),
    );
    const payments = await new TiingoProvider("key", mockFetch).getDividends(
      { symbol: "KO", class: "stock" },
      "2025-10-30",
      "2026-10-30",
    );
    expect(payments).toEqual([{ date: "2026-03-13", amount: "0.51" }]);
    expect(mockFetch.mock.calls[0]![0]).toContain("columns=date,divCash");
  });

  it("maps 429 to RATE_LIMITED", async () => {
    const provider = new TiingoProvider(
      "key",
      vi.fn().mockResolvedValue(jsonResponse({}, 429)),
    );
    await expect(
      provider.getDailyCloses({ symbol: "AAPL", class: "stock" }, "2024-01-01", "2024-01-05"),
    ).rejects.toMatchObject({ kind: "RATE_LIMITED" });
  });

  it("after a 429, fails every call at once for a minute without asking, then asks again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({}, 429))
        .mockResolvedValue(jsonResponse([{ date: "2026-03-13T00:00:00.000Z", divCash: 0.51 }]));
      const provider = new TiingoProvider("key", mockFetch);
      const ko = { symbol: "KO", class: "stock" } as const;
      // A dashboard's burst: one request is refused, the other nine never go out.
      const burst = Array.from({ length: 10 }, () =>
        provider.getDividends(ko, "2025-10-30", "2026-10-30").then(
          () => "ok",
          (e: ProviderError) => e.kind,
        ),
      );
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await Promise.all(burst)).toEqual(Array(10).fill("RATE_LIMITED"));
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // Prices and quotes pause too: the cap is one per key.
      await expect(
        provider.getDailyCloses({ symbol: "AAPL", class: "stock" }, "2024-01-01", "2024-01-05"),
      ).rejects.toMatchObject({ kind: "RATE_LIMITED" });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(TiingoProvider.RATE_LIMIT_PAUSE_MS);
      const after = provider.getDividends(ko, "2025-10-30", "2026-10-30");
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(after).resolves.toEqual([{ date: "2026-03-13", amount: "0.51" }]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("quotes many tickers in one request, skipping ones without a price", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse([
        { ticker: "VTI", last: 377.5, tngoLast: 377.4 },
        { ticker: "BND", last: null, tngoLast: 72.1 },
        { ticker: "XYZ", last: null, tngoLast: null },
      ]),
    );
    const quotes = await new TiingoProvider("key", mockFetch).getIntradayQuotes([
      { symbol: "VTI", class: "etf" },
      { symbol: "BND", class: "etf" },
      { symbol: "XYZ", class: "stock" },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]![0]).toContain("tickers=vti,bnd,xyz");
    expect(quotes).toEqual(new Map([["VTI", "377.5"], ["BND", "72.1"]]));
  });

  it("gives every request a deadline, so a hung call can't hold the throttle", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse([]));
    await new TiingoProvider("key", mockFetch).search("app");
    const init = mockFetch.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false);
  });
});

describe("CoinGeckoProvider", () => {
  it("collapses intraday points to one close per UTC day", async () => {
    const day1 = Date.parse("2024-01-01T10:00:00Z");
    const day1b = Date.parse("2024-01-01T22:00:00Z");
    const day2 = Date.parse("2024-01-02T12:00:00Z");
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        prices: [
          [day1, 42000],
          [day1b, 42500],
          [day2, 43100.5],
        ],
      }),
    );
    const provider = new CoinGeckoProvider(undefined, mockFetch);
    const closes = await provider.getDailyCloses(
      { symbol: "BTC", class: "crypto", providerRef: "bitcoin" },
      "2024-01-01",
      "2024-01-02",
    );
    expect(closes).toEqual([
      { date: "2024-01-01", close: "42500" },
      { date: "2024-01-02", close: "43100.5" },
    ]);
  });

  it("requires a providerRef", async () => {
    const provider = new CoinGeckoProvider(undefined, vi.fn());
    await expect(
      provider.getDailyCloses({ symbol: "BTC", class: "crypto" }, "2024-01-01", "2024-01-02"),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("AlphaVantageProvider", () => {
  it("filters the full series to the requested range", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        "Time Series (Daily)": {
          "2024-01-05": { "4. close": "181.18" },
          "2024-01-02": { "4. close": "185.64" },
          "2023-12-29": { "4. close": "192.53" },
        },
      }),
    );
    const provider = new AlphaVantageProvider("key", mockFetch);
    const closes = await provider.getDailyCloses(
      { symbol: "AAPL", class: "stock" },
      "2024-01-01",
      "2024-01-31",
    );
    expect(closes).toEqual([
      { date: "2024-01-02", close: "185.64" },
      { date: "2024-01-05", close: "181.18" },
    ]);
  });

  it("maps the HTTP-200 rate-limit note to RATE_LIMITED", async () => {
    const provider = new AlphaVantageProvider(
      "key",
      vi.fn().mockResolvedValue(jsonResponse({ Note: "API call frequency exceeded" })),
    );
    await expect(
      provider.getDailyCloses({ symbol: "AAPL", class: "stock" }, "2024-01-01", "2024-01-31"),
    ).rejects.toMatchObject({ kind: "RATE_LIMITED" });
  });
});

describe("CoinbaseExchangeProvider", () => {
  it("parses candles (newest-first) into sorted daily closes", async () => {
    const { CoinbaseExchangeProvider } = await import("../src/providers/coinbase-exchange");
    const day1 = Date.parse("2024-01-01T00:00:00Z") / 1000;
    const day2 = Date.parse("2024-01-02T00:00:00Z") / 1000;
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          [day2, 42650, 44800, 42860.58, 44193.29, 18193.8],
          [day1, 42175.65, 44240.8, 42288.58, 44220.78, 7977.7],
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new CoinbaseExchangeProvider(mockFetch);
    const closes = await provider.getDailyCloses(
      { symbol: "BTC", class: "crypto" },
      "2024-01-01",
      "2024-01-02",
    );
    expect(closes).toEqual([
      { date: "2024-01-01", close: "44220.78" },
      { date: "2024-01-02", close: "44193.29" },
    ]);
    expect(mockFetch.mock.calls[0]![0]).toContain("products/BTC-USD/candles");
  });
});
