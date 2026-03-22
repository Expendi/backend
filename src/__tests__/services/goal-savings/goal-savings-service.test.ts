import { describe, it, expect, vi } from "vitest";
import { Effect, Layer } from "effect";
import {
  GoalSavingsService,
  GoalSavingsServiceLive,
  GoalSavingsError,
} from "../../../services/goal-savings/goal-savings-service.js";
import { DatabaseService } from "../../../db/client.js";
import { YieldService, YieldError } from "../../../services/yield/yield-service.js";
import { OnboardingService } from "../../../services/onboarding/onboarding-service.js";
import { ConfigService } from "../../../config.js";
import type {
  GoalSaving,
  GoalSavingsDeposit,
} from "../../../db/schema/index.js";

const now = new Date("2025-01-15T12:00:00Z");

function makeFakeGoal(overrides?: Partial<GoalSaving>): GoalSaving {
  return {
    id: "goal-1",
    userId: "user-1",
    name: "Vacation Fund",
    description: null,
    targetAmount: "1000000",
    accumulatedAmount: "0",
    tokenAddress: "0xtoken",
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    status: "active",
    walletId: "wallet-1",
    walletType: "server",
    vaultId: "vault-1",
    chainId: 1,
    depositAmount: "100000",
    unlockTimeOffsetSeconds: 0,
    frequency: "1d",
    nextDepositAt: new Date(Date.now() - 60000),
    startDate: now,
    endDate: null,
    maxRetries: 3,
    consecutiveFailures: 0,
    totalDeposits: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeDeposit(
  overrides?: Partial<GoalSavingsDeposit>
): GoalSavingsDeposit {
  return {
    id: "dep-1",
    goalId: "goal-1",
    yieldPositionId: "pos-1",
    amount: "100000",
    depositType: "manual",
    status: "confirmed",
    error: null,
    depositedAt: now,
    ...overrides,
  };
}

function makeFakePosition(overrides?: Record<string, unknown>) {
  return {
    id: "pos-1",
    userId: "user-1",
    walletId: "wallet-1",
    walletType: "server",
    vaultId: "vault-1",
    amount: "100000",
    unlockTime: 0,
    label: "goal:goal-1",
    chainId: 1,
    status: "active",
    txHash: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

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
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve(resolveValue).then(resolve, reject);
  return chain;
};

function makeTestLayers(opts?: {
  selectResult?: unknown[];
  insertResult?: unknown[];
  updateResult?: unknown[];
  insertThrows?: Error;
  createPositionResult?: any;
  createPositionFail?: boolean;
  getAccruedYieldResult?: any;
  getProfileResult?: any;
}) {
  // We need separate chains for select, insert, update so they can return different values
  const selectChain = createChainableMock(opts?.selectResult ?? []);
  const insertChain = createChainableMock(
    opts?.insertThrows
      ? undefined
      : opts?.insertResult ?? [makeFakeGoal()]
  );
  if (opts?.insertThrows) {
    insertChain.then = (resolve: any, reject?: any) =>
      Promise.reject(opts.insertThrows).then(resolve, reject);
  }
  const updateChain = createChainableMock(
    opts?.updateResult ?? [makeFakeGoal()]
  );

  const mockDb = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
  };

  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: mockDb as any,
    pool: {} as any,
  });

  const MockYieldLayer = Layer.succeed(YieldService, {
    createPosition: () =>
      opts?.createPositionFail
        ? Effect.fail(new YieldError({ message: "yield failed" }))
        : Effect.succeed(
            opts?.createPositionResult ?? makeFakePosition()
          ),
    getAccruedYield: () =>
      Effect.succeed(
        opts?.getAccruedYieldResult ?? {
          positionId: "pos-1",
          principalAmount: "100000",
          currentAssets: "105000",
          accruedYield: "5000",
          estimatedApy: "5.0",
        }
      ),
    listVaults: () => Effect.succeed([]),
    getVault: () => Effect.succeed(undefined),
    addVault: () => Effect.succeed({} as any),
    removeVault: () => Effect.succeed({} as any),
    syncVaultsFromChain: () => Effect.succeed([]),
    getUserPositions: () => Effect.succeed([]),
    getPosition: () => Effect.succeed(undefined),
    withdrawPosition: () => Effect.succeed({} as any),
    syncPositionFromChain: () => Effect.succeed({} as any),
    snapshotYield: () => Effect.succeed({} as any),
    snapshotAllActivePositions: () => Effect.succeed([]),
    getYieldHistory: () => Effect.succeed([]),
    getPortfolioSummary: () => Effect.succeed({} as any),
    listAllPositions: () => Effect.succeed([]),
  });

  const MockOnboardingLayer = Layer.succeed(OnboardingService, {
    onboardUser: () => Effect.succeed({} as any),
    getProfile: () =>
      Effect.succeed(
        opts?.getProfileResult ?? {
          id: "profile-1",
          privyUserId: "user-1",
          serverWalletId: "resolved-wallet-1",
          agentWalletId: "resolved-agent-wallet-1",
          username: null,
          createdAt: now,
          updatedAt: now,
        }
      ),
    getProfileWithWallets: () => Effect.succeed({} as any),
    isOnboarded: () => Effect.succeed(true),
    setUsername: () => Effect.succeed({} as any),
    resolveUsername: () => Effect.succeed({} as any),
  } as any);

  const MockConfigLayer = Layer.succeed(ConfigService, {
    databaseUrl: "postgres://test",
    privyAppId: "test",
    privyAppSecret: "test",
    coinmarketcapApiKey: "test",
    adminApiKey: "test",
    defaultChainId: 1,
    port: 3000,
  });

  return {
    layer: GoalSavingsServiceLive.pipe(
      Layer.provide(MockDbLayer),
      Layer.provide(MockYieldLayer),
      Layer.provide(MockOnboardingLayer),
      Layer.provide(MockConfigLayer)
    ),
    mockDb,
  };
}

