import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createSplitExpenseRoutes } from "../../routes/split-expenses.js";
import {
  SplitExpenseService,
  SplitExpenseError,
  type SplitExpenseWithShares,
} from "../../services/split-expense/split-expense-service.js";
import type {
  SplitExpense,
  SplitExpenseShare,
} from "../../db/schema/index.js";

const now = new Date("2025-06-15T12:00:00Z");

function makeFakeExpense(overrides?: Partial<SplitExpense>): SplitExpense {
  return {
    id: "exp-1",
    creatorUserId: "user-1",
    title: "Dinner",
    tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    totalAmount: "50000000",
    chainId: 8453,
    transactionId: null,
    categoryId: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeShare(
  overrides?: Partial<SplitExpenseShare & { username: string | null }>
): SplitExpenseShare & { username: string | null } {
  return {
    id: "share-1",
    expenseId: "exp-1",
    debtorUserId: "user-2",
    amount: "25000000",
    status: "pending",
    transactionId: null,
    paidAt: null,
    createdAt: now,
    username: "bob",
    ...overrides,
  };
}

function makeFakeExpenseWithShares(
  overrides?: Partial<SplitExpenseWithShares>
): SplitExpenseWithShares {
  return {
    ...makeFakeExpense(),
    shares: [
      makeFakeShare(),
      makeFakeShare({
        id: "share-2",
        debtorUserId: "user-3",
        username: "charlie",
      }),
    ],
    ...overrides,
  };
}

function makeTestRuntime(opts?: {
  createResult?: SplitExpenseWithShares;
  createFail?: boolean;
  getResult?: SplitExpenseWithShares;
  getFail?: boolean;
  listResult?: SplitExpense[];
  payResult?: SplitExpenseShare;
  payFail?: boolean;
  cancelResult?: SplitExpense;
  cancelFail?: boolean;
}) {
  const MockSplitExpenseLayer = Layer.succeed(SplitExpenseService, {
    createExpense: () =>
      opts?.createFail
        ? Effect.fail(new SplitExpenseError({ message: "create failed" }))
        : Effect.succeed(opts?.createResult ?? makeFakeExpenseWithShares()),

    getExpense: (id: string) =>
      opts?.getFail
        ? Effect.fail(
            new SplitExpenseError({ message: `Expense not found: ${id}` })
          )
        : Effect.succeed(
            opts?.getResult ?? makeFakeExpenseWithShares({ id })
          ),

    listByUser: () =>
      Effect.succeed(opts?.listResult ?? [makeFakeExpense()]),

    payShare: () =>
      opts?.payFail
        ? Effect.fail(new SplitExpenseError({ message: "pay failed" }))
        : Effect.succeed(
            opts?.payResult ??
              makeFakeShare({ status: "paid", paidAt: now, transactionId: "tx-1" })
          ),

    cancelExpense: () =>
      opts?.cancelFail
        ? Effect.fail(new SplitExpenseError({ message: "cancel failed" }))
        : Effect.succeed(
            opts?.cancelResult ?? makeFakeExpense({ status: "cancelled" })
          ),
  });

  return ManagedRuntime.make(Layer.mergeAll(MockSplitExpenseLayer));
}

function makeApp(runtime: ReturnType<typeof makeTestRuntime>) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId" as any, "user-1");
    await next();
  });
  app.route("/", createSplitExpenseRoutes(runtime as any));
  return app;
}

describe("Split Expense Routes", () => {
  describe("POST /", () => {
    it("should create a split expense", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Dinner",
          tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          tokenSymbol: "USDC",
          tokenDecimals: 6,
          totalAmount: "50000000",
          chainId: 8453,
          shares: [
            { userId: "user-2", amount: "25000000" },
            { userId: "user-3", amount: "25000000" },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.title).toBe("Dinner");
      expect(body.data.shares).toHaveLength(2);

      await runtime.dispose();
    });

    it("should create a split expense with a categoryId", async () => {
      const expense = makeFakeExpense({ categoryId: "cat-1" });
      const runtime = makeTestRuntime({
        createResult: makeFakeExpenseWithShares({ ...expense }),
      });
      const app = makeApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Dinner",
          tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          tokenSymbol: "USDC",
          tokenDecimals: 6,
          totalAmount: "50000000",
          chainId: 8453,
          categoryId: "cat-1",
          shares: [{ userId: "user-2", amount: "25000000" }],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.categoryId).toBe("cat-1");

      await runtime.dispose();
    });

    it("should return 400 when creation fails", async () => {
      const runtime = makeTestRuntime({ createFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Dinner",
          tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          tokenSymbol: "USDC",
          tokenDecimals: 6,
          totalAmount: "50000000",
          chainId: 8453,
          shares: [{ userId: "nonexistent", amount: "25000000" }],
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("GET /", () => {
    it("should return list of user expenses", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);

      await runtime.dispose();
    });

    it("should return empty array when no expenses", async () => {
      const runtime = makeTestRuntime({ listResult: [] });
      const app = makeApp(runtime);

      const res = await app.request("/");
      const body = await res.json();
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("GET /:id", () => {
    it("should return expense with shares", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/exp-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.shares).toBeDefined();
      expect(body.data.shares).toHaveLength(2);

      await runtime.dispose();
    });

    it("should return 400 when expense not found", async () => {
      const runtime = makeTestRuntime({ getFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/nonexistent");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /:id/pay", () => {
    it("should pay a share", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/share-1/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          walletType: "server",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("paid");
      expect(body.data.transactionId).toBe("tx-1");

      await runtime.dispose();
    });

    it("should return 400 when payment fails", async () => {
      const runtime = makeTestRuntime({ payFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/share-1/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          walletType: "server",
        }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("DELETE /:id", () => {
    it("should cancel an expense", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/exp-1", { method: "DELETE" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("cancelled");

      await runtime.dispose();
    });

    it("should return 400 when cancel fails", async () => {
      const runtime = makeTestRuntime({ cancelFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/exp-1", { method: "DELETE" });
      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });
});
