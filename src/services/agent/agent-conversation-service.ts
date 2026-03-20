import { Effect, Context, Layer, Data } from "effect";
import { eq } from "drizzle-orm";
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
  readonly getConversation: (
    userId: string
  ) => Effect.Effect<AgentConversation, AgentConversationError>;

  readonly appendMessage: (
    userId: string,
    message: ConversationMessage
  ) => Effect.Effect<AgentConversation, AgentConversationError>;

  readonly clearConversation: (
    userId: string
  ) => Effect.Effect<AgentConversation, AgentConversationError>;

  readonly updateTokenCount: (
    userId: string,
    tokenCount: number
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

    const ensureConversation = (
      userId: string
    ): Effect.Effect<AgentConversation, AgentConversationError> =>
      Effect.gen(function* () {
        const [existing] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(agentConversations)
              .where(eq(agentConversations.userId, userId)),
          catch: (error) =>
            new AgentConversationError({
              message: `Failed to fetch conversation: ${error}`,
              cause: error,
            }),
        });

        if (existing) {
          return existing;
        }

        const [created] = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(agentConversations)
              .values({ userId, messages: [] })
              .returning(),
          catch: (error) =>
            new AgentConversationError({
              message: `Failed to create conversation: ${error}`,
              cause: error,
            }),
        });

        return created!;
      });

    return {
      getConversation: (userId: string) => ensureConversation(userId),

      appendMessage: (userId: string, message: ConversationMessage) =>
        Effect.gen(function* () {
          const conversation = yield* ensureConversation(userId);

          const updatedMessages = [...(conversation.messages ?? []), message];
          const now = new Date();

          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentConversations)
                .set({
                  messages: updatedMessages,
                  lastMessageAt: now,
                  updatedAt: now,
                })
                .where(eq(agentConversations.userId, userId))
                .returning(),
            catch: (error) =>
              new AgentConversationError({
                message: `Failed to append message: ${error}`,
                cause: error,
              }),
          });

          return updated!;
        }),

      clearConversation: (userId: string) =>
        Effect.gen(function* () {
          // Ensure the conversation row exists before clearing
          yield* ensureConversation(userId);

          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentConversations)
                .set({
                  messages: [],
                  tokenCount: 0,
                  updatedAt: new Date(),
                })
                .where(eq(agentConversations.userId, userId))
                .returning(),
            catch: (error) =>
              new AgentConversationError({
                message: `Failed to clear conversation: ${error}`,
                cause: error,
              }),
          });

          return updated!;
        }),

      updateTokenCount: (userId: string, tokenCount: number) =>
        Effect.gen(function* () {
          yield* ensureConversation(userId);

          yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentConversations)
                .set({
                  tokenCount,
                  updatedAt: new Date(),
                })
                .where(eq(agentConversations.userId, userId)),
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
