import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect, Layer } from "effect";
import {
  AdapterService,
  AdapterError,
} from "../../../services/adapters/adapter-service.js";
import { CoinMarketCapAdapterLive } from "../../../services/adapters/coinmarketcap.js";
import { ConfigService } from "../../../config.js";

const MockConfigLayer = Layer.succeed(ConfigService, {
  databaseUrl: "postgres://localhost/test",
  privyAppId: "test-app-id",
  privyAppSecret: "test-secret",
  coinmarketcapApiKey: "test-cmc-key",
  port: 3000,
});

const testLayer = CoinMarketCapAdapterLive.pipe(
  Layer.provide(MockConfigLayer)
);

function makeCmcResponse(data: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: vi.fn().mockResolvedValue({ data }),
  };
}

function makeCmcQuoteEntry(symbol: string, price: number) {
  return {
    symbol,
    quote: {
      USD: {
        price,
        percent_change_24h: 2.5,
        market_cap: 360000000000,
        volume_24h: 15000000000,
        last_updated: "2025-01-15T12:00:00Z",
      },
    },
  };
}

describe("CoinMarketCapAdapter", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("getPrice", () => {
    it("should fetch price data for a single symbol", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        makeCmcResponse({
          ETH: makeCmcQuoteEntry("ETH", 3000),
        })
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AdapterService;
          return yield* adapter.getPrice("ETH");
        }).pipe(Effect.provide(testLayer))
      );

      expect(result.symbol).toBe("ETH");
      expect(result.price).toBe(3000);
      expect(result.percentChange24h).toBe(2.5);
      expect(result.marketCap).toBe(360000000000);
      expect(result.volume24h).toBe(15000000000);
      expect(result.lastUpdated).toBe("2025-01-15T12:00:00Z");
    });

    it("should pass the API key in request headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeCmcResponse({
          BTC: makeCmcQuoteEntry("BTC", 42000),
        })
      );
      globalThis.fetch = mockFetch;

      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AdapterService;
          return yield* adapter.getPrice("BTC");
        }).pipe(Effect.provide(testLayer))
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("symbol=BTC"),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-CMC_PRO_API_KEY": "test-cmc-key",
          }),
        })
      );
    });

    it("should fail with AdapterError when symbol not found in response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        makeCmcResponse({
          // No ETH entry
        })
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AdapterService;
          return yield* adapter.getPrice("ETH").pipe(
            Effect.matchEffect({
              onSuccess: (r) => Effect.succeed({ tag: "ok" as const, r }),
              onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
            })
          );
        }).pipe(Effect.provide(testLayer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(AdapterError);
        expect((result.e as AdapterError).message).toContain("No price data found for ETH");
      }
    });

    it("should fail with AdapterError when API returns non-OK response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: vi.fn(),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AdapterService;
          return yield* adapter.getPrice("ETH").pipe(
            Effect.matchEffect({
              onSuccess: (r) => Effect.succeed({ tag: "ok" as const, r }),
              onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
            })
          );
        }).pipe(Effect.provide(testLayer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(AdapterError);
        expect((result.e as AdapterError).source).toBe("coinmarketcap");
      }
    });

    it("should fail with AdapterError when fetch throws a network error", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("Network unreachable"));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AdapterService;
          return yield* adapter.getPrice("ETH").pipe(
            Effect.matchEffect({
              onSuccess: (r) => Effect.succeed({ tag: "ok" as const, r }),
              onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
            })
          );
        }).pipe(Effect.provide(testLayer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(AdapterError);
        expect((result.e as AdapterError).message).toContain("Network unreachable");
      }
    });

    it("should handle case-insensitive symbol lookup", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        makeCmcResponse({
          ETH: makeCmcQuoteEntry("ETH", 3000),
        })
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AdapterService;
          return yield* adapter.getPrice("eth"); // lowercase
        }).pipe(Effect.provide(testLayer))
      );

      // The mapQuoteToPrice uses symbol.toUpperCase() to lookup
      expect(result.symbol).toBe("ETH");
    });
  });

  describe("getPrices", () => {
    it("should fetch prices for multiple symbols", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        makeCmcResponse({
          BTC: makeCmcQuoteEntry("BTC", 42000),
          ETH: makeCmcQuoteEntry("ETH", 3000),
        })
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AdapterService;
          return yield* adapter.getPrices(["BTC", "ETH"]);
        }).pipe(Effect.provide(testLayer))
      );

      expect(result).toHaveLength(2);
      const symbols = result.map((p) => p.symbol);
      expect(symbols).toContain("BTC");
      expect(symbols).toContain("ETH");
    });

    it("should return only found symbols (skip missing ones)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        makeCmcResponse({
          BTC: makeCmcQuoteEntry("BTC", 42000),
          // DOGE not in response
        })
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AdapterService;
          return yield* adapter.getPrices(["BTC", "DOGE"]);
        }).pipe(Effect.provide(testLayer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.symbol).toBe("BTC");
    });

    it("should return empty array when no symbols found", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(makeCmcResponse({}));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AdapterService;
          return yield* adapter.getPrices(["FAKE1", "FAKE2"]);
        }).pipe(Effect.provide(testLayer))
      );

      expect(result).toEqual([]);
    });

    it("should join symbols with comma in the API URL", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeCmcResponse({
          BTC: makeCmcQuoteEntry("BTC", 42000),
          ETH: makeCmcQuoteEntry("ETH", 3000),
        })
      );
      globalThis.fetch = mockFetch;

      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AdapterService;
          return yield* adapter.getPrices(["BTC", "ETH"]);
        }).pipe(Effect.provide(testLayer))
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("symbol=BTC,ETH"),
        expect.any(Object)
      );
    });
  });
});
