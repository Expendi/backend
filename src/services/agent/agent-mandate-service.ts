import { Effect, Context, Layer, Data } from "effect";
import { eq, and, desc, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import {
  agentMandates,
  mandateExecutions,
  type AgentMandate,
  type NewAgentMandate,
  type MandateExecution,
  type NewMandateExecution,
  type MandateTrigger,
  type MandateAction,
  type MandateConstraints,
} from "../../db/schema/index.js";

// ── Error type ───────────────────────────────────────────────────────

export class AgentMandateError extends Data.TaggedError("AgentMandateError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export interface CreateMandateParams {
  readonly userId: string;
  readonly type: string;
  readonly name?: string;
  readonly description?: string;
  readonly trigger: MandateTrigger;
  readonly action: MandateAction;
  readonly constraints?: MandateConstraints;
  readonly source?: "explicit" | "suggested" | "inferred";
  readonly expiresAt?: Date;
}

export interface UpdateMandateParams {
  readonly name?: string;
  readonly description?: string;
  readonly trigger?: MandateTrigger;
  readonly action?: MandateAction;
  readonly constraints?: MandateConstraints;
  readonly expiresAt?: Date | null;
}

export interface RecordExecutionParams {
  readonly mandateId: string;
  readonly status: "success" | "failed" | "skipped";
  readonly triggerSnapshot?: unknown;
  readonly result?: unknown;
  readonly transactionId?: string;
}

// ── Service interface ────────────────────────────────────────────────

export interface AgentMandateServiceApi {
  readonly listMandates: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<AgentMandate>, AgentMandateError>;

  readonly getMandate: (
    id: string
  ) => Effect.Effect<AgentMandate | undefined, AgentMandateError>;

  readonly createMandate: (
    params: CreateMandateParams
  ) => Effect.Effect<AgentMandate, AgentMandateError>;

  readonly updateMandate: (
    id: string,
    params: UpdateMandateParams
  ) => Effect.Effect<AgentMandate, AgentMandateError>;

  readonly pauseMandate: (
    id: string
  ) => Effect.Effect<AgentMandate, AgentMandateError>;

  readonly resumeMandate: (
    id: string
  ) => Effect.Effect<AgentMandate, AgentMandateError>;

  readonly revokeMandate: (
    id: string
  ) => Effect.Effect<AgentMandate, AgentMandateError>;

  readonly recordExecution: (
    params: RecordExecutionParams
  ) => Effect.Effect<MandateExecution, AgentMandateError>;

  readonly listExecutions: (
    mandateId: string,
    limit?: number
  ) => Effect.Effect<ReadonlyArray<MandateExecution>, AgentMandateError>;

  readonly getActiveMandatesForUser: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<AgentMandate>, AgentMandateError>;
}

export class AgentMandateService extends Context.Tag("AgentMandateService")<
  AgentMandateService,
  AgentMandateServiceApi
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

function computeNextExecutionAt(trigger: MandateTrigger): Date | null {
  if (trigger.type !== "schedule" || !trigger.frequency) {
    return null;
  }
  const intervalMs = parseFrequencyToMs(trigger.frequency);
  const anchor = trigger.anchor ? new Date(trigger.anchor).getTime() : Date.now();
  return new Date(anchor + intervalMs);
}

// ── Live implementation ──────────────────────────────────────────────

export const AgentMandateServiceLive: Layer.Layer<
  AgentMandateService,
  never,
  DatabaseService
> = Layer.effect(
  AgentMandateService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    return {
      listMandates: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(agentMandates)
              .where(eq(agentMandates.userId, userId))
              .orderBy(desc(agentMandates.createdAt));
            return results;
          },
          catch: (error) =>
            new AgentMandateError({
              message: `Failed to list mandates: ${error}`,
              cause: error,
            }),
        }),

      getMandate: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .select()
              .from(agentMandates)
              .where(eq(agentMandates.id, id));
            return result;
          },
          catch: (error) =>
            new AgentMandateError({
              message: `Failed to get mandate: ${error}`,
              cause: error,
            }),
        }),

      createMandate: (params: CreateMandateParams) =>
        Effect.tryPromise({
          try: async () => {
            const nextExecutionAt = computeNextExecutionAt(params.trigger);

            const values: NewAgentMandate = {
              userId: params.userId,
              type: params.type,
              name: params.name ?? null,
              description: params.description ?? null,
              trigger: params.trigger,
              action: params.action,
              constraints: params.constraints ?? null,
              source: params.source ?? "explicit",
              nextExecutionAt,
              expiresAt: params.expiresAt ?? null,
            };

            const [result] = await db
              .insert(agentMandates)
              .values(values)
              .returning();
            return result!;
          },
          catch: (error) =>
            new AgentMandateError({
              message: `Failed to create mandate: ${error}`,
              cause: error,
            }),
        }),

      updateMandate: (id: string, params: UpdateMandateParams) =>
        Effect.tryPromise({
          try: async () => {
            const updates: Record<string, unknown> = {
              updatedAt: new Date(),
            };
            if (params.name !== undefined) updates.name = params.name;
            if (params.description !== undefined)
              updates.description = params.description;
            if (params.trigger !== undefined) {
              updates.trigger = params.trigger;
              const nextExecutionAt = computeNextExecutionAt(params.trigger);
              if (nextExecutionAt) {
                updates.nextExecutionAt = nextExecutionAt;
              }
            }
            if (params.action !== undefined) updates.action = params.action;
            if (params.constraints !== undefined)
              updates.constraints = params.constraints;
            if (params.expiresAt !== undefined)
              updates.expiresAt = params.expiresAt;

            const [result] = await db
              .update(agentMandates)
              .set(updates)
              .where(eq(agentMandates.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new AgentMandateError({
              message: `Failed to update mandate: ${error}`,
              cause: error,
            }),
        }),

      pauseMandate: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(agentMandates)
              .set({ status: "paused", updatedAt: new Date() })
              .where(eq(agentMandates.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new AgentMandateError({
              message: `Failed to pause mandate: ${error}`,
              cause: error,
            }),
        }),

      resumeMandate: (id: string) =>
        Effect.gen(function* () {
          const [mandate] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(agentMandates)
                .where(eq(agentMandates.id, id)),
            catch: (error) =>
              new AgentMandateError({
                message: `Failed to find mandate: ${error}`,
                cause: error,
              }),
          });

          if (!mandate) {
            return yield* Effect.fail(
              new AgentMandateError({ message: `Mandate not found: ${id}` })
            );
          }

          // Recompute next execution for schedule-based mandates
          let nextExecutionAt: Date | null = mandate.nextExecutionAt;
          if (
            mandate.trigger.type === "schedule" &&
            mandate.trigger.frequency
          ) {
            const intervalMs = parseFrequencyToMs(mandate.trigger.frequency);
            nextExecutionAt = new Date(Date.now() + intervalMs);
          }

          const [result] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentMandates)
                .set({
                  status: "active",
                  nextExecutionAt,
                  updatedAt: new Date(),
                })
                .where(eq(agentMandates.id, id))
                .returning(),
            catch: (error) =>
              new AgentMandateError({
                message: `Failed to resume mandate: ${error}`,
                cause: error,
              }),
          });

          return result!;
        }),

      revokeMandate: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(agentMandates)
              .set({ status: "revoked", updatedAt: new Date() })
              .where(eq(agentMandates.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new AgentMandateError({
              message: `Failed to revoke mandate: ${error}`,
              cause: error,
            }),
        }),

      recordExecution: (params: RecordExecutionParams) =>
        Effect.gen(function* () {
          // Insert execution record
          const executionValues: NewMandateExecution = {
            mandateId: params.mandateId,
            status: params.status,
            triggerSnapshot: params.triggerSnapshot ?? null,
            result: params.result ?? null,
            transactionId: params.transactionId ?? null,
          };

          const [execution] = yield* Effect.tryPromise({
            try: () =>
              db
                .insert(mandateExecutions)
                .values(executionValues)
                .returning(),
            catch: (error) =>
              new AgentMandateError({
                message: `Failed to record execution: ${error}`,
                cause: error,
              }),
          });

          // Update the mandate's executionCount, lastExecutedAt, and nextExecutionAt
          const [mandate] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(agentMandates)
                .where(eq(agentMandates.id, params.mandateId)),
            catch: (error) =>
              new AgentMandateError({
                message: `Failed to fetch mandate for execution update: ${error}`,
                cause: error,
              }),
          });

          if (!mandate) {
            return yield* Effect.fail(
              new AgentMandateError({
                message: `Mandate not found: ${params.mandateId}`,
              })
            );
          }

          // Compute next execution time for schedule-based mandates
          let nextExecutionAt: Date | null = mandate.nextExecutionAt;
          if (
            mandate.trigger.type === "schedule" &&
            mandate.trigger.frequency
          ) {
            const intervalMs = parseFrequencyToMs(mandate.trigger.frequency);
            nextExecutionAt = new Date(Date.now() + intervalMs);
          }

          yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentMandates)
                .set({
                  executionCount: mandate.executionCount + 1,
                  lastExecutedAt: new Date(),
                  nextExecutionAt,
                  updatedAt: new Date(),
                })
                .where(eq(agentMandates.id, params.mandateId)),
            catch: (error) =>
              new AgentMandateError({
                message: `Failed to update mandate after execution: ${error}`,
                cause: error,
              }),
          });

          return execution!;
        }),

      listExecutions: (mandateId: string, limit = 50) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(mandateExecutions)
              .where(eq(mandateExecutions.mandateId, mandateId))
              .orderBy(desc(mandateExecutions.executedAt))
              .limit(limit);
            return results;
          },
          catch: (error) =>
            new AgentMandateError({
              message: `Failed to list executions: ${error}`,
              cause: error,
            }),
        }),

      getActiveMandatesForUser: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(agentMandates)
              .where(
                and(
                  eq(agentMandates.userId, userId),
                  eq(agentMandates.status, "active")
                )
              )
              .orderBy(desc(agentMandates.createdAt));
            return results;
          },
          catch: (error) =>
            new AgentMandateError({
              message: `Failed to get active mandates: ${error}`,
              cause: error,
            }),
        }),
    };
  })
);
