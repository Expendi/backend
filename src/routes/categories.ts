import { Hono } from "hono";
import { Effect } from "effect";
import { eq, or, isNull, and } from "drizzle-orm";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { DatabaseService } from "../db/client.js";
import { transactionCategories } from "../db/schema/index.js";
import type { AuthVariables } from "../middleware/auth.js";

/**
 * Public category routes -- all behind Privy auth middleware.
 * Users can see global (userId IS NULL) categories plus their own.
 * Write operations are scoped to the authenticated user.
 */
export function createCategoryRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

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
