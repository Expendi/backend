import { Hono } from "hono";
import { Effect } from "effect";
import { eq, and } from "drizzle-orm";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { RecurringPaymentService } from "../services/recurring-payment/recurring-payment-service.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import { ConfigService } from "../config.js";
import { DatabaseService } from "../db/client.js";
import { wallets, userProfiles } from "../db/schema/index.js";
import type { UserPreferences } from "../db/schema/user-profiles.js";
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
              // Pretium offramp shorthand — used when provider is "pretium"
              country?: string;
              phoneNumber?: string;
              mobileNetwork?: string;
              paymentMethod?: string;
              accountNumber?: string;
              accountName?: string;
              bankAccount?: string;
              bankCode?: string;
              bankName?: string;
              categoryId?: string;
              executeImmediately?: boolean;
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

        // Build offramp details — support Pretium shorthand fields
        let offramp = body.offramp;
        if (body.paymentType === "offramp" && !offramp) {
          // Auto-fill from saved preferences if fields are missing
          let country = body.country;
          let phoneNumber = body.phoneNumber;
          let mobileNetwork = body.mobileNetwork;

          if (!country || !phoneNumber || !mobileNetwork) {
            const rows = yield* Effect.tryPromise({
              try: () =>
                db
                  .select({ preferences: userProfiles.preferences })
                  .from(userProfiles)
                  .where(eq(userProfiles.privyUserId, userId))
                  .limit(1),
              catch: () => new Error("Failed to fetch preferences"),
            });
            const prefs = (rows[0]?.preferences ?? {}) as UserPreferences;
            country = country || prefs.country;
            phoneNumber = phoneNumber || prefs.phoneNumber;
            mobileNetwork = mobileNetwork || prefs.mobileNetwork;
          }

          if (!country || !phoneNumber || !mobileNetwork) {
            return yield* Effect.fail(
              new Error(
                "Pretium offramp requires country, phoneNumber, and mobileNetwork"
              )
            );
          }

          offramp = {
            currency: country, // will be resolved to actual currency by service
            fiatAmount: body.amount,
            provider: "pretium",
            destinationId: phoneNumber,
            metadata: {
              country,
              phoneNumber,
              mobileNetwork,
              paymentType: body.paymentMethod,
              accountNumber: body.accountNumber,
              accountName: body.accountName,
              bankAccount: body.bankAccount,
              bankCode: body.bankCode,
              bankName: body.bankName,
            },
          };
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
          offramp,
          categoryId: body.categoryId,
          executeImmediately: body.executeImmediately,
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
