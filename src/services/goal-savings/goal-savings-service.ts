import { Effect, Context, Layer, Data } from "effect";
import { eq, and, lte, isNotNull } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import {
  goalSavings,
  goalSavingsDeposits,
  type GoalSaving,
  type NewGoalSaving,
  type GoalSavingsDeposit,
  type NewGoalSavingsDeposit,
} from "../../db/schema/index.js";
import { YieldService, type YieldError } from "../yield/yield-service.js";
import { OnboardingService } from "../onboarding/onboarding-service.js";
import { ConfigService } from "../../config.js";

// ── Error type ───────────────────────────────────────────────────────

export class GoalSavingsError extends Data.TaggedError("GoalSavingsError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export interface CreateGoalParams {
  readonly userId: string;
  readonly name: string;
  readonly description?: string;
  readonly targetAmount: string;
  readonly tokenAddress: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly walletId?: string;
  readonly walletType?: "server" | "agent";
  readonly vaultId?: string;
  readonly chainId?: number;
  readonly depositAmount?: string;
  readonly unlockTimeOffsetSeconds?: number;
  readonly frequency?: string;
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly maxRetries?: number;
}

export interface UpdateGoalParams {
  readonly name?: string;
  readonly description?: string;
  readonly depositAmount?: string;
  readonly frequency?: string;
  readonly endDate?: Date | null;
  readonly maxRetries?: number;
}

export interface DepositParams {
  readonly goalId: string;
  readonly amount: string;
  readonly depositType: "automated" | "manual";
  readonly walletId?: string;
  readonly walletType?: "server" | "agent";
  readonly vaultId?: string;
  readonly chainId?: number;
  readonly unlockTimeOffsetSeconds?: number;
}

// ── Service interface ────────────────────────────────────────────────

export interface GoalSavingsServiceApi {
  readonly createGoal: (
    params: CreateGoalParams
  ) => Effect.Effect<GoalSaving, GoalSavingsError>;

  readonly getGoal: (
    id: string
  ) => Effect.Effect<GoalSaving | undefined, GoalSavingsError>;

  readonly listGoals: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<GoalSaving>, GoalSavingsError>;

  readonly updateGoal: (
    id: string,
    params: UpdateGoalParams
  ) => Effect.Effect<GoalSaving, GoalSavingsError>;

  readonly pauseGoal: (
    id: string
  ) => Effect.Effect<GoalSaving, GoalSavingsError>;

  readonly resumeGoal: (
    id: string
  ) => Effect.Effect<GoalSaving, GoalSavingsError>;

  readonly cancelGoal: (
    id: string
  ) => Effect.Effect<GoalSaving, GoalSavingsError>;

  readonly deposit: (
    params: DepositParams
  ) => Effect.Effect<GoalSavingsDeposit, GoalSavingsError>;

  readonly listDeposits: (
    goalId: string,
    limit?: number
  ) => Effect.Effect<ReadonlyArray<GoalSavingsDeposit>, GoalSavingsError>;

  readonly processDueDeposits: () => Effect.Effect<
    ReadonlyArray<GoalSavingsDeposit>,
    GoalSavingsError
  >;
}

export class GoalSavingsService extends Context.Tag("GoalSavingsService")<
  GoalSavingsService,
  GoalSavingsServiceApi
>() {}

// ── Helpers ──────────────────────────────────────────────────────────

function parseFrequencyToMs(frequency: string): number {
  const match = frequency.match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) return 86400000; // default 1 day
  const [, value, unit] = match;
  const num = parseInt(value!, 10);
  switch (unit) {
    case "s":
      return num * 1000;
    case "m":
      return num * 60 * 1000;
    case "h":
      return num * 60 * 60 * 1000;
    case "d":
      return num * 24 * 60 * 60 * 1000;
    case "w":
      return num * 7 * 24 * 60 * 60 * 1000;
    default:
      return 86400000;
  }
}

// ── Live implementation ──────────────────────────────────────────────

export const GoalSavingsServiceLive: Layer.Layer<
  GoalSavingsService,
  never,
  DatabaseService | YieldService | OnboardingService | ConfigService
