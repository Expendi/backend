import { Hono } from "hono";
import { Effect } from "effect";
import { eq, or, isNull, and, gte, sql } from "drizzle-orm";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { DatabaseService } from "../db/client.js";
import {
  transactionCategories,
  categoryLimits,
  transactions,
} from "../db/schema/index.js";
import type { AuthVariables } from "../middleware/auth.js";

/**
 * Public category routes -- all behind Privy auth middleware.
 * Users can see global (userId IS NULL) categories plus their own.
 * Write operations are scoped to the authenticated user.
 */
export function createCategoryRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // ── Category Limits ────────────────────────────────────────────────

  // Get all limits for the authenticated user
  app.get("/limits", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;
        return yield* Effect.tryPromise({
          try: () =>
            db
              .select({
                id: categoryLimits.id,
                userId: categoryLimits.userId,
                categoryId: categoryLimits.categoryId,
                monthlyLimit: categoryLimits.monthlyLimit,
                tokenAddress: categoryLimits.tokenAddress,
                tokenSymbol: categoryLimits.tokenSymbol,
                tokenDecimals: categoryLimits.tokenDecimals,
                categoryName: transactionCategories.name,
                createdAt: categoryLimits.createdAt,
                updatedAt: categoryLimits.updatedAt,
              })
              .from(categoryLimits)
              .innerJoin(
                transactionCategories,
                eq(categoryLimits.categoryId, transactionCategories.id)
              )
              .where(eq(categoryLimits.userId, userId)),
          catch: (error) => new Error(`Failed to list category limits: ${error}`),
        });
      }),
      c
    )
  );

  // Get limit for a specific category
  app.get("/:id/limit", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const categoryId = c.req.param("id");
        const userId = c.get("userId");
        const tokenAddress = c.req.query("tokenAddress");
        const { db } = yield* DatabaseService;

        const conditions = [
          eq(categoryLimits.userId, userId),
          eq(categoryLimits.categoryId, categoryId),
        ];
        if (tokenAddress) {
          conditions.push(eq(categoryLimits.tokenAddress, tokenAddress));
        }

        const results = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(categoryLimits)
              .where(and(...conditions)),
          catch: (error) => new Error(`Failed to get category limit: ${error}`),
        });

        if (tokenAddress) {
          if (!results[0]) {
            return yield* Effect.fail(new Error("Category limit not found"));
          }
          return results[0];
        }
        return results;
      }),
      c
    )
  );

  // Set/update limit for a category (upsert)
  app.put("/:id/limit", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const categoryId = c.req.param("id");
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              monthlyLimit: string;
              tokenAddress: string;
              tokenSymbol: string;
              tokenDecimals: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const { db } = yield* DatabaseService;

        const [result] = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(categoryLimits)
              .values({
                userId,
                categoryId,
                monthlyLimit: body.monthlyLimit,
                tokenAddress: body.tokenAddress,
                tokenSymbol: body.tokenSymbol,
                tokenDecimals: body.tokenDecimals,
              })
              .onConflictDoUpdate({
                target: [
                  categoryLimits.userId,
                  categoryLimits.categoryId,
                  categoryLimits.tokenAddress,
                ],
                set: {
                  monthlyLimit: body.monthlyLimit,
                  tokenSymbol: body.tokenSymbol,
                  tokenDecimals: body.tokenDecimals,
                  updatedAt: new Date(),
                },
              })
              .returning(),
          catch: (error) =>
            new Error(`Failed to set category limit: ${error}`),
        });
        return result!;
      }),
      c
    )
  );

  // Remove limit for a category
  app.delete("/:id/limit", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const categoryId = c.req.param("id");
        const userId = c.get("userId");
        const tokenAddress = c.req.query("tokenAddress");
        const { db } = yield* DatabaseService;

        const conditions = [
          eq(categoryLimits.userId, userId),
          eq(categoryLimits.categoryId, categoryId),
        ];
        if (tokenAddress) {
          conditions.push(eq(categoryLimits.tokenAddress, tokenAddress));
        }

        const results = yield* Effect.tryPromise({
          try: () =>
            db
              .delete(categoryLimits)
              .where(and(...conditions))
              .returning(),
          catch: (error) =>
            new Error(`Failed to delete category limit: ${error}`),
        });
        if (results.length === 0) {
          return yield* Effect.fail(new Error("Category limit not found"));
        }
        return { deleted: true, count: results.length };
      }),
      c
    )
  );

  // ── Spending Analytics ───────────────────────────────────────────

  // Get spending per category for a given period (default: current month)
  app.get("/spending", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;

        // Period: default to start of current month
        const sinceParam = c.req.query("since");
        const since = sinceParam ? new Date(sinceParam) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

        // Get all confirmed transactions with a category for this user since the period
        const rows = yield* Effect.tryPromise({
          try: () =>
            db
              .select({
                categoryId: transactions.categoryId,
                categoryName: transactionCategories.name,
                txCount: sql<number>`count(*)::int`,
                // Extract amount from payload->'args'->>1 (the transfer amount for USDC transfers)
                totalAmount: sql<string>`coalesce(sum(
                  case when ${transactions.method} in ('transfer', 'raw_transfer')
                    then (${transactions.payload}->>'amount')::numeric
                    else coalesce((${transactions.payload}->'args'->>1)::numeric, 0)
                  end
                ), 0)::text`,
              })
              .from(transactions)
              .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
              .where(
                and(
                  eq(transactions.userId, userId),
                  gte(transactions.createdAt, since),
                  sql`${transactions.categoryId} is not null`
                )
              )
              .groupBy(transactions.categoryId, transactionCategories.name),
          catch: (error) => new Error(`Failed to get spending data: ${error}`),
        });

        // Also fetch limits so the frontend can compare
        const userLimits = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(categoryLimits)
              .where(eq(categoryLimits.userId, userId)),
          catch: (error) => new Error(`Failed to get limits: ${error}`),
        });

        const limitsMap = new Map(
          userLimits.map(l => [l.categoryId, l])
        );

        return rows.map(r => ({
          categoryId: r.categoryId,
          categoryName: r.categoryName,
          txCount: r.txCount,
          totalSpent: r.totalAmount,
          limit: limitsMap.get(r.categoryId!) ? {
            monthlyLimit: limitsMap.get(r.categoryId!)!.monthlyLimit,
            tokenSymbol: limitsMap.get(r.categoryId!)!.tokenSymbol,
            tokenDecimals: limitsMap.get(r.categoryId!)!.tokenDecimals,
          } : null,
        }));
      }),
      c
    )
  );

  // Get daily spending breakdown for charts
  app.get("/spending/daily", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;

        const daysParam = c.req.query("days");
        const days = daysParam ? Number(daysParam) : 30;
        const since = new Date();
        since.setDate(since.getDate() - days);

        const rows = yield* Effect.tryPromise({
          try: () =>
            db
              .select({
                date: sql<string>`to_char(${transactions.createdAt}, 'YYYY-MM-DD')`,
                categoryId: transactions.categoryId,
                categoryName: transactionCategories.name,
                totalAmount: sql<string>`coalesce(sum(
                  case when ${transactions.method} in ('transfer', 'raw_transfer')
                    then (${transactions.payload}->>'amount')::numeric
                    else coalesce((${transactions.payload}->'args'->>1)::numeric, 0)
                  end
                ), 0)::text`,
                txCount: sql<number>`count(*)::int`,
              })
              .from(transactions)
              .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
              .where(
                and(
                  eq(transactions.userId, userId),
                  gte(transactions.createdAt, since),
                  sql`${transactions.categoryId} is not null`
                )
              )
              .groupBy(
                sql`to_char(${transactions.createdAt}, 'YYYY-MM-DD')`,
                transactions.categoryId,
                transactionCategories.name
              )
              .orderBy(sql`to_char(${transactions.createdAt}, 'YYYY-MM-DD')`),
          catch: (error) => new Error(`Failed to get daily spending: ${error}`),
        });

        return rows;
      }),
      c
    )
  );

  // Get weekly spending breakdown for charts
  app.get("/spending/weekly", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;

        const weeksParam = c.req.query("weeks");
        const weeks = weeksParam ? Number(weeksParam) : 12;
        const since = new Date();
        since.setDate(since.getDate() - weeks * 7);

        const rows = yield* Effect.tryPromise({
          try: () =>
            db
              .select({
                week: sql<string>`to_char(date_trunc('week', ${transactions.createdAt}), 'YYYY-MM-DD')`,
                categoryId: transactions.categoryId,
                categoryName: transactionCategories.name,
                totalAmount: sql<string>`coalesce(sum(
                  case when ${transactions.method} in ('transfer', 'raw_transfer')
                    then (${transactions.payload}->>'amount')::numeric
                    else coalesce((${transactions.payload}->'args'->>1)::numeric, 0)
                  end
                ), 0)::text`,
                txCount: sql<number>`count(*)::int`,
              })
              .from(transactions)
              .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
              .where(
                and(
                  eq(transactions.userId, userId),
                  gte(transactions.createdAt, since),
                  sql`${transactions.categoryId} is not null`
                )
              )
              .groupBy(
                sql`date_trunc('week', ${transactions.createdAt})`,
                transactions.categoryId,
                transactionCategories.name
              )
              .orderBy(sql`date_trunc('week', ${transactions.createdAt})`),
          catch: (error) => new Error(`Failed to get weekly spending: ${error}`),
        });

        return rows;
      }),
      c
    )
  );

  // Get monthly spending breakdown for charts
  app.get("/spending/monthly", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;

        const monthsParam = c.req.query("months");
        const months = monthsParam ? Number(monthsParam) : 12;
        const since = new Date();
        since.setMonth(since.getMonth() - months);

        const rows = yield* Effect.tryPromise({
          try: () =>
            db
              .select({
                month: sql<string>`to_char(date_trunc('month', ${transactions.createdAt}), 'YYYY-MM')`,
                categoryId: transactions.categoryId,
                categoryName: transactionCategories.name,
                totalAmount: sql<string>`coalesce(sum(
                  case when ${transactions.method} in ('transfer', 'raw_transfer')
                    then (${transactions.payload}->>'amount')::numeric
                    else coalesce((${transactions.payload}->'args'->>1)::numeric, 0)
                  end
                ), 0)::text`,
                txCount: sql<number>`count(*)::int`,
              })
              .from(transactions)
              .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
              .where(
                and(
                  eq(transactions.userId, userId),
                  gte(transactions.createdAt, since),
                  sql`${transactions.categoryId} is not null`
                )
              )
              .groupBy(
                sql`date_trunc('month', ${transactions.createdAt})`,
                transactions.categoryId,
                transactionCategories.name
              )
              .orderBy(sql`date_trunc('month', ${transactions.createdAt})`),
          catch: (error) => new Error(`Failed to get monthly spending: ${error}`),
        });

        return rows;
      }),
      c
    )
  );

  // ── Categories CRUD ───────────────────────────────────────────────

  // List categories: global categories (no userId) + user's own categories
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;
        return yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(transactionCategories)
              .where(
                or(
                  isNull(transactionCategories.userId),
                  eq(transactionCategories.userId, userId)
                )
              )
              .orderBy(transactionCategories.createdAt),
          catch: (error) => new Error(`Failed to list categories: ${error}`),
        });
      }),
      c
    )
  );

  // Get a single category -- visible if global or owned by user
  app.get("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;
        const [result] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(transactionCategories)
              .where(
                and(
                  eq(transactionCategories.id, id),
                  or(
                    isNull(transactionCategories.userId),
                    eq(transactionCategories.userId, userId)
                  )
                )
              ),
          catch: (error) => new Error(`Failed to get category: ${error}`),
        });
        if (!result) {
          return yield* Effect.fail(new Error("Category not found"));
        }
        return result;
      }),
      c
    )
  );

  // Create a category -- userId is set from auth context
  app.post("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              name: string;
              description?: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const { db } = yield* DatabaseService;
        const [result] = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(transactionCategories)
              .values({
                name: body.name,
                userId,
                description: body.description ?? null,
              })
              .returning(),
          catch: (error) => new Error(`Failed to create category: ${error}`),
        });
        return result!;
      }),
      c
    )
  );

  // Batch create categories -- for onboarding flow
  app.post("/batch", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{ name: string; description?: string }[]>(),
          catch: () => new Error("Invalid request body"),
        });

        if (!Array.isArray(body) || body.length === 0) {
          return yield* Effect.fail(
            new Error("Request body must be a non-empty array")
          );
        }

        const { db } = yield* DatabaseService;
        const values = body.map((item) => ({
          name: item.name,
          userId,
          description: item.description ?? null,
        }));

        const results = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(transactionCategories)
              .values(values)
              .returning(),
          catch: (error) =>
            new Error(`Failed to batch create categories: ${error}`),
        });

        return results;
      }),
      c,
      201
    )
  );

  // Update a category -- only if the authenticated user owns it
  app.put("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              name?: string;
              description?: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const { db } = yield* DatabaseService;

        // Verify ownership before updating
        const [existing] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(transactionCategories)
              .where(
                and(
                  eq(transactionCategories.id, id),
                  eq(transactionCategories.userId, userId)
                )
              ),
          catch: (error) => new Error(`Failed to verify category ownership: ${error}`),
        });
        if (!existing) {
          return yield* Effect.fail(new Error("Category not found"));
        }

        const updates: Record<string, unknown> = {};
        if (body.name !== undefined) updates.name = body.name;
        if (body.description !== undefined) updates.description = body.description;

        const [result] = yield* Effect.tryPromise({
          try: () =>
            db
              .update(transactionCategories)
              .set(updates)
              .where(
                and(
                  eq(transactionCategories.id, id),
                  eq(transactionCategories.userId, userId)
                )
              )
              .returning(),
          catch: (error) => new Error(`Failed to update category: ${error}`),
        });
        if (!result) {
          return yield* Effect.fail(new Error("Category not found"));
        }
        return result;
      }),
      c
    )
  );

  // Delete a category -- only if the authenticated user owns it
  app.delete("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;

        // Delete associated limits first to avoid FK constraint violation
        yield* Effect.tryPromise({
          try: () =>
            db
              .delete(categoryLimits)
              .where(
                and(
                  eq(categoryLimits.categoryId, id),
                  eq(categoryLimits.userId, userId)
                )
              ),
          catch: (error) =>
            new Error(`Failed to delete category limits: ${error}`),
        });

        const [result] = yield* Effect.tryPromise({
          try: () =>
            db
              .delete(transactionCategories)
              .where(
                and(
                  eq(transactionCategories.id, id),
                  eq(transactionCategories.userId, userId)
                )
              )
              .returning(),
          catch: (error) => new Error(`Failed to delete category: ${error}`),
        });
        if (!result) {
          return yield* Effect.fail(new Error("Category not found"));
        }
        return { deleted: true, id };
      }),
      c
    )
  );

  return app;
}