/**
 * Helper to build test layers where select/insert/update can each
 * return different values on successive calls.
 */
function makeTestLayersMultiCall(opts: {
  selectResults: unknown[][];
  insertResults?: unknown[][];
  updateResults?: unknown[][];
  createPositionFail?: boolean;
  createPositionResult?: any;
}) {
  let selectCallIndex = 0;
  const selectChainFactory = () => {
    const result =
      opts.selectResults[selectCallIndex] ??
      opts.selectResults[opts.selectResults.length - 1];
    selectCallIndex++;
    return createChainableMock(result);
  };

  let insertCallIndex = 0;
  const insertChainFactory = () => {
    const results = opts.insertResults ?? [[makeFakeDeposit()]];
    const result = results[insertCallIndex] ?? results[results.length - 1];
    insertCallIndex++;
    return createChainableMock(result);
  };

  let updateCallIndex = 0;
  const updateChainFactory = () => {
    const results = opts.updateResults ?? [[makeFakeGoal()]];
    const result = results[updateCallIndex] ?? results[results.length - 1];
    updateCallIndex++;
    return createChainableMock(result);
  };

  const mockDb = {
    select: vi.fn().mockImplementation(() => selectChainFactory()),
    insert: vi.fn().mockImplementation(() => insertChainFactory()),
    update: vi.fn().mockImplementation(() => updateChainFactory()),
  };

  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: mockDb as any,
    pool: {} as any,
  });

  const MockYieldLayer = Layer.succeed(YieldService, {
    createPosition: () =>
      opts.createPositionFail
        ? Effect.fail(new YieldError({ message: "yield failed" }))
        : Effect.succeed(opts.createPositionResult ?? makeFakePosition()),
    getAccruedYield: () =>
      Effect.succeed({
        positionId: "pos-1",
        principalAmount: "100000",
        currentAssets: "105000",
        accruedYield: "5000",
        estimatedApy: "5.0",
      }),
    listVaults: () => Effect.succeed([]),
    getVault: () => Effect.succeed(undefined),
    addVault: () => Effect.succeed({} as any),
    removeVault: () => Effect.succeed({} as any),
    syncVaultsFromChain: () => Effect.succeed([]),
    getUserPositions: () => Effect.succeed([]),
    getPosition: () => Effect.succeed(undefined),
    withdrawPosition: () => Effect.succeed({} as any),
    syncPositionFromChain: () => Effect.succeed({} as any),
    snapshotYield: () => Effect.succeed({} as any),
    snapshotAllActivePositions: () => Effect.succeed([]),
    getYieldHistory: () => Effect.succeed([]),
    getPortfolioSummary: () => Effect.succeed({} as any),
    listAllPositions: () => Effect.succeed([]),
  });

  const MockOnboardingLayer = Layer.succeed(OnboardingService, {
    onboardUser: () => Effect.succeed({} as any),
    getProfile: () =>
      Effect.succeed({
        id: "profile-1",
        privyUserId: "user-1",
        serverWalletId: "resolved-wallet-1",
        agentWalletId: "resolved-agent-wallet-1",
        username: null,
        createdAt: now,
        updatedAt: now,
      }),
    getProfileWithWallets: () => Effect.succeed({} as any),
    isOnboarded: () => Effect.succeed(true),
    setUsername: () => Effect.succeed({} as any),
    resolveUsername: () => Effect.succeed({} as any),
  } as any);

  const MockConfigLayer = Layer.succeed(ConfigService, {
    databaseUrl: "postgres://test",
    privyAppId: "test",
    privyAppSecret: "test",
    coinmarketcapApiKey: "test",
    adminApiKey: "test",
    defaultChainId: 1,
    port: 3000,
  });

  return {
    layer: GoalSavingsServiceLive.pipe(
      Layer.provide(MockDbLayer),
      Layer.provide(MockYieldLayer),
      Layer.provide(MockOnboardingLayer),
      Layer.provide(MockConfigLayer)
    ),
    mockDb,
  };
}

