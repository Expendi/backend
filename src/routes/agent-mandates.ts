import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { AgentMandateService } from "../services/agent/index.js";
import type { AuthVariables } from "../middleware/auth.js";
import type {
  MandateTrigger,
  MandateAction,
  MandateConstraints,
} from "../db/schema/index.js";

export function createAgentMandateRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET / — List mandates for user
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* AgentMandateService;
        return yield* service.listMandates(userId);
      }),
      c
    )
  );

  // POST / — Create mandate
  app.post("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              type: string;
              name?: string;
              description?: string;
              trigger: MandateTrigger;
              action: MandateAction;
              constraints?: MandateConstraints;
              source?: "explicit" | "suggested" | "inferred";
              expiresAt?: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const service = yield* AgentMandateService;
        return yield* service.createMandate({
          userId,
          type: body.type,
          name: body.name,
          description: body.description,
          trigger: body.trigger,
          action: body.action,
          constraints: body.constraints,
          source: body.source,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        });
      }),
      c,
      201
    )
  );

  // GET /:id — Get mandate (ownership check)
  app.get("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* AgentMandateService;
        const mandate = yield* service.getMandate(id);
        if (!mandate || mandate.userId !== userId) {
          return yield* Effect.fail(new Error("Mandate not found"));
        }
        return mandate;
      }),
      c
    )
  );

  // PATCH /:id — Update mandate
  app.patch("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* AgentMandateService;

        const mandate = yield* service.getMandate(id);
        if (!mandate || mandate.userId !== userId) {
          return yield* Effect.fail(new Error("Mandate not found"));
        }

        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              name?: string;
              description?: string;
              trigger?: MandateTrigger;
              action?: MandateAction;
              constraints?: MandateConstraints;
              expiresAt?: string | null;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        return yield* service.updateMandate(id, {
          name: body.name,
          description: body.description,
          trigger: body.trigger,
          action: body.action,
          constraints: body.constraints,
          expiresAt:
            body.expiresAt === null
              ? null
              : body.expiresAt
                ? new Date(body.expiresAt)
                : undefined,
        });
      }),
      c
    )
  );

  // POST /:id/pause — Pause mandate
  app.post("/:id/pause", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* AgentMandateService;

        const mandate = yield* service.getMandate(id);
        if (!mandate || mandate.userId !== userId) {
          return yield* Effect.fail(new Error("Mandate not found"));
        }

        return yield* service.pauseMandate(id);
      }),
      c
    )
  );

  // POST /:id/resume — Resume mandate
  app.post("/:id/resume", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* AgentMandateService;

        const mandate = yield* service.getMandate(id);
        if (!mandate || mandate.userId !== userId) {
          return yield* Effect.fail(new Error("Mandate not found"));
        }

        return yield* service.resumeMandate(id);
      }),
      c
    )
  );

  // DELETE /:id — Revoke mandate
  app.delete("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* AgentMandateService;

        const mandate = yield* service.getMandate(id);
        if (!mandate || mandate.userId !== userId) {
          return yield* Effect.fail(new Error("Mandate not found"));
        }

        return yield* service.revokeMandate(id);
      }),
      c
    )
  );

  // GET /:id/executions — List executions for mandate
  app.get("/:id/executions", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* AgentMandateService;

        const mandate = yield* service.getMandate(id);
        if (!mandate || mandate.userId !== userId) {
          return yield* Effect.fail(new Error("Mandate not found"));
        }

        const limit = Number(c.req.query("limit") ?? "50");
        return yield* service.listExecutions(id, limit);
      }),
      c
    )
  );

  return app;
}
