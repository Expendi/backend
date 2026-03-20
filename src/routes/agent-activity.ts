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

  return app;
}
