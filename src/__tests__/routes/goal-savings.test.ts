import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createGoalSavingsRoutes } from "../../routes/goal-savings.js";
import {
  GoalSavingsService,
  GoalSavingsError,
  type GoalAccruedYieldInfo,
} from "../../services/goal-savings/goal-savings-service.js";
import type {
  GoalSaving,
  GoalSavingsDeposit,
} from "../../db/schema/index.js";

const now = new Date("2025-06-15T12:00:00Z");

function makeFakeGoal(overrides?: Partial<GoalSaving>): GoalSaving {
  return {
    id: "goal-1",
    userId: "user-1",
    name: "House Fund",
    description: null,
    targetAmount: "1000000000",
    accumulatedAmount: "0",
    tokenAddress: "0xUSDC",
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    status: "active",
    walletId: "wallet-1",
    walletType: "server",
    vaultId: "vault-1",
    chainId: 8453,
    depositAmount: "100000000",
    unlockTimeOffsetSeconds: 86400,
    frequency: "7d",
    nextDepositAt: now,
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
    amount: "100000000",
    depositType: "manual",
    status: "confirmed",
    error: null,
    depositedAt: now,
    ...overrides,
  };
}

function makeTestRuntime(opts?: {
  createResult?: GoalSaving;
  createFail?: boolean;
  getResult?: GoalSaving | undefined;
  getFail?: boolean;
  listResult?: GoalSaving[];
  updateResult?: GoalSaving;
  pauseResult?: GoalSaving;
  resumeResult?: GoalSaving;
  cancelResult?: GoalSaving;
  depositResult?: GoalSavingsDeposit;
  depositFail?: boolean;
  listDepositsResult?: GoalSavingsDeposit[];
  accruedYieldResult?: GoalAccruedYieldInfo;
  accruedYieldFail?: boolean;
  processDueResult?: GoalSavingsDeposit[];
}) {
  const MockGoalSavingsLayer = Layer.succeed(GoalSavingsService, {
    createGoal: () =>
      opts?.createFail
        ? Effect.fail(new GoalSavingsError({ message: "create failed" }))
        : Effect.succeed(opts?.createResult ?? makeFakeGoal()),

    getGoal: (id: string) =>
      opts?.getFail
        ? Effect.fail(new GoalSavingsError({ message: "not found" }))
        : Effect.succeed(opts?.getResult ?? makeFakeGoal({ id })),

    listGoals: () =>
      Effect.succeed(opts?.listResult ?? [makeFakeGoal()]),

    updateGoal: (id: string) =>
      Effect.succeed(
        opts?.updateResult ?? makeFakeGoal({ id, name: "Updated" })
      ),

    pauseGoal: (id: string) =>
      Effect.succeed(
        opts?.pauseResult ?? makeFakeGoal({ id, status: "paused" })
      ),

    resumeGoal: (id: string) =>
      Effect.succeed(
        opts?.resumeResult ?? makeFakeGoal({ id, status: "active" })
      ),

    cancelGoal: (id: string) =>
      Effect.succeed(
        opts?.cancelResult ?? makeFakeGoal({ id, status: "cancelled" })
      ),

    deposit: () =>
      opts?.depositFail
        ? Effect.fail(new GoalSavingsError({ message: "deposit failed" }))
        : Effect.succeed(opts?.depositResult ?? makeFakeDeposit()),

    listDeposits: () =>
      Effect.succeed(opts?.listDepositsResult ?? [makeFakeDeposit()]),

    getAccruedYield: (goalId: string) =>
      opts?.accruedYieldFail
        ? Effect.fail(new GoalSavingsError({ message: "yield fetch failed" }))
        : Effect.succeed(
            opts?.accruedYieldResult ?? {
              goalId,
              totalPrincipalAmount: "1000000000",
              totalCurrentAssets: "1050000000",
              totalAccruedYield: "50000000",
              positions: [
                {
                  positionId: "pos-1",
                  principalAmount: "1000000000",
                  currentAssets: "1050000000",
                  accruedYield: "50000000",
                  estimatedApy: "5.0000",
                },
              ],
            }
          ),

    processDueDeposits: () =>
      Effect.succeed({ deposits: opts?.processDueResult ?? [], failures: [] }),
  });

  return ManagedRuntime.make(Layer.mergeAll(MockGoalSavingsLayer));
}

