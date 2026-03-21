import { Effect, Context, Layer, Data } from "effect";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import { AdapterService } from "../adapters/adapter-service.js";
import { WalletService } from "../wallet/wallet-service.js";
import { AgentMandateService } from "./agent-mandate-service.js";
import { AgentProfileService } from "./agent-profile-service.js";
import { AgentActivityService } from "./agent-activity-service.js";
import { MarketResearchService } from "./market-research-service.js";
import type { AgentProfileData } from "../../db/schema/index.js";
import {
  agentMandates,
  type AgentMandate,
  type MandateTrigger,
} from "../../db/schema/index.js";

// ── Error type ───────────────────────────────────────────────────────

export class AgentAutonomyError extends Data.TaggedError(
  "AgentAutonomyError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export interface MandateResult {
  readonly mandateId: string;
  readonly status: "success" | "failed" | "skipped";
  readonly reason?: string;
}

export interface ExecutionSummary {
  readonly processed: number;
  readonly executed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly results: ReadonlyArray<MandateResult>;
}

// ── Service interface ────────────────────────────────────────────────

export interface ResearchCycleResult {
  readonly userId: string;
  readonly opportunitiesFound: number;
  readonly suggestionsCreated: number;
}

export interface AgentAutonomyServiceApi {
  readonly processAllMandates: () => Effect.Effect<
    ExecutionSummary,
    AgentAutonomyError
  >;
  readonly processUserMandates: (
    userId: string
  ) => Effect.Effect<ExecutionSummary, AgentAutonomyError>;
  readonly runResearchCycle: (
    userId: string
  ) => Effect.Effect<ResearchCycleResult, AgentAutonomyError>;
}

export class AgentAutonomyService extends Context.Tag("AgentAutonomyService")<
  AgentAutonomyService,
  AgentAutonomyServiceApi
>() {}

// ── Helpers ──────────────────────────────────────────────────────────

function buildActionDescription(mandate: AgentMandate): string {
  const action = mandate.action;
  switch (action.type) {
    case "notify":
      return action.message ?? "Notification triggered";
    case "swap":
      return `Swap ${action.amount ?? "?"} ${action.from ?? "?"} to ${action.to ?? "?"}`;
    case "offramp":
      return `Offramp ${action.amount ?? "?"} USDC to ${action.phone ?? "mobile"} (${action.country ?? "?"})`;
    case "goal_deposit":
      return `Deposit ${action.amount ?? "?"} to goal ${action.goalId ?? "?"}`;
    case "transfer":
      return `Transfer ${action.amount ?? "?"} to ${action.to ?? "?"}`;
    default:
      return `Action: ${action.type}`;
  }
}

function buildActivityTitle(mandate: AgentMandate, executed: boolean): string {
  if (!executed) {
    return `Mandate skipped: ${mandate.name ?? mandate.type}`;
  }
  if (mandate.action.type === "notify") {
    return mandate.action.message ?? `Alert: ${mandate.name ?? mandate.type}`;
  }
  return `Mandate evaluated: ${mandate.name ?? mandate.type}`;
}

// ── Live implementation ──────────────────────────────────────────────

export const AgentAutonomyServiceLive: Layer.Layer<
  AgentAutonomyService,
  never,
  | DatabaseService
  | AdapterService
  | WalletService
  | AgentMandateService
  | AgentProfileService
  | AgentActivityService
  | MarketResearchService
