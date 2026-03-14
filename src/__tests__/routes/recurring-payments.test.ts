import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createRecurringPaymentRoutes } from "../../routes/recurring-payments.js";
import { createInternalRoutes } from "../../routes/internal.js";
import {
  RecurringPaymentService,
  RecurringPaymentError,
} from "../../services/recurring-payment/recurring-payment-service.js";
import { OnboardingService } from "../../services/onboarding/onboarding-service.js";
import { ConfigService } from "../../config.js";
import { DatabaseService } from "../../db/client.js";
import {
  TransactionService,
  TransactionError,
} from "../../services/transaction/transaction-service.js";
import {
  LedgerService,
  LedgerError,
} from "../../services/ledger/ledger-service.js";
import { WalletService } from "../../services/wallet/wallet-service.js";
import { JobberService } from "../../services/jobber/jobber-service.js";
import { YieldService } from "../../services/yield/yield-service.js";
import type {
  RecurringPayment,
  RecurringPaymentExecution,
  Transaction,
  Job,
} from "../../db/schema/index.js";

const now = new Date("2025-01-15T12:00:00Z");

function makeFakeSchedule(
  overrides?: Partial<RecurringPayment>
): RecurringPayment {
  return {
    id: "rp-1",
    userId: "user-1",
    name: null,
    walletId: "wallet-1",
    walletType: "server",
    recipientAddress: "0x0000000000000000000000000000000000000001",
    paymentType: "raw_transfer",
    amount: "1000000000000000000",
    tokenContractName: null,
    contractName: null,
    contractMethod: null,
    contractArgs: null,
    chainId: 1,
    frequency: "1d",
    status: "active",
    startDate: now,
    endDate: null,
    nextExecutionAt: new Date(Date.now() + 86400000),
    maxRetries: 3,
    consecutiveFailures: 0,
    totalExecutions: 0,
    isOfframp: false,
    offrampCurrency: null,
    offrampFiatAmount: null,
    offrampProvider: null,
    offrampDestinationId: null,
    offrampMetadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeExecution(
  overrides?: Partial<RecurringPaymentExecution>
): RecurringPaymentExecution {
  return {
    id: "exec-1",
    scheduleId: "rp-1",
    transactionId: "tx-1",
    status: "success",
    error: null,
    executedAt: now,
    ...overrides,
  };
}

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
    userId: null,
    error: null,
    createdAt: now,
    confirmedAt: null,
    ...overrides,
  };
}

function makeFakeJob(overrides?: Partial<Job>): Job {
  return {
    id: "job-1",
    name: "Test Job",
    jobType: "contract_transaction",
    schedule: "5m",
    payload: {},
    status: "pending",
    lastRunAt: null,
    nextRunAt: new Date(Date.now() + 300000),
    maxRetries: 3,
    retryCount: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ── Public route tests ──────────────────────────────────────────────

function makePublicTestRuntime(opts?: {
  listResult?: RecurringPayment[];
  getResult?: RecurringPayment | null;
  createResult?: RecurringPayment;
  createFail?: boolean;
  pauseResult?: RecurringPayment;
  resumeResult?: RecurringPayment;
  cancelResult?: RecurringPayment;
  executionHistory?: RecurringPaymentExecution[];
}) {
  const MockRPLayer = Layer.succeed(RecurringPaymentService, {
    createSchedule: () =>
      opts?.createFail
        ? Effect.fail(
            new RecurringPaymentError({ message: "create failed" })
          )
        : Effect.succeed(opts?.createResult ?? makeFakeSchedule()),
    getSchedule: (id: string) =>
      Effect.succeed(
        opts?.getResult === null
          ? undefined
          : (opts?.getResult ?? makeFakeSchedule({ id }))
      ),
    listSchedulesByUser: () =>
      Effect.succeed(opts?.listResult ?? [makeFakeSchedule()]),
    listAllSchedules: () => Effect.succeed([]),
    updateSchedule: () => Effect.succeed(makeFakeSchedule()),
    pauseSchedule: (id: string) =>
      Effect.succeed(
        opts?.pauseResult ?? makeFakeSchedule({ id, status: "paused" })
      ),
    resumeSchedule: (id: string) =>
      Effect.succeed(
        opts?.resumeResult ?? makeFakeSchedule({ id, status: "active" })
      ),
    cancelSchedule: (id: string) =>
      Effect.succeed(
        opts?.cancelResult ?? makeFakeSchedule({ id, status: "cancelled" })
      ),
    getExecutionHistory: () =>
      Effect.succeed(opts?.executionHistory ?? [makeFakeExecution()]),
    processDuePayments: () => Effect.succeed([]),
    executeSchedule: () => Effect.succeed(makeFakeExecution()),
  });

  const MockOnboardingLayer = Layer.succeed(OnboardingService, {
    onboardUser: () => Effect.succeed({} as any),
    getProfile: () =>
      Effect.succeed({
        id: "profile-1",
        privyUserId: "user-1",
        userWalletId: "wallet-1",
        serverWalletId: "wallet-2",
        agentWalletId: "wallet-3",
        createdAt: now,
        updatedAt: now,
      }),
    getProfileWithWallets: () => Effect.succeed({} as any),
    isOnboarded: () => Effect.succeed(true),
  });

  const MockConfigLayer = Layer.succeed(ConfigService, {
    databaseUrl: "postgres://test",
    privyAppId: "test",
    privyAppSecret: "test",
    coinmarketcapApiKey: "test",
    adminApiKey: "test",
    defaultChainId: 1,
    port: 3000,
  });

  const selectFrom = vi.fn().mockReturnValue({
    where: vi
      .fn()
      .mockResolvedValue([
        { id: "wallet-1", ownerId: "user-1", type: "server" },
      ]),
    orderBy: vi.fn().mockResolvedValue([]),
  });
  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: { select: vi.fn().mockReturnValue({ from: selectFrom }) } as any,
    pool: {} as any,
  });

  const testLayer = Layer.mergeAll(
    MockRPLayer,
    MockOnboardingLayer,
    MockConfigLayer,
    MockDbLayer
  );

  return ManagedRuntime.make(testLayer);
}

