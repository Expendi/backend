import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { ConfigService } from "../config.js";
import {
  PretiumService,
  PretiumServiceLive,
  PretiumError,
  SETTLEMENT_ADDRESS,
  VALIDATION_SUPPORTED_COUNTRIES,
  BANK_VALIDATION_SUPPORTED_COUNTRIES,
} from "../services/pretium/pretium-service.js";

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

const TestLayer = PretiumServiceLive.pipe(Layer.provide(TestConfigLayer));

const runEffect = <A>(effect: Effect.Effect<A, PretiumError, PretiumService>) =>
  effect.pipe(Effect.provide(TestLayer), Effect.runPromise);

const runEffectExit = <A>(
  effect: Effect.Effect<A, PretiumError, PretiumService>
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

describe("PretiumService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── isCountrySupported ──────────────────────────────────────────

  describe("isCountrySupported", () => {
    it("returns true for all supported countries", async () => {
      const countries = ["KE", "NG", "GH", "UG", "CD", "MW", "ET"];
      for (const code of countries) {
        const result = await runEffect(
          Effect.gen(function* () {
            const svc = yield* PretiumService;
            return svc.isCountrySupported(code);
          })
        );
        expect(result).toBe(true);
      }
    });

    it("returns false for unsupported countries", async () => {
      const unsupported = ["US", "GB", "ZA", "FR", "", "XX"];
      for (const code of unsupported) {
        const result = await runEffect(
          Effect.gen(function* () {
            const svc = yield* PretiumService;
            return svc.isCountrySupported(code);
          })
        );
        expect(result).toBe(false);
      }
    });
  });

  // ── getSupportedCountries ───────────────────────────────────────

  describe("getSupportedCountries", () => {
    it("returns all 7 supported countries", async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return svc.getSupportedCountries();
        })
      );
      const keys = Object.keys(result);
      expect(keys).toHaveLength(7);
      expect(keys).toEqual(
        expect.arrayContaining(["KE", "NG", "GH", "UG", "CD", "MW", "ET"])
      );
    });

    it("each country has currency, endpoint, and name", async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return svc.getSupportedCountries();
        })
      );
      for (const [, config] of Object.entries(result)) {
        expect(config).toHaveProperty("currency");
        expect(config).toHaveProperty("endpoint");
        expect(config).toHaveProperty("name");
        expect(config.endpoint).toMatch(/^\/v1\/pay\//);
      }
    });
  });

  // ── getSettlementAddress ────────────────────────────────────────

  describe("getSettlementAddress", () => {
    it("returns the correct settlement address", async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return svc.getSettlementAddress();
        })
      );
      expect(result).toBe(SETTLEMENT_ADDRESS);
      expect(result).toBe("0x8005ee53E57aB11E11eAA4EFe07Ee3835Dc02F98");
    });
  });

  // ── getCountryPaymentConfig ─────────────────────────────────────

  describe("getCountryPaymentConfig", () => {
    it("returns config with 4 payment types for Kenya", async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return svc.getCountryPaymentConfig("KE");
        })
      );
      expect(result).toBeDefined();
      expect(result!.paymentTypes).toHaveLength(4);
      expect(result!.paymentTypes).toEqual([
        "MOBILE",
        "BUY_GOODS",
        "PAYBILL",
        "BANK_TRANSFER",
      ]);
    });

    it("returns config with 1 payment type for Nigeria", async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return svc.getCountryPaymentConfig("NG");
        })
      );
      expect(result).toBeDefined();
      expect(result!.paymentTypes).toHaveLength(1);
      expect(result!.paymentTypes).toEqual(["BANK_TRANSFER"]);
    });

    it("returns config with 1 MOBILE payment type for Ghana", async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return svc.getCountryPaymentConfig("GH");
        })
      );
      expect(result).toBeDefined();
      expect(result!.paymentTypes).toHaveLength(1);
      expect(result!.paymentTypes).toEqual(["MOBILE"]);
    });

    it("returns undefined for unsupported countries", async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return svc.getCountryPaymentConfig("US");
        })
      );
      expect(result).toBeUndefined();
    });
  });

  // ── disburse ────────────────────────────────────────────────────

  describe("disburse", () => {
    it("rejects unsupported countries with PretiumError", async () => {
      const exit = await runEffectExit(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.disburse({
            country: "US" as any,
            amount: 1000,
            phoneNumber: "254700000000",
            mobileNetwork: "safaricom",
            transactionHash: "0xabc123def456",
          });
        })
      );
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const error = exit.cause as any;
        const pretiumError = error.error ?? error._tag;
        expect(pretiumError).toBeInstanceOf(PretiumError);
        expect(pretiumError.code).toBe("UNSUPPORTED_COUNTRY");
      }
    });

    it("rejects unsupported networks with PretiumError", async () => {
      const exit = await runEffectExit(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.disburse({
            country: "KE",
            amount: 1000,
            phoneNumber: "254700000000",
            mobileNetwork: "t-mobile",
            transactionHash: "0xabc123def456",
          });
        })
      );
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error;
        expect(error).toBeInstanceOf(PretiumError);
        expect(error.code).toBe("UNSUPPORTED_NETWORK");
      }
    });

    it("builds correct request body for Kenya MOBILE and calls API", async () => {
      const fetchMock = mockFetchResponse({
        code: 200,
        message: "Success",
        data: {
          status: "PENDING",
          transaction_code: "TXN-KE-001",
          message: "Payment initiated",
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.disburse({
            country: "KE",
            amount: 5000,
            phoneNumber: "254712345678",
            mobileNetwork: "safaricom",
            transactionHash: "0xabc123",
            paymentType: "MOBILE",
          });
        })
      );

      expect(result.data.transaction_code).toBe("TXN-KE-001");
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.test.pretium/v1/pay/KES");
      expect(init?.method).toBe("POST");

      const body = JSON.parse(init?.body as string);
      expect(body.type).toBe("MOBILE");
      expect(body.mobile_network).toBe("Safaricom");
      expect(body.shortcode).toBe("254712345678");
      expect(body.amount).toBe(5000);
      expect(body.chain).toBe("BASE");
      expect(body.transaction_hash).toBe("0xabc123");
    });

    it("builds correct request body for Kenya BANK_TRANSFER", async () => {
      const fetchMock = mockFetchResponse({
        code: 200,
        message: "Success",
        data: {
          status: "PENDING",
          transaction_code: "TXN-KE-BNK-001",
          message: "Bank transfer initiated",
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.disburse({
            country: "KE",
            amount: 25000,
            phoneNumber: "254712345678",
            mobileNetwork: "",
            transactionHash: "0xdef456",
            paymentType: "BANK_TRANSFER",
            accountNumber_bank: "1234567890",
            bankCode: "01",
          });
        })
      );

      expect(result.data.transaction_code).toBe("TXN-KE-BNK-001");

      const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string);
      expect(body.type).toBe("BANK_TRANSFER");
      expect(body.account_number).toBe("1234567890");
      expect(body.bank_code).toBe("01");
      expect(body.amount).toBe(25000);
      expect(body.chain).toBe("BASE");
      expect(body).not.toHaveProperty("shortcode");
    });

    it("builds correct request body for Nigeria (bank transfer)", async () => {
      const fetchMock = mockFetchResponse({
        code: 200,
        message: "Success",
        data: {
          status: "PENDING",
          transaction_code: "TXN-NG-001",
          message: "Bank transfer initiated",
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.disburse({
            country: "NG",
            amount: 150000,
            phoneNumber: "",
            mobileNetwork: "",
            transactionHash: "0x789abc",
            accountName: "John Adeyemi",
            accountNumber_bank: "0123456789",
            bankName: "Access Bank",
            bankCode: "044",
          });
        })
      );

      expect(result.data.transaction_code).toBe("TXN-NG-001");

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.test.pretium/v1/pay/NGN");

      const body = JSON.parse(init?.body as string);
      expect(body.type).toBe("BANK_TRANSFER");
      expect(body.account_name).toBe("John Adeyemi");
      expect(body.account_number).toBe("0123456789");
      expect(body.bank_name).toBe("Access Bank");
      expect(body.bank_code).toBe("044");
      expect(body.amount).toBe(150000);
    });

    it("builds correct request body for Ghana", async () => {
      const fetchMock = mockFetchResponse({
        code: 200,
        message: "Success",
        data: {
          status: "PENDING",
          transaction_code: "TXN-GH-001",
          message: "Payment initiated",
        },
      });

      await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.disburse({
            country: "GH",
            amount: 500,
            phoneNumber: "233241234567",
            mobileNetwork: "mtn",
            transactionHash: "0xgha123",
            accountName: "Kwame Asante",
          });
        })
      );

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.test.pretium/v1/pay/GHS");

      const body = JSON.parse(init?.body as string);
      expect(body.shortcode).toBe("233241234567");
      expect(body.mobile_network).toBe("MTN");
      expect(body.account_name).toBe("Kwame Asante");
      expect(body.amount).toBe(500);
    });

    it("builds correct request body for Uganda", async () => {
      const fetchMock = mockFetchResponse({
        code: 200,
        message: "Success",
        data: {
          status: "PENDING",
          transaction_code: "TXN-UG-001",
          message: "Payment initiated",
        },
      });

      await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.disburse({
            country: "UG",
            amount: 200000,
            phoneNumber: "256771234567",
            mobileNetwork: "mtn",
            transactionHash: "0xuga123",
          });
        })
      );

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.test.pretium/v1/pay/UGX");

      const body = JSON.parse(init?.body as string);
      expect(body.shortcode).toBe("256771234567");
      expect(body.mobile_network).toBe("MTN");
      expect(body.amount).toBe(200000);
    });
  });

  // ── getTransactionStatus ────────────────────────────────────────

  describe("getTransactionStatus", () => {
    it("returns transaction status from API", async () => {
      mockFetchResponse({
        code: 200,
        message: "Success",
        data: {
          transaction_code: "TXN-KE-001",
          status: "COMPLETED",
          amount: "5000",
          currency_code: "KES",
          shortcode: "254712345678",
          receipt_number: "RCP123456",
          created_at: "2025-12-01T10:00:00Z",
          completed_at: "2025-12-01T10:01:00Z",
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.getTransactionStatus("TXN-KE-001", "KES");
        })
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("COMPLETED");
      expect(result.receiptNumber).toBe("RCP123456");
      expect(result.completedAt).toBe("2025-12-01T10:01:00Z");
    });

    it("normalizes COMPLETE status to COMPLETED", async () => {
      mockFetchResponse({
        code: 200,
        message: "Success",
        data: {
          transaction_code: "TXN-NG-002",
          status: "COMPLETE",
          amount: "50000",
          currency_code: "NGN",
          created_at: "2025-12-01T10:00:00Z",
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.getTransactionStatus("TXN-NG-002", "NGN");
        })
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("COMPLETED");
    });

    it("returns failure when transaction data is null", async () => {
      mockFetchResponse({
        code: 200,
        message: "Not found",
        data: null,
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.getTransactionStatus("TXN-UNKNOWN", "KES");
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TRANSACTION_NOT_FOUND");
    });
  });

  // ── validatePhoneWithMno ────────────────────────────────────────

  describe("validatePhoneWithMno", () => {
    it("rejects unsupported countries like NG", async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.validatePhoneWithMno("NG", "2348012345678", "mtn");
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("UNSUPPORTED_COUNTRY");
      expect(result.error?.message).toContain("NG");
      expect(result.error?.message).toContain(
        VALIDATION_SUPPORTED_COUNTRIES.join(", ")
      );
    });

    it("returns validated name on success for Kenya", async () => {
      mockFetchResponse({
        code: 200,
        message: "Success",
        data: {
          status: "COMPLETE",
          shortcode: "254712345678",
          public_name: "JAMES MWANGI",
          mobile_network: "Safaricom",
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.validatePhoneWithMno(
            "KE",
            "254712345678",
            "safaricom"
          );
        })
      );

      expect(result.success).toBe(true);
      expect(result.validatedName).toBe("JAMES MWANGI");
    });

    it("returns failure when no public_name is found", async () => {
      mockFetchResponse({
        code: 200,
        message: "Success",
        data: {
          status: "NOT_FOUND",
          shortcode: "254799999999",
          mobile_network: "Safaricom",
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.validatePhoneWithMno(
            "KE",
            "254799999999",
            "safaricom"
          );
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NAME_NOT_FOUND");
    });
  });

  // ── validateBankAccount ─────────────────────────────────────────

  describe("validateBankAccount", () => {
    it("rejects unsupported countries like KE", async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.validateBankAccount("KE", "1234567890", "01");
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("UNSUPPORTED_COUNTRY");
      expect(result.error?.message).toContain("KE");
      expect(result.error?.message).toContain(
        BANK_VALIDATION_SUPPORTED_COUNTRIES.join(", ")
      );
    });

    it("returns validated bank account for Nigeria", async () => {
      mockFetchResponse({
        code: 200,
        message: "Success",
        data: {
          status: "COMPLETE",
          account_name: "ADEYEMI JOHN",
          account_number: "0123456789",
          bank_name: "Access Bank",
          bank_code: "044",
        },
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.validateBankAccount("NG", "0123456789", "044");
        })
      );

      expect(result.success).toBe(true);
      expect(result.accountName).toBe("ADEYEMI JOHN");
      expect(result.bankName).toBe("Access Bank");
    });
  });

  // ── getBanksForCountry ──────────────────────────────────────────

  describe("getBanksForCountry", () => {
    it("fetches bank list from API for Nigeria", async () => {
      const banks = [
        { Code: "044", Name: "Access Bank" },
        { Code: "023", Name: "Citibank" },
        { Code: "050", Name: "Ecobank" },
      ];

      mockFetchResponse({
        code: 200,
        message: "Success",
        data: banks,
      });

      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.getBanksForCountry("NG");
        })
      );

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ Code: "044", Name: "Access Bank" });
    });

    it("sends correct request to the API", async () => {
      const fetchMock = mockFetchResponse({
        code: 200,
        message: "Success",
        data: [],
      });

      await runEffect(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.getBanksForCountry("KE");
        })
      );

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.test.pretium/v1/banks/KES");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("test-pretium-api-key");
    });
  });

  // ── API error handling ──────────────────────────────────────────

  describe("API error handling", () => {
    it("wraps 401 errors as AUTHENTICATION_FAILED", async () => {
      mockFetchResponse({ message: "Unauthorized" }, 401);

      const exit = await runEffectExit(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.getBanksForCountry("NG");
        })
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error;
        expect(error).toBeInstanceOf(PretiumError);
        expect(error.code).toBe("AUTHENTICATION_FAILED");
      }
    });

    it("wraps 400 errors as VALIDATION_ERROR", async () => {
      mockFetchResponse({ message: "Invalid parameters" }, 400);

      const exit = await runEffectExit(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.getBanksForCountry("NG");
        })
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error;
        expect(error).toBeInstanceOf(PretiumError);
        expect(error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("wraps network failures as NETWORK_ERROR", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("Connection refused"));

      const exit = await runEffectExit(
        Effect.gen(function* () {
          const svc = yield* PretiumService;
          return yield* svc.getBanksForCountry("NG");
        })
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error;
        expect(error).toBeInstanceOf(PretiumError);
        expect(error.code).toBe("NETWORK_ERROR");
      }
    });
  });
});