> = Layer.effect(
  GoalSavingsService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const yieldService = yield* YieldService;
    const onboarding = yield* OnboardingService;
    const config = yield* ConfigService;

    const depositOne = (
      goal: GoalSaving,
      amount: string,
      depositType: "automated" | "manual",
      overrides?: {
        walletId?: string;
        walletType?: "server" | "agent";
        vaultId?: string;
        chainId?: number;
        unlockTimeOffsetSeconds?: number;
      }
    ) =>
      Effect.gen(function* () {
        const walletId = overrides?.walletId ?? goal.walletId;
        const walletType =
          (overrides?.walletType ?? goal.walletType) as "server" | "agent";
        const vaultId = overrides?.vaultId ?? goal.vaultId;
        const chainId = overrides?.chainId ?? goal.chainId ?? config.defaultChainId;
        const offsetSeconds =
          overrides?.unlockTimeOffsetSeconds ?? goal.unlockTimeOffsetSeconds ?? 0;

        if (!walletId || !vaultId) {
          return yield* Effect.fail(
            new GoalSavingsError({
              message: `Goal ${goal.id} missing walletId or vaultId for deposit`,
            })
          );
        }

        const unlockTime = Math.floor(Date.now() / 1000) + offsetSeconds;

        // Create yield position
        const position = yield* yieldService
          .createPosition({
            userId: goal.userId,
            walletId,
            walletType,
            vaultId,
            amount,
            unlockTime,
            label: `goal:${goal.id}`,
            chainId,
          })
          .pipe(
            Effect.mapError(
              (e) =>
                new GoalSavingsError({
                  message: `Failed to create yield position: ${e.message}`,
                  cause: e,
                })
            )
          );

        // Insert deposit record
        const depositValues: NewGoalSavingsDeposit = {
          goalId: goal.id,
          yieldPositionId: position.id,
          amount,
          depositType,
          status: "confirmed",
        };

        const [deposit] = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(goalSavingsDeposits)
              .values(depositValues)
              .returning(),
          catch: (error) =>
            new GoalSavingsError({
              message: `Failed to record deposit: ${error}`,
              cause: error,
            }),
        });

        // Update goal accumulation
        const newAccumulated = (
          BigInt(goal.accumulatedAmount) + BigInt(amount)
        ).toString();
        const newTotalDeposits = goal.totalDeposits + 1;
        const isCompleted =
          BigInt(newAccumulated) >= BigInt(goal.targetAmount);

        yield* Effect.tryPromise({
          try: () =>
            db
              .update(goalSavings)
              .set({
                accumulatedAmount: newAccumulated,
                totalDeposits: newTotalDeposits,
                status: isCompleted ? "completed" : goal.status,
                updatedAt: new Date(),
              })
              .where(eq(goalSavings.id, goal.id)),
          catch: (error) =>
            new GoalSavingsError({
              message: `Failed to update goal after deposit: ${error}`,
              cause: error,
            }),
        });

        return deposit!;
      });

    return {
      createGoal: (params: CreateGoalParams) =>
        Effect.gen(function* () {
          let resolvedWalletId = params.walletId;

          // Resolve wallet from profile if not provided
          if (!resolvedWalletId && params.walletType) {
            const profile = yield* onboarding
              .getProfile(params.userId)
              .pipe(
                Effect.mapError(
                  (e) =>
                    new GoalSavingsError({
                      message: `Failed to resolve wallet: ${e}`,
                      cause: e,
                    })
                )
              );
            resolvedWalletId =
              params.walletType === "server"
                ? profile.serverWalletId
                : profile.agentWalletId;
          }

          const startDate = params.startDate ?? new Date();
          let nextDepositAt: Date | null = null;

          if (params.frequency) {
            const intervalMs = parseFrequencyToMs(params.frequency);
            nextDepositAt = new Date(startDate.getTime() + intervalMs);
          }

          const values: NewGoalSaving = {
            userId: params.userId,
            name: params.name,
            description: params.description ?? null,
            targetAmount: params.targetAmount,
            tokenAddress: params.tokenAddress,
            tokenSymbol: params.tokenSymbol,
            tokenDecimals: params.tokenDecimals,
            walletId: resolvedWalletId ?? null,
            walletType: params.walletType ?? null,
            vaultId: params.vaultId ?? null,
            chainId: params.chainId ?? null,
            depositAmount: params.depositAmount ?? null,
            unlockTimeOffsetSeconds: params.unlockTimeOffsetSeconds ?? null,
            frequency: params.frequency ?? null,
            nextDepositAt,
            startDate,
            endDate: params.endDate ?? null,
            maxRetries: params.maxRetries ?? 3,
          };

          const [result] = yield* Effect.tryPromise({
            try: () => db.insert(goalSavings).values(values).returning(),
            catch: (error) =>
              new GoalSavingsError({
                message: `Failed to create goal: ${error}`,
                cause: error,
              }),
          });

          return result!;
        }),

      getGoal: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .select()
              .from(goalSavings)
              .where(eq(goalSavings.id, id));
            return result;
          },
          catch: (error) =>
            new GoalSavingsError({
              message: `Failed to get goal: ${error}`,
              cause: error,
            }),
        }),

      listGoals: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(goalSavings)
              .where(eq(goalSavings.userId, userId))
              .orderBy(goalSavings.createdAt);
            return results;
          },
          catch: (error) =>
            new GoalSavingsError({
              message: `Failed to list goals: ${error}`,
              cause: error,
            }),
        }),

      updateGoal: (id: string, params: UpdateGoalParams) =>
        Effect.tryPromise({
          try: async () => {
            const updates: Record<string, unknown> = {
              updatedAt: new Date(),
            };
            if (params.name !== undefined) updates.name = params.name;
            if (params.description !== undefined)
              updates.description = params.description;
            if (params.depositAmount !== undefined)
              updates.depositAmount = params.depositAmount;
            if (params.endDate !== undefined) updates.endDate = params.endDate;
            if (params.maxRetries !== undefined)
              updates.maxRetries = params.maxRetries;
            if (params.frequency !== undefined) {
              updates.frequency = params.frequency;
              const intervalMs = parseFrequencyToMs(params.frequency);
              updates.nextDepositAt = new Date(Date.now() + intervalMs);
            }

            const [result] = await db
              .update(goalSavings)
              .set(updates)
              .where(eq(goalSavings.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new GoalSavingsError({
              message: `Failed to update goal: ${error}`,
              cause: error,
            }),
        }),

      pauseGoal: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(goalSavings)
              .set({ status: "paused", updatedAt: new Date() })
              .where(eq(goalSavings.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new GoalSavingsError({
              message: `Failed to pause goal: ${error}`,
              cause: error,
            }),
        }),

      resumeGoal: (id: string) =>
        Effect.gen(function* () {
          const [goal] = yield* Effect.tryPromise({
            try: () =>
              db.select().from(goalSavings).where(eq(goalSavings.id, id)),
            catch: (error) =>
              new GoalSavingsError({
                message: `Failed to find goal: ${error}`,
                cause: error,
              }),
          });

          if (!goal) {
            return yield* Effect.fail(
              new GoalSavingsError({ message: `Goal not found: ${id}` })
            );
          }

          let nextDepositAt: Date | null = null;
          if (goal.frequency) {
            const intervalMs = parseFrequencyToMs(goal.frequency);
            nextDepositAt = new Date(Date.now() + intervalMs);
          }

          const [result] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(goalSavings)
                .set({
                  status: "active",
                  consecutiveFailures: 0,
                  nextDepositAt,
                  updatedAt: new Date(),
                })
                .where(eq(goalSavings.id, id))
                .returning(),
            catch: (error) =>
              new GoalSavingsError({
                message: `Failed to resume goal: ${error}`,
                cause: error,
              }),
          });

          return result!;
        }),

      cancelGoal: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(goalSavings)
              .set({ status: "cancelled", updatedAt: new Date() })
              .where(eq(goalSavings.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new GoalSavingsError({
              message: `Failed to cancel goal: ${error}`,
              cause: error,
            }),
        }),

      deposit: (params: DepositParams) =>
        Effect.gen(function* () {
          const [goal] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(goalSavings)
                .where(eq(goalSavings.id, params.goalId)),
            catch: (error) =>
              new GoalSavingsError({
                message: `Failed to find goal: ${error}`,
                cause: error,
              }),
          });

          if (!goal) {
            return yield* Effect.fail(
              new GoalSavingsError({
                message: `Goal not found: ${params.goalId}`,
              })
            );
          }

          if (goal.status === "cancelled" || goal.status === "completed") {
            return yield* Effect.fail(
              new GoalSavingsError({
                message: `Goal is ${goal.status}, cannot deposit`,
              })
            );
          }

          return yield* depositOne(goal, params.amount, params.depositType, {
            walletId: params.walletId,
            walletType: params.walletType,
            vaultId: params.vaultId,
            chainId: params.chainId,
            unlockTimeOffsetSeconds: params.unlockTimeOffsetSeconds,
          });
        }),

      listDeposits: (goalId: string, limit = 50) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(goalSavingsDeposits)
              .where(eq(goalSavingsDeposits.goalId, goalId))
              .orderBy(goalSavingsDeposits.depositedAt)
              .limit(limit);
            return results;
          },
          catch: (error) =>
            new GoalSavingsError({
              message: `Failed to list deposits: ${error}`,
              cause: error,
            }),
        }),

      processDueDeposits: () =>
        Effect.gen(function* () {
          const dueGoals = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(goalSavings)
                .where(
                  and(
                    eq(goalSavings.status, "active"),
                    isNotNull(goalSavings.frequency),
                    lte(goalSavings.nextDepositAt, new Date())
                  )
                ),
            catch: (error) =>
              new GoalSavingsError({
                message: `Failed to fetch due goals: ${error}`,
                cause: error,
              }),
          });

          const deposits: GoalSavingsDeposit[] = [];

          for (const goal of dueGoals) {
            const result = yield* Effect.gen(function* () {
              const amount = goal.depositAmount;
              if (!amount) {
                return yield* Effect.fail(
                  new GoalSavingsError({
                    message: `Goal ${goal.id} has no depositAmount configured`,
                  })
                );
              }

              return yield* depositOne(goal, amount, "automated");
            }).pipe(
              Effect.map((d) => ({ success: true as const, deposit: d })),
              Effect.catchAll((error) =>
                Effect.succeed({
                  success: false as const,
                  error: String(error),
                })
              )
            );

            // Update goal state after attempt
            const intervalMs = parseFrequencyToMs(goal.frequency!);
            const nextDepositAt = new Date(Date.now() + intervalMs);

            if (result.success) {
              // Reset failures, advance next deposit
              yield* Effect.tryPromise({
                try: () =>
                  db
                    .update(goalSavings)
                    .set({
                      consecutiveFailures: 0,
                      nextDepositAt,
                      updatedAt: new Date(),
                    })
                    .where(eq(goalSavings.id, goal.id)),
                catch: () =>
                  new GoalSavingsError({
                    message: `Failed to update goal after success`,
                  }),
              });

              deposits.push(result.deposit);
            } else {
              // Increment failures
              const newFailures = goal.consecutiveFailures + 1;
              const newStatus =
                newFailures >= goal.maxRetries ? "paused" : goal.status;

              yield* Effect.tryPromise({
                try: () =>
                  db
                    .update(goalSavings)
                    .set({
                      consecutiveFailures: newFailures,
                      nextDepositAt,
                      status: newStatus,
                      updatedAt: new Date(),
                    })
                    .where(eq(goalSavings.id, goal.id)),
                catch: () =>
                  new GoalSavingsError({
                    message: `Failed to update goal after failure`,
                  }),
              });
            }

            // Check if next deposit exceeds end date
            if (goal.endDate && nextDepositAt > goal.endDate) {
              yield* Effect.tryPromise({
                try: () =>
                  db
                    .update(goalSavings)
                    .set({ status: "completed", updatedAt: new Date() })
                    .where(eq(goalSavings.id, goal.id)),
                catch: () =>
                  new GoalSavingsError({
                    message: `Failed to complete goal past end date`,
                  }),
              });
            }
          }

          return deposits;
        }),
    };
  })
);
