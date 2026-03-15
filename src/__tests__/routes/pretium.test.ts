import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { getTableName } from "drizzle-orm";
import {
  createPretiumRoutes,
  createPretiumWebhookRoutes,
} from "../../routes/pretium.js";
import {
  PretiumService,
  SUPPORTED_COUNTRIES,
  COUNTRY_PAYMENT_CONFIG,
  ONRAMP_SUPPORTED_COUNTRIES,
  ONRAMP_SUPPORTED_ASSETS,
  SETTLEMENT_ADDRESS,
} from "../../services/pretium/pretium-service.js";
import { ExchangeRateService } from "../../services/pretium/exchange-rate-service.js";
import { TransactionService } from "../../services/transaction/transaction-service.js";
import { ConfigService } from "../../config.js";
import { DatabaseService } from "../../db/client.js";

// ── Mock data ─────────────────────────────────────────────────────────

const mockCountries = SUPPORTED_COUNTRIES;

const mockExchangeRate = {
  buyingRate: 128.5,
  sellingRate: 130.0,
  quotedRate: 129.25,
};

const mockConversionUsdcToFiat = {
  amount: 12925,
  exchangeRate: 129.25,
};

const mockConversionFiatToUsdc = {
  amount: 77.37,
  exchangeRate: 129.25,
};

const mockPhoneValidation = {
  success: true,
  name: "John Doe",
  phoneNumber: "254712345678",
};

const mockBankValidation = {
  success: true,
  accountName: "Jane Doe",
  accountNumber: "1234567890",
  bankCode: "044",
};

const mockBanks = [
  { code: "044", name: "Access Bank" },
  { code: "058", name: "GTBank" },
  { code: "011", name: "First Bank" },
];

const mockPretiumTransaction = {
  id: "ptx-1",
  userId: "user-1",
  walletId: "wallet-1",
  countryCode: "KE",
  fiatCurrency: "KES",
  usdcAmount: "100",
  fiatAmount: "12925",
  exchangeRate: "129.25",
  fee: "0",
  paymentType: "MOBILE",
  status: "pending",
  direction: "offramp",
  onChainTxHash: "0xabc123",
  pretiumTransactionCode: "TXN-001",
  phoneNumber: "254712345678",
  mobileNetwork: "Safaricom",
  accountNumber: null,
  bankCode: null,
  bankName: null,
  accountName: null,
  asset: null,
  recipientAddress: null,
  recipientName: null,
  pretiumReceiptNumber: null,
  failureReason: null,
  callbackUrl: "http://localhost:3000/webhooks/pretium",
  categoryId: null,
  completedAt: null,
  createdAt: new Date("2025-01-15T12:00:00Z"),
  updatedAt: new Date("2025-01-15T12:00:00Z"),
};

const mockWallet = {
  id: "wallet-1",
  userId: "user-1",
  type: "server",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 1,
  createdAt: new Date("2025-01-15T12:00:00Z"),
  updatedAt: new Date("2025-01-15T12:00:00Z"),
};

const mockOnrampTransaction = {
  ...mockPretiumTransaction,
  id: "ptx-2",
  direction: "onramp",
  recipientAddress: "0x1111111111111111111111111111111111111111",
  asset: "USDC",
  pretiumTransactionCode: "TXN-002",
  onChainTxHash: null,
  phoneNumber: "254712345678",
  mobileNetwork: "Safaricom",
  accountNumber: null,
  bankCode: null,
  bankName: null,
  accountName: null,
};

// ── Test runtime factory ──────────────────────────────────────────────

