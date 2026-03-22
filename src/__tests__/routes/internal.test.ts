import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createInternalRoutes } from "../../routes/internal.js";
import { WalletService } from "../../services/wallet/wallet-service.js";
import { TransactionService } from "../../services/transaction/transaction-service.js";
import { LedgerService } from "../../services/ledger/ledger-service.js";
import { JobberService } from "../../services/jobber/jobber-service.js";
import {
  OnboardingService,
  type UserProfileWithWallets,
} from "../../services/onboarding/onboarding-service.js";
import { RecurringPaymentService } from "../../services/recurring-payment/recurring-payment-service.js";
import { YieldService } from "../../services/yield/yield-service.js";
import { GoalSavingsService } from "../../services/goal-savings/index.js";
import { DatabaseService } from "../../db/client.js";
import {
  wallets as walletsTable,
  userProfiles as userProfilesTable,
} from "../../db/schema/index.js";
import type {
  Wallet,
  UserProfile,
  Transaction,
  Job,
  RecurringPayment,
  RecurringPaymentExecution,
  YieldVault,
  YieldPosition,
  YieldSnapshot,
  GoalSavingsDeposit,
} from "../../db/schema/index.js";

const now = new Date("2025-01-15T12:00:00Z");

// ── Fake data factories ──────────────────────────────────────────────

function makeFakeWallet(overrides?: Partial<Wallet>): Wallet {
  return {
    id: "wallet-1",
    type: "server",
    privyWalletId: "privy-wallet-1",
    ownerId: "owner-1",
    address: "0xserver1234567890abcdef1234567890abcdef1234",
    chainId: "1",
    createdAt: now,
    ...overrides,
  };
}

