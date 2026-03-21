import { Effect, Context, Layer, Data } from "effect";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import {
  agentInbox,
  type AgentInboxItem,
  type NewAgentInboxItem,
} from "../../db/schema/index.js";

// ── Error type ───────────────────────────────────────────────────────

export class AgentInboxError extends Data.TaggedError("AgentInboxError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export interface CreateInboxItemParams {
  readonly userId: string;
  readonly category:
    | "research"
    | "request"
    | "alert"
    | "news"
    | "suggestion"
    | "mandate_update";
  readonly title: string;
  readonly body?: string;
  readonly metadata?: Record<string, unknown>;
  readonly priority?: "low" | "medium" | "high" | "urgent";
  readonly actionType?: string;
  readonly actionPayload?: Record<string, unknown>;
  readonly expiresAt?: Date;
}

export interface InboxFilters {
  readonly category?: string;
  readonly status?: string;
  readonly priority?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface UnreadCount {
  readonly total: number;
  readonly byCategory: Record<string, number>;
}

// ── Service interface ────────────────────────────────────────────────

export interface AgentInboxServiceApi {
  readonly addItem: (
    params: CreateInboxItemParams
  ) => Effect.Effect<AgentInboxItem, AgentInboxError>;

  readonly listItems: (
    userId: string,
    filters?: InboxFilters
  ) => Effect.Effect<ReadonlyArray<AgentInboxItem>, AgentInboxError>;

  readonly getUnreadCount: (
    userId: string
  ) => Effect.Effect<UnreadCount, AgentInboxError>;

  readonly markRead: (
    userId: string,
    itemId: string
  ) => Effect.Effect<AgentInboxItem, AgentInboxError>;

  readonly markAllRead: (
    userId: string,
    category?: string
  ) => Effect.Effect<void, AgentInboxError>;

  readonly dismiss: (
    userId: string,
    itemId: string
  ) => Effect.Effect<AgentInboxItem, AgentInboxError>;

