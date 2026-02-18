import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createInternalRoutes } from "../../routes/internal.js";
import {
  JobberService,
  JobberError,
} from "../../services/jobber/jobber-service.js";
import {
  TransactionService,
  TransactionError,
} from "../../services/transaction/transaction-service.js";
import {
  LedgerService,
  LedgerError,
} from "../../services/ledger/ledger-service.js";
import { WalletService } from "../../services/wallet/wallet-service.js";
import { DatabaseService } from "../../db/client.js";
import type { Job, Transaction } from "../../db/schema/index.js";

const now = new Date("2025-01-15T12:00:00Z");

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

function makeTestRuntime(opts?: {
  listResult?: Job[];
  getResult?: Job | null;
  createResult?: Job;
  createFail?: boolean;
  cancelResult?: Job;
  processResult?: Job[];
}) {
  const MockJobberLayer = Layer.succeed(JobberService, {
    listJobs: () => Effect.succeed(opts?.listResult ?? [makeFakeJob()]),
    getJob: (id: string) =>
      Effect.succeed(
        opts?.getResult === null
          ? undefined
          : (opts?.getResult ?? makeFakeJob({ id }))
      ),
    createJob: () =>
      opts?.createFail
        ? Effect.fail(new JobberError({ message: "create failed" }))
        : Effect.succeed(opts?.createResult ?? makeFakeJob()),
    cancelJob: (id: string) =>
      Effect.succeed(
        opts?.cancelResult ?? makeFakeJob({ id, status: "cancelled" })
      ),
    processDueJobs: () =>
      Effect.succeed(
        opts?.processResult ?? [makeFakeJob({ status: "running" as any })]
      ),
    startPolling: () => Effect.void,
  });

  // Internal routes also include wallet and transaction admin routes,
  // so we need to provide those services too.
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

  const selectFrom = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockResolvedValue([]),
  });
  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: { select: vi.fn().mockReturnValue({ from: selectFrom }) } as any,
    pool: {} as any,
  });

  const testLayer = Layer.mergeAll(
    MockJobberLayer,
    MockWalletServiceLayer,
    MockTxServiceLayer,
    MockLedgerLayer,
    MockDbLayer
  );

  return ManagedRuntime.make(testLayer);
}

/**
 * Creates a test Hono app that mounts the internal routes.
 * Internal routes are accessed via /jobs, /jobs/:id, etc.
 */
function makeApp(runtime: ReturnType<typeof makeTestRuntime>) {
  const app = new Hono();
  app.route("/", createInternalRoutes(runtime as any));
  return app;
}

describe("Job Routes (Internal)", () => {
  describe("GET /jobs", () => {
    it("should return list of jobs", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/jobs");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should return empty array when no jobs", async () => {
      const runtime = makeTestRuntime({ listResult: [] });
      const app = makeApp(runtime);

      const res = await app.request("/jobs");
      const body = await res.json();
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("GET /jobs/:id", () => {
    it("should return a job by id", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/jobs/job-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when job not found", async () => {
      const runtime = makeTestRuntime({ getResult: null });
      const app = makeApp(runtime);

      const res = await app.request("/jobs/nonexistent");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /jobs", () => {
    it("should create a new job", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New Job",
          jobType: "contract_transaction",
          schedule: "10m",
          payload: { walletId: "w1" },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when creation fails", async () => {
      const runtime = makeTestRuntime({ createFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Bad Job",
          jobType: "unknown",
          schedule: "5m",
          payload: {},
        }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("POST /jobs/:id/cancel", () => {
    it("should cancel a job", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/jobs/job-1/cancel", { method: "POST" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("cancelled");

      await runtime.dispose();
    });
  });

  describe("POST /jobs/process", () => {
    it("should process due jobs and return count", async () => {
      const runtime = makeTestRuntime({
        processResult: [makeFakeJob(), makeFakeJob({ id: "job-2" })],
      });
      const app = makeApp(runtime);

      const res = await app.request("/jobs/process", { method: "POST" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.processedCount).toBe(2);
      expect(body.data.jobs).toHaveLength(2);

      await runtime.dispose();
    });

    it("should return zero count when no due jobs", async () => {
      const runtime = makeTestRuntime({ processResult: [] });
      const app = makeApp(runtime);

      const res = await app.request("/jobs/process", { method: "POST" });
      const body = await res.json();
      expect(body.data.processedCount).toBe(0);

      await runtime.dispose();
    });
  });
});