function makeFakeProfile(overrides?: Partial<UserProfile>): UserProfile {
  return {
    id: "profile-1",
    privyUserId: "did:privy:user-1",
    userWalletId: "wallet-u1",
    serverWalletId: "wallet-s1",
    agentWalletId: "wallet-a1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as UserProfile;
}

function makeFakeProfileWithWallets(
  overrides?: Partial<UserProfileWithWallets>
): UserProfileWithWallets {
  return {
    ...makeFakeProfile(),
    userWallet: makeFakeWallet({ id: "wallet-u1", type: "user" }),
    serverWallet: makeFakeWallet({ id: "wallet-s1", type: "server" }),
    agentWallet: makeFakeWallet({ id: "wallet-a1", type: "agent" }),
    ...overrides,
  } as UserProfileWithWallets;
}

function makeFakeTransaction(overrides?: Partial<Transaction>): Transaction {
  return {
    id: "tx-1",
    walletId: "wallet-1",
    userId: "user-1",
    type: "transfer",
    status: "submitted",
    txHash: "0xabc123",
    fromAddress: "0xfrom",
    toAddress: "0xto",
    amount: "1000000",
    chainId: "1",
    gasUsed: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Transaction;
}

function makeFakeJob(overrides?: Partial<Job>): Job {
  return {
    id: "job-1",
    name: "Test Job",
    jobType: "recurring_payment",
    schedule: "1h",
    payload: { key: "value" },
    status: "active",
    maxRetries: 3,
    retryCount: 0,
    lastRunAt: null,
    nextRunAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Job;
}

function makeFakeRecurringPayment(
  overrides?: Partial<RecurringPayment>
): RecurringPayment {
  return {
    id: "rp-1",
    userId: "user-1",
    walletId: "wallet-1",
    recipientAddress: "0xrecipient",
    amount: "1000000",
    tokenAddress: "0xtoken",
    frequency: "weekly",
    status: "active",
    nextExecutionAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as RecurringPayment;
}

function makeFakeExecution(
  overrides?: Partial<RecurringPaymentExecution>
): RecurringPaymentExecution {
  return {
    id: "exec-1",
    scheduleId: "rp-1",
    status: "success",
    txHash: "0xexechash",
    executedAt: now,
    createdAt: now,
    ...overrides,
  } as RecurringPaymentExecution;
}

function makeFakeVault(overrides?: Partial<YieldVault>): YieldVault {
  return {
    id: "vault-1",
    vaultAddress: "0x1111111111111111111111111111111111111111",
    chainId: 1,
    name: "Test Vault",
    description: "A test vault",
    underlyingToken: "0x2222222222222222222222222222222222222222",
    underlyingSymbol: "USDC",
    underlyingDecimals: 6,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakePosition(overrides?: Partial<YieldPosition>): YieldPosition {
  return {
    id: "pos-1",
    userId: "user-1",
    walletId: "wallet-1",
    vaultId: "vault-1",
    onChainLockId: "1",
    principalAmount: "1000000000",
    shares: "950000000",
    unlockTime: new Date("2025-06-15T12:00:00Z"),
    label: "savings",
    status: "active",
    transactionId: "tx-1",
    chainId: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeSnapshot(overrides?: Partial<YieldSnapshot>): YieldSnapshot {
  return {
    id: "snap-1",
    positionId: "pos-1",
    currentAssets: "1050000000",
    accruedYield: "50000000",
    estimatedApy: "5.0000",
    snapshotAt: now,
    ...overrides,
  };
}

function makeFakeDeposit(
  overrides?: Partial<GoalSavingsDeposit>
): GoalSavingsDeposit {
  return {
    id: "deposit-1",
    goalId: "goal-1",
    amount: "500000",
    status: "completed",
    transactionId: "tx-1",
    createdAt: now,
    ...overrides,
  } as GoalSavingsDeposit;
}

// ── Test runtime factory ─────────────────────────────────────────────

function makeTestRuntime(opts?: {
  wallets?: Wallet[];
  profiles?: UserProfile[];
  transactions?: Transaction[];
  confirmedTransaction?: Transaction;
  failedTransaction?: Transaction;
  jobs?: Job[];
  getJob?: Job | null;
  createdJob?: Job;
  cancelledJob?: Job;
  processedJobs?: Job[];
  profileWithWallets?: UserProfileWithWallets;
  onboardedProfile?: UserProfile;
  recurringPayments?: RecurringPayment[];
  getSchedule?: RecurringPayment | null;
  execution?: RecurringPaymentExecution;
  executionHistory?: RecurringPaymentExecution[];
  processedPayments?: RecurringPaymentExecution[];
  vaults?: YieldVault[];
  addedVault?: YieldVault;
  removedVault?: YieldVault;
  syncedVaults?: YieldVault[];
  positions?: YieldPosition[];
  snapshots?: YieldSnapshot[];
  deposits?: GoalSavingsDeposit[];
  ledgerByWallet?: Transaction[];
  ledgerByUser?: Transaction[];
}) {
  // ── DatabaseService mock (chainable select → from → orderBy) ───
  // Track call order to distinguish wallets (first) vs profiles (second)
  let fromCallCount = 0;
  const mockDb = {
    select: () => {
      fromCallCount = 0;
      return {
        from: (table: any) => {
          fromCallCount++;
          // Use table name symbol for comparison since drizzle tables are Symbol-keyed
          const tableName = (table as any)?.[Symbol.for("drizzle:Name")] ?? String(table);
          return {
            orderBy: () => {
              if (tableName === "wallets" || table === walletsTable) {
                return Promise.resolve(opts?.wallets ?? [makeFakeWallet()]);
              }
              if (tableName === "user_profiles" || table === userProfilesTable) {
                return Promise.resolve(opts?.profiles ?? [makeFakeProfile()]);
              }
              return Promise.resolve([]);
            },
          };
        },
      };
    },
  };

  const MockDatabaseLayer = Layer.succeed(DatabaseService, {
    db: mockDb as any,
    pool: {} as any,
  });

  // ── WalletService mock ─────────────────────────────────────────
  const mockWalletInstance = {
    getAddress: () =>
      Effect.succeed("0xserver1234" as `0x${string}`),
    sign: () => Effect.succeed("0xsig" as `0x${string}`),
    sendTransaction: () =>
      Effect.succeed("0xhash" as `0x${string}`),
  };

  const MockWalletLayer = Layer.succeed(WalletService, {
    createUserWallet: () => Effect.succeed(mockWalletInstance),
    createServerWallet: () => Effect.succeed(mockWalletInstance),
    createAgentWallet: () => Effect.succeed(mockWalletInstance),
    getWallet: () => Effect.succeed(mockWalletInstance),
  } as any);

  // ── TransactionService mock ────────────────────────────────────
  const MockTransactionLayer = Layer.succeed(TransactionService, {
    submitContractTransaction: () =>
      Effect.succeed(makeFakeTransaction()),
    submitRawTransaction: () =>
      Effect.succeed(makeFakeTransaction()),
    getTransaction: () =>
      Effect.succeed(makeFakeTransaction()),
    listTransactions: () =>
      Effect.succeed(opts?.transactions ?? [makeFakeTransaction()]),
  } as any);

  // ── LedgerService mock ─────────────────────────────────────────
  const MockLedgerLayer = Layer.succeed(LedgerService, {
    createIntent: () => Effect.succeed(makeFakeTransaction()),
    markSubmitted: () => Effect.succeed(makeFakeTransaction()),
    markConfirmed: () =>
      Effect.succeed(
        opts?.confirmedTransaction ??
          makeFakeTransaction({ status: "confirmed" })
      ),
    markFailed: () =>
      Effect.succeed(
        opts?.failedTransaction ??
          makeFakeTransaction({ status: "failed" })
      ),
    getById: () => Effect.succeed(makeFakeTransaction()),
    listByWallet: () =>
      Effect.succeed(opts?.ledgerByWallet ?? [makeFakeTransaction()]),
    listByUser: () =>
      Effect.succeed(opts?.ledgerByUser ?? [makeFakeTransaction()]),
    listAll: () =>
      Effect.succeed(opts?.transactions ?? [makeFakeTransaction()]),
  } as any);

  // ── JobberService mock ─────────────────────────────────────────
  const MockJobberLayer = Layer.succeed(JobberService, {
    listJobs: () =>
      Effect.succeed(opts?.jobs ?? [makeFakeJob()]),
    getJob: (_id: string) =>
      Effect.succeed(
        opts?.getJob === null
          ? undefined
          : (opts?.getJob ?? makeFakeJob())
      ),
    createJob: () =>
      Effect.succeed(opts?.createdJob ?? makeFakeJob()),
    cancelJob: () =>
      Effect.succeed(
        opts?.cancelledJob ?? makeFakeJob({ status: "cancelled" as any })
      ),
    processDueJobs: () =>
      Effect.succeed(opts?.processedJobs ?? [makeFakeJob()]),
    startPolling: () => Effect.succeed(undefined),
  } as any);

  // ── OnboardingService mock ─────────────────────────────────────
  const MockOnboardingLayer = Layer.succeed(OnboardingService, {
    onboardUser: () =>
      Effect.succeed(opts?.onboardedProfile ?? makeFakeProfile()),
    getProfile: () => Effect.succeed(makeFakeProfile()),
    getProfileWithWallets: () =>
      Effect.succeed(
        opts?.profileWithWallets ?? makeFakeProfileWithWallets()
      ),
    isOnboarded: () => Effect.succeed(true),
    setUsername: () => Effect.succeed(makeFakeProfile()),
    resolveUsername: () =>
      Effect.succeed({ privyUserId: "did:privy:user-1", address: "0xaddr" }),
  } as any);

  // ── RecurringPaymentService mock ───────────────────────────────
  const MockRecurringPaymentLayer = Layer.succeed(RecurringPaymentService, {
    createSchedule: () =>
      Effect.succeed(makeFakeRecurringPayment()),
    getSchedule: (_id: string) =>
      Effect.succeed(
        opts?.getSchedule === null
          ? undefined
          : (opts?.getSchedule ?? makeFakeRecurringPayment())
      ),
    listSchedulesByUser: () =>
      Effect.succeed(opts?.recurringPayments ?? [makeFakeRecurringPayment()]),
    listAllSchedules: () =>
      Effect.succeed(opts?.recurringPayments ?? [makeFakeRecurringPayment()]),
    updateSchedule: () =>
      Effect.succeed(makeFakeRecurringPayment()),
    pauseSchedule: () =>
      Effect.succeed(makeFakeRecurringPayment()),
    resumeSchedule: () =>
      Effect.succeed(makeFakeRecurringPayment()),
    cancelSchedule: () =>
      Effect.succeed(makeFakeRecurringPayment()),
    getExecutionHistory: () =>
      Effect.succeed(opts?.executionHistory ?? [makeFakeExecution()]),
    processDuePayments: () =>
      Effect.succeed(opts?.processedPayments ?? [makeFakeExecution()]),
    executeSchedule: () =>
      Effect.succeed(opts?.execution ?? makeFakeExecution()),
  } as any);

  // ── YieldService mock ──────────────────────────────────────────
  const MockYieldLayer = Layer.succeed(YieldService, {
    listVaults: () =>
      Effect.succeed(opts?.vaults ?? [makeFakeVault()]),
    getVault: () => Effect.succeed(makeFakeVault()),
    addVault: () =>
      Effect.succeed(opts?.addedVault ?? makeFakeVault()),
    removeVault: () =>
      Effect.succeed(
        opts?.removedVault ?? makeFakeVault({ isActive: false })
      ),
    syncVaultsFromChain: () =>
      Effect.succeed(opts?.syncedVaults ?? [makeFakeVault()]),
    createPosition: () => Effect.succeed(makeFakePosition()),
    getUserPositions: () =>
      Effect.succeed(opts?.positions ?? [makeFakePosition()]),
    getPosition: () => Effect.succeed(makeFakePosition()),
    withdrawPosition: () => Effect.succeed(makeFakePosition()),
    syncPositionFromChain: () => Effect.succeed(makeFakePosition()),
    snapshotYield: () => Effect.succeed(makeFakeSnapshot()),
    snapshotAllActivePositions: () =>
      Effect.succeed(opts?.snapshots ?? [makeFakeSnapshot()]),
    getAccruedYield: () =>
      Effect.succeed({
        positionId: "pos-1",
        principalAmount: "1000000000",
        currentAssets: "1050000000",
        accruedYield: "50000000",
        estimatedApy: "5.0000",
      }),
    getYieldHistory: () => Effect.succeed([makeFakeSnapshot()]),
    getPortfolioSummary: () =>
      Effect.succeed({
        totalPrincipal: "1000000000",
        totalCurrentValue: "1050000000",
        totalYield: "50000000",
        averageApy: "5.0000",
        positionCount: 1,
      }),
    listAllPositions: () =>
      Effect.succeed(opts?.positions ?? [makeFakePosition()]),
  } as any);

  // ── GoalSavingsService mock ────────────────────────────────────
  const MockGoalSavingsLayer = Layer.succeed(GoalSavingsService, {
    createGoal: () => Effect.succeed({} as any),
    getGoal: () => Effect.succeed({} as any),
    listGoals: () => Effect.succeed([]),
    updateGoal: () => Effect.succeed({} as any),
    cancelGoal: () => Effect.succeed({} as any),
    deposit: () => Effect.succeed({} as any),
    withdraw: () => Effect.succeed({} as any),
    getAccruedYield: () => Effect.succeed({} as any),
    processDueDeposits: () =>
      Effect.succeed({ deposits: opts?.deposits ?? [makeFakeDeposit()], failures: [] }),
  } as any);

  const testLayer = Layer.mergeAll(
    MockDatabaseLayer,
    MockWalletLayer,
    MockTransactionLayer,
    MockLedgerLayer,
    MockJobberLayer,
    MockOnboardingLayer,
    MockRecurringPaymentLayer,
    MockYieldLayer,
    MockGoalSavingsLayer
  );

  return ManagedRuntime.make(testLayer);
}

function makeApp(runtime: ReturnType<typeof makeTestRuntime>) {
  const app = new Hono();
  app.route("/internal", createInternalRoutes(runtime as any));
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Internal/Admin Routes", () => {
  // ── Wallet routes ────────────────────────────────────────────────

  describe("GET /internal/wallets", () => {
    it("should return list of all wallets", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/wallets");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);

      await runtime.dispose();
    });

    it("should return empty array when no wallets", async () => {
      const runtime = makeTestRuntime({ wallets: [] });
      const app = makeApp(runtime);

      const res = await app.request("/internal/wallets");
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("POST /internal/wallets/server", () => {
    it("should create a server wallet and return address", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/wallets/server", {
        method: "POST",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.address).toBe("0xserver1234");
      expect(body.data.type).toBe("server");

      await runtime.dispose();
    });
  });

  describe("POST /internal/wallets/agent", () => {
    it("should create an agent wallet and return address", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/wallets/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-42" }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.address).toBe("0xserver1234");
      expect(body.data.type).toBe("agent");

      await runtime.dispose();
    });
  });

  // ── Transaction routes ───────────────────────────────────────────

  describe("GET /internal/transactions", () => {
    it("should return list of all transactions", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/transactions");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should accept limit and offset query params", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request(
        "/internal/transactions?limit=10&offset=5"
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });
  });

  describe("GET /internal/transactions/wallet/:walletId", () => {
    it("should return transactions for a wallet", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/transactions/wallet/wallet-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });
  });

  describe("GET /internal/transactions/user/:userId", () => {
    it("should return transactions for a user", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/transactions/user/user-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });
  });

  describe("PATCH /internal/transactions/:id/confirm", () => {
    it("should mark a transaction as confirmed", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/transactions/tx-1/confirm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gasUsed: "21000" }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("confirmed");

      await runtime.dispose();
    });

    it("should work without gasUsed in body", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/transactions/tx-1/confirm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });
  });

  describe("PATCH /internal/transactions/:id/fail", () => {
    it("should mark a transaction as failed", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/transactions/tx-1/fail", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "out of gas" }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("failed");

      await runtime.dispose();
    });
  });

  // ── Job routes ───────────────────────────────────────────────────

  describe("GET /internal/jobs", () => {
    it("should return list of all jobs", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/jobs");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should return empty array when no jobs", async () => {
      const runtime = makeTestRuntime({ jobs: [] });
      const app = makeApp(runtime);

      const res = await app.request("/internal/jobs");
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("GET /internal/jobs/:id", () => {
    it("should return a job by id", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/jobs/job-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when job not found", async () => {
      const runtime = makeTestRuntime({ getJob: null });
      const app = makeApp(runtime);

      const res = await app.request("/internal/jobs/nonexistent");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /internal/jobs", () => {
    it("should create a new job", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New Job",
          jobType: "recurring_payment",
          schedule: "1h",
          payload: { target: "all" },
          maxRetries: 5,
        }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("Test Job");

      await runtime.dispose();
    });
  });

  describe("POST /internal/jobs/:id/cancel", () => {
    it("should cancel a job", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/jobs/job-1/cancel", {
        method: "POST",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });
  });

  describe("POST /internal/jobs/process", () => {
    it("should process due jobs and return count", async () => {
      const runtime = makeTestRuntime({
        processedJobs: [makeFakeJob(), makeFakeJob({ id: "job-2" })],
      });
      const app = makeApp(runtime);

      const res = await app.request("/internal/jobs/process", {
        method: "POST",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.processedCount).toBe(2);
      expect(Array.isArray(body.data.jobs)).toBe(true);

      await runtime.dispose();
    });
  });

  // ── Profile routes ───────────────────────────────────────────────

  describe("GET /internal/profiles", () => {
    it("should return list of all profiles", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/profiles");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should return empty array when no profiles", async () => {
      const runtime = makeTestRuntime({ profiles: [] });
      const app = makeApp(runtime);

      const res = await app.request("/internal/profiles");
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("GET /internal/profiles/:privyUserId", () => {
    it("should return a profile with wallets", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/profiles/did:privy:user-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });
  });

  describe("POST /internal/profiles/:privyUserId/onboard", () => {
    it("should admin-onboard a user and return profile with wallets", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request(
        "/internal/profiles/did:privy:user-1/onboard",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chainId: 1 }),
        }
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.profile).toBeDefined();
      expect(body.data.wallets).toBeDefined();

      await runtime.dispose();
    });
  });

  // ── Recurring payment routes ─────────────────────────────────────

  describe("GET /internal/recurring-payments", () => {
    it("should return list of all recurring payment schedules", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/recurring-payments");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should accept limit and offset query params", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request(
        "/internal/recurring-payments?limit=10&offset=5"
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });
  });

  describe("GET /internal/recurring-payments/:id", () => {
    it("should return a schedule by id", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/recurring-payments/rp-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when schedule not found", async () => {
      const runtime = makeTestRuntime({ getSchedule: null });
      const app = makeApp(runtime);

      const res = await app.request(
        "/internal/recurring-payments/nonexistent"
      );
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /internal/recurring-payments/:id/execute", () => {
    it("should force-execute a schedule", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request(
        "/internal/recurring-payments/rp-1/execute",
        { method: "POST" }
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });
  });

  describe("GET /internal/recurring-payments/:id/executions", () => {
    it("should return execution history", async () => {
      const runtime = makeTestRuntime({
        executionHistory: [
          makeFakeExecution({ id: "exec-1" }),
          makeFakeExecution({ id: "exec-2" }),
        ],
      });
      const app = makeApp(runtime);

      const res = await app.request(
        "/internal/recurring-payments/rp-1/executions"
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);

      await runtime.dispose();
    });
  });

  describe("POST /internal/recurring-payments/process", () => {
    it("should process due payments and return count", async () => {
      const runtime = makeTestRuntime({
        processedPayments: [
          makeFakeExecution(),
          makeFakeExecution({ id: "exec-2" }),
        ],
      });
      const app = makeApp(runtime);

      const res = await app.request("/internal/recurring-payments/process", {
        method: "POST",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.processedCount).toBe(2);
      expect(Array.isArray(body.data.executions)).toBe(true);

      await runtime.dispose();
    });
  });

  // ── Yield routes ─────────────────────────────────────────────────

  describe("GET /internal/yield/vaults", () => {
    it("should return list of all vaults including inactive", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/yield/vaults");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should accept chainId query param", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/yield/vaults?chainId=1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return empty array when no vaults", async () => {
      const runtime = makeTestRuntime({ vaults: [] });
      const app = makeApp(runtime);

      const res = await app.request("/internal/yield/vaults");
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("POST /internal/yield/vaults", () => {
    it("should add a new vault", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/yield/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vaultAddress: "0xnewvault",
          chainId: 1,
          name: "New Vault",
          description: "A new test vault",
          underlyingToken: "0xtoken",
          underlyingSymbol: "USDC",
          underlyingDecimals: 6,
        }),
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("Test Vault");

      await runtime.dispose();
    });
  });

  describe("DELETE /internal/yield/vaults/:id", () => {
    it("should deactivate a vault", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/yield/vaults/vault-1", {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.isActive).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /internal/yield/vaults/sync", () => {
    it("should sync vaults from chain", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/yield/vaults/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId: 1 }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });
  });

  describe("GET /internal/yield/positions", () => {
    it("should return list of all positions", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/internal/yield/positions");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should accept limit and offset query params", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request(
        "/internal/yield/positions?limit=10&offset=0"
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });
  });

  describe("POST /internal/yield/snapshots/run", () => {
    it("should trigger snapshots for all active positions", async () => {
      const runtime = makeTestRuntime({
        snapshots: [
          makeFakeSnapshot({ id: "snap-1" }),
          makeFakeSnapshot({ id: "snap-2" }),
        ],
      });
      const app = makeApp(runtime);

      const res = await app.request("/internal/yield/snapshots/run", {
        method: "POST",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.snapshotCount).toBe(2);
      expect(Array.isArray(body.data.snapshots)).toBe(true);

      await runtime.dispose();
    });
  });

  // ── Goal savings routes ──────────────────────────────────────────

  describe("POST /internal/goal-savings/process", () => {
    it("should process due deposits and return count", async () => {
      const runtime = makeTestRuntime({
        deposits: [
          makeFakeDeposit(),
          makeFakeDeposit({ id: "deposit-2" }),
        ],
      });
      const app = makeApp(runtime);

      const res = await app.request("/internal/goal-savings/process", {
        method: "POST",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.processedCount).toBe(2);
      expect(Array.isArray(body.data.deposits)).toBe(true);

      await runtime.dispose();
    });

    it("should return zero count when no due deposits", async () => {
      const runtime = makeTestRuntime({ deposits: [] });
      const app = makeApp(runtime);

      const res = await app.request("/internal/goal-savings/process", {
        method: "POST",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.processedCount).toBe(0);
      expect(body.data.deposits).toEqual([]);

      await runtime.dispose();
    });
  });
});
