import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createTransactionRoutes } from "../../routes/transactions.js";
import {
  TransactionService,
  TransactionError,
} from "../../services/transaction/transaction-service.js";
import {
  LedgerService,
  LedgerError,
} from "../../services/ledger/ledger-service.js";
import {
  OnboardingService,
  OnboardingError,
} from "../../services/onboarding/onboarding-service.js";
import { ConfigService } from "../../config.js";
import { DatabaseService } from "../../db/client.js";
import type { Transaction } from "../../db/schema/index.js";
import type { AuthVariables } from "../../middleware/auth.js";

const TEST_USER_ID = "test-user-123";
const now = new Date("2025-01-15T12:00:00Z");

function makeFakeTx(overrides?: Partial<Transaction>): Transaction {
  return {
    id: "tx-1",
    walletId: "wallet-1",
    walletType: "server",
    chainId: "1",
    contractId: null,
    method: "transfer",
    payload: {},
    status: "submitted",
    txHash: "0xhash123",
    gasUsed: null,
    categoryId: null,
    userId: TEST_USER_ID,
    error: null,
    createdAt: now,
    confirmedAt: null,
    ...overrides,
  };
}

function makeTestRuntime(opts?: {
  listResult?: Transaction[];
  getResult?: Transaction | null;
  submitContractResult?: Transaction;
  submitContractFail?: boolean;
  submitRawResult?: Transaction;
  listByUserResult?: Transaction[];
  walletOwnershipFail?: boolean;
  /** When true, the OnboardingService.getProfile call will fail (user not onboarded). */
  onboardingProfileFail?: boolean;
}) {
  const MockTxServiceLayer = Layer.succeed(TransactionService, {
    submitContractTransaction: () =>
      opts?.submitContractFail
        ? Effect.fail(new TransactionError({ message: "submit failed" }))
        : Effect.succeed(opts?.submitContractResult ?? makeFakeTx()),
    submitRawTransaction: () =>
      Effect.succeed(opts?.submitRawResult ?? makeFakeTx()),
    getTransaction: () =>
      Effect.succeed(
        opts?.getResult === null ? undefined : (opts?.getResult ?? makeFakeTx())
      ),
    listTransactions: () =>
      Effect.succeed(opts?.listResult ?? [makeFakeTx()]),
  });

  const MockLedgerLayer = Layer.succeed(LedgerService, {
    createIntent: () => Effect.succeed(makeFakeTx()),
    markSubmitted: () => Effect.succeed(makeFakeTx({ status: "submitted" })),
    markConfirmed: (id: string) =>
      Effect.succeed(makeFakeTx({ id, status: "confirmed", confirmedAt: now })),
    markFailed: (id: string, error: string) =>
      Effect.succeed(makeFakeTx({ id, status: "failed", error })),
    getById: () => Effect.succeed(makeFakeTx()),
    listByWallet: () => Effect.succeed([makeFakeTx()]),
    listByUser: () =>
      Effect.succeed(opts?.listByUserResult ?? [makeFakeTx()]),
    listAll: () => Effect.succeed([makeFakeTx()]),
  });

  // Mock OnboardingService for walletType resolution (when walletId is not provided)
  const MockOnboardingLayer = Layer.succeed(OnboardingService, {
    onboardUser: () => Effect.succeed({} as any),
    getProfile: (_privyUserId: string) =>
      opts?.onboardingProfileFail
        ? Effect.fail(
            new OnboardingError({
              message: `Profile not found for user: ${_privyUserId}`,
            })
          )
        : Effect.succeed({
            id: "profile-1",
            privyUserId: TEST_USER_ID,
            userWalletId: "wallet-user-resolved",
            serverWalletId: "wallet-server-resolved",
            agentWalletId: "wallet-agent-resolved",
            createdAt: now,
            updatedAt: now,
          }),
    getProfileWithWallets: () => Effect.succeed({} as any),
    isOnboarded: () => Effect.succeed(true),
  });

  // Mock DB for wallet ownership verification in POST /contract and POST /raw
  const fakeWalletRecord = {
    id: "wallet-1",
    type: "server",
    privyWalletId: "privy-1",
    ownerId: TEST_USER_ID,
    address: "0xabc",
    chainId: null,
    createdAt: now,
  };

  const selectWhere = opts?.walletOwnershipFail
    ? vi.fn().mockResolvedValue([])
    : vi.fn().mockResolvedValue([fakeWalletRecord]);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: { select: selectFn } as any,
    pool: {} as any,
  });

  const MockConfigLayer = Layer.succeed(ConfigService, {
    databaseUrl: "postgresql://test",
    privyAppId: "test",
    privyAppSecret: "test",
    coinmarketcapApiKey: "test",
    adminApiKey: "test",
    defaultChainId: 1,
    port: 3000,
  });

  const testLayer = Layer.mergeAll(
    MockTxServiceLayer,
    MockLedgerLayer,
    MockDbLayer,
    MockOnboardingLayer,
    MockConfigLayer
  );
  return ManagedRuntime.make(testLayer);
}

