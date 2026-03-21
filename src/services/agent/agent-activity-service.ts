import { Effect, Context, Layer, Data } from "effect";
import { eq, and, desc, asc, sql, count, isNull } from "drizzle-orm";
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
    | "position_matured"
    | "research_finding"
    | "action_request"
    | "risk_alert";
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

  readonly listPendingRequests: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<AgentActivityRecord>, AgentActivityError>;

  readonly respondToRequest: (
    userId: string,
    activityId: string,
    approved: boolean,
    note?: string
  ) => Effect.Effect<AgentActivityRecord, AgentActivityError>;
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

      listPendingRequests: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(agentActivity)
              .where(
                and(
                  eq(agentActivity.userId, userId),
                  eq(agentActivity.type, "action_request"),
                  sql`(${agentActivity.metadata}->>'status') IS NULL OR (${agentActivity.metadata}->>'status') = 'pending'`
                )
              )
              .orderBy(desc(agentActivity.createdAt));
            return results;
          },
          catch: (error) =>
            new AgentActivityError({
              message: `Failed to list pending requests: ${error}`,
              cause: error,
            }),
        }),

      respondToRequest: (
        userId: string,
        activityId: string,
        approved: boolean,
        note?: string
      ) =>
        Effect.tryPromise({
          try: async () => {
            // First verify the activity belongs to the user and is an action_request
            const [existing] = await db
              .select()
              .from(agentActivity)
              .where(
                and(
                  eq(agentActivity.id, activityId),
                  eq(agentActivity.userId, userId),
                  eq(agentActivity.type, "action_request")
                )
              );

            if (!existing) {
              throw new Error(
                `Action request ${activityId} not found or does not belong to user`
              );
            }

            const existingMetadata =
              (existing.metadata as Record<string, unknown>) ?? {};
            const currentStatus = existingMetadata.status as string | undefined;

            if (
              currentStatus === "approved" ||
              currentStatus === "rejected"
            ) {
              throw new Error(
                `Action request ${activityId} has already been responded to with status: ${currentStatus}`
              );
            }

            const updatedMetadata = {
              ...existingMetadata,
              status: approved ? "approved" : "rejected",
              respondedAt: new Date().toISOString(),
              ...(note !== undefined && { responseNote: note }),
            };

            const [updated] = await db
              .update(agentActivity)
              .set({
                metadata: updatedMetadata,
                read: true,
              })
              .where(eq(agentActivity.id, activityId))
              .returning();

            return updated!;
          },
          catch: (error) =>
            new AgentActivityError({
              message: `Failed to respond to request: ${error}`,
              cause: error,
            }),
        }),
    };
  })
);