function makeTestRuntime(opts?: {
  isCountrySupported?: boolean;
  exchangeRateFail?: boolean;
  phoneValidationFail?: boolean;
  banksFail?: boolean;
}) {
  const MockPretiumLayer = Layer.succeed(PretiumService, {
    getSupportedCountries: () => mockCountries,
    getCountryPaymentConfig: (country: string) =>
      (COUNTRY_PAYMENT_CONFIG as any)[country] ?? undefined,
    isCountrySupported: ((country: string) =>
      country in mockCountries) as any,
    validatePhoneWithMno: (_country: any, _phone: string, _network: string) =>
      opts?.phoneValidationFail
        ? Effect.fail({
            _tag: "PretiumError" as const,
            message: "Validation failed",
            code: "VALIDATION_ERROR",
          } as any)
        : Effect.succeed(mockPhoneValidation),
    validateBankAccount: (_country: any, _account: string, _bankCode: string) =>
      Effect.succeed(mockBankValidation),
    getBanksForCountry: (_country: any) =>
      opts?.banksFail
        ? Effect.fail({
            _tag: "PretiumError" as const,
            message: "Failed to fetch banks",
            code: "NETWORK_ERROR",
          } as any)
        : Effect.succeed(mockBanks),
    getSettlementAddress: () => SETTLEMENT_ADDRESS,
    disburse: (_request: any) =>
      Effect.succeed({
        success: true,
        data: {
          transaction_code: "TXN-001",
          message: "Transaction initiated",
        },
      }),
    getTransactionStatus: (_code: string, _currency: string) =>
      Effect.succeed({
        success: true,
        status: "COMPLETED",
        receiptNumber: "REC-001",
        failureReason: null,
      }),
    onramp: (_request: any) =>
      Effect.succeed({
        success: true,
        data: {
          transaction_code: "TXN-002",
          message: "Onramp initiated",
        },
      }),
  });

  const MockExchangeRateLayer = Layer.succeed(ExchangeRateService, {
    getExchangeRate: (_currency: string) =>
      opts?.exchangeRateFail
        ? Effect.fail({
            _tag: "ExchangeRateError" as const,
            message: "Failed to fetch rate",
            code: "NETWORK_ERROR",
          } as any)
        : Effect.succeed(mockExchangeRate),
    convertUsdcToFiat: (_usdcAmount: number, _currency: string) =>
      Effect.succeed(mockConversionUsdcToFiat),
    convertFiatToUsdc: (_fiatAmount: number, _currency: string) =>
      Effect.succeed(mockConversionFiatToUsdc),
    clearCache: () => Effect.void,
  });

  const MockTransactionLayer = Layer.succeed(TransactionService, {
    submitContractTransaction: (_params: any) =>
      Effect.succeed({
        id: "tx-1",
        txHash: "0xabc123",
        status: "confirmed",
      }),
    getTransaction: (_id: string) => Effect.succeed(undefined as any),
    getUserTransactions: () => Effect.succeed([]),
  } as any);

  const MockConfigLayer = Layer.succeed(ConfigService, {
    databaseUrl: "postgres://test",
    privyAppId: "test",
    privyAppSecret: "test",
    coinmarketcapApiKey: "test",
    adminApiKey: "test",
    defaultChainId: 1,
    port: 3000,
    pretiumApiKey: "test",
    pretiumBaseUri: "https://api.test.africa",
    serverBaseUrl: "http://localhost:3000",
    uniswapApiKey: "test",
    approvalTokenSecret: "test",
  });

  // Build a chainable mock DB that handles drizzle's fluent API
  const createChainableMock = (resolveValue: any) => {
    const chain: any = {};
    const methods = [
      "select",
      "from",
      "where",
      "limit",
      "offset",
      "orderBy",
      "insert",
      "values",
      "returning",
      "update",
      "set",
    ];
    for (const method of methods) {
      chain[method] = vi.fn().mockReturnValue(chain);
    }
    // Terminal methods that return a promise
    chain.then = (resolve: any, reject?: any) =>
      Promise.resolve(resolveValue).then(resolve, reject);
    return chain;
  };

  const mockDb: any = {
    select: vi.fn().mockImplementation(() => {
      const chain = createChainableMock([mockWallet]);
      // Override 'from' to route based on the table
      chain.from = vi.fn().mockImplementation((table: any) => {
        const tableName = (() => {
          try { return getTableName(table); } catch { return undefined; }
        })();
        if (tableName === "wallets") {
          return createChainableMock([mockWallet]);
        }
        if (tableName === "pretium_transactions") {
          return createChainableMock([mockPretiumTransaction]);
        }
        if (tableName === "user_profiles") {
          return createChainableMock([{ preferences: {} }]);
        }
        return createChainableMock([]);
      });
      return chain;
    }),
    insert: vi.fn().mockImplementation(() => {
      return createChainableMock([mockPretiumTransaction]);
    }),
    update: vi.fn().mockImplementation(() => {
      return createChainableMock([mockPretiumTransaction]);
    }),
  };

  const MockDatabaseLayer = Layer.succeed(DatabaseService, {
    db: mockDb,
  });

  const testLayer = Layer.mergeAll(
    MockPretiumLayer,
    MockExchangeRateLayer,
    MockTransactionLayer,
    MockConfigLayer,
    MockDatabaseLayer
  );

  return ManagedRuntime.make(testLayer);
}

