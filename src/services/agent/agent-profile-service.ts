import { Effect, Context, Layer, Data } from "effect";
import { eq } from "drizzle-orm";
import { createAdapter, providers } from "glove-core/models/providers";
import { DatabaseService } from "../../db/client.js";
import { ConfigService } from "../../config.js";
import {
  agentProfiles,
  type AgentProfile,
  type AgentProfileData,
  type ConversationMessage,
} from "../../db/schema/index.js";

// ── Error type ───────────────────────────────────────────────────────

export class AgentProfileError extends Data.TaggedError("AgentProfileError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Service interface ────────────────────────────────────────────────

export interface AgentProfileServiceApi {
  readonly getProfile: (
    userId: string
  ) => Effect.Effect<AgentProfile, AgentProfileError>;

  readonly updateProfile: (
    userId: string,
    patch: Partial<AgentProfileData>
  ) => Effect.Effect<AgentProfile, AgentProfileError>;

  readonly reflect: (
    userId: string,
    recentMessages: ConversationMessage[]
  ) => Effect.Effect<AgentProfile, AgentProfileError>;

  readonly updateTrustTier: (
    userId: string,
    tier: "observe" | "notify" | "act_within_limits" | "full"
  ) => Effect.Effect<AgentProfile, AgentProfileError>;

  readonly updateBudget: (
    userId: string,
    budget: string
  ) => Effect.Effect<AgentProfile, AgentProfileError>;

}

export class AgentProfileService extends Context.Tag("AgentProfileService")<
  AgentProfileService,
  AgentProfileServiceApi
>() {}

// ── Helpers ──────────────────────────────────────────────────────────

function deepMergeProfile(
  existing: AgentProfileData,
  patch: Partial<AgentProfileData>
): AgentProfileData {
  const merged: AgentProfileData = { ...existing };

  if (patch.country !== undefined) merged.country = patch.country;
  if (patch.currency !== undefined) merged.currency = patch.currency;
  if (patch.knowledgeLevel !== undefined)
    merged.knowledgeLevel = patch.knowledgeLevel;
  if (patch.riskTolerance !== undefined)
    merged.riskTolerance = patch.riskTolerance;
  if (patch.communicationStyle !== undefined)
    merged.communicationStyle = patch.communicationStyle;
  if (patch.onboardingComplete !== undefined)
    merged.onboardingComplete = patch.onboardingComplete;
  if (patch.riskScore !== undefined) merged.riskScore = patch.riskScore;
  if (patch.investmentHorizon !== undefined)
    merged.investmentHorizon = patch.investmentHorizon;
  if (patch.maxSingleTradePercent !== undefined)
    merged.maxSingleTradePercent = patch.maxSingleTradePercent;
  if (patch.customInstructions !== undefined)
    merged.customInstructions = patch.customInstructions;

  if (patch.preferredCategories !== undefined) {
    const existingPref = existing.preferredCategories ?? [];
    const newPref = patch.preferredCategories.filter(
      (c) => !existingPref.includes(c)
    );
    merged.preferredCategories = [...existingPref, ...newPref];
  }

  if (patch.avoidCategories !== undefined) {
    const existingAvoid = existing.avoidCategories ?? [];
    const newAvoid = patch.avoidCategories.filter(
      (c) => !existingAvoid.includes(c)
    );
    merged.avoidCategories = [...existingAvoid, ...newAvoid];
  }

  if (patch.goals !== undefined) {
    const existingGoals = existing.goals ?? [];
    const newGoals = patch.goals.filter((g) => !existingGoals.includes(g));
    merged.goals = [...existingGoals, ...newGoals];
  }

  if (patch.interests !== undefined) {
    const existingInterests = existing.interests ?? [];
    const newInterests = patch.interests.filter(
      (i) => !existingInterests.includes(i)
    );
    merged.interests = [...existingInterests, ...newInterests];
  }

  if (patch.patterns !== undefined) {
    const existingPatterns = existing.patterns ?? {};
    merged.patterns = {
      frequentRecipients: patch.patterns.frequentRecipients ??
        existingPatterns.frequentRecipients,
      preferredTokens: patch.patterns.preferredTokens ??
        existingPatterns.preferredTokens,
      typicalAmounts: patch.patterns.typicalAmounts
        ? { ...existingPatterns.typicalAmounts, ...patch.patterns.typicalAmounts }
        : existingPatterns.typicalAmounts,
    };
  }

  return merged;
}

function buildReflectionPrompt(
  existingProfile: AgentProfileData,
  messages: ConversationMessage[]
): string {
  const existingProfileJSON = JSON.stringify(existingProfile, null, 2);
  const messagesFormatted = messages
    .map((m) => `[${m.role}] ${m.content}`)
    .join("\n");

  return `You are analyzing a conversation between a user and their crypto wallet agent.

Current profile:
${existingProfileJSON}

Recent messages:
${messagesFormatted}

Update the profile JSON with any new information from this conversation.
Rules:
- Never remove existing facts unless explicitly contradicted
- Infer knowledge level from vocabulary and questions
- Track recurring patterns (same recipient, same amounts, same times)
- Note stated goals, preferences, and concerns
- Keep it structured and concise

Risk profiling rules:
- Detect risk appetite from vocabulary: words like "moon", "degen", "ape in", "yolo", "100x" signal aggressive (riskScore 7-10); words like "safe", "careful", "stable", "preserve", "low risk" signal conservative (riskScore 1-3); neutral language is moderate (riskScore 4-6)
- Infer investmentHorizon from stated goals: "saving for retirement", "long game", "hold for years" = "long"; "a few months", "medium term" = "medium"; "quick flip", "day trade", "short term" = "short"
- Track token category preferences: if user mentions interest in DeFi, L2s, stablecoins, meme coins, NFTs, etc., populate preferredCategories; if they express dislike or avoidance of certain categories, populate avoidCategories
- Compute riskScore (1-10) based on accumulated signals across all conversations — weight recent statements more heavily
- Set maxSingleTradePercent if the user expresses preferences about position sizing (e.g. "never put more than 5% in one trade")

Output only valid JSON matching this schema:
{ country?, currency?, knowledgeLevel?, riskTolerance?, goals?, patterns?: { frequentRecipients?, preferredTokens?, typicalAmounts? }, interests?, communicationStyle?, onboardingComplete?, riskScore?, investmentHorizon?, maxSingleTradePercent?, preferredCategories?, avoidCategories? }`;
}

// ── Live implementation ──────────────────────────────────────────────

export const AgentProfileServiceLive: Layer.Layer<
  AgentProfileService,
  never,
  DatabaseService | ConfigService
> = Layer.effect(
  AgentProfileService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    const ensureProfile = (
      userId: string
    ): Effect.Effect<AgentProfile, AgentProfileError> =>
      Effect.gen(function* () {
        const [existing] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(agentProfiles)
              .where(eq(agentProfiles.userId, userId)),
          catch: (error) =>
            new AgentProfileError({
              message: `Failed to fetch profile: ${error}`,
              cause: error,
            }),
        });

        if (existing) {
          return existing;
        }

        const [created] = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(agentProfiles)
              .values({ userId, profile: {} })
              .returning(),
          catch: (error) =>
            new AgentProfileError({
              message: `Failed to create profile: ${error}`,
              cause: error,
            }),
        });

        return created!;
      });

    return {
      getProfile: (userId: string) => ensureProfile(userId),

      updateProfile: (userId: string, patch: Partial<AgentProfileData>) =>
        Effect.gen(function* () {
          const existing = yield* ensureProfile(userId);

          const mergedProfile = deepMergeProfile(
            (existing.profile ?? {}) as AgentProfileData,
            patch
          );

          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentProfiles)
                .set({
                  profile: mergedProfile,
                  updatedAt: new Date(),
                })
                .where(eq(agentProfiles.userId, userId))
                .returning(),
            catch: (error) =>
              new AgentProfileError({
                message: `Failed to update profile: ${error}`,
                cause: error,
              }),
          });

          return updated!;
        }),

      reflect: (userId: string, recentMessages: ConversationMessage[]) =>
        Effect.gen(function* () {
          const existing = yield* ensureProfile(userId);

          if (recentMessages.length === 0) {
            return existing;
          }

          const prompt = buildReflectionPrompt(
            (existing.profile ?? {}) as AgentProfileData,
            recentMessages
          );

          const provider = process.env.LLM_PROVIDER ?? "anthropic";
          const model =
            process.env.LLM_REFLECTION_MODEL ?? process.env.LLM_MODEL;
          const maxTokens = 2048;

          // Register unknown providers as OpenAI-compatible at runtime
          if (!providers[provider]) {
            const envKey = `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
            providers[provider] = {
              id: provider,
              name: provider,
              baseURL: process.env.LLM_BASE_URL ?? "",
              envVar: envKey,
              defaultModel: model ?? "",
              models: model ? [model] : [],
              format:
                (process.env.LLM_FORMAT as
                  | "openai"
                  | "anthropic"
                  | "bedrock") ?? "openai",
              defaultMaxTokens: maxTokens,
            };
          }

          const adapter = yield* Effect.try({
            try: () =>
              createAdapter({
                provider,
                ...(model && { model }),
                ...(process.env.LLM_API_KEY && {
                  apiKey: process.env.LLM_API_KEY,
                }),
                ...(process.env.LLM_BASE_URL && {
                  baseURL: process.env.LLM_BASE_URL,
                }),
                maxTokens,
                stream: false,
              }),
            catch: (error) =>
              new AgentProfileError({
                message: `Failed to create LLM adapter: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          adapter.setSystemPrompt(
            "You are a profile extraction assistant. You analyze conversations and extract structured user profile data. Always respond with valid JSON only, no markdown or explanations."
          );

          const result = yield* Effect.tryPromise({
            try: () =>
              adapter.prompt(
                { messages: [{ sender: "user", text: prompt }] },
                async () => {}
              ),
            catch: (error) =>
              new AgentProfileError({
                message: `LLM reflection call failed: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          const responseText = result.messages[0]?.text ?? "";

          // Extract JSON from the response, handling potential markdown code fences
          let jsonText = responseText.trim();
          const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            jsonText = jsonMatch[1]!.trim();
          }

          const parsed = yield* Effect.try({
            try: () => JSON.parse(jsonText) as Partial<AgentProfileData>,
            catch: (error) =>
              new AgentProfileError({
                message: `Failed to parse LLM reflection response as JSON: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          const mergedProfile = deepMergeProfile(
            (existing.profile ?? {}) as AgentProfileData,
            parsed
          );

          const now = new Date();
          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentProfiles)
                .set({
                  profile: mergedProfile,
                  lastReflectionAt: now,
                  updatedAt: now,
                })
                .where(eq(agentProfiles.userId, userId))
                .returning(),
            catch: (error) =>
              new AgentProfileError({
                message: `Failed to save reflected profile: ${error}`,
                cause: error,
              }),
          });

          return updated!;
        }),

      updateTrustTier: (
        userId: string,
        tier: "observe" | "notify" | "act_within_limits" | "full"
      ) =>
        Effect.gen(function* () {
          yield* ensureProfile(userId);

          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentProfiles)
                .set({
                  trustTier: tier,
                  updatedAt: new Date(),
                })
                .where(eq(agentProfiles.userId, userId))
                .returning(),
            catch: (error) =>
              new AgentProfileError({
                message: `Failed to update trust tier: ${error}`,
                cause: error,
              }),
          });

          return updated!;
        }),

      updateBudget: (userId: string, budget: string) =>
        Effect.gen(function* () {
          yield* ensureProfile(userId);

          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(agentProfiles)
                .set({
                  agentBudget: budget,
                  updatedAt: new Date(),
                })
                .where(eq(agentProfiles.userId, userId))
                .returning(),
            catch: (error) =>
              new AgentProfileError({
                message: `Failed to update agent budget: ${error}`,
                cause: error,
              }),
          });

          return updated!;
        }),

    };
  })
);
