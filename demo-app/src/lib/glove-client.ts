import { GloveClient, createRemoteModel, createRemoteStore, parseSSEStream } from "glove-react";
import type { RemotePromptRequest, RemotePromptResponse, RemoteStreamEvent } from "glove-react";
import { allTools } from "../tools";

const SYSTEM_PROMPT = `You are exo, the AI wallet assistant. Brief, confident, conversational.

# How You Work

You are the agent inside a smart wallet on Base (chain 8453). You have five powerful tools that handle entire workflows — each one resolves inputs, checks balances, fetches rates, and presents a confirmation before executing. You don't need to orchestrate multiple steps; just call the right tool with the user's intent.

# Your Tools

**send** — Send tokens to anyone. Accepts addresses, usernames, or contact labels. Handles resolution, balance check, and confirmation internally.
Example: User says "send 10 USDC to alice" → call send({ to: "alice", amount: "10 USDC" })

**buy_sell** — On-ramp (fiat→crypto) and off-ramp (crypto→fiat) via mobile money. Pre-fills user's country, currency, phone, and network from preferences.
Example: "sell 10 USDC" → call buy_sell({ direction: "sell", amount: "10 USDC" })
Example: "buy 1000 KES worth of USDC" → call buy_sell({ direction: "buy", amount: "1000 KES" })

**swap** — Token swaps on Uniswap. Gets a quote with price impact, shows confirmation, then executes.
Example: "swap 0.5 ETH for USDC" → call swap({ from: "ETH", to: "USDC", amount: "0.5" })

**earn** — Yield opportunities. View portfolio, deposit into vaults, or withdraw positions.
Example: "show my yield" → call earn({ action: "overview" })
Example: "deposit 100 USDC into vault X" → call earn({ action: "deposit", vaultId: "X", amount: "100 USDC" })

**manage** — Recurring payments, savings goals, group accounts, categories, and security settings.
Example: "set up a weekly 5 USDC payment to bob" → call manage({ domain: "recurring", action: "create", params: { recipient: "bob", amount: "5", token: "USDC", frequency: "7d" } })
Example: "show my savings goals" → call manage({ domain: "goals", action: "list" })

# Utility Tools

You also have read-only tools for information queries:
- **get_wallet_balances** — Check all wallet balances
- **list_transactions** — Transaction history
- **get_transaction_details** — Specific transaction lookup
- **get_token_info** — Token metadata (you already know USDC, WETH, ETH, USDT)
- **get_user_preferences** — User's saved defaults
- **get_profile** / **resolve_username** / **set_username** / **onboard_user** — Profile operations

# Rules

- NEVER render data as UI cards. Always respond with formatted text.
- Show balances in human-readable form: "1.5 ETH", not "1500000000000000000".
- After a mutation, state what happened concisely: "Sent 10 USDC to 0x1234...5678."
- Don't narrate tool calls. Just do the work and present results.
- Each super tool handles its own balance checks, amount parsing, and confirmations — trust them.
- If something fails, explain clearly and suggest next steps.
- Be concise and conversational. Skip formalities.`;

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const CHAT_ENDPOINT = `${API_BASE}/api/chat`;

type TokenGetter = () => Promise<string | null>;
let getAccessToken: TokenGetter | null = null;

/** The active conversation ID, passed to the chat endpoint for server-side persistence. */
let activeConversationId: string | null = null;

export function setTokenGetter(fn: TokenGetter) {
  getAccessToken = fn;
}

export function setActiveConversationId(id: string | null) {
  activeConversationId = id;
}

/** Authenticated fetch helper shared by model + store */
async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (getAccessToken) {
    const token = await getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(url, { ...init, headers });
}

async function authFetch(request: RemotePromptRequest, signal?: AbortSignal) {
  const body: Record<string, unknown> = { ...request };
  if (activeConversationId) {
    body.conversationId = activeConversationId;
  }
  const res = await authedFetch(CHAT_ENDPOINT, {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Chat endpoint error: ${res.status} ${res.statusText}`);
  }
  return res;
}

/**
 * Store actions that map Glove's store interface to our conversation API.
 *
 * Glove's Agent.ask() flow:
 *   1. appendMessages([userMessage])   — save user message to store
 *   2. getMessages()                   — load ALL messages (must include the just-appended one)
 *   3. Send all messages to model
 *   4. appendMessages([agentResponse]) — save agent response to store
 *
 * We use an in-memory cache per session so appendMessages writes are
 * immediately visible to getMessages. On first getMessages call, we
 * hydrate the cache from the backend API. Server-side persistence
 * in chat.ts handles durable storage to the database.
 */
const messageCache = new Map<string, Array<{ sender: string; text: string }>>();
const cacheHydrated = new Set<string>();

const storeActions = {
  async getMessages(sessionId: string) {
    // Hydrate from backend on first call for this session
    if (!cacheHydrated.has(sessionId)) {
      cacheHydrated.add(sessionId);
      try {
        const res = await authedFetch(`${API_BASE}/api/agent/conversations/${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          const conversation = data?.data ?? data;
          const backendMessages = conversation?.messages ?? [];
          const converted = backendMessages
            .filter((m: { content?: string }) => m.content && !m.content.startsWith("[Conversation summary from compaction]"))
            .map((m: { role: string; content: string }) => ({
              sender: m.role === "user" ? "user" : "agent",
              text: m.content,
            }));
          messageCache.set(sessionId, converted);
        }
      } catch {
        // Silently fail — cache stays empty
      }
    }
    return messageCache.get(sessionId) ?? [];
  },

  async appendMessages(sessionId: string, messages: Array<{ sender: string; text: string }>) {
    // Append to in-memory cache so getMessages() sees them immediately.
    // Durable persistence is handled server-side by the chat route.
    const existing = messageCache.get(sessionId) ?? [];
    messageCache.set(sessionId, [...existing, ...messages]);
  },
};

export const gloveClient = new GloveClient({
  createModel: () =>
    createRemoteModel("expendi-chat", {
      async prompt(request: RemotePromptRequest, signal?: AbortSignal): Promise<RemotePromptResponse> {
        const res = await authFetch(request, signal);
        let result: RemotePromptResponse | null = null;
        for await (const event of parseSSEStream(res)) {
          if (event.type === "done") {
            result = { message: event.message, tokens_in: event.tokens_in, tokens_out: event.tokens_out };
          }
        }
        if (!result) throw new Error("Stream ended without a 'done' event");
        return result;
      },
      async *promptStream(
        request: RemotePromptRequest,
        signal?: AbortSignal,
      ): AsyncIterable<RemoteStreamEvent> {
        const res = await authFetch(request, signal);
        yield* parseSSEStream(res);
      },
    }),
  createStore: (sessionId: string) => createRemoteStore(sessionId, storeActions),
  systemPrompt: SYSTEM_PROMPT,
  tools: allTools,
});
