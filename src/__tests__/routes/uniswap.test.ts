import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createUniswapRoutes } from "../../routes/uniswap.js";
import {
  UniswapService,
  BASE_CHAIN_ID,
} from "../../services/uniswap/uniswap-service.js";
import { TransactionService } from "../../services/transaction/transaction-service.js";
import { ConfigService } from "../../config.js";
import { DatabaseService } from "../../db/client.js";

// Mock the shared public client helper to prevent real RPC calls
vi.mock("../../services/chain/public-client.js", () => ({
  createBasePublicClient: () => ({
    readContract: vi.fn().mockResolvedValue(BigInt("1000000000000000000000")),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
  }),
}));

// Mock global fetch to prevent real HTTP calls
const originalFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
  });
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

// ── Fake data builders ──────────────────────────────────────────────

function makeFakeApprovalResult(overrides?: Record<string, unknown>) {
  return {
    approval: {
      to: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      from: "0xWalletAddress",
      data: "0xapprovaldata",
      value: "0",
      chainId: BASE_CHAIN_ID,
    },
    ...overrides,
  };
}

function makeFakeQuoteResponse(overrides?: Record<string, unknown>) {
  return {
    routing: "CLASSIC",
    quote: {
      input: {
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "1000000",
      },
      output: {
        token: "0x4200000000000000000000000000000000000006",
        amount: "500000000000000",
      },
      slippage: 0.5,
      gasFee: "100000",
      gasFeeUSD: "0.25",
      gasUseEstimate: "150000",
    },
    permitData: null,
    ...overrides,
  };
}

function makeFakeSwapTransaction(overrides?: Record<string, unknown>) {
  return {
    to: "0x6ff5693b99212da76ad316178a184ab56d299b43",
    from: "0xWalletAddress",
    data: "0xswapdata",
    value: "0",
    chainId: BASE_CHAIN_ID,
    ...overrides,
  };
}

function makeFakeTransaction(overrides?: Record<string, unknown>) {
  return {
    id: "tx-1",
    txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    walletId: "wallet-1",
    chainId: String(BASE_CHAIN_ID),
    method: "raw_transfer",
    status: "confirmed",
    createdAt: new Date("2025-01-15T12:00:00Z"),
    updatedAt: new Date("2025-01-15T12:00:00Z"),
    ...overrides,
  };
}

// ── Test runtime factory ────────────────────────────────────────────

function makeTestRuntime(opts?: {
  walletAddress?: string;
  walletNotFound?: boolean;
  approvalResult?: ReturnType<typeof makeFakeApprovalResult>;
  quoteResponse?: ReturnType<typeof makeFakeQuoteResponse>;
  swapTransaction?: ReturnType<typeof makeFakeSwapTransaction>;
  submitRawTransactionResult?: ReturnType<typeof makeFakeTransaction>;
}) {
  const MockUniswapLayer = Layer.succeed(UniswapService, {
    checkApproval: () =>
      Effect.succeed(opts?.approvalResult ?? makeFakeApprovalResult()),
    getQuote: () =>
      Effect.succeed(opts?.quoteResponse ?? makeFakeQuoteResponse()),
    getSwapTransaction: () =>
      Effect.succeed(opts?.swapTransaction ?? makeFakeSwapTransaction()),
  });

  const MockTransactionLayer = Layer.succeed(TransactionService, {
    submitContractTransaction: () =>
      Effect.succeed(makeFakeTransaction()) as any,
    submitRawTransaction: () =>
      Effect.succeed(
        opts?.submitRawTransactionResult ?? makeFakeTransaction()
      ) as any,
    getTransaction: () => Effect.succeed(makeFakeTransaction()) as any,
    listTransactions: () => Effect.succeed([makeFakeTransaction()]) as any,
  });

  const walletAddress = opts?.walletAddress ?? "0xWalletAddress";
  const walletNotFound = opts?.walletNotFound ?? false;

  const MockDatabaseLayer = Layer.succeed(DatabaseService, {
    db: {
      select: () => ({
        from: () => ({
          where: () =>
            walletNotFound
              ? Promise.resolve([])
              : Promise.resolve([
                  {
                    id: "wallet-1",
                    address: walletAddress,
                    type: "server",
                  },
                ]),
        }),
      }),
    } as any,
    pool: {} as any,
  });

  const MockConfigLayer = Layer.succeed(ConfigService, {
    databaseUrl: "",
    privyAppId: "",
    privyAppSecret: "",
    coinmarketcapApiKey: "",
    adminApiKey: "",
    defaultChainId: 1,
    port: 3000,
    pretiumApiKey: "",
    pretiumBaseUri: "",
    serverBaseUrl: "",
    uniswapApiKey: "",
    approvalTokenSecret: "",
    baseRpcUrl: "",
  });

  const testLayer = Layer.mergeAll(
    MockUniswapLayer,
    MockTransactionLayer,
    MockDatabaseLayer,
    MockConfigLayer
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
  app.route("/", createUniswapRoutes(runtime as any));
  return app;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Uniswap Routes", () => {
  describe("POST /check-approval", () => {
    it("should return approval result for a valid wallet", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/check-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: "1000000",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.approval).toBeDefined();
      expect(body.data.approval.chainId).toBe(BASE_CHAIN_ID);

      await runtime.dispose();
    });

    it("should return error when wallet not found", async () => {
      const runtime = makeTestRuntime({ walletNotFound: true });
      const app = makeApp(runtime);

      const res = await app.request("/check-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "nonexistent-wallet",
          tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: "1000000",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
      expect(body.error._tag).toBeDefined();

      await runtime.dispose();
    });
  });

  describe("POST /quote", () => {
    it("should return a swap quote", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          tokenOut: "0x4200000000000000000000000000000000000006",
          amount: "1000000",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.routing).toBe("CLASSIC");
      expect(body.data.quote.input).toBeDefined();
      expect(body.data.quote.output).toBeDefined();
      expect(body.data.quote.gasFeeUSD).toBeDefined();

      await runtime.dispose();
    });

    it("should accept optional type and slippageTolerance params", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          tokenOut: "0x4200000000000000000000000000000000000006",
          amount: "1000000",
          type: "EXACT_INPUT",
          slippageTolerance: 0.5,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.routing).toBe("CLASSIC");

      await runtime.dispose();
    });
  });

  describe("POST /swap", () => {
    it("should execute a swap for ETH (no approval needed)", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          tokenIn: "0x0000000000000000000000000000000000000000",
          tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: "1000000000000000000",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.swapTxId).toBeDefined();
      expect(body.data.swapTxHash).toBeDefined();
      expect(body.data.approvalTxId).toBeUndefined();
      expect(body.data.quote).toBeDefined();
      expect(body.data.quote.routing).toBe("CLASSIC");
      expect(body.data.quote.input).toBeDefined();
      expect(body.data.quote.output).toBeDefined();
      expect(body.data.quote.gasFeeUSD).toBeDefined();

      await runtime.dispose();
    });

    it("should return error when wallet not found", async () => {
      const runtime = makeTestRuntime({ walletNotFound: true });
      const app = makeApp(runtime);

      const res = await app.request("/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "nonexistent-wallet",
          tokenIn: "0x0000000000000000000000000000000000000000",
          tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: "1000000000000000000",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
      expect(body.error._tag).toBeDefined();
      expect(body.error.message).toBeDefined();

      await runtime.dispose();
    });
  });
});
