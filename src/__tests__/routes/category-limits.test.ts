import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createCategoryRoutes } from "../../routes/categories.js";
import { DatabaseService } from "../../db/client.js";
import type { CategoryLimit } from "../../db/schema/index.js";
import type { AuthVariables } from "../../middleware/auth.js";

const TEST_USER_ID = "test-user-123";
const now = new Date("2025-01-15T12:00:00Z");

function makeFakeLimit(overrides?: Partial<CategoryLimit>): CategoryLimit {
  return {
    id: "limit-1",
    userId: TEST_USER_ID,
    categoryId: "cat-1",
    monthlyLimit: "500000000",
    tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeLimitWithCategory(overrides?: Partial<CategoryLimit>) {
  const limit = makeFakeLimit(overrides);
  return { ...limit, categoryName: "Food & Dining" };
}

/**
 * Build a mock runtime that intercepts chained drizzle query builder calls.
 */
function makeTestRuntime(opts?: {
  selectResult?: unknown[];
  insertResult?: unknown[];
  deleteResult?: unknown[];
  operationThrows?: Error;
}) {
  // select().from().innerJoin().where() — for GET /limits
  // select().from().where() — for GET /:id/limit
  const selectData = opts?.selectResult ?? [makeFakeLimitWithCategory()];

  const mockWhere = opts?.operationThrows
    ? vi.fn().mockRejectedValue(opts.operationThrows)
    : vi.fn().mockResolvedValue(selectData);

  const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
  const mockFrom = vi.fn().mockReturnValue({
    where: mockWhere,
    innerJoin: mockInnerJoin,
    orderBy: vi.fn().mockResolvedValue(selectData),
  });

  const selectFn = vi.fn().mockImplementation((fields?: unknown) => ({
    from: mockFrom,
  }));

  // insert().values().onConflictDoUpdate().returning()
  const insertReturning = opts?.operationThrows
    ? vi.fn().mockRejectedValue(opts.operationThrows)
    : vi.fn().mockResolvedValue(opts?.insertResult ?? [makeFakeLimit()]);
  const insertOnConflict = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertValues = vi
    .fn()
    .mockReturnValue({ onConflictDoUpdate: insertOnConflict, returning: insertReturning });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  // update — needed for PUT /:id on categories (the mock runtime is shared)
  const updateReturning = vi.fn().mockResolvedValue([]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  // delete().where().returning()
  const deleteReturning = opts?.operationThrows
    ? vi.fn().mockRejectedValue(opts.operationThrows)
    : vi.fn().mockResolvedValue(opts?.deleteResult ?? [makeFakeLimit()]);
  const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: {
      select: selectFn,
      insert: insertFn,
      update: updateFn,
      delete: deleteFn,
    } as any,
    pool: {} as any,
  });

  return ManagedRuntime.make(MockDbLayer);
}

function makeApp(runtime: ReturnType<typeof makeTestRuntime>) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", TEST_USER_ID);
    await next();
  });
  app.route("/", createCategoryRoutes(runtime as any));
  return app;
}

describe("Category Limit Routes", () => {
  describe("GET /limits", () => {
    it("should return all limits for the user", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/limits");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].categoryName).toBe("Food & Dining");

      await runtime.dispose();
    });

    it("should return empty array when no limits exist", async () => {
      const runtime = makeTestRuntime({ selectResult: [] });
      const app = makeApp(runtime);

      const res = await app.request("/limits");
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("GET /:id/limit", () => {
    it("should return limits for a category", async () => {
      const runtime = makeTestRuntime({
        selectResult: [makeFakeLimit()],
      });
      const app = makeApp(runtime);

      const res = await app.request("/cat-1/limit");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should return single limit when tokenAddress is provided", async () => {
      const runtime = makeTestRuntime({
        selectResult: [makeFakeLimit()],
      });
      const app = makeApp(runtime);

      const res = await app.request(
        "/cat-1/limit?tokenAddress=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("limit-1");

      await runtime.dispose();
    });

    it("should return 400 when limit not found with tokenAddress filter", async () => {
      const runtime = makeTestRuntime({ selectResult: [] });
      const app = makeApp(runtime);

      const res = await app.request("/cat-1/limit?tokenAddress=0xNONEXISTENT");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("PUT /:id/limit", () => {
    it("should create/update a category limit", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/cat-1/limit", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyLimit: "500000000",
          tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          tokenSymbol: "USDC",
          tokenDecimals: 6,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.monthlyLimit).toBe("500000000");

      await runtime.dispose();
    });

    it("should return 400 on invalid body", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/cat-1/limit", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("DELETE /:id/limit", () => {
    it("should delete a category limit", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/cat-1/limit", { method: "DELETE" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when deleting non-existent limit", async () => {
      const runtime = makeTestRuntime({ deleteResult: [] });
      const app = makeApp(runtime);

      const res = await app.request("/cat-1/limit", { method: "DELETE" });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });
});