/**
 * Creates a test Hono app with auth middleware that sets userId,
 * then mounts the transaction routes.
 */
function makeApp(runtime: ReturnType<typeof makeTestRuntime>) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", TEST_USER_ID);
    await next();
  });
  app.route("/", createTransactionRoutes(runtime as any));
  return app;
}

describe("Transaction Routes", () => {
  describe("GET /", () => {
    it("should return list of transactions", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should accept limit and offset query params", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/?limit=10&offset=5");
      expect(res.status).toBe(200);

      await runtime.dispose();
    });
  });

  describe("GET /:id", () => {
    it("should return a transaction by id", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/tx-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("tx-1");

      await runtime.dispose();
    });

    it("should return 400 when transaction not found", async () => {
      const runtime = makeTestRuntime({ getResult: null });
      const app = makeApp(runtime);

      const res = await app.request("/nonexistent");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });

    it("should return 400 when transaction belongs to another user", async () => {
      const runtime = makeTestRuntime({
        getResult: makeFakeTx({ userId: "other-user-456" }),
      });
      const app = makeApp(runtime);

      const res = await app.request("/tx-1");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /contract", () => {
    it("should submit a contract transaction", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          walletType: "server",
          contractName: "TestToken",
          chainId: 1,
          method: "transfer",
          args: ["0x0000000000000000000000000000000000000001", "1000"],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when contract transaction fails", async () => {
      const runtime = makeTestRuntime({ submitContractFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          walletType: "server",
          contractName: "TestToken",
          chainId: 1,
          method: "transfer",
          args: [],
        }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });

    it("should return 400 when wallet is not owned by user", async () => {
      const runtime = makeTestRuntime({ walletOwnershipFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          walletType: "server",
          contractName: "TestToken",
          chainId: 1,
          method: "transfer",
          args: [],
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /raw", () => {
    it("should submit a raw transaction", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          walletType: "server",
          chainId: 1,
          to: "0x0000000000000000000000000000000000000001",
          value: "1000000",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when wallet is not owned by user", async () => {
      const runtime = makeTestRuntime({ walletOwnershipFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          walletType: "server",
          chainId: 1,
          to: "0x0000000000000000000000000000000000000001",
          value: "1000000",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("walletType resolution (no walletId)", () => {
    it("POST /contract with walletType resolves walletId from onboarding profile", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletType: "server",
          contractName: "TestToken",
          chainId: 1,
          method: "transfer",
          args: ["0x0000000000000000000000000000000000000001", "500"],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("tx-1");

      await runtime.dispose();
    });

    it("POST /raw with walletType resolves walletId from onboarding profile", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletType: "user",
          chainId: 1,
          to: "0x0000000000000000000000000000000000000001",
          value: "250000",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("tx-1");

      await runtime.dispose();
    });

    it("POST /contract with walletType agent resolves agentWalletId from profile", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletType: "agent",
          contractName: "TestToken",
          chainId: 1,
          method: "approve",
          args: ["0x0000000000000000000000000000000000000002", "999"],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("POST /contract with walletType returns 400 when user not onboarded", async () => {
      const runtime = makeTestRuntime({ onboardingProfileFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletType: "server",
          contractName: "TestToken",
          chainId: 1,
          method: "transfer",
          args: [],
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });

    it("POST /raw with walletType returns 400 when user not onboarded", async () => {
      const runtime = makeTestRuntime({ onboardingProfileFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletType: "server",
          chainId: 1,
          to: "0x0000000000000000000000000000000000000001",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });
});
