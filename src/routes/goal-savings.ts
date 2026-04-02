import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { GoalSavingsService } from "../services/goal-savings/index.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import type { AuthVariables } from "../middleware/auth.js";

export function createGoalSavingsRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET / — List user's goals
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* GoalSavingsService;
        return yield* service.listGoals(userId);
      }),
      c
    )
  );

  // POST / — Create goal
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
              targetAmount: string;
              tokenAddress: string;
              tokenSymbol: string;
              tokenDecimals: number;
              walletId?: string;
              walletType?: "server" | "agent";
              vaultId?: string;
              chainId?: number;
              depositAmount?: string;
              unlockTimeOffsetSeconds?: number;
              frequency?: string;
              startDate?: string;
              endDate?: string;
              maxRetries?: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const service = yield* GoalSavingsService;
        return yield* service.createGoal({
          userId,
          name: body.name,
          description: body.description,
          targetAmount: body.targetAmount,
          tokenAddress: body.tokenAddress,
          tokenSymbol: body.tokenSymbol,
          tokenDecimals: body.tokenDecimals,
          walletId: body.walletId,
          walletType: body.walletType,
          vaultId: body.vaultId,
          chainId: body.chainId,
          depositAmount: body.depositAmount,
          unlockTimeOffsetSeconds: body.unlockTimeOffsetSeconds,
          frequency: body.frequency,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          endDate: body.endDate ? new Date(body.endDate) : undefined,
          maxRetries: body.maxRetries,
        });
      }),
      c,
      201
    )
  );

  // GET /:id — Get goal (ownership check)
  app.get("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* GoalSavingsService;
        const goal = yield* service.getGoal(id);
        if (!goal || goal.userId !== userId) {
          return yield* Effect.fail(new Error("Goal not found"));
        }
        return goal;
      }),
      c
    )
  );

  // PATCH /:id — Update goal
  app.patch("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* GoalSavingsService;

        const goal = yield* service.getGoal(id);
        if (!goal || goal.userId !== userId) {
          return yield* Effect.fail(new Error("Goal not found"));
        }

        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              name?: string;
              description?: string;
              depositAmount?: string;
              frequency?: string;
              endDate?: string | null;
              maxRetries?: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        return yield* service.updateGoal(id, {
          name: body.name,
          description: body.description,
          depositAmount: body.depositAmount,
          frequency: body.frequency,
          endDate:
            body.endDate === null
              ? null
              : body.endDate
                ? new Date(body.endDate)
                : undefined,
          maxRetries: body.maxRetries,
        });
      }),
      c
    )
  );

  // POST /:id/pause
  app.post("/:id/pause", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* GoalSavingsService;

        const goal = yield* service.getGoal(id);
        if (!goal || goal.userId !== userId) {
          return yield* Effect.fail(new Error("Goal not found"));
        }

        return yield* service.pauseGoal(id);
      }),
      c
    )
  );

  // POST /:id/resume
  app.post("/:id/resume", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* GoalSavingsService;

        const goal = yield* service.getGoal(id);
        if (!goal || goal.userId !== userId) {
          return yield* Effect.fail(new Error("Goal not found"));
        }

        return yield* service.resumeGoal(id);
      }),
      c
    )
  );

  // POST /:id/cancel
  app.post("/:id/cancel", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* GoalSavingsService;

        const goal = yield* service.getGoal(id);
        if (!goal || goal.userId !== userId) {
          return yield* Effect.fail(new Error("Goal not found"));
        }

        return yield* service.cancelGoal(id);
      }),
      c
    )
  );

  // POST /:id/deposit — Manual deposit
  app.post("/:id/deposit", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* GoalSavingsService;

        const goal = yield* service.getGoal(id);
        if (!goal || goal.userId !== userId) {
          return yield* Effect.fail(new Error("Goal not found"));
        }

        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              amount: string;
              walletId?: string;
              walletType?: "server" | "agent";
              vaultId?: string;
              chainId?: number;
              unlockTimeOffsetSeconds?: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        // Resolve walletId if not provided
        let resolvedWalletId = body.walletId ?? goal.walletId;
        if (!resolvedWalletId) {
          const onboarding = yield* OnboardingService;
          const profile = yield* onboarding.getProfile(userId);
          const wType = body.walletType ?? goal.walletType ?? "server";
          resolvedWalletId =
            wType === "server"
              ? profile.serverWalletId
              : profile.agentWalletId;
        }

        return yield* service.deposit({
          goalId: id,
          amount: body.amount,
          depositType: "manual",
          walletId: resolvedWalletId ?? undefined,
          walletType: body.walletType ?? (goal.walletType as "server" | "agent") ?? "server",
          vaultId: body.vaultId ?? goal.vaultId ?? undefined,
          chainId: body.chainId ?? goal.chainId ?? undefined,
          unlockTimeOffsetSeconds:
            body.unlockTimeOffsetSeconds ?? goal.unlockTimeOffsetSeconds ?? undefined,
        });
      }),
      c,
      201
    )
  );

  // GET /:id/accrued-yield — Aggregated accrued yield for all goal deposits
  app.get("/:id/accrued-yield", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* GoalSavingsService;

        const goal = yield* service.getGoal(id);
        if (!goal || goal.userId !== userId) {
          return yield* Effect.fail(new Error("Goal not found"));
        }

        return yield* service.getAccruedYield(id);
      }),
      c
    )
  );

  // POST /:id/withdraw — Batch withdraw all deposits for a goal in one transaction
  app.post("/:id/withdraw", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* GoalSavingsService;

        const goal = yield* service.getGoal(id);
        if (!goal || goal.userId !== userId) {
          return yield* Effect.fail(new Error("Goal not found"));
        }

        return yield* service.withdrawGoal(id);
      }),
      c
    )
  );

  // GET /:id/deposits — List deposits for goal
  app.get("/:id/deposits", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* GoalSavingsService;

        const goal = yield* service.getGoal(id);
        if (!goal || goal.userId !== userId) {
          return yield* Effect.fail(new Error("Goal not found"));
        }

        const limit = Number(c.req.query("limit") ?? "50");
        return yield* service.listDeposits(id, limit);
      }),
      c
    )
  );

  return app;
}
