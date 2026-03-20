import { Hono } from "hono";
import { Effect } from "effect";
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import {
  AgentConversationService,
  AgentProfileService,
  AgentPatternService,
} from "../services/agent/index.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import { ContractExecutor } from "../services/contract/contract-executor.js";
import { ConfigService } from "../config.js";
import type { AuthVariables } from "../middleware/auth.js";
import type {
  ConversationMessage,
  AgentProfileData,
} from "../db/schema/index.js";

export function createAgentRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /conversation — Load conversation
  app.get("/conversation", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* AgentConversationService;
        return yield* service.getConversation(userId);
      }),
      c
    )
  );

  // POST /conversation/message — Append message
  app.post("/conversation/message", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              role: "user" | "agent";
              content: string;
              toolCalls?: Array<{
                name: string;
                input: Record<string, unknown>;
                output?: Record<string, unknown>;
              }>;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const message: ConversationMessage = {
          role: body.role,
          content: body.content,
          timestamp: new Date().toISOString(),
          ...(body.toolCalls && { toolCalls: body.toolCalls }),
        };

        const service = yield* AgentConversationService;
        return yield* service.appendMessage(userId, message);
      }),
      c,
      201
    )
  );

  // DELETE /conversation — Clear conversation
  app.delete("/conversation", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* AgentConversationService;
        return yield* service.clearConversation(userId);
      }),
      c
    )
  );

  // GET /profile — Get agent profile
  app.get("/profile", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* AgentProfileService;
        return yield* service.getProfile(userId);
      }),
      c
    )
  );

  // PATCH /profile — Update profile fields
  app.patch("/profile", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<Partial<AgentProfileData>>(),
          catch: () => new Error("Invalid request body"),
        });

        const service = yield* AgentProfileService;
        return yield* service.updateProfile(userId, body);
      }),
      c
    )
  );

  // PATCH /profile/trust-tier — Update trust tier
  app.patch("/profile/trust-tier", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              tier: "observe" | "notify" | "act_within_limits" | "full";
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const service = yield* AgentProfileService;
        return yield* service.updateTrustTier(userId, body.tier);
      }),
      c
    )
  );

  // PATCH /profile/budget — Update agent budget
  app.patch("/profile/budget", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ budget: string }>(),
          catch: () => new Error("Invalid request body"),
        });

        const service = yield* AgentProfileService;
        return yield* service.updateBudget(userId, body.budget);
      }),
      c
    )
  );

  // ── Agent wallet budget endpoints ─────────────────────────────────

  // GET /wallet/balance — Get agent wallet balance
  app.get("/wallet/balance", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const onboarding = yield* OnboardingService;
        const config = yield* ConfigService;
        const executor = yield* ContractExecutor;

        const profileWithWallets =
          yield* onboarding.getProfileWithWallets(userId);

        const agentWallet = profileWithWallets.agentWallet;
        if (!agentWallet.address) {
          return yield* Effect.fail(
            new Error("Agent wallet has no address")
          );
        }

        const address = agentWallet.address as Address;
        const chainId = config.defaultChainId;

        const publicClient = createPublicClient({
          chain: base,
          transport: http(),
        });

        const ethBalance = yield* Effect.tryPromise({
          try: () => publicClient.getBalance({ address }),
          catch: () =>
            new Error(
              `Failed to read ETH balance for agent wallet ${agentWallet.id}`
            ),
        }).pipe(
          Effect.map((balance) => balance.toString()),
          Effect.catchAll(() => Effect.succeed("0"))
        );

        const usdcBalance = yield* executor
          .readContract("usdc", chainId, "balance", [address])
          .pipe(
            Effect.map((balance) => String(balance)),
            Effect.catchAll(() => Effect.succeed("0"))
          );

        return {
          walletId: agentWallet.id,
          address: agentWallet.address,
          balances: {
            ETH: ethBalance,
            USDC: usdcBalance,
          },
        };
      }),
      c
    )
  );

  // POST /wallet/fund — Return confirmation payload for funding the agent wallet
  app.post("/wallet/fund", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              amount: string;
              token?: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        if (!body.amount || isNaN(parseFloat(body.amount)) || parseFloat(body.amount) <= 0) {
          return yield* Effect.fail(
            new Error("Amount must be a positive number")
          );
        }

        const onboarding = yield* OnboardingService;
        const profileWithWallets =
          yield* onboarding.getProfileWithWallets(userId);

        const userWallet = profileWithWallets.userWallet;
        const agentWallet = profileWithWallets.agentWallet;

        if (!userWallet.address || !agentWallet.address) {
          return yield* Effect.fail(
            new Error("User or agent wallet has no address")
          );
        }

        return {
          type: "fund_agent_wallet" as const,
          from: {
            walletId: userWallet.id,
            address: userWallet.address,
            type: userWallet.type,
          },
          to: {
            walletId: agentWallet.id,
            address: agentWallet.address,
            type: agentWallet.type,
          },
          amount: body.amount,
          token: body.token ?? "USDC",
        };
      }),
      c
    )
  );

  // POST /wallet/withdraw — Return confirmation payload for withdrawing from agent wallet
  app.post("/wallet/withdraw", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              amount: string;
              token?: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        if (!body.amount || isNaN(parseFloat(body.amount)) || parseFloat(body.amount) <= 0) {
          return yield* Effect.fail(
            new Error("Amount must be a positive number")
          );
        }

        const onboarding = yield* OnboardingService;
        const profileWithWallets =
          yield* onboarding.getProfileWithWallets(userId);

        const userWallet = profileWithWallets.userWallet;
        const agentWallet = profileWithWallets.agentWallet;

        if (!userWallet.address || !agentWallet.address) {
          return yield* Effect.fail(
            new Error("User or agent wallet has no address")
          );
        }

        return {
          type: "withdraw_agent_wallet" as const,
          from: {
            walletId: agentWallet.id,
            address: agentWallet.address,
            type: agentWallet.type,
          },
          to: {
            walletId: userWallet.id,
            address: userWallet.address,
            type: userWallet.type,
          },
          amount: body.amount,
          token: body.token ?? "USDC",
        };
      }),
      c
    )
  );

  // ── Pattern detection endpoint ──────────────────────────────────

  // GET /patterns — Analyze transaction patterns for the user
  app.get("/patterns", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const patternService = yield* AgentPatternService;
        return yield* patternService.analyzePatterns(userId);
      }),
      c
    )
  );

  return app;
}
