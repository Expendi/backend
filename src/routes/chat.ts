import { Effect } from "effect";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createAdapter, providers } from "glove-core/models/providers";
import type { Message, ToolCall, PromptRequest, Tool } from "glove-core/core";
import type { AuthVariables } from "../middleware/auth.js";
import type { AppRuntime } from "./effect-handler.js";
import type { ConversationMessage } from "../db/schema/index.js";
import {
  AgentProfileService,
  AgentConversationService,
} from "../services/agent/index.js";
import { buildSystemPrompt } from "../services/agent/system-prompt-builder.js";
import z4 from "zod4";

interface SerializedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface RemotePromptRequest {
  systemPrompt: string;
  messages: Message[];
  tools?: SerializedTool[];
  conversationId?: string;
}

/**
 * Convert a JSON Schema object into a zod v4 schema.
 *
 * This is intentionally minimal — we only need the JSON Schema to pass
 * through `z.toJSONSchema()` correctly so the model adapter can send it
 * to the LLM. We wrap it as a zod `z.any()` with the original JSON Schema
 * injected via `z.any().describe()` — but since the adapter ultimately
 * calls `z.toJSONSchema()` which re-derives the schema, we use a
 * z.object() that produces the right output.
 *
 * The key insight: for the LLM API call, the adapter strips zod and sends
 * JSON Schema. We construct a zod schema whose toJSONSchema() output
 * approximates the original. For complex schemas, the LLM still gets a
 * valid object type with the description.
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z4.ZodType {
  if (!schema || typeof schema !== "object") {
    return z4.any();
  }

  const type = schema.type as string | undefined;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = (schema.required as string[]) ?? [];

  if (type === "object" && properties) {
    const shape: Record<string, z4.ZodType> = {};
    for (const [key, propSchema] of Object.entries(properties)) {
      let field = jsonSchemaToZod(propSchema);
      if (!required.includes(key)) {
        field = field.optional();
      }
      if (propSchema.description) {
        field = field.describe(propSchema.description as string);
      }
      shape[key] = field;
    }
    return z4.object(shape);
  }

  if (type === "string") {
    const s = z4.string();
    if (schema.enum) {
      return z4.enum(schema.enum as [string, ...string[]]);
    }
    return s;
  }

  if (type === "number" || type === "integer") {
    return z4.number();
  }

  if (type === "boolean") {
    return z4.boolean();
  }

  if (type === "array") {
    const items = schema.items as Record<string, unknown> | undefined;
    return z4.array(items ? jsonSchemaToZod(items) : z4.any());
  }

  return z4.any();
}

/**
 * Convert serialized tools (with JSON Schema parameters) into glove-core
 * Tool objects with proper zod v4 input_schema.
 */
function deserializeTools(tools: SerializedTool[]): Tool<unknown>[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: jsonSchemaToZod(t.parameters),
    async run() {
      // Server never executes tools — the client does
      return { status: "success" as const, data: "" };
    },
  }));
}


