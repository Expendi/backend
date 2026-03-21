import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { AgentActivityService } from "../services/agent/index.js";
import type { AuthVariables } from "../middleware/auth.js";

export function createAgentActivityRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET / — List activity (query params: limit, offset)
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const limit = Number(c.req.query("limit") ?? "50");
        const offset = Number(c.req.query("offset") ?? "0");
        const service = yield* AgentActivityService;
        return yield* service.listActivity(userId, limit, offset);
      }),
      c
    )
  );

  // POST /read — Mark all read
  app.post("/read", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* AgentActivityService;
        yield* service.markAllRead(userId);
        return { acknowledged: true };
      }),
      c
    )
  );

  // GET /unread-count — Get unread count
  app.get("/unread-count", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* AgentActivityService;
        const unreadCount = yield* service.getUnreadCount(userId);
        return { unreadCount };
      }),
      c
    )
  );

  // GET /pending — List pending action requests
  app.get("/pending", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* AgentActivityService;
        return yield* service.listPendingRequests(userId);
      }),
      c
    )
  );

  // POST /:id/respond — Respond to an action request
  app.post("/:id/respond", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const activityId = c.req.param("id");
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

        const service = yield* AgentActivityService;
        return yield* service.respondToRequest(
          userId,
          activityId,
          body.approved,
          body.note
        );
      }),
      c
    )
  );

  return app;
}
