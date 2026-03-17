import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { SwapAutomationService } from "../services/swap-automation/swap-automation-service.js";
import type { AuthVariables } from "../middleware/auth.js";

/**
 * Swap Automation Routes
 *
 * A swap automation monitors the price of a token (`indicatorToken`) and automatically
 * executes a Uniswap swap (tokenIn → tokenOut) when a price condition is met.
 *
 * ## Lifecycle
 *   active → triggered   (maxExecutions reached — completed successfully)
 *   active → failed      (maxRetries consecutive failures)
 *   active → paused      (user-initiated via POST /:id/pause)
 *   active → cancelled   (user-initiated via POST /:id/cancel — permanent)
 *   paused → active      (user-initiated via POST /:id/resume — resets failure counter)
 *
 * ## Rate limiting
 * Three knobs control execution frequency:
 *   - `cooldownSeconds` — minimum gap between price checks for this automation.
 *     Prevents rapid re-evaluation on every polling cycle.
 *   - `maxExecutions` — lifetime cap on successful executions. Once reached,
 *     the automation transitions to "triggered" status.
 *   - `maxExecutionsPerDay` — optional per-UTC-day cap. If set, the automation
 *     is skipped for the rest of the day once the limit is hit.
 *
 * ## Important caveat
 * Automations are not real-time. They only execute when `processDueAutomations()`
 * is called (e.g. via a cron job). The polling interval determines latency.
 */
export function createSwapAutomationRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  /** List all swap automations for the authenticated user */
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* SwapAutomationService;
        return yield* service.listByUser(userId);
      }),
      c
    )
  );

  /** Get a single automation by ID */
  app.get("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const service = yield* SwapAutomationService;
        const automation = yield* service.getAutomation(c.req.param("id"));
        if (!automation) {
          return yield* Effect.fail(
            new Error("Automation not found")
          );
        }
        return automation;
      }),
      c
    )
  );

  /** Create a new swap automation */
  app.post("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId: string;
              walletType: "server" | "agent";
              tokenIn: string;
              tokenOut: string;
              amount: string;
              slippageTolerance?: number;
              chainId?: number;
              indicatorType:
                | "price_above"
                | "price_below"
                | "percent_change_up"
                | "percent_change_down";
              indicatorToken: string;
              thresholdValue: number;
              maxExecutions?: number;
              maxExecutionsPerDay?: number;
              cooldownSeconds?: number;
              maxRetries?: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const service = yield* SwapAutomationService;
        return yield* service.createAutomation({
          userId,
          ...body,
        });
      }),
      c,
      201
    )
  );

  /** Update an automation */
  app.patch("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              thresholdValue?: number;
              amount?: string;
              slippageTolerance?: number;
              maxExecutions?: number;
              maxExecutionsPerDay?: number | null;
              cooldownSeconds?: number;
              maxRetries?: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const service = yield* SwapAutomationService;
        return yield* service.updateAutomation(c.req.param("id"), body);
      }),
      c
    )
  );

  /** Pause an automation */
  app.post("/:id/pause", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const service = yield* SwapAutomationService;
        return yield* service.pauseAutomation(c.req.param("id"));
      }),
      c
    )
  );

  /** Resume an automation */
  app.post("/:id/resume", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const service = yield* SwapAutomationService;
        return yield* service.resumeAutomation(c.req.param("id"));
      }),
      c
    )
  );

  /** Cancel an automation */
  app.post("/:id/cancel", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const service = yield* SwapAutomationService;
        return yield* service.cancelAutomation(c.req.param("id"));
      }),
      c
    )
  );

  /** Get execution history for an automation */
  app.get("/:id/executions", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const limit = Number(c.req.query("limit") ?? "50");
        const service = yield* SwapAutomationService;
        return yield* service.getExecutionHistory(
          c.req.param("id"),
          limit
        );
      }),
      c
    )
  );

  return app;
}
