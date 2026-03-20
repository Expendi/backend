import { Effect, Context, Layer, Data } from "effect";
import { eq, and, desc } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import {
  agentConversations,
  type AgentConversation,
  type ConversationMessage,
} from "../../db/schema/index.js";

// ── Error type ───────────────────────────────────────────────────────

export class AgentConversationError extends Data.TaggedError(
  "AgentConversationError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Service interface ────────────────────────────────────────────────

export interface AgentConversationServiceApi {
  /** List all conversations for a user, newest first */
  readonly listConversations: (
    userId: string
  ) => Effect.Effect<AgentConversation[], AgentConversationError>;

  /** Get a specific conversation by ID (must belong to user) */
  readonly getConversation: (
    userId: string,
    conversationId?: string
  ) => Effect.Effect<AgentConversation, AgentConversationError>;

  /** Create a new conversation, optionally with a title */
  readonly createConversation: (
    userId: string,
    title?: string
  ) => Effect.Effect<AgentConversation, AgentConversationError>;

  /** Append a message to a specific conversation */
  readonly appendMessage: (
    userId: string,
    message: ConversationMessage,
    conversationId?: string
  ) => Effect.Effect<AgentConversation, AgentConversationError>;

  /** Clear messages in a specific conversation */
  readonly clearConversation: (
    userId: string,
    conversationId?: string
  ) => Effect.Effect<AgentConversation, AgentConversationError>;

  /** Delete a conversation */
  readonly deleteConversation: (
    userId: string,
    conversationId: string
  ) => Effect.Effect<void, AgentConversationError>;

  /** Update conversation title */
  readonly updateTitle: (
    userId: string,
    conversationId: string,
    title: string
  ) => Effect.Effect<AgentConversation, AgentConversationError>;

  /** Update token count for a conversation */
  readonly updateTokenCount: (
    userId: string,
    tokenCount: number,
    conversationId?: string
  ) => Effect.Effect<void, AgentConversationError>;
}

export class AgentConversationService extends Context.Tag(
  "AgentConversationService"
)<AgentConversationService, AgentConversationServiceApi>() {}

// ── Live implementation ──────────────────────────────────────────────

export const AgentConversationServiceLive: Layer.Layer<
  AgentConversationService,
  never,
  DatabaseService
> = Layer.effect(
  AgentConversationService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    /** Get the active conversation for a user, or create one if none exists */
    const getActiveConversation = (
      userId: string
    ): Effect.Effect<AgentConversation, AgentConversationError> =>
      Effect.gen(function* () {
        const [existing] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(agentConversations)
              .where(
                and(
                  eq(agentConversations.userId, userId),
                  eq(agentConversations.isActive, true)
                )
              )
              .orderBy(desc(agentConversations.updatedAt))
              .limit(1),
          catch: (error) =>
            new AgentConversationError({
              message: `Failed to fetch conversation: ${error}`,
              cause: error,
            }),
        });

        if (existing) {
          return existing;
        }

        // Auto-create a conversation
        const [created] = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(agentConversations)
              .values({ userId, messages: [], isActive: true })
              .returning(),
          catch: (error) =>
            new AgentConversationError({
              message: `Failed to create conversation: ${error}`,
              cause: error,
            }),
        });

        return created!;
      });

    /** Get a specific conversation by ID, verifying ownership */
    const getConversationById = (
      userId: string,
      conversationId: string
    ): Effect.Effect<AgentConversation, AgentConversationError> =>
      Effect.gen(function* () {
        const [conversation] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(agentConversations)
              .where(
                and(
                  eq(agentConversations.id, conversationId),
                  eq(agentConversations.userId, userId)
                )
              ),
          catch: (error) =>
            new AgentConversationError({
              message: `Failed to fetch conversation: ${error}`,
              cause: error,
            }),
        });

        if (!conversation) {
          return yield* Effect.fail(
            new AgentConversationError({
              message: `Conversation not found: ${conversationId}`,
            })
          );
        }

        return conversation;
      });

    return {
      listConversations: (userId: string) =>
        Effect.tryPromise({
          try: () =>
            db
              .select({
                id: agentConversations.id,
                userId: agentConversations.userId,
                title: agentConversations.title,
                isActive: agentConversations.isActive,
                messages: agentConversations.messages,
                tokenCount: agentConversations.tokenCount,
                lastMessageAt: agentConversations.lastMessageAt,
                createdAt: agentConversations.createdAt,
                updatedAt: agentConversations.updatedAt,
              })
              .from(agentConversations)
              .where(eq(agentConversations.userId, userId))
              .orderBy(desc(agentConversations.updatedAt)),
          catch: (error) =>
            new AgentConversationError({
              message: `Failed to list conversations: ${error}`,
              cause: error,
            }),
        }),

      getConversation: (userId: string, conversationId?: string) =>
        conversationId
          ? getConversationById(userId, conversationId)
          : getActiveConversation(userId),

      createConversation: (userId: string, title?: string) =>
        Effect.gen(function* () {
          // Deactivate all existing conversations
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentConversations)
                .set({ isActive: false, updatedAt: new Date() })
                .where(
                  and(
                    eq(agentConversations.userId, userId),
                    eq(agentConversations.isActive, true)
                  )
                ),
            catch: (error) =>
              new AgentConversationError({
                message: `Failed to deactivate conversations: ${error}`,
                cause: error,
              }),
          });

          const [created] = yield* Effect.tryPromise({
            try: () =>
              db
                .insert(agentConversations)
                .values({
                  userId,
                  title: title ?? null,
                  messages: [],
                  isActive: true,
                })
                .returning(),
            catch: (error) =>
              new AgentConversationError({
                message: `Failed to create conversation: ${error}`,
                cause: error,
              }),
          });

          return created!;
        }),

      appendMessage: (
        userId: string,
        message: ConversationMessage,
        conversationId?: string
      ) =>
        Effect.gen(function* () {
          const conversation = conversationId
            ? yield* getConversationById(userId, conversationId)
            : yield* getActiveConversation(userId);

          const updatedMessages = [...(conversation.messages ?? []), message];
          const now = new Date();

          // Auto-generate title from first user message if untitled
          let title = conversation.title;
          if (!title && message.role === "user" && message.content) {
            title =
              message.content.length > 60
                ? message.content.slice(0, 57) + "..."
                : message.content;
          }

          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentConversations)
                .set({
                  messages: updatedMessages,
                  lastMessageAt: now,
                  updatedAt: now,
                  ...(title && !conversation.title && { title }),
                })
                .where(eq(agentConversations.id, conversation.id))
                .returning(),
            catch: (error) =>
              new AgentConversationError({
                message: `Failed to append message: ${error}`,
                cause: error,
              }),
          });

          return updated!;
        }),

      clearConversation: (userId: string, conversationId?: string) =>
        Effect.gen(function* () {
          const conversation = conversationId
            ? yield* getConversationById(userId, conversationId)
            : yield* getActiveConversation(userId);

          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentConversations)
                .set({
                  messages: [],
                  tokenCount: 0,
                  updatedAt: new Date(),
                })
                .where(eq(agentConversations.id, conversation.id))
                .returning(),
            catch: (error) =>
              new AgentConversationError({
                message: `Failed to clear conversation: ${error}`,
                cause: error,
              }),
          });

          return updated!;
        }),

      deleteConversation: (userId: string, conversationId: string) =>
        Effect.gen(function* () {
          // Verify ownership
          yield* getConversationById(userId, conversationId);

          yield* Effect.tryPromise({
            try: () =>
              db
                .delete(agentConversations)
                .where(
                  and(
                    eq(agentConversations.id, conversationId),
                    eq(agentConversations.userId, userId)
                  )
                ),
            catch: (error) =>
              new AgentConversationError({
                message: `Failed to delete conversation: ${error}`,
                cause: error,
              }),
          });
        }),

      updateTitle: (userId: string, conversationId: string, title: string) =>
        Effect.gen(function* () {
          yield* getConversationById(userId, conversationId);

          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentConversations)
                .set({ title, updatedAt: new Date() })
                .where(
                  and(
                    eq(agentConversations.id, conversationId),
                    eq(agentConversations.userId, userId)
                  )
                )
                .returning(),
            catch: (error) =>
              new AgentConversationError({
                message: `Failed to update title: ${error}`,
                cause: error,
              }),
          });

          return updated!;
        }),

      updateTokenCount: (
        userId: string,
        tokenCount: number,
        conversationId?: string
      ) =>
        Effect.gen(function* () {
          const conversation = conversationId
            ? yield* getConversationById(userId, conversationId)
            : yield* getActiveConversation(userId);

          yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentConversations)
                .set({
                  tokenCount,
                  updatedAt: new Date(),
                })
                .where(eq(agentConversations.id, conversation.id)),
            catch: (error) =>
              new AgentConversationError({
                message: `Failed to update token count: ${error}`,
                cause: error,
              }),
          });
        }),
    };
  })
);
