import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { ConfigService } from "../config.js";
import {
  ExchangeRateService,
  ExchangeRateServiceLive,
  ExchangeRateError,
} from "../services/pretium/exchange-rate-service.js";

// ── Test layer ──────────────────────────────────────────────────────

const TestConfigLayer = Layer.succeed(ConfigService, {
  databaseUrl: "postgres://test:test@localhost:5432/testdb",
  privyAppId: "privy-app-id-test",
  privyAppSecret: "privy-app-secret-test",
  coinmarketcapApiKey: "cmc-api-key-test",
  adminApiKey: "admin-api-key-test",
  defaultChainId: 8453,
  port: 3000,
  pretiumApiKey: "test-pretium-api-key",
  pretiumBaseUri: "https://api.test.pretium",
});

const TestLayer = ExchangeRateServiceLive.pipe(Layer.provide(TestConfigLayer));

const runEffect = <A>(
  effect: Effect.Effect<A, ExchangeRateError, ExchangeRateService>
) => effect.pipe(Effect.provide(TestLayer), Effect.runPromise);

const runEffectExit = <A>(
  effect: Effect.Effect<A, ExchangeRateError, ExchangeRateService>
) => effect.pipe(Effect.provide(TestLayer), Effect.runPromiseExit);

// ── Helpers ─────────────────────────────────────────────────────────

const mockFetchResponse = (body: unknown, status = 200) => {
  const fn = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
  globalThis.fetch = fn;
  return fn;
};

// ── Tests ───────────────────────────────────────────────────────────

