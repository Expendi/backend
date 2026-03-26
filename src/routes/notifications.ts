import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import {
  NotificationService,
  type UpdatePreferencesParams,
} from "../services/notification/notification-service.js";
import type { AuthVariables } from "../middleware/auth.js";

export function createNotificationRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // List notifications for the authenticated user
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const limit = Number(c.req.query("limit") ?? "50");
        const offset = Number(c.req.query("offset") ?? "0");
        const svc = yield* NotificationService;
        return yield* svc.list(userId, limit, offset);
      }),
      c
    )
  );

  // Get unread count
  app.get("/unread-count", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const svc = yield* NotificationService;
        const count = yield* svc.countUnread(userId);
        return { count };
      }),
      c
    )
  );

  // Mark a single notification as read
  app.post("/:id/read", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const svc = yield* NotificationService;
        return yield* svc.markRead(id, userId);
      }),
      c
    )
  );

  // Mark all notifications as read
  app.post("/read-all", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const svc = yield* NotificationService;
        yield* svc.markAllRead(userId);
        return { ok: true };
      }),
      c
    )
  );

  // Get notification preferences
  app.get("/preferences", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const svc = yield* NotificationService;
        return yield* svc.getPreferences(userId);
      }),
      c
    )
  );

  // Update notification preferences
  app.put("/preferences", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<UpdatePreferencesParams>(),
          catch: () => new Error("Invalid request body"),
        });
        const svc = yield* NotificationService;
        return yield* svc.updatePreferences(userId, body);
      }),
      c
    )
  );

  return app;
}