export function createChatRoutes(runtime: AppRuntime) {
  const router = new Hono<{ Variables: AuthVariables }>();

  router.post("/", async (c) => {
    const provider = process.env.LLM_PROVIDER ?? "anthropic";
    const model = process.env.LLM_MODEL;
    const maxTokens = process.env.LLM_MAX_TOKENS
      ? Number(process.env.LLM_MAX_TOKENS)
      : 4096;

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
        format: (process.env.LLM_FORMAT as "openai" | "anthropic" | "bedrock") ?? "openai",
        defaultMaxTokens: maxTokens,
      };
    }

    let adapter;
    try {
      adapter = createAdapter({
        provider,
        ...(model && { model }),
        ...(process.env.LLM_API_KEY && { apiKey: process.env.LLM_API_KEY }),
        ...(process.env.LLM_BASE_URL && { baseURL: process.env.LLM_BASE_URL }),
        maxTokens,
        stream: true,
      });
    } catch (err) {
      return c.json(
        {
          error: `Failed to create model adapter: ${err instanceof Error ? err.message : String(err)}. Check LLM_PROVIDER and the corresponding API key env var.`,
        },
        500,
      );
    }

    const body = (await c.req.json()) as RemotePromptRequest;

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: "messages must be a non-empty array" }, 400);
    }

    // Build a profile-aware system prompt if the user is authenticated
    const userId = c.get("userId");
    const DEFAULT_SYSTEM_PROMPT = "You are exo, a helpful financial assistant.";
    let systemPrompt: string | undefined;
    let profileData: { trustTier: string; agentBudget: string; profile: Record<string, unknown> } | undefined;

    if (userId) {
      try {
        const agentProfile = await runtime.runPromise(
          Effect.gen(function* () {
            const profileService = yield* AgentProfileService;
            return yield* profileService.getProfile(userId);
          })
        );

        profileData = {
          trustTier: agentProfile.trustTier,
          agentBudget: agentProfile.agentBudget,
          profile: (agentProfile.profile ?? {}) as Record<string, unknown>,
        };

        systemPrompt = buildSystemPrompt({
          profile: agentProfile.profile ?? undefined,
          trustTier: agentProfile.trustTier as "observe" | "notify" | "act_within_limits" | "full",
          agentBudget: agentProfile.agentBudget,
        });
      } catch (err) {
        // Profile fetch failed — fall back to hardcoded safe default.
        console.error("Failed to fetch agent profile for system prompt:", err instanceof Error ? err.message : String(err));
        systemPrompt = DEFAULT_SYSTEM_PROMPT;
      }
    }

    adapter.setSystemPrompt(systemPrompt ?? DEFAULT_SYSTEM_PROMPT);

    const tools = body.tools?.length ? deserializeTools(body.tools) : [];

    // Track the last user message and agent response for post-stream reflection
    const lastUserMessage = body.messages[body.messages.length - 1];
    let agentResponseText = "";

    return streamSSE(c, async (stream) => {
      // ── Emit "thinking" immediately so the frontend can show a loading state ──
      await stream.writeSSE({
        data: JSON.stringify({ type: "thinking" }),
      });

      let firstTextReceived = false;

      try {
        const result = await adapter.prompt(
          { messages: body.messages, tools: tools.length > 0 ? tools : undefined } as PromptRequest,
          async (eventType, eventData) => {
            switch (eventType) {
              case "text_delta": {
                const d = eventData as { text: string };
                if (!firstTextReceived) {
                  firstTextReceived = true;
                  // No extra event needed — the arrival of text_delta
                  // implicitly tells the frontend that thinking is over.
                }
                agentResponseText += d.text;
                await stream.writeSSE({
                  data: JSON.stringify({ type: "text_delta", text: d.text }),
                });
                break;
              }
              case "tool_use": {
                const d = eventData as {
                  id: string;
                  name: string;
                  input: unknown;
                };
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "tool_use",
                    id: d.id,
                    name: d.name,
                    input: d.input,
                  }),
                });
                break;
              }
              case "tool_use_result": {
                const d = eventData as {
                  tool_name: string;
                  call_id?: string;
                  result: { data: unknown; status: string; message?: string };
                };
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "tool_result",
                    name: d.tool_name,
                    id: d.call_id,
                    status: d.result.status,
                    data: d.result.data,
                    message: d.result.message,
                  }),
                });
                break;
              }
            }
          },
        );

        const msg = result.messages[0];
        await stream.writeSSE({
          data: JSON.stringify({
            type: "done",
            message: msg ?? { sender: "agent", text: "" },
            tokens_in: result.tokens_in,
            tokens_out: result.tokens_out,
          }),
        });

        // Fire-and-forget: persist messages and trigger profile reflection
        if (userId && agentResponseText) {
          const now = new Date().toISOString();

          const messagesToAppend: ConversationMessage[] = [];

          if (lastUserMessage && lastUserMessage.sender === "user" && lastUserMessage.text) {
            messagesToAppend.push({
              role: "user",
              content: lastUserMessage.text,
              timestamp: now,
            });
          }

          messagesToAppend.push({
            role: "agent",
            content: agentResponseText,
            timestamp: now,
          });

          const persistAndReflect = Effect.gen(function* () {
            const conversationService = yield* AgentConversationService;
            const profileService = yield* AgentProfileService;

            // Append both messages to the conversation
            for (const message of messagesToAppend) {
              yield* conversationService.appendMessage(userId, message, body.conversationId);
            }

            // Update token count
            yield* conversationService.updateTokenCount(
              userId,
              (result.tokens_in ?? 0) + (result.tokens_out ?? 0),
              body.conversationId
            );

            // Trigger reflection with the recent messages
            yield* profileService.reflect(userId, messagesToAppend);
          });

          runtime.runPromise(persistAndReflect).catch((err) => {
            console.error(
              "Background reflection failed:",
              err instanceof Error ? err.message : String(err)
            );
          });
        }
      } catch (err) {
        // ── Emit a dedicated error event with an actionable user message ──
        const isNetworkError =
          err instanceof Error &&
          (err.message.includes("ECONNREFUSED") ||
            err.message.includes("fetch failed") ||
            err.message.includes("timeout"));

        const userMessage = isNetworkError
          ? "Unable to reach the AI service. Please try again in a moment."
          : "Something went wrong. Please try sending your message again.";

        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            code: isNetworkError ? "llm_unavailable" : "internal_error",
            userMessage,
            detail:
              process.env.NODE_ENV !== "production"
                ? (err instanceof Error ? err.message : String(err))
                : undefined,
          }),
        });

        // Still emit done so the frontend knows the stream has ended
        await stream.writeSSE({
          data: JSON.stringify({
            type: "done",
            message: { sender: "agent", text: "" },
            tokens_in: 0,
            tokens_out: 0,
          }),
        });
      }
    });
  });

  return router;
}