> = Layer.effect(
  AgentAutonomyService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const mandateService = yield* AgentMandateService;
    const profileService = yield* AgentProfileService;
    const activityService = yield* AgentActivityService;
    const adapterService = yield* AdapterService;
    const walletService = yield* WalletService;

    // ── Trigger evaluation ─────────────────────────────────────────

    const evaluatePriceTrigger = (
      trigger: MandateTrigger
    ): Effect.Effect<boolean, AgentAutonomyError> =>
      Effect.gen(function* () {
        if (!trigger.token || !trigger.condition || trigger.value === undefined) {
          return false;
        }

        const priceData = yield* adapterService.getPrice(trigger.token).pipe(
          Effect.mapError(
            (err) =>
              new AgentAutonomyError({
                message: `Failed to fetch price for ${trigger.token}: ${err.message}`,
                cause: err,
              })
          )
        );

        const targetValue =
          typeof trigger.value === "string"
            ? parseFloat(trigger.value)
            : trigger.value;

        if (isNaN(targetValue)) {
          return false;
        }

        if (trigger.condition === "above") {
          return priceData.price > targetValue;
        }
        if (trigger.condition === "below") {
          return priceData.price < targetValue;
        }
        return false;
      });

    const evaluateScheduleTrigger = (
      mandate: AgentMandate
    ): Effect.Effect<boolean, AgentAutonomyError> =>
      Effect.succeed(
        mandate.nextExecutionAt !== null &&
          new Date() >= new Date(mandate.nextExecutionAt)
      );

    const evaluateBalanceTrigger = (
      trigger: MandateTrigger
    ): Effect.Effect<boolean, AgentAutonomyError> =>
      Effect.gen(function* () {
        if (
          !trigger.wallet ||
          !trigger.condition ||
          trigger.value === undefined
        ) {
          return false;
        }

        const wallet = yield* walletService
          .getWallet(trigger.wallet, "user")
          .pipe(
            Effect.mapError(
              (err) =>
                new AgentAutonomyError({
                  message: `Failed to get wallet ${trigger.wallet}: ${err.message}`,
                  cause: err,
                })
            )
          );

        const address = yield* wallet.getAddress().pipe(
          Effect.mapError(
            (err) =>
              new AgentAutonomyError({
                message: `Failed to get wallet address: ${err.message}`,
                cause: err,
              })
          )
        );

        // For balance triggers, we compare the raw address availability as a
        // proxy. The actual on-chain balance read requires viem/ContractExecutor
        // which is not a dependency of this service. In v1, balance triggers
        // check that the wallet exists and is accessible; full on-chain balance
        // comparison will be wired when we integrate ContractExecutor.
        // For now, we return true if the wallet and address are accessible,
        // meaning the mandate will fire and log what it would do.
        const _ = address;
        return true;
      });

    const evaluateTrigger = (
      mandate: AgentMandate
    ): Effect.Effect<boolean, AgentAutonomyError> => {
      const trigger = mandate.trigger;
      switch (trigger.type) {
        case "price":
          return evaluatePriceTrigger(trigger);
        case "schedule":
          return evaluateScheduleTrigger(mandate);
        case "balance":
          return evaluateBalanceTrigger(trigger);
        case "event":
          // Event-based triggers will be webhook-driven in the future
          return Effect.succeed(false);
        default:
          return Effect.succeed(false);
      }
    };

    // ── Consecutive failure counting ───────────────────────────────

    const countConsecutiveFailures = (
      mandateId: string
    ): Effect.Effect<number, AgentAutonomyError> =>
      mandateService.listExecutions(mandateId, 10).pipe(
        Effect.map((executions) => {
          let count = 0;
          for (const exec of executions) {
            if (exec.status === "failed") {
              count++;
            } else {
              break;
            }
          }
          return count;
        }),
        Effect.mapError(
          (err) =>
            new AgentAutonomyError({
              message: `Failed to count consecutive failures: ${err.message}`,
              cause: err,
            })
        )
      );

    // ── Single mandate processing ──────────────────────────────────

    const processMandate = (
      mandate: AgentMandate
    ): Effect.Effect<MandateResult, never> =>
      Effect.gen(function* () {
        // Check if mandate has expired
        if (mandate.expiresAt && new Date() > new Date(mandate.expiresAt)) {
          yield* mandateService.revokeMandate(mandate.id).pipe(
            Effect.catchAll(() => Effect.void)
          );

          yield* activityService
            .createActivity({
              userId: mandate.userId,
              type: "mandate_executed",
              title: `Mandate expired: ${mandate.name ?? mandate.type}`,
              description: `The mandate "${mandate.name ?? mandate.type}" has expired and been revoked.`,
              mandateId: mandate.id,
            })
            .pipe(Effect.catchAll(() => Effect.void));

          return {
            mandateId: mandate.id,
            status: "skipped" as const,
            reason: "Mandate has expired",
          };
        }

        // Evaluate the trigger
        const triggered = yield* evaluateTrigger(mandate).pipe(
          Effect.catchAll((err) =>
            Effect.gen(function* () {
              // Record the failure
              yield* mandateService
                .recordExecution({
                  mandateId: mandate.id,
                  status: "failed",
                  triggerSnapshot: { trigger: mandate.trigger, error: err.message },
                  result: { error: err.message },
                })
                .pipe(Effect.catchAll(() => Effect.void));

              // Check consecutive failures and pause if 3+
              const failures = yield* countConsecutiveFailures(mandate.id).pipe(
                Effect.catchAll(() => Effect.succeed(0))
              );

              if (failures >= 2) {
                // This failure makes it 3 total (the one we just recorded + 2 previous)
                yield* mandateService.pauseMandate(mandate.id).pipe(
                  Effect.catchAll(() => Effect.void)
                );

                yield* activityService
                  .createActivity({
                    userId: mandate.userId,
                    type: "alert",
                    title: `Mandate paused: ${mandate.name ?? mandate.type}`,
                    description: `Automatically paused after 3 consecutive failures. Last error: ${err.message}`,
                    mandateId: mandate.id,
                  })
                  .pipe(Effect.catchAll(() => Effect.void));
              }

              return false;
            })
          )
        );

        if (!triggered) {
          return {
            mandateId: mandate.id,
            status: "skipped" as const,
            reason: "Trigger condition not met",
          };
        }

        // Trigger is met -- evaluate and log the action
        const actionDescription = buildActionDescription(mandate);
        const activityTitle = buildActivityTitle(mandate, true);

        if (mandate.action.type === "notify") {
          // Notify actions create activity entries directly
          yield* activityService
            .createActivity({
              userId: mandate.userId,
              type: "alert",
              title: activityTitle,
              description:
                mandate.action.message ??
                mandate.description ??
                "Notification from mandate",
              mandateId: mandate.id,
              metadata: {
                trigger: mandate.trigger,
                action: mandate.action,
              },
            })
            .pipe(
              Effect.mapError(
                (err) =>
                  new AgentAutonomyError({
                    message: `Failed to create activity: ${err.message}`,
                    cause: err,
                  })
              )
            );

          yield* mandateService
            .recordExecution({
              mandateId: mandate.id,
              status: "success",
              triggerSnapshot: { trigger: mandate.trigger, evaluatedAt: new Date().toISOString() },
              result: { action: "notify", message: mandate.action.message },
            })
            .pipe(
              Effect.mapError(
                (err) =>
                  new AgentAutonomyError({
                    message: `Failed to record execution: ${err.message}`,
                    cause: err,
                  })
              )
            );

          return {
            mandateId: mandate.id,
            status: "success" as const,
          };
        }

        // For non-notify actions: log what would be done (execution deferred)
        const executionResult = {
          action: mandate.action.type,
          description: actionDescription,
          deferredExecution: true,
          evaluatedAt: new Date().toISOString(),
          actionDetails: mandate.action,
          constraints: mandate.constraints,
        };

        yield* mandateService
          .recordExecution({
            mandateId: mandate.id,
            status: "success",
            triggerSnapshot: {
              trigger: mandate.trigger,
              evaluatedAt: new Date().toISOString(),
            },
            result: executionResult,
          })
          .pipe(
            Effect.mapError(
              (err) =>
                new AgentAutonomyError({
                  message: `Failed to record execution: ${err.message}`,
                  cause: err,
                })
            )
          );

        yield* activityService
          .createActivity({
            userId: mandate.userId,
            type: "mandate_executed",
            title: activityTitle,
            description: `Evaluated: ${actionDescription}. Execution deferred pending agent wallet integration.`,
            mandateId: mandate.id,
            metadata: executionResult,
          })
          .pipe(
            Effect.mapError(
              (err) =>
                new AgentAutonomyError({
                  message: `Failed to create activity: ${err.message}`,
                  cause: err,
                })
            )
          );

        return {
          mandateId: mandate.id,
          status: "success" as const,
        };
      }).pipe(
        Effect.catchAll((err) =>
          Effect.succeed({
            mandateId: mandate.id,
            status: "failed" as const,
            reason:
              err instanceof AgentAutonomyError
                ? err.message
                : `Unexpected error: ${String(err)}`,
          })
        )
      );

    // ── Public API ────────────────────────────────────────────────

    const processUserMandates = (
      userId: string
    ): Effect.Effect<ExecutionSummary, AgentAutonomyError> =>
      Effect.gen(function* () {
        // Verify the user's trust tier allows autonomous execution
        const profile = yield* profileService.getProfile(userId).pipe(
          Effect.mapError(
            (err) =>
              new AgentAutonomyError({
                message: `Failed to fetch profile for ${userId}: ${err.message}`,
                cause: err,
              })
          )
        );

        const tier = profile.trustTier;
        if (tier !== "act_within_limits" && tier !== "full") {
          return {
            processed: 0,
            executed: 0,
            skipped: 0,
            failed: 0,
            results: [],
          };
        }

        // Fetch active mandates
        const mandates = yield* mandateService
          .getActiveMandatesForUser(userId)
          .pipe(
            Effect.mapError(
              (err) =>
                new AgentAutonomyError({
                  message: `Failed to fetch mandates for ${userId}: ${err.message}`,
                  cause: err,
                })
            )
          );

        if (mandates.length === 0) {
          return {
            processed: 0,
            executed: 0,
            skipped: 0,
            failed: 0,
            results: [],
          };
        }

        // Process each mandate sequentially to avoid race conditions
        const results: MandateResult[] = [];
        for (const mandate of mandates) {
          const result = yield* processMandate(mandate);
          results.push(result);
        }

        const executed = results.filter((r) => r.status === "success").length;
        const skipped = results.filter((r) => r.status === "skipped").length;
        const failed = results.filter((r) => r.status === "failed").length;

        return {
          processed: results.length,
          executed,
          skipped,
          failed,
          results,
        };
      });

    const processAllMandates = (): Effect.Effect<
      ExecutionSummary,
      AgentAutonomyError
    > =>
      Effect.gen(function* () {
        const allActiveMandates = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(agentMandates)
              .where(eq(agentMandates.status, "active")),
          catch: (error) =>
            new AgentAutonomyError({
              message: `Failed to fetch all active mandates: ${error}`,
              cause: error,
            }),
        });

        // Group by userId
        const byUser = new Map<string, AgentMandate[]>();
        for (const mandate of allActiveMandates) {
          const existing = byUser.get(mandate.userId);
          if (existing) {
            existing.push(mandate);
          } else {
            byUser.set(mandate.userId, [mandate]);
          }
        }

        // Process each user's mandates
        const allResults: MandateResult[] = [];
        for (const [userId] of byUser) {
          const summary = yield* processUserMandates(userId).pipe(
            Effect.catchAll((err) =>
              Effect.succeed({
                processed: 0,
                executed: 0,
                skipped: 0,
                failed: 0,
                results: [] as ReadonlyArray<MandateResult>,
              })
            )
          );
          allResults.push(...summary.results);
        }

        const executed = allResults.filter(
          (r) => r.status === "success"
        ).length;
        const skipped = allResults.filter(
          (r) => r.status === "skipped"
        ).length;
        const failed = allResults.filter((r) => r.status === "failed").length;

        return {
          processed: allResults.length,
          executed,
          skipped,
          failed,
          results: allResults,
        };
      });

    // ── Research cycle ──────────────────────────────────────────────
    const runResearchCycle = (userId: string) =>
      Effect.gen(function* () {
        const profileService = yield* AgentProfileService;
        const researchService = yield* MarketResearchService;
        const activityService = yield* AgentActivityService;

        // Get user profile
        const agentProfile = yield* profileService.getProfile(userId).pipe(
          Effect.mapError(
            (e) =>
              new AgentAutonomyError({
                message: `Failed to get profile for research: ${e}`,
                cause: e,
              })
          )
        );

        const profile = (agentProfile.profile ?? {}) as AgentProfileData;
        const trustTier = agentProfile.trustTier;

        // Only run research for users with notify tier or above
        if (trustTier === "observe") {
          return {
            userId,
            opportunitiesFound: 0,
            suggestionsCreated: 0,
          };
        }

        // Find opportunities based on profile
        const opportunities = yield* researchService
          .findOpportunities(profile)
          .pipe(
            Effect.mapError(
              (e) =>
                new AgentAutonomyError({
                  message: `Research failed: ${e.message}`,
                  cause: e,
                })
            )
          );

        if (opportunities.length === 0) {
          return {
            userId,
            opportunitiesFound: 0,
            suggestionsCreated: 0,
          };
        }

        // Create activity entries for top opportunities (max 3)
        const topOpportunities = opportunities.slice(0, 3);
        let suggestionsCreated = 0;

        for (const opp of topOpportunities) {
          yield* activityService
            .createActivity({
              userId,
              type: "research_finding",
              title: `${opp.token.symbol}: ${opp.reason}`,
              description: `${opp.token.name} (${opp.token.symbol}) — risk: ${opp.riskLevel}, relevance: ${opp.relevanceScore}/10. 24h change: ${opp.token.priceChange24h.toFixed(1)}%.`,
              metadata: {
                symbol: opp.token.symbol,
                name: opp.token.name,
                riskLevel: opp.riskLevel,
                relevanceScore: opp.relevanceScore,
                priceChange24h: opp.token.priceChange24h,
              },
            })
            .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
          suggestionsCreated++;
        }

        return {
          userId,
          opportunitiesFound: opportunities.length,
          suggestionsCreated,
        };
      });

    return {
      processAllMandates,
      processUserMandates,
      runResearchCycle,
    };
  })
);