  readonly actOnItem: (
    userId: string,
    itemId: string,
    approved: boolean,
    note?: string
  ) => Effect.Effect<AgentInboxItem, AgentInboxError>;
}

export class AgentInboxService extends Context.Tag("AgentInboxService")<
  AgentInboxService,
  AgentInboxServiceApi
>() {}

// ── Live implementation ──────────────────────────────────────────────

export const AgentInboxServiceLive: Layer.Layer<
  AgentInboxService,
  never,
  DatabaseService
> = Layer.effect(
  AgentInboxService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    return {
      addItem: (params: CreateInboxItemParams) =>
        Effect.tryPromise({
          try: async () => {
            const values: NewAgentInboxItem = {
              userId: params.userId,
              category: params.category,
              title: params.title,
              body: params.body ?? null,
              metadata: params.metadata ?? null,
              priority: params.priority ?? "medium",
              actionType: params.actionType ?? null,
              actionPayload: params.actionPayload ?? null,
              expiresAt: params.expiresAt ?? null,
            };

            const [result] = await db
              .insert(agentInbox)
              .values(values)
              .returning();
            return result!;
          },
          catch: (error) =>
            new AgentInboxError({
              message: `Failed to add inbox item: ${error}`,
              cause: error,
            }),
        }),

      listItems: (userId: string, filters?: InboxFilters) =>
        Effect.tryPromise({
          try: async () => {
            const conditions = [eq(agentInbox.userId, userId)];

            if (filters?.category) {
              conditions.push(
                eq(
                  agentInbox.category,
                  filters.category as
                    | "research"
                    | "request"
                    | "alert"
                    | "news"
                    | "suggestion"
                    | "mandate_update"
                )
              );
            }
            if (filters?.status) {
              conditions.push(
                eq(
                  agentInbox.status,
                  filters.status as
                    | "unread"
                    | "read"
                    | "actioned"
                    | "dismissed"
                )
              );
            }
            if (filters?.priority) {
              conditions.push(
                eq(
                  agentInbox.priority,
                  filters.priority as "low" | "medium" | "high" | "urgent"
                )
              );
            }

            const limit = filters?.limit ?? 20;
            const offset = filters?.offset ?? 0;

            const results = await db
              .select()
              .from(agentInbox)
              .where(and(...conditions))
              .orderBy(desc(agentInbox.createdAt))
              .limit(limit)
              .offset(offset);

            return results;
          },
          catch: (error) =>
            new AgentInboxError({
              message: `Failed to list inbox items: ${error}`,
              cause: error,
            }),
        }),

      getUnreadCount: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await db
              .select({
                category: agentInbox.category,
                value: count(),
              })
              .from(agentInbox)
              .where(
                and(
                  eq(agentInbox.userId, userId),
                  eq(agentInbox.status, "unread")
                )
              )
              .groupBy(agentInbox.category);

            const byCategory: Record<string, number> = {};
            let total = 0;
            for (const row of rows) {
              byCategory[row.category] = row.value;
              total += row.value;
            }

            return { total, byCategory };
          },
          catch: (error) =>
            new AgentInboxError({
              message: `Failed to get unread count: ${error}`,
              cause: error,
            }),
        }),

      markRead: (userId: string, itemId: string) =>
        Effect.tryPromise({
          try: async () => {
            const [updated] = await db
              .update(agentInbox)
              .set({ status: "read" })
              .where(
                and(
                  eq(agentInbox.id, itemId),
                  eq(agentInbox.userId, userId)
                )
              )
              .returning();

            if (!updated) {
              throw new Error(
                `Inbox item ${itemId} not found or does not belong to user`
              );
            }

            return updated;
          },
          catch: (error) =>
            new AgentInboxError({
              message: `Failed to mark item as read: ${error}`,
              cause: error,
            }),
        }),

      markAllRead: (userId: string, category?: string) =>
        Effect.tryPromise({
          try: async () => {
            const conditions = [
              eq(agentInbox.userId, userId),
              eq(agentInbox.status, "unread"),
            ];

            if (category) {
              conditions.push(
                eq(
                  agentInbox.category,
                  category as
                    | "research"
                    | "request"
                    | "alert"
                    | "news"
                    | "suggestion"
                    | "mandate_update"
                )
              );
            }

            await db
              .update(agentInbox)
              .set({ status: "read" })
              .where(and(...conditions));
          },
          catch: (error) =>
            new AgentInboxError({
              message: `Failed to mark all as read: ${error}`,
              cause: error,
            }),
        }),

      dismiss: (userId: string, itemId: string) =>
        Effect.tryPromise({
          try: async () => {
            const [updated] = await db
              .update(agentInbox)
              .set({ status: "dismissed" })
              .where(
                and(
                  eq(agentInbox.id, itemId),
                  eq(agentInbox.userId, userId)
                )
              )
              .returning();

            if (!updated) {
              throw new Error(
                `Inbox item ${itemId} not found or does not belong to user`
              );
            }

            return updated;
          },
          catch: (error) =>
            new AgentInboxError({
              message: `Failed to dismiss item: ${error}`,
              cause: error,
            }),
        }),

      actOnItem: (
        userId: string,
        itemId: string,
        approved: boolean,
        note?: string
      ) =>
        Effect.tryPromise({
          try: async () => {
            // Verify the item belongs to the user and has an action
            const [existing] = await db
              .select()
              .from(agentInbox)
              .where(
                and(
                  eq(agentInbox.id, itemId),
                  eq(agentInbox.userId, userId)
                )
              );

            if (!existing) {
              throw new Error(
                `Inbox item ${itemId} not found or does not belong to user`
              );
            }

            if (!existing.actionType) {
              throw new Error(
                `Inbox item ${itemId} does not have an actionable type`
              );
            }

            if (
              existing.status === "actioned" ||
              existing.status === "dismissed"
            ) {
              throw new Error(
                `Inbox item ${itemId} has already been ${existing.status}`
              );
            }

            const existingMetadata =
              (existing.metadata as Record<string, unknown>) ?? {};

            const updatedMetadata = {
              ...existingMetadata,
              actionResult: approved ? "approved" : "rejected",
              respondedAt: new Date().toISOString(),
              ...(note !== undefined && { responseNote: note }),
            };

            const [updated] = await db
              .update(agentInbox)
              .set({
                status: "actioned",
                metadata: updatedMetadata,
              })
              .where(eq(agentInbox.id, itemId))
              .returning();

            return updated!;
          },
          catch: (error) =>
            new AgentInboxError({
              message: `Failed to act on item: ${error}`,
              cause: error,
            }),
        }),
    };
  })
);