describe("ExchangeRateService", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    // Clear the module-level cache before each test
    await runEffect(
      Effect.gen(function* () {
        const svc = yield* ExchangeRateService;
        return yield* svc.clearCache();
      })
    );
  });

  // ── getExchangeRate ─────────────────────────────────────────────

  describe("getExchangeRate", () => {
    it("calls the API and returns formatted exchange rate data", async () => {
      const fetchMock = mockFetchResponse({
        data: {
          buying_rate: 129.5,
          selling_rate: 130.2,
          quoted_rate: 128.8,
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.getExchangeRate("KES");
        })
      );

      expect(result.buyingRate).toBe(129.5);
      expect(result.sellingRate).toBe(130.2);
      expect(result.quotedRate).toBe(128.8);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.test.pretium/v1/exchange-rate");
      expect(init?.method).toBe("POST");

      const body = JSON.parse(init?.body as string);
      expect(body.currency_code).toBe("KES");

      const headers = init?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("test-pretium-api-key");
    });

    it("uses buying_rate as quotedRate when quoted_rate is missing", async () => {
      mockFetchResponse({
        data: {
          buying_rate: 1550.0,
          selling_rate: 1560.0,
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.getExchangeRate("NGN");
        })
      );

      expect(result.quotedRate).toBe(1550.0);
    });

    it("caches results so the second call does not hit the API", async () => {
      const fetchMock = mockFetchResponse({
        data: {
          buying_rate: 129.5,
          selling_rate: 130.2,
          quoted_rate: 128.8,
        },
      });

      // First call -- hits API
      await runEffect(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.getExchangeRate("KES");
        })
      );

      // Second call -- should use cache
      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.getExchangeRate("KES");
        })
      );

      expect(result.buyingRate).toBe(129.5);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("normalizes currency code to uppercase for caching", async () => {
      const fetchMock = mockFetchResponse({
        data: {
          buying_rate: 15.0,
          selling_rate: 15.5,
          quoted_rate: 14.8,
        },
      });

      await runEffect(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.getExchangeRate("ghs");
        })
      );

      // Same currency different case -- should be cached
      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.getExchangeRate("GHS");
        })
      );

      expect(result.quotedRate).toBe(14.8);
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });

  // ── clearCache ──────────────────────────────────────────────────

  describe("clearCache", () => {
    it("clears cached rates so next call hits API again", async () => {
      const fetchMock = mockFetchResponse({
        data: {
          buying_rate: 129.5,
          selling_rate: 130.2,
          quoted_rate: 128.8,
        },
      });

      // First call populates cache
      await runEffect(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.getExchangeRate("KES");
        })
      );

      expect(fetchMock).toHaveBeenCalledOnce();

      // Clear the cache
      await runEffect(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.clearCache();
        })
      );

      // Next call should hit API again
      await runEffect(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.getExchangeRate("KES");
        })
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  // ── convertUsdcToFiat ───────────────────────────────────────────

  describe("convertUsdcToFiat", () => {
    it("calculates fiat amount as usdcAmount * quotedRate rounded to 2 decimals", async () => {
      mockFetchResponse({
        data: {
          buying_rate: 129.5,
          selling_rate: 130.2,
          quoted_rate: 128.75,
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.convertUsdcToFiat(10, "KES");
        })
      );

      // 10 * 128.75 = 1287.50
      expect(result.amount).toBe(1287.5);
      expect(result.exchangeRate).toBe(128.75);
    });

    it("rounds to 2 decimal places correctly", async () => {
      mockFetchResponse({
        data: {
          buying_rate: 1550.33,
          selling_rate: 1560.0,
          quoted_rate: 1550.33,
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.convertUsdcToFiat(3.5, "NGN");
        })
      );

      // 3.5 * 1550.33 = 5426.155 -> rounded to 5426.16
      expect(result.amount).toBe(5426.16);
      expect(result.exchangeRate).toBe(1550.33);
    });
  });

  // ── convertFiatToUsdc ───────────────────────────────────────────

  describe("convertFiatToUsdc", () => {
    it("calculates USDC amount as fiatAmount / quotedRate rounded to 6 decimals", async () => {
      mockFetchResponse({
        data: {
          buying_rate: 129.5,
          selling_rate: 130.2,
          quoted_rate: 128.75,
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.convertFiatToUsdc(1000, "KES");
        })
      );

      // 1000 / 128.75 = 7.766990...
      expect(result.amount).toBe(
        Math.round((1000 / 128.75) * 1e6) / 1e6
      );
      expect(result.exchangeRate).toBe(128.75);
    });

    it("rounds to 6 decimal places correctly", async () => {
      mockFetchResponse({
        data: {
          buying_rate: 1550.33,
          selling_rate: 1560.0,
          quoted_rate: 1550.33,
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.convertFiatToUsdc(5000, "NGN");
        })
      );

      // 5000 / 1550.33 = 3.22512...
      const expected = Math.round((5000 / 1550.33) * 1e6) / 1e6;
      expect(result.amount).toBe(expected);
      expect(result.exchangeRate).toBe(1550.33);
    });
  });

  // ── API error handling ──────────────────────────────────────────

  describe("API error handling", () => {
    it("wraps 401 errors as AUTHENTICATION_FAILED", async () => {
      mockFetchResponse({ message: "Unauthorized" }, 401);

      const exit = await runEffectExit(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.getExchangeRate("KES");
        })
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error;
        expect(error).toBeInstanceOf(ExchangeRateError);
        expect(error.code).toBe("AUTHENTICATION_FAILED");
      }
    });

    it("wraps 400 errors as INVALID_CURRENCY", async () => {
      mockFetchResponse({ message: "Invalid currency code" }, 400);

      const exit = await runEffectExit(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.getExchangeRate("INVALID");
        })
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error;
        expect(error).toBeInstanceOf(ExchangeRateError);
        expect(error.code).toBe("INVALID_CURRENCY");
      }
    });

    it("wraps 500 errors as API_ERROR", async () => {
      mockFetchResponse({ message: "Internal server error" }, 500);

      const exit = await runEffectExit(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.getExchangeRate("KES");
        })
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error;
        expect(error).toBeInstanceOf(ExchangeRateError);
        expect(error.code).toBe("API_ERROR");
      }
    });

    it("wraps network failures as NETWORK_ERROR", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("DNS resolution failed"));

      const exit = await runEffectExit(
        Effect.gen(function* () {
          const svc = yield* ExchangeRateService;
          return yield* svc.getExchangeRate("KES");
        })
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error;
        expect(error).toBeInstanceOf(ExchangeRateError);
        expect(error.code).toBe("NETWORK_ERROR");
      }
    });
  });
});
