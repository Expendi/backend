import { Hono } from "hono";
import { Effect } from "effect";
import { eq, and } from "drizzle-orm";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { RecurringPaymentService } from "../services/recurring-payment/recurring-payment-service.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import { ConfigService } from "../config.js";
import { DatabaseService } from "../db/client.js";
import { wallets } from "../db/schema/index.js";
import type { AuthVariables } from "../middleware/auth.js";

/**
 * Public recurring payment routes -- all behind Privy auth middleware.
 * Every operation is scoped to the authenticated user.
 */
export function createRecurringPaymentRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // List the authenticated user's recurring payment schedules
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.listSchedulesByUser(userId);
      }),
      c
    )
  );

  // Get a single schedule -- verify the authenticated user owns it
  app.get("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const rpService = yield* RecurringPaymentService;
        const schedule = yield* rpService.getSchedule(id);
        if (!schedule) {
          return yield* Effect.fail(new Error("Schedule not found"));
        }
        if (schedule.userId !== userId) {
          return yield* Effect.fail(new Error("Schedule not found"));
        }
        return schedule;
      }),
      c
    )
  );

  // Create a new recurring payment schedule
  app.post("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const config = yield* ConfigService;
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId?: string;
              walletType: "user" | "server" | "agent";
              recipientAddress: string;
              paymentType: "erc20_transfer" | "raw_transfer" | "contract_call" | "offramp";
              amount: string;
              tokenContractName?: string;
              contractName?: string;
              contractMethod?: string;
              contractArgs?: unknown[];
              chainId?: number;
              frequency: string;
              startDate?: string;
              endDate?: string;
              maxRetries?: number;
              offramp?: {
                currency: string;
                fiatAmount: string;
                provider: string;
                destinationId: string;
                metadata?: Record<string, unknown>;
              };
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        // Resolve walletId from walletType if not provided directly
        let resolvedWalletId = body.walletId;
        if (!resolvedWalletId) {
          const onboarding = yield* OnboardingService;
          const profile = yield* onboarding.getProfile(userId);
          if (body.walletType === "user") {
            resolvedWalletId = profile.userWalletId;
          } else if (body.walletType === "server") {
            resolvedWalletId = profile.serverWalletId;
          } else {
            resolvedWalletId = profile.agentWalletId;
          }
        }

        // Verify the user owns the wallet
        const { db } = yield* DatabaseService;
        const [walletRecord] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(
                and(
                  eq(wallets.id, resolvedWalletId!),
                  eq(wallets.ownerId, userId)
                )
              ),
          catch: (error) =>
            new Error(`Failed to verify wallet ownership: ${error}`),
        });
        if (!walletRecord) {
          return yield* Effect.fail(
            new Error(
              "Wallet not found or not owned by the authenticated user"
            )
          );
        }

        const rpService = yield* RecurringPaymentService;
        return yield* rpService.createSchedule({
          userId,
          walletId: resolvedWalletId!,
          walletType: body.walletType,
          recipientAddress: body.recipientAddress,
          paymentType: body.paymentType,
          amount: body.amount,
          tokenContractName: body.tokenContractName,
          contractName: body.contractName,
          contractMethod: body.contractMethod,
          contractArgs: body.contractArgs,
          chainId: body.chainId ?? config.defaultChainId,
          frequency: body.frequency,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          endDate: body.endDate ? new Date(body.endDate) : undefined,
          maxRetries: body.maxRetries,
          offramp: body.offramp,
        });
      }),
      c,
      201
    )
  );

  // Pause a schedule
  app.post("/:id/pause", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const rpService = yield* RecurringPaymentService;
        const schedule = yield* rpService.getSchedule(id);
        if (!schedule || schedule.userId !== userId) {
          return yield* Effect.fail(new Error("Schedule not found"));
        }
        return yield* rpService.pauseSchedule(id);
      }),
      c
    )
  );

  // Resume a schedule
  app.post("/:id/resume", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const rpService = yield* RecurringPaymentService;
        const schedule = yield* rpService.getSchedule(id);
        if (!schedule || schedule.userId !== userId) {
          return yield* Effect.fail(new Error("Schedule not found"));
        }
        return yield* rpService.resumeSchedule(id);
      }),
      c
    )
  );

  // Cancel a schedule
  app.post("/:id/cancel", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const rpService = yield* RecurringPaymentService;
        const schedule = yield* rpService.getSchedule(id);
        if (!schedule || schedule.userId !== userId) {
          return yield* Effect.fail(new Error("Schedule not found"));
        }
        return yield* rpService.cancelSchedule(id);
      }),
      c
    )
  );

  // Get execution history for a schedule
  app.get("/:id/executions", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const rpService = yield* RecurringPaymentService;
        const schedule = yield* rpService.getSchedule(id);
        if (!schedule || schedule.userId !== userId) {
          return yield* Effect.fail(new Error("Schedule not found"));
        }
        const limit = Number(c.req.query("limit") ?? "50");
        return yield* rpService.getExecutionHistory(id, limit);
      }),
      c
    )
  );

  return app;
}
