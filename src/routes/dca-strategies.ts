import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { DcaStrategyService } from "../services/dca/dca-strategy-service.js";
import type { AuthVariables } from "../middleware/auth.js";
import type { IndicatorConfig } from "../db/schema/dca-strategies.js";

export function createDcaStrategyRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  /** List all DCA strategies for the authenticated user */
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* DcaStrategyService;
        return yield* service.listByUser(userId);
      }),
      c
    )
  );

  /** Get a single DCA strategy by ID */
  app.get("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const service = yield* DcaStrategyService;
        const strategy = yield* service.getStrategy(c.req.param("id"));
        if (!strategy) {
          return yield* Effect.fail(new Error("Strategy not found"));
        }
        return strategy;
      }),
      c
    )
  );

  /** Create a new DCA strategy */
  app.post("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              name?: string;
              walletId: string;
              walletType: "server" | "agent";
              strategyType: "frequency" | "indicator";
              tokenIn: string;
              tokenOut: string;
              amount: string;
              slippageTolerance?: number;
              chainId?: number;
              frequency: "daily" | "weekly" | "biweekly" | "monthly";
              indicatorConfig?: IndicatorConfig;
              indicatorToken?: string;
              startDate?: string;
              endDate?: string;
              maxExecutions?: number;
              maxRetries?: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const service = yield* DcaStrategyService;
        return yield* service.createStrategy({
          userId,
          ...body,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          endDate: body.endDate ? new Date(body.endDate) : undefined,
        });
      }),
      c,
      201
    )
  );

  /** Update a DCA strategy */
  app.patch("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              name?: string;
              amount?: string;
              slippageTolerance?: number;
              frequency?: "daily" | "weekly" | "biweekly" | "monthly";
              indicatorConfig?: IndicatorConfig;
              maxExecutions?: number | null;
              maxRetries?: number;
              endDate?: string | null;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const service = yield* DcaStrategyService;
        return yield* service.updateStrategy(c.req.param("id"), {
          ...body,
          endDate:
            body.endDate === null
              ? null
              : body.endDate
                ? new Date(body.endDate)
                : undefined,
        });
      }),
      c
    )
  );

  /** Pause a strategy */
  app.post("/:id/pause", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const service = yield* DcaStrategyService;
        return yield* service.pauseStrategy(c.req.param("id"));
      }),
      c
    )
  );

  /** Resume a strategy */
  app.post("/:id/resume", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const service = yield* DcaStrategyService;
        return yield* service.resumeStrategy(c.req.param("id"));
      }),
      c
    )
  );

  /** Cancel a strategy */
  app.post("/:id/cancel", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const service = yield* DcaStrategyService;
        return yield* service.cancelStrategy(c.req.param("id"));
      }),
      c
    )
  );

  /** Get execution history for a strategy */
  app.get("/:id/executions", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const limit = Number(c.req.query("limit") ?? "50");
        const service = yield* DcaStrategyService;
        return yield* service.getExecutionHistory(c.req.param("id"), limit);
      }),
      c
    )
  );

  return app;
}
