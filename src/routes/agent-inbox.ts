import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { AgentInboxService } from "../services/agent/index.js";
import type { AuthVariables } from "../middleware/auth.js";

export function createAgentInboxRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET / — List inbox items (query params: category, status, priority, limit, offset)
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const category = c.req.query("category");
        const status = c.req.query("status");
        const priority = c.req.query("priority");
        const limit = Number(c.req.query("limit") ?? "20");
        const offset = Number(c.req.query("offset") ?? "0");

        const service = yield* AgentInboxService;
        return yield* service.listItems(userId, {
          category,
          status,
          priority,
          limit,
          offset,
        });
      }),
      c
    )
  );

  // GET /unread — Returns unread count with breakdown by category
  app.get("/unread", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* AgentInboxService;
        return yield* service.getUnreadCount(userId);
      }),
      c
    )
  );

  // POST /:id/read — Mark a single item as read
  app.post("/:id/read", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const itemId = c.req.param("id");
        const service = yield* AgentInboxService;
        return yield* service.markRead(userId, itemId);
      }),
      c
    )
  );

  // POST /read-all — Mark all items as read (optional body: { category })
  app.post("/read-all", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");

        const category = yield* Effect.tryPromise({
          try: async () => {
            const body = await c.req.json<{ category?: string }>();
            return body.category;
          },
          catch: () => undefined as string | undefined,
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined as string | undefined)));

        const service = yield* AgentInboxService;
        yield* service.markAllRead(userId, category);
        return { acknowledged: true };
      }),
      c
    )
  );

  // POST /:id/dismiss — Dismiss an item
  app.post("/:id/dismiss", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const itemId = c.req.param("id");
        const service = yield* AgentInboxService;
        return yield* service.dismiss(userId, itemId);
      }),
      c
    )
  );

  // POST /:id/action — Act on an item (approve/reject)
  app.post("/:id/action", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const itemId = c.req.param("id");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{ approved: boolean; note?: string }>(),
          catch: () => new Error("Invalid request body"),
        });

        if (typeof body.approved !== "boolean") {
          return yield* Effect.fail(
            new Error(
              'Request body must include "approved" as a boolean value'
            )
          );
        }

        const service = yield* AgentInboxService;
        return yield* service.actOnItem(
          userId,
          itemId,
          body.approved,
          body.note
        );
      }),
      c
    )
  );

  return app;
}