function makePublicApp(runtime: ReturnType<typeof makePublicTestRuntime>) {
  const app = new Hono();
  // Simulate auth by setting userId
  app.use("*", async (c, next) => {
    c.set("userId" as any, "user-1");
    await next();
  });
  app.route("/", createRecurringPaymentRoutes(runtime as any));
  return app;
}

describe("Recurring Payment Routes (Public)", () => {
  describe("GET /", () => {
    it("should return list of user schedules", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should return empty array when no schedules", async () => {
      const runtime = makePublicTestRuntime({ listResult: [] });
      const app = makePublicApp(runtime);

      const res = await app.request("/");
      const body = await res.json();
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("GET /:id", () => {
    it("should return a schedule by id", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/rp-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when schedule not found", async () => {
      const runtime = makePublicTestRuntime({ getResult: null });
      const app = makePublicApp(runtime);

      const res = await app.request("/nonexistent");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });

    it("should return 400 when schedule belongs to another user", async () => {
      const runtime = makePublicTestRuntime({
        getResult: makeFakeSchedule({ userId: "other-user" }),
      });
      const app = makePublicApp(runtime);

      const res = await app.request("/rp-1");
      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("POST /", () => {
    it("should create a new schedule", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          walletType: "server",
          recipientAddress: "0x0000000000000000000000000000000000000001",
          paymentType: "raw_transfer",
          amount: "1000000000000000000",
          frequency: "1d",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should create a schedule with name and categoryId", async () => {
      const runtime = makePublicTestRuntime({
        createResult: makeFakeSchedule({ name: "Rent Payment", categoryId: "cat-1" }),
      });
      const app = makePublicApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "transfer",
          name: "Rent Payment",
          wallet: "server",
          to: "0x0000000000000000000000000000000000000001",
          amount: "1000000",
          token: "usdc",
          frequency: "30d",
          categoryId: "cat-1",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("Rent Payment");
      expect(body.data.categoryId).toBe("cat-1");

      await runtime.dispose();
    });

    it("should create a schedule using new transfer format", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "transfer",
          wallet: "server",
          to: "0x0000000000000000000000000000000000000001",
          amount: "1000000",
          token: "usdc",
          frequency: "1d",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should create a schedule using new raw_transfer format", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "raw_transfer",
          wallet: "user",
          to: "0x0000000000000000000000000000000000000001",
          amount: "1000000000000000000",
          frequency: "7d",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when creation fails", async () => {
      const runtime = makePublicTestRuntime({ createFail: true });
      const app = makePublicApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          walletType: "server",
          recipientAddress: "0x0000000000000000000000000000000000000001",
          paymentType: "raw_transfer",
          amount: "1000000000000000000",
          frequency: "1d",
        }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });

    it("should return 400 for new format missing required fields", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "transfer",
          amount: "1000000",
          frequency: "1d",
          // missing 'to'
        }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("POST /:id/pause", () => {
    it("should pause a schedule", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/rp-1/pause", { method: "POST" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("paused");

      await runtime.dispose();
    });
  });

  describe("POST /:id/resume", () => {
    it("should resume a schedule", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/rp-1/resume", { method: "POST" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("active");

      await runtime.dispose();
    });
  });

  describe("POST /:id/cancel", () => {
    it("should cancel a schedule", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/rp-1/cancel", { method: "POST" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("cancelled");

      await runtime.dispose();
    });
  });

  describe("GET /:id/executions", () => {
    it("should return execution history", async () => {
      const runtime = makePublicTestRuntime({
        executionHistory: [
          makeFakeExecution({ id: "exec-1" }),
          makeFakeExecution({ id: "exec-2" }),
        ],
      });
      const app = makePublicApp(runtime);

      const res = await app.request("/rp-1/executions");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);

      await runtime.dispose();
    });

    it("should return empty array when no executions", async () => {
      const runtime = makePublicTestRuntime({ executionHistory: [] });
      const app = makePublicApp(runtime);

      const res = await app.request("/rp-1/executions");
      const body = await res.json();
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });
});

// ── Internal route tests ────────────────────────────────────────────

function makeInternalTestRuntime(opts?: {
  listResult?: RecurringPayment[];
  getResult?: RecurringPayment | null;
  executeResult?: RecurringPaymentExecution;
  executeFail?: boolean;
  executionHistory?: RecurringPaymentExecution[];
  processResult?: RecurringPaymentExecution[];
}) {
  const MockRPLayer = Layer.succeed(RecurringPaymentService, {
    createSchedule: () => Effect.succeed(makeFakeSchedule()),
    getSchedule: (id: string) =>
      Effect.succeed(
        opts?.getResult === null
          ? undefined
          : (opts?.getResult ?? makeFakeSchedule({ id }))
      ),
    listSchedulesByUser: () => Effect.succeed([]),
    listAllSchedules: () =>
      Effect.succeed(opts?.listResult ?? [makeFakeSchedule()]),
    updateSchedule: () => Effect.succeed(makeFakeSchedule()),
    pauseSchedule: () => Effect.succeed(makeFakeSchedule()),
    resumeSchedule: () => Effect.succeed(makeFakeSchedule()),
    cancelSchedule: () => Effect.succeed(makeFakeSchedule()),
    getExecutionHistory: () =>
      Effect.succeed(opts?.executionHistory ?? [makeFakeExecution()]),
    processDuePayments: () =>
      Effect.succeed(opts?.processResult ?? [makeFakeExecution()]),
    executeSchedule: () =>
      opts?.executeFail
        ? Effect.fail(
            new RecurringPaymentError({ message: "execute failed" })
          )
        : Effect.succeed(opts?.executeResult ?? makeFakeExecution()),
  });

  const MockJobberLayer = Layer.succeed(JobberService, {
    listJobs: () => Effect.succeed([]),
    getJob: () => Effect.succeed(undefined),
    createJob: () => Effect.succeed(makeFakeJob()),
    cancelJob: () => Effect.succeed(makeFakeJob()),
    processDueJobs: () => Effect.succeed([]),
    startPolling: () => Effect.void,
  });

  const MockWalletServiceLayer = Layer.succeed(WalletService, {
    createUserWallet: () => Effect.succeed({} as any),
    createServerWallet: () => Effect.succeed({} as any),
    createAgentWallet: () => Effect.succeed({} as any),
    getWallet: () => Effect.succeed({} as any),
  });

  const MockTxServiceLayer = Layer.succeed(TransactionService, {
    submitContractTransaction: () => Effect.succeed(makeFakeTx()),
    submitRawTransaction: () => Effect.succeed(makeFakeTx()),
    getTransaction: () => Effect.succeed(undefined),
    listTransactions: () => Effect.succeed([]),
  });

  const MockLedgerLayer = Layer.succeed(LedgerService, {
    createIntent: () => Effect.succeed(makeFakeTx()),
    markSubmitted: () => Effect.succeed(makeFakeTx()),
    markConfirmed: () => Effect.succeed(makeFakeTx()),
    markFailed: () => Effect.succeed(makeFakeTx()),
    getById: () => Effect.succeed(makeFakeTx()),
    listByWallet: () => Effect.succeed([]),
    listByUser: () => Effect.succeed([]),
    listAll: () => Effect.succeed([]),
  });

  const MockOnboardingLayer = Layer.succeed(OnboardingService, {
    onboardUser: () => Effect.succeed({} as any),
    getProfile: () => Effect.succeed({} as any),
    getProfileWithWallets: () => Effect.succeed({} as any),
    isOnboarded: () => Effect.succeed(true),
  });

  const MockYieldLayer = Layer.succeed(YieldService, {
    listVaults: () => Effect.succeed([]),
    getVault: () => Effect.succeed(undefined),
    addVault: () => Effect.succeed({} as any),
    removeVault: () => Effect.succeed({} as any),
    syncVaultsFromChain: () => Effect.succeed([]),
    createPosition: () => Effect.succeed({} as any),
    getUserPositions: () => Effect.succeed([]),
    getPosition: () => Effect.succeed(undefined),
    withdrawPosition: () => Effect.succeed({} as any),
    syncPositionFromChain: () => Effect.succeed({} as any),
    snapshotYield: () => Effect.succeed({} as any),
    snapshotAllActivePositions: () => Effect.succeed([]),
    getYieldHistory: () => Effect.succeed([]),
    getAccruedYield: () =>
      Effect.succeed({
        positionId: "pos-1",
        principalAmount: "0",
        currentAssets: "0",
        accruedYield: "0",
        estimatedApy: "0",
      }),
    getPortfolioSummary: () =>
      Effect.succeed({
        totalPrincipal: "0",
        totalCurrentValue: "0",
        totalYield: "0",
        averageApy: "0",
        positionCount: 0,
      }),
    listAllPositions: () => Effect.succeed([]),
  });

  const selectFrom = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockResolvedValue([]),
  });
  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: { select: vi.fn().mockReturnValue({ from: selectFrom }) } as any,
    pool: {} as any,
  });

  const testLayer = Layer.mergeAll(
    MockRPLayer,
    MockJobberLayer,
    MockWalletServiceLayer,
    MockTxServiceLayer,
    MockLedgerLayer,
    MockOnboardingLayer,
    MockYieldLayer,
    MockDbLayer
  );

  return ManagedRuntime.make(testLayer);
}