function makeApp(runtime: ReturnType<typeof makeTestRuntime>) {
  const app = new Hono();
  // Simulate auth by setting userId
  app.use("*", async (c, next) => {
    c.set("userId" as any, "user-1");
    await next();
  });
  app.route("/", createPretiumRoutes(runtime as any));
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Pretium Routes", () => {
  describe("GET /countries", () => {
    it("should return list of supported countries", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/countries");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);

      // Check that each country has expected fields
      const ke = body.data.find((c: any) => c.code === "KE");
      expect(ke).toBeDefined();
      expect(ke.currency).toBe("KES");
      expect(ke.name).toBe("Kenya");
      expect(ke.paymentConfig).toBeDefined();

      await runtime.dispose();
    });

    it("should include payment config for each country", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/countries");
      const body = await res.json();

      const ng = body.data.find((c: any) => c.code === "NG");
      expect(ng).toBeDefined();
      expect(ng.currency).toBe("NGN");
      expect(ng.paymentConfig).toBeDefined();

      await runtime.dispose();
    });
  });

  describe("GET /countries/:code", () => {
    it("should return config for a supported country", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/countries/KE");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.code).toBe("KE");
      expect(body.data.currency).toBe("KES");
      expect(body.data.name).toBe("Kenya");
      expect(body.data.paymentConfig).toBeDefined();

      await runtime.dispose();
    });

    it("should handle lowercase country code", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/countries/ke");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.code).toBe("KE");

      await runtime.dispose();
    });

    it("should return 400 for unsupported country", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/countries/XX");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.message).toContain("not supported");

      await runtime.dispose();
    });
  });

  describe("GET /exchange-rate/:currency", () => {
    it("should return exchange rate for a currency", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/exchange-rate/KES");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.buyingRate).toBe(128.5);
      expect(body.data.sellingRate).toBe(130.0);
      expect(body.data.quotedRate).toBe(129.25);

      await runtime.dispose();
    });

    it("should return 400 when exchange rate fetch fails", async () => {
      const runtime = makeTestRuntime({ exchangeRateFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/exchange-rate/INVALID");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /convert/usdc-to-fiat", () => {
    it("should convert USDC amount to fiat", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/convert/usdc-to-fiat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usdcAmount: 100, currency: "KES" }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.amount).toBe(12925);
      expect(body.data.exchangeRate).toBe(129.25);

      await runtime.dispose();
    });
  });

  describe("POST /convert/fiat-to-usdc", () => {
    it("should convert fiat amount to USDC", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/convert/fiat-to-usdc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiatAmount: 10000, currency: "KES" }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.amount).toBe(77.37);
      expect(body.data.exchangeRate).toBe(129.25);

      await runtime.dispose();
    });
  });

  describe("POST /validate/phone", () => {
    it("should validate a phone number successfully", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/validate/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: "KE",
          phoneNumber: "254712345678",
          network: "Safaricom",
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("John Doe");
      expect(body.data.phoneNumber).toBe("254712345678");

      await runtime.dispose();
    });

    it("should return 400 when validation fails", async () => {
      const runtime = makeTestRuntime({ phoneValidationFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/validate/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: "KE",
          phoneNumber: "invalid",
          network: "Safaricom",
        }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /validate/bank-account", () => {
    it("should validate a bank account successfully", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/validate/bank-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: "NG",
          accountNumber: "1234567890",
          bankCode: "044",
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.accountName).toBe("Jane Doe");

      await runtime.dispose();
    });
  });

  describe("GET /banks/:country", () => {
    it("should return list of banks for a supported country", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/banks/NG");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(3);
      expect(body.data[0].code).toBe("044");
      expect(body.data[0].name).toBe("Access Bank");

      await runtime.dispose();
    });

    it("should handle lowercase country code", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/banks/ng");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 for unsupported country", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/banks/XX");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.message).toContain("Bank list not available");

      await runtime.dispose();
    });

    it("should return 400 for country without bank support", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/banks/GH");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("GET /settlement-address", () => {
    it("should return the settlement address", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/settlement-address");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.address).toBe(SETTLEMENT_ADDRESS);
      expect(body.data.chain).toBe("BASE");

      await runtime.dispose();
    });
  });

  describe("GET /onramp/countries", () => {
    it("should return list of onramp-supported countries", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/onramp/countries");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBe(ONRAMP_SUPPORTED_COUNTRIES.length);

      // Check that each onramp country has expected fields
      const ke = body.data.find((c: any) => c.code === "KE");
      expect(ke).toBeDefined();
      expect(ke.currency).toBe("KES");
      expect(ke.name).toBe("Kenya");
      expect(ke.supportedAssets).toEqual([...ONRAMP_SUPPORTED_ASSETS]);

      await runtime.dispose();
    });

    it("should only include onramp-supported countries", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/onramp/countries");
      const body = await res.json();

      const codes = body.data.map((c: any) => c.code);
      // NG and ET are not in ONRAMP_SUPPORTED_COUNTRIES
      expect(codes).not.toContain("NG");
      expect(codes).not.toContain("ET");
      // KE, GH, UG, CD, MW should be present
      expect(codes).toContain("KE");
      expect(codes).toContain("GH");
      expect(codes).toContain("UG");

      await runtime.dispose();
    });
  });

  // ── Offramp endpoints ─────────────────────────────────────────────

  describe("POST /offramp", () => {
    it("should initiate an offramp and return 201", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/offramp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: "KE",
          walletId: "wallet-1",
          usdcAmount: 100,
          phoneNumber: "254712345678",
          mobileNetwork: "Safaricom",
        }),
      });

      expect(res.status).toBe(201);

      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.transaction).toBeDefined();
      expect(body.data.pretiumResponse).toBeDefined();
      expect(body.data.pretiumResponse.data.transaction_code).toBe("TXN-001");

      await runtime.dispose();
    });

    it("should return 400 for unsupported country", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/offramp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: "XX",
          walletId: "wallet-1",
          usdcAmount: 100,
          phoneNumber: "254712345678",
          mobileNetwork: "Safaricom",
        }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.message).toContain("not supported");

      await runtime.dispose();
    });
  });

  describe("GET /offramp/:id", () => {
    it("should return an offramp transaction by ID", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/offramp/ptx-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("ptx-1");
      expect(body.data.direction).toBe("offramp");

      await runtime.dispose();
    });
  });

  describe("POST /offramp/:id/refresh", () => {
    it("should poll Pretium status and update the transaction", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/offramp/ptx-1/refresh", {
        method: "POST",
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.pretiumStatus).toBeDefined();
      expect(body.data.pretiumStatus.status).toBe("COMPLETED");
      expect(body.data.pretiumStatus.receiptNumber).toBe("REC-001");
      expect(body.data.transaction).toBeDefined();

      await runtime.dispose();
    });
  });

  describe("GET /offramp", () => {
    it("should list user offramp transactions", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/offramp");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should support limit and offset query params", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/offramp?limit=10&offset=5");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });
  });

  // ── Onramp endpoints ──────────────────────────────────────────────

  describe("POST /onramp", () => {
    it("should initiate an onramp and return 201", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/onramp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: "KE",
          walletId: "wallet-1",
          fiatAmount: 10000,
          phoneNumber: "254712345678",
          mobileNetwork: "Safaricom",
          asset: "USDC",
        }),
      });

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.transaction).toBeDefined();
      expect(body.data.pretiumResponse).toBeDefined();
      expect(body.data.pretiumResponse.data.transaction_code).toBe("TXN-002");

      await runtime.dispose();
    });

    it("should return 400 for unsupported onramp country", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/onramp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: "NG",
          walletId: "wallet-1",
          fiatAmount: 10000,
          phoneNumber: "2348012345678",
          mobileNetwork: "MTN",
          asset: "USDC",
        }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.message).toContain("not supported");

      await runtime.dispose();
    });
  });

  describe("GET /onramp/:id", () => {
    it("should return an onramp transaction by ID", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/onramp/ptx-2");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      // The mock DB returns mockPretiumTransaction for any pretium_transactions query
      expect(body.data).toBeDefined();

      await runtime.dispose();
    });
  });

  describe("POST /onramp/:id/refresh", () => {
    it("should poll Pretium status and update the onramp transaction", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/onramp/ptx-2/refresh", {
        method: "POST",
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.pretiumStatus).toBeDefined();
      expect(body.data.pretiumStatus.status).toBe("COMPLETED");
      expect(body.data.transaction).toBeDefined();

      await runtime.dispose();
    });
  });

  describe("GET /onramp", () => {
    it("should list user onramp transactions", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/onramp");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should support limit and offset query params", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/onramp?limit=20&offset=0");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });
  });
});

