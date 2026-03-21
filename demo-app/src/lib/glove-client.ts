import { GloveClient, createRemoteModel, parseSSEStream } from "glove-react";
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
let activeConversationId: string | null = null;

/** Previous conversation messages to prepend to every LLM request for context continuity. */
let historyMessages: Array<{ sender: "user" | "agent"; text: string }> = [];

export function setTokenGetter(fn: TokenGetter) {
  getAccessToken = fn;
}

export function setActiveConversationId(id: string | null) {
  activeConversationId = id;
}

/**
 * Set restored conversation messages so they're included in the LLM context.
 * Call this when loading a conversation's persisted messages.
 */
export function setHistoryMessages(messages: Array<{ role: "user" | "agent"; content: string }>) {
  historyMessages = messages.map((m) => ({
    sender: m.role === "user" ? "user" : "agent",
    text: m.content,
  }));
}

async function authFetch(request: RemotePromptRequest, signal?: AbortSignal) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (getAccessToken) {
    const token = await getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  // Prepend history messages so the LLM has full conversation context
  const messages = [...historyMessages, ...request.messages];
  const body: Record<string, unknown> = { ...request, messages };
  if (activeConversationId) {
    body.conversationId = activeConversationId;
  }
  const res = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Chat endpoint error: ${res.status} ${res.statusText}`);
  }
  return res;
}

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
  systemPrompt: SYSTEM_PROMPT,
  tools: allTools,
});