function makeApp(runtime: ReturnType<typeof makeTestRuntime>) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId" as any, "user-1");
    await next();
  });
  app.route("/", createGoalSavingsRoutes(runtime as any));
  return app;
}

describe("Goal Savings Routes", () => {
  describe("GET /", () => {
    it("should list user goals", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe("House Fund");

      await runtime.dispose();
    });

    it("should return empty array when no goals", async () => {
      const runtime = makeTestRuntime({ listResult: [] });
      const app = makeApp(runtime);

      const res = await app.request("/");
      const body = await res.json();
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("POST /", () => {
    it("should create a goal", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "House Fund",
          targetAmount: "1000000000",
          tokenAddress: "0xUSDC",
          tokenSymbol: "USDC",
          tokenDecimals: 6,
          walletId: "wallet-1",
          walletType: "server",
          vaultId: "vault-1",
          chainId: 8453,
          depositAmount: "100000000",
          frequency: "7d",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("House Fund");

      await runtime.dispose();
    });

    it("should return 400 when creation fails", async () => {
      const runtime = makeTestRuntime({ createFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test",
          targetAmount: "100",
          tokenAddress: "0x1",
          tokenSymbol: "TST",
          tokenDecimals: 18,
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("GET /:id", () => {
    it("should return goal by id", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/goal-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("goal-1");

      await runtime.dispose();
    });

    it("should return 400 for non-existent goal", async () => {
      const runtime = makeTestRuntime({ getFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/nonexistent");
      expect(res.status).toBe(400);

      await runtime.dispose();
    });

    it("should return 400 for goal owned by another user", async () => {
      const runtime = makeTestRuntime({
        getResult: makeFakeGoal({ userId: "other-user" }),
      });
      const app = makeApp(runtime);

      const res = await app.request("/goal-1");
      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("PATCH /:id", () => {
    it("should update a goal", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/goal-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("Updated");

      await runtime.dispose();
    });
  });

  describe("POST /:id/pause", () => {
    it("should pause a goal", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/goal-1/pause", { method: "POST" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.status).toBe("paused");

      await runtime.dispose();
    });
  });

  describe("POST /:id/resume", () => {
    it("should resume a goal", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/goal-1/resume", { method: "POST" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.status).toBe("active");

      await runtime.dispose();
    });
  });

  describe("POST /:id/cancel", () => {
    it("should cancel a goal", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/goal-1/cancel", { method: "POST" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.status).toBe("cancelled");

      await runtime.dispose();
    });
  });

  describe("POST /:id/deposit", () => {
    it("should make a manual deposit", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/goal-1/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: "100000000",
          walletId: "wallet-1",
          walletType: "server",
          vaultId: "vault-1",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.amount).toBe("100000000");
      expect(body.data.status).toBe("confirmed");

      await runtime.dispose();
    });

    it("should return 400 when deposit fails", async () => {
      const runtime = makeTestRuntime({ depositFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/goal-1/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: "100000000" }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("GET /:id/accrued-yield", () => {
    it("should return aggregated accrued yield for a goal", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/goal-1/accrued-yield");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.goalId).toBe("goal-1");
      expect(body.data.totalPrincipalAmount).toBe("1000000000");
      expect(body.data.totalCurrentAssets).toBe("1050000000");
      expect(body.data.totalAccruedYield).toBe("50000000");
      expect(body.data.positions).toHaveLength(1);

      await runtime.dispose();
    });

    it("should return 400 for goal owned by another user", async () => {
      const runtime = makeTestRuntime({
        getResult: makeFakeGoal({ userId: "other-user" }),
      });
      const app = makeApp(runtime);

      const res = await app.request("/goal-1/accrued-yield");
      expect(res.status).toBe(400);

      await runtime.dispose();
    });

    it("should return 400 when goal not found", async () => {
      const runtime = makeTestRuntime({ getFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/nonexistent/accrued-yield");
      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("GET /:id/deposits", () => {
    it("should list deposits for a goal", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/goal-1/deposits");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);

      await runtime.dispose();
    });
  });
});