// ── Webhook Routes ────────────────────────────────────────────────────

describe("Pretium Webhook Routes", () => {
  function makeWebhookApp(runtime: ReturnType<typeof makeTestRuntime>) {
    const app = new Hono();
    // No auth middleware — webhooks are unauthenticated
    app.route("/", createPretiumWebhookRoutes(runtime as any));
    return app;
  }

  describe("POST /pretium (status update callback)", () => {
    it("should handle offramp status update", async () => {
      const runtime = makeTestRuntime();
      const app = makeWebhookApp(runtime);

      const res = await app.request("/pretium", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_code: "TXN-001",
          status: "COMPLETED",
          receipt_number: "REC-001",
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.received).toBe(true);
      expect(body.data.matched).toBe(true);
      expect(body.data.type).toBe("status_update");
      expect(body.data.transaction).toBeDefined();

      await runtime.dispose();
    });
  });

  describe("POST /pretium (asset release callback)", () => {
    it("should handle onramp asset release", async () => {
      const runtime = makeTestRuntime();
      const app = makeWebhookApp(runtime);

      const res = await app.request("/pretium", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_code: "TXN-001",
          is_released: true,
          transaction_hash: "0xdef456",
          public_name: "John Doe",
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.received).toBe(true);
      expect(body.data.matched).toBe(true);
      expect(body.data.type).toBe("asset_release");
      expect(body.data.transaction).toBeDefined();

      await runtime.dispose();
    });
  });

  describe("POST /pretium (unmatched transaction)", () => {
    it("should return matched=false for unknown transaction code", async () => {
      // Create a runtime whose DB returns empty for pretium_transactions lookups
      const runtime = makeTestRuntime();
      const app = new Hono();

      // We need a custom runtime where pretium_transactions select returns []
      const emptyTxRuntime = (() => {
        const createChainableMock = (resolveValue: any) => {
          const chain: any = {};
          const methods = [
            "select", "from", "where", "limit", "offset",
            "orderBy", "insert", "values", "returning", "update", "set",
          ];
          for (const method of methods) {
            chain[method] = vi.fn().mockReturnValue(chain);
          }
          chain.then = (resolve: any, reject?: any) =>
            Promise.resolve(resolveValue).then(resolve, reject);
          return chain;
        };

        const mockDb: any = {
          select: vi.fn().mockImplementation(() => {
            const chain = createChainableMock([]);
            chain.from = vi.fn().mockImplementation(() => {
              return createChainableMock([]);
            });
            return chain;
          }),
          insert: vi.fn().mockImplementation(() => createChainableMock([])),
          update: vi.fn().mockImplementation(() => createChainableMock([])),
        };

        const MockPretiumLayer = Layer.succeed(PretiumService, {
          getSupportedCountries: () => mockCountries,
          getCountryPaymentConfig: (country: string) =>
            (COUNTRY_PAYMENT_CONFIG as any)[country] ?? undefined,
          isCountrySupported: ((country: string) =>
            country in mockCountries) as any,
          validatePhoneWithMno: () => Effect.succeed(mockPhoneValidation),
          validateBankAccount: () => Effect.succeed(mockBankValidation),
          getBanksForCountry: () => Effect.succeed(mockBanks),
          getSettlementAddress: () => SETTLEMENT_ADDRESS,
          disburse: () => Effect.succeed({ success: true, data: { transaction_code: "TXN-001", message: "ok" } }),
          getTransactionStatus: () => Effect.succeed({ success: true, status: "COMPLETED", receiptNumber: "REC-001", failureReason: null }),
          onramp: () => Effect.succeed({ success: true, data: { transaction_code: "TXN-002", message: "ok" } }),
        });

        const MockExchangeRateLayer = Layer.succeed(ExchangeRateService, {
          getExchangeRate: () => Effect.succeed(mockExchangeRate),
          convertUsdcToFiat: () => Effect.succeed(mockConversionUsdcToFiat),
          convertFiatToUsdc: () => Effect.succeed(mockConversionFiatToUsdc),
          clearCache: () => Effect.void,
        });

        const MockTransactionLayer = Layer.succeed(TransactionService, {
          submitContractTransaction: () => Effect.succeed({ id: "tx-1", txHash: "0xabc123", status: "confirmed" }),
          getTransaction: () => Effect.succeed(undefined as any),
          getUserTransactions: () => Effect.succeed([]),
        } as any);

        const MockConfigLayer = Layer.succeed(ConfigService, {
          databaseUrl: "postgres://test",
          privyAppId: "test",
          privyAppSecret: "test",
          coinmarketcapApiKey: "test",
          adminApiKey: "test",
          defaultChainId: 1,
          port: 3000,
          pretiumApiKey: "test",
          pretiumBaseUri: "https://api.test.africa",
          serverBaseUrl: "http://localhost:3000",
          uniswapApiKey: "test",
          approvalTokenSecret: "test",
        });

        const MockDatabaseLayer = Layer.succeed(DatabaseService, { db: mockDb });

        return ManagedRuntime.make(
          Layer.mergeAll(
            MockPretiumLayer,
            MockExchangeRateLayer,
            MockTransactionLayer,
            MockConfigLayer,
            MockDatabaseLayer
          )
        );
      })();

      const webhookApp = new Hono();
      webhookApp.route("/", createPretiumWebhookRoutes(emptyTxRuntime as any));

      const res = await webhookApp.request("/pretium", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_code: "UNKNOWN-999",
          status: "COMPLETED",
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.received).toBe(true);
      expect(body.data.matched).toBe(false);

      await runtime.dispose();
      await emptyTxRuntime.dispose();
    });
  });
});
