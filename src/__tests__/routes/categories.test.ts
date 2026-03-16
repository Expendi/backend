import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createCategoryRoutes } from "../../routes/categories.js";
import { DatabaseService } from "../../db/client.js";
import type { TransactionCategory } from "../../db/schema/index.js";
import type { AuthVariables } from "../../middleware/auth.js";

const TEST_USER_ID = "test-user-123";
const now = new Date("2025-01-15T12:00:00Z");

function makeFakeCategory(
  overrides?: Partial<TransactionCategory>
): TransactionCategory {
  return {
    id: "cat-1",
    name: "Gas Fees",
    userId: TEST_USER_ID,
    description: "Transaction gas fees",
    createdAt: now,
    ...overrides,
  };
}

function makeTestRuntime(opts?: {
  listResult?: TransactionCategory[];
  getResult?: TransactionCategory | null;
  insertResult?: TransactionCategory[];
  updateResult?: TransactionCategory[];
  deleteResult?: TransactionCategory[];
  operationThrows?: Error;
}) {
  // Build a mock db that handles the chained query builder pattern.
  // GET / uses: db.select().from(table).where(...).orderBy(...)
  // GET /:id uses: db.select().from(table).where(...)
  // The mock needs to support both: .where() returning a result directly,
  // and .where().orderBy() for the list endpoint.
  const listData = opts?.listResult ?? [makeFakeCategory()];
  const getResultArray =
    opts?.getResult === null ? [] : [opts?.getResult ?? makeFakeCategory()];

  const mockOrderBy = vi.fn().mockResolvedValue(listData);
  const mockWhere = opts?.operationThrows
    ? vi.fn().mockRejectedValue(opts.operationThrows)
    : vi.fn().mockImplementation(() => {
        // Return an object that can either be awaited (for GET /:id)
        // or chained with .orderBy() (for GET /)
        const promise = Promise.resolve(getResultArray);
        return Object.assign(promise, { orderBy: mockOrderBy });
      });

  const mockFrom = vi.fn().mockReturnValue({
    where: mockWhere,
    orderBy: mockOrderBy,
  });

  const selectFn = vi.fn().mockReturnValue({ from: mockFrom });

  const insertReturning = opts?.operationThrows
    ? vi.fn().mockRejectedValue(opts.operationThrows)
    : vi.fn().mockResolvedValue(opts?.insertResult ?? [makeFakeCategory()]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturning = opts?.operationThrows
    ? vi.fn().mockRejectedValue(opts.operationThrows)
    : vi
        .fn()
        .mockResolvedValue(opts?.updateResult ?? [makeFakeCategory()]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  const deleteReturning = opts?.operationThrows
    ? vi.fn().mockRejectedValue(opts.operationThrows)
    : vi
        .fn()
        .mockResolvedValue(opts?.deleteResult ?? [makeFakeCategory()]);
  const deleteWhere = vi.fn().mockImplementation(() => {
    // Support both chained .returning() (for category delete) and
    // plain resolution (for category_limits delete which has no .returning())
    const promise = Promise.resolve([]);
    return Object.assign(promise, { returning: deleteReturning });
  });
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

/**
 * Creates a test Hono app with auth middleware that sets userId,
 * then mounts the category routes.
 */
function makeApp(runtime: ReturnType<typeof makeTestRuntime>) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", TEST_USER_ID);
    await next();
  });
  app.route("/", createCategoryRoutes(runtime as any));
  return app;
}

describe("Category Routes", () => {
  describe("GET /", () => {
    it("should return list of categories", async () => {
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

    it("should return empty array when no categories", async () => {
      const runtime = makeTestRuntime({ listResult: [] });
      const app = makeApp(runtime);

      const res = await app.request("/");
      const body = await res.json();
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("GET /:id", () => {
    it("should return a category by id", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/cat-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("cat-1");
      expect(body.data.name).toBe("Gas Fees");

      await runtime.dispose();
    });

    it("should return 400 when category not found", async () => {
      const runtime = makeTestRuntime({ getResult: null });
      const app = makeApp(runtime);

      const res = await app.request("/nonexistent");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /", () => {
    it("should create a category with required fields", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Category" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should create a category with optional fields", async () => {
      const cat = makeFakeCategory({
        userId: TEST_USER_ID,
        description: "A custom category",
      });
      const runtime = makeTestRuntime({ insertResult: [cat] });
      const app = makeApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Custom",
          description: "A custom category",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });
  });

  describe("POST /batch", () => {
    it("should batch create categories", async () => {
      const cats = [
        makeFakeCategory({ id: "cat-1", name: "Food" }),
        makeFakeCategory({ id: "cat-2", name: "Transport" }),
      ];
      const runtime = makeTestRuntime({ insertResult: cats });
      const app = makeApp(runtime);

      const res = await app.request("/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { name: "Food" },
          { name: "Transport" },
        ]),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(2);

      await runtime.dispose();
    });

    it("should return 400 for empty array", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([]),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("PUT /:id", () => {
    it("should update a category name", async () => {
      const updatedCat = makeFakeCategory({ name: "Updated Name" });
      const runtime = makeTestRuntime({ updateResult: [updatedCat] });
      const app = makeApp(runtime);

      const res = await app.request("/cat-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Name" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("Updated Name");

      await runtime.dispose();
    });

    it("should return 400 when updating non-existent category", async () => {
      const runtime = makeTestRuntime({ updateResult: [] });
      const app = makeApp(runtime);

      const res = await app.request("/nonexistent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Nope" }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("DELETE /:id", () => {
    it("should delete a category", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/cat-1", { method: "DELETE" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);

      await runtime.dispose();
    });

    it("should delete a category that has an associated limit", async () => {
      const runtime = makeTestRuntime({ deleteResult: [makeFakeCategory()] });
      const app = makeApp(runtime);

      const res = await app.request("/cat-1", { method: "DELETE" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
      await runtime.dispose();
    });

    it("should return 400 when deleting non-existent category", async () => {
      const runtime = makeTestRuntime({ deleteResult: [] });
      const app = makeApp(runtime);

      const res = await app.request("/nonexistent", { method: "DELETE" });
      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });
});
