import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { YieldService } from "../services/yield/yield-service.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import { ConfigService } from "../config.js";
import type { AuthVariables } from "../middleware/auth.js";

/**
 * Public yield routes -- all behind Privy auth middleware.
 * Every operation is scoped to the authenticated user.
 */
export function createYieldRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // ── Vault routes ──────────────────────────────────────────────────

  // List active vaults
  app.get("/vaults", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const chainIdParam = c.req.query("chainId");
        const chainId = chainIdParam ? Number(chainIdParam) : undefined;
        const yieldService = yield* YieldService;
        return yield* yieldService.listVaults(chainId);
      }),
      c
    )
  );

  // Get a single vault
  app.get("/vaults/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const yieldService = yield* YieldService;
        const vault = yield* yieldService.getVault(id);
        if (!vault) {
          return yield* Effect.fail(new Error("Vault not found"));
        }
        return vault;
      }),
      c
    )
  );

  // ── Position routes ───────────────────────────────────────────────

  // Create a new yield position (lock)
  app.post("/positions", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const config = yield* ConfigService;
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId?: string;
              walletType: "user" | "server" | "agent";
              vaultId: string;
              amount: string;
              unlockTime: number;
              label?: string;
              chainId?: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        // Resolve walletId from walletType if not provided
        let resolvedWalletId = body.walletId;
        if (!resolvedWalletId) {
          const onboarding = yield* OnboardingService;
          const profile = yield* onboarding.getProfile(userId);
          if (body.walletType === "user") {
            resolvedWalletId = profile.userWalletId;
          } else if (body.walletType === "server") {
            resolvedWalletId = profile.serverWalletId;
          } else {
            resolvedWalletId = profile.agentWalletId;
          }
        }

        const yieldService = yield* YieldService;
        return yield* yieldService.createPosition({
          userId,
          walletId: resolvedWalletId!,
          walletType: body.walletType,
          vaultId: body.vaultId,
          amount: body.amount,
          unlockTime: body.unlockTime,
          label: body.label,
          chainId: body.chainId ?? config.defaultChainId,
        });
      }),
      c,
      201
    )
  );

  // List the authenticated user's positions
  app.get("/positions", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const yieldService = yield* YieldService;
        return yield* yieldService.getUserPositions(userId);
      }),
      c
    )
  );

  // Get a single position -- verify the authenticated user owns it
  app.get("/positions/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const yieldService = yield* YieldService;
        const position = yield* yieldService.getPosition(id);
        if (!position) {
          return yield* Effect.fail(new Error("Position not found"));
        }
        if (position.userId !== userId) {
          return yield* Effect.fail(new Error("Position not found"));
        }
        return position;
      }),
      c
    )
  );

  // Withdraw a matured position
  app.post("/positions/:id/withdraw", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const yieldService = yield* YieldService;

        const position = yield* yieldService.getPosition(id);
        if (!position || position.userId !== userId) {
          return yield* Effect.fail(new Error("Position not found"));
        }

        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId?: string;
              walletType: "user" | "server" | "agent";
            }>(),
          catch: () => ({ walletId: undefined, walletType: "server" as const }),
        });

        let resolvedWalletId = body.walletId ?? position.walletId;

        return yield* yieldService.withdrawPosition(
          id,
          resolvedWalletId,
          body.walletType
        );
      }),
      c
    )
  );

  // Get yield snapshot history for a position
  app.get("/positions/:id/history", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const yieldService = yield* YieldService;

        const position = yield* yieldService.getPosition(id);
        if (!position || position.userId !== userId) {
          return yield* Effect.fail(new Error("Position not found"));
        }

        const limit = Number(c.req.query("limit") ?? "50");
        return yield* yieldService.getYieldHistory(id, limit);
      }),
      c
    )
  );

  // ── Portfolio ─────────────────────────────────────────────────────

  // Portfolio summary (totals, APY)
  app.get("/portfolio", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const yieldService = yield* YieldService;
        return yield* yieldService.getPortfolioSummary(userId);
      }),
      c
    )
  );

  return app;
}