describe("GoalSavingsService", () => {
  // ── createGoal ──────────────────────────────────────────────────────

  describe("createGoal", () => {
    it("should create a goal with correct defaults (startDate, nextDepositAt, maxRetries)", async () => {
      const goal = makeFakeGoal({ maxRetries: 3 });
      const { layer } = makeTestLayers({ insertResult: [goal] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.createGoal({
            userId: "user-1",
            name: "Vacation Fund",
            targetAmount: "1000000",
            tokenAddress: "0xtoken",
            tokenSymbol: "USDC",
            tokenDecimals: 6,
            walletId: "wallet-1",
            frequency: "1d",
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.id).toBe("goal-1");
      expect(result.maxRetries).toBe(3);
      expect(result.startDate).toBeDefined();
    });

    it("should resolve walletId from OnboardingService when walletId not provided", async () => {
      const goal = makeFakeGoal({ walletId: "resolved-wallet-1" });
      const { layer } = makeTestLayers({ insertResult: [goal] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.createGoal({
            userId: "user-1",
            name: "Vacation Fund",
            targetAmount: "1000000",
            tokenAddress: "0xtoken",
            tokenSymbol: "USDC",
            tokenDecimals: 6,
            walletType: "server",
            frequency: "1d",
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.walletId).toBe("resolved-wallet-1");
    });

    it("should fail with GoalSavingsError on DB insert failure", async () => {
      const { layer } = makeTestLayers({
        insertThrows: new Error("DB write failed"),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc
            .createGoal({
              userId: "user-1",
              name: "Vacation Fund",
              targetAmount: "1000000",
              tokenAddress: "0xtoken",
              tokenSymbol: "USDC",
              tokenDecimals: 6,
              walletId: "wallet-1",
            })
            .pipe(
              Effect.matchEffect({
                onSuccess: () => Effect.succeed({ tag: "ok" as const }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(GoalSavingsError);
      }
    });
  });

  // ── getGoal ─────────────────────────────────────────────────────────

  describe("getGoal", () => {
    it("should return a goal when found", async () => {
      const goal = makeFakeGoal();
      const { layer } = makeTestLayers({ selectResult: [goal] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.getGoal("goal-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeDefined();
      expect(result!.id).toBe("goal-1");
    });

    it("should return undefined when not found", async () => {
      const { layer } = makeTestLayers({ selectResult: [] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.getGoal("nonexistent");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeUndefined();
    });
  });

  // ── listGoals ───────────────────────────────────────────────────────

  describe("listGoals", () => {
    it("should list goals for a user", async () => {
      const goals = [
        makeFakeGoal({ id: "goal-1" }),
        makeFakeGoal({ id: "goal-2" }),
      ];
      const { layer } = makeTestLayers({ selectResult: goals });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.listGoals("user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });

    it("should return empty array when user has no goals", async () => {
      const { layer } = makeTestLayers({ selectResult: [] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.listGoals("user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });

  // ── updateGoal ──────────────────────────────────────────────────────

  describe("updateGoal", () => {
    it("should update goal name", async () => {
      const updated = makeFakeGoal({ name: "New Name" });
      const { layer } = makeTestLayers({ updateResult: [updated] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.updateGoal("goal-1", { name: "New Name" });
        }).pipe(Effect.provide(layer))
      );

      expect(result.name).toBe("New Name");
    });

    it("should recalculate nextDepositAt when frequency is updated", async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const updated = makeFakeGoal({
        frequency: "1w",
        nextDepositAt: futureDate,
      });
      const { layer } = makeTestLayers({ updateResult: [updated] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.updateGoal("goal-1", { frequency: "1w" });
        }).pipe(Effect.provide(layer))
      );

      expect(result.frequency).toBe("1w");
      expect(result.nextDepositAt).toBeDefined();
      // nextDepositAt should be approximately 1 week from now
      expect(result.nextDepositAt!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  // ── pauseGoal ───────────────────────────────────────────────────────

  describe("pauseGoal", () => {
    it("should set status to paused", async () => {
      const paused = makeFakeGoal({ status: "paused" });
      const { layer } = makeTestLayers({ updateResult: [paused] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.pauseGoal("goal-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("paused");
    });
  });

  // ── resumeGoal ──────────────────────────────────────────────────────

  describe("resumeGoal", () => {
    it("should set status to active and reset consecutiveFailures", async () => {
      const pausedGoal = makeFakeGoal({
        status: "paused",
        consecutiveFailures: 2,
      });
      const resumed = makeFakeGoal({
        status: "active",
        consecutiveFailures: 0,
      });
      const { layer } = makeTestLayersMultiCall({
        selectResults: [[pausedGoal]],
        updateResults: [[resumed]],
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.resumeGoal("goal-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("active");
      expect(result.consecutiveFailures).toBe(0);
    });

    it("should fail when goal not found", async () => {
      const { layer } = makeTestLayersMultiCall({
        selectResults: [[]],
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.resumeGoal("nonexistent").pipe(
            Effect.matchEffect({
              onSuccess: () => Effect.succeed({ tag: "ok" as const }),
              onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
            })
          );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
    });
  });

  // ── cancelGoal ──────────────────────────────────────────────────────

  describe("cancelGoal", () => {
    it("should set status to cancelled", async () => {
      const cancelled = makeFakeGoal({ status: "cancelled" });
      const { layer } = makeTestLayers({ updateResult: [cancelled] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.cancelGoal("goal-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("cancelled");
    });
  });

  // ── deposit ─────────────────────────────────────────────────────────

  describe("deposit", () => {
    it("should create yield position and record deposit", async () => {
      const goal = makeFakeGoal();
      const pendingDeposit = makeFakeDeposit({ status: "pending" });
      const confirmedDeposit = makeFakeDeposit({ status: "confirmed" });

      const { layer } = makeTestLayersMultiCall({
        selectResults: [[goal]],
        insertResults: [[pendingDeposit]],
        // First update: confirm deposit; Second update: goal accumulation
        updateResults: [[confirmedDeposit], [makeFakeGoal({ accumulatedAmount: "100000", totalDeposits: 1 })]],
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.deposit({
            goalId: "goal-1",
            amount: "100000",
            depositType: "manual",
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.id).toBe("dep-1");
      expect(result.status).toBe("confirmed");
    });

    it("should fail when goal is cancelled", async () => {
      const cancelledGoal = makeFakeGoal({ status: "cancelled" });

      const { layer } = makeTestLayersMultiCall({
        selectResults: [[cancelledGoal]],
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc
            .deposit({
              goalId: "goal-1",
              amount: "100000",
              depositType: "manual",
            })
            .pipe(
              Effect.matchEffect({
                onSuccess: () => Effect.succeed({ tag: "ok" as const }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(GoalSavingsError);
      }
    });

    it("should update accumulatedAmount after deposit", async () => {
      const goal = makeFakeGoal({ accumulatedAmount: "50000" });
      const pendingDeposit = makeFakeDeposit({ amount: "100000", status: "pending" });
      const confirmedDeposit = makeFakeDeposit({ amount: "100000", status: "confirmed" });
      const updatedGoal = makeFakeGoal({
        accumulatedAmount: "150000",
        totalDeposits: 1,
      });

      const { layer, mockDb } = makeTestLayersMultiCall({
        selectResults: [[goal]],
        insertResults: [[pendingDeposit]],
        // First update: confirm deposit; Second update: goal accumulation
        updateResults: [[confirmedDeposit], [updatedGoal]],
      });

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.deposit({
            goalId: "goal-1",
            amount: "100000",
            depositType: "manual",
          });
        }).pipe(Effect.provide(layer))
      );

      // Verify that update was called (for accumulation)
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  // ── listDeposits ────────────────────────────────────────────────────

  describe("listDeposits", () => {
    it("should return deposits for goal", async () => {
      const deposits = [
        makeFakeDeposit({ id: "dep-1" }),
        makeFakeDeposit({ id: "dep-2" }),
      ];
      const { layer } = makeTestLayers({ selectResult: deposits });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.listDeposits("goal-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });
  });

  // ── getAccruedYield ─────────────────────────────────────────────────

  describe("getAccruedYield", () => {
    it("should return aggregated yield info from all positions", async () => {
      const deposits = [
        makeFakeDeposit({ id: "dep-1", yieldPositionId: "pos-1" }),
        makeFakeDeposit({ id: "dep-2", yieldPositionId: "pos-2" }),
      ];

      const { layer } = makeTestLayers({
        selectResult: deposits,
        getAccruedYieldResult: {
          positionId: "pos-1",
          principalAmount: "100000",
          currentAssets: "105000",
          accruedYield: "5000",
          estimatedApy: "5.0",
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.getAccruedYield("goal-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.goalId).toBe("goal-1");
      // Two deposits, each returning 100000 principal -> 200000 total
      expect(result.totalPrincipalAmount).toBe("200000");
      expect(result.totalCurrentAssets).toBe("210000");
      expect(result.totalAccruedYield).toBe("10000");
      expect(result.positions).toHaveLength(2);
    });

    it("should return zeros when no deposits", async () => {
      const { layer } = makeTestLayers({ selectResult: [] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.getAccruedYield("goal-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.totalPrincipalAmount).toBe("0");
      expect(result.totalCurrentAssets).toBe("0");
      expect(result.totalAccruedYield).toBe("0");
      expect(result.positions).toEqual([]);
    });
  });

  // ── processDueDeposits ──────────────────────────────────────────────

  describe("processDueDeposits", () => {
    it("should return empty array when no due goals", async () => {
      const { layer } = makeTestLayers({ selectResult: [] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.processDueDeposits();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });

    it("should process due goal deposits successfully", async () => {
      const dueGoal = makeFakeGoal({
        status: "active",
        frequency: "1d",
        depositAmount: "100000",
        nextDepositAt: new Date(Date.now() - 60000),
      });
      const pendingDeposit = makeFakeDeposit({ status: "pending" });
      const confirmedDeposit = makeFakeDeposit({ status: "confirmed" });

      const { layer } = makeTestLayersMultiCall({
        selectResults: [[dueGoal]],
        insertResults: [[pendingDeposit]],
        // Updates: 1) confirm deposit, 2) goal accumulation, 3) advance nextDepositAt
        updateResults: [[confirmedDeposit], [makeFakeGoal()], [makeFakeGoal()]],
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.processDueDeposits();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("dep-1");
    });

    it("should auto-pause goal after max consecutive failures", async () => {
      const dueGoal = makeFakeGoal({
        status: "active",
        frequency: "1d",
        depositAmount: "100000",
        consecutiveFailures: 2,
        maxRetries: 3,
        walletId: null, // will cause depositOne to fail (missing walletId)
        vaultId: null,  // also null to ensure failure even after profile resolution attempt
      });

      const pendingDeposit = makeFakeDeposit({ status: "pending" });
      const { layer, mockDb } = makeTestLayersMultiCall({
        selectResults: [[dueGoal]],
        // Insert: pending deposit; Updates: 1) mark failed, 2) increment failures & pause
        insertResults: [[pendingDeposit]],
        updateResults: [[makeFakeDeposit({ status: "failed" })], [makeFakeGoal({ status: "paused" })]],
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GoalSavingsService;
          return yield* svc.processDueDeposits();
        }).pipe(Effect.provide(layer))
      );

      // Deposit failed (no confirmed deposits returned)
      expect(result).toEqual([]);
      // update was called to increment failures and set status to paused
      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});