function makeInternalApp(runtime: ReturnType<typeof makeInternalTestRuntime>) {
  const app = new Hono();
  app.route("/", createInternalRoutes(runtime as any));
  return app;
}

describe("Recurring Payment Routes (Internal)", () => {
  describe("GET /recurring-payments", () => {
    it("should return list of all schedules", async () => {
      const runtime = makeInternalTestRuntime();
      const app = makeInternalApp(runtime);

      const res = await app.request("/recurring-payments");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should return empty array when no schedules", async () => {
      const runtime = makeInternalTestRuntime({ listResult: [] });
      const app = makeInternalApp(runtime);

      const res = await app.request("/recurring-payments");
      const body = await res.json();
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("GET /recurring-payments/:id", () => {
    it("should return a schedule by id", async () => {
      const runtime = makeInternalTestRuntime();
      const app = makeInternalApp(runtime);

      const res = await app.request("/recurring-payments/rp-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when schedule not found", async () => {
      const runtime = makeInternalTestRuntime({ getResult: null });
      const app = makeInternalApp(runtime);

      const res = await app.request("/recurring-payments/nonexistent");
      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("POST /recurring-payments/:id/execute", () => {
    it("should force-execute a schedule", async () => {
      const runtime = makeInternalTestRuntime();
      const app = makeInternalApp(runtime);

      const res = await app.request("/recurring-payments/rp-1/execute", {
        method: "POST",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("exec-1");

      await runtime.dispose();
    });

    it("should return 400 when execution fails", async () => {
      const runtime = makeInternalTestRuntime({ executeFail: true });
      const app = makeInternalApp(runtime);

      const res = await app.request("/recurring-payments/rp-1/execute", {
        method: "POST",
      });
      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("GET /recurring-payments/:id/executions", () => {
    it("should return execution history", async () => {
      const runtime = makeInternalTestRuntime({
        executionHistory: [
          makeFakeExecution({ id: "exec-1" }),
          makeFakeExecution({ id: "exec-2" }),
        ],
      });
      const app = makeInternalApp(runtime);

      const res = await app.request("/recurring-payments/rp-1/executions");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);

      await runtime.dispose();
    });
  });

  describe("POST /recurring-payments/process", () => {
    it("should process due payments and return count", async () => {
      const runtime = makeInternalTestRuntime({
        processResult: [
          makeFakeExecution({ id: "exec-1" }),
          makeFakeExecution({ id: "exec-2" }),
        ],
      });
      const app = makeInternalApp(runtime);

      const res = await app.request("/recurring-payments/process", {
        method: "POST",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.processedCount).toBe(2);
      expect(body.data.executions).toHaveLength(2);

      await runtime.dispose();
    });

    it("should return zero count when no due payments", async () => {
      const runtime = makeInternalTestRuntime({ processResult: [] });
      const app = makeInternalApp(runtime);

      const res = await app.request("/recurring-payments/process", {
        method: "POST",
      });
      const body = await res.json();
      expect(body.data.processedCount).toBe(0);

      await runtime.dispose();
    });
  });
});
