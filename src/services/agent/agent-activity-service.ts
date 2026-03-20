import { Effect, Context, Layer, Data } from "effect";
import { eq, and, desc, asc, sql, count } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import {
  agentActivity,
  type AgentActivityRecord,
  type NewAgentActivityRecord,
} from "../../db/schema/index.js";

// ── Error type ───────────────────────────────────────────────────────

export class AgentActivityError extends Data.TaggedError(
  "AgentActivityError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export interface CreateActivityParams {
  readonly userId: string;
  readonly type:
    | "mandate_executed"
    | "pattern_detected"
    | "alert"
    | "suggestion"
    | "balance_change"
    | "position_matured";
  readonly title: string;
  readonly description?: string;
  readonly mandateId?: string;
  readonly transactionId?: string;
  readonly metadata?: unknown;
}

// ── Service interface ────────────────────────────────────────────────

export interface AgentActivityServiceApi {
  readonly listActivity: (
    userId: string,
    limit?: number,
    offset?: number
  ) => Effect.Effect<ReadonlyArray<AgentActivityRecord>, AgentActivityError>;

  readonly createActivity: (
    params: CreateActivityParams
  ) => Effect.Effect<AgentActivityRecord, AgentActivityError>;

  readonly markAllRead: (
    userId: string
  ) => Effect.Effect<void, AgentActivityError>;

  readonly getUnreadCount: (
    userId: string
  ) => Effect.Effect<number, AgentActivityError>;
}

export class AgentActivityService extends Context.Tag("AgentActivityService")<
  AgentActivityService,
  AgentActivityServiceApi
>() {}

// ── Live implementation ──────────────────────────────────────────────

export const AgentActivityServiceLive: Layer.Layer<
  AgentActivityService,
  never,
  DatabaseService
> = Layer.effect(
  AgentActivityService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    return {
      listActivity: (userId: string, limit = 50, offset = 0) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(agentActivity)
              .where(eq(agentActivity.userId, userId))
              .orderBy(asc(agentActivity.read), desc(agentActivity.createdAt))
              .limit(limit)
              .offset(offset);
            return results;
          },
          catch: (error) =>
            new AgentActivityError({
              message: `Failed to list activity: ${error}`,
              cause: error,
            }),
        }),

      createActivity: (params: CreateActivityParams) =>
        Effect.tryPromise({
          try: async () => {
            const values: NewAgentActivityRecord = {
              userId: params.userId,
              type: params.type,
              title: params.title,
              description: params.description ?? null,
              mandateId: params.mandateId ?? null,
              transactionId: params.transactionId ?? null,
              metadata: params.metadata ?? null,
            };

            const [result] = await db
              .insert(agentActivity)
              .values(values)
              .returning();
            return result!;
          },
          catch: (error) =>
            new AgentActivityError({
              message: `Failed to create activity: ${error}`,
              cause: error,
            }),
        }),

      markAllRead: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(agentActivity)
              .set({ read: true })
              .where(
                and(
                  eq(agentActivity.userId, userId),
                  eq(agentActivity.read, false)
                )
              );
          },
          catch: (error) =>
            new AgentActivityError({
              message: `Failed to mark all read: ${error}`,
              cause: error,
            }),
        }),

      getUnreadCount: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .select({ value: count() })
              .from(agentActivity)
              .where(
                and(
                  eq(agentActivity.userId, userId),
                  eq(agentActivity.read, false)
                )
              );
            return result?.value ?? 0;
          },
          catch: (error) =>
            new AgentActivityError({
              message: `Failed to get unread count: ${error}`,
              cause: error,
            }),
        }),
    };
  })
);
