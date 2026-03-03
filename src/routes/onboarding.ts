import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import { ConfigService } from "../config.js";
import type { AuthVariables } from "../middleware/auth.js";

/**
 * Public onboarding & profile routes -- all behind Privy auth middleware.
 * Every operation is scoped to the authenticated user.
 */
export function createOnboardingRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // POST /api/onboard — Full onboarding (idempotent)
  app.post("/onboard", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ chainId?: number }>(),
          catch: () => ({ chainId: undefined }),
        });

        const config = yield* ConfigService;
        const onboarding = yield* OnboardingService;
        const profile = yield* onboarding.onboardUser({
          privyUserId: userId,
          chainId: body.chainId ?? config.defaultChainId,
        });

        // Always return the full profile with wallets
        const profileWithWallets =
          yield* onboarding.getProfileWithWallets(userId);

        return {
          profile: {
            id: profileWithWallets.id,
            privyUserId: profileWithWallets.privyUserId,
            userWalletId: profileWithWallets.userWalletId,
            serverWalletId: profileWithWallets.serverWalletId,
            agentWalletId: profileWithWallets.agentWalletId,
            username: profileWithWallets.username ?? null,
            createdAt: profileWithWallets.createdAt,
            updatedAt: profileWithWallets.updatedAt,
          },
          wallets: {
            user: profileWithWallets.userWallet,
            server: profileWithWallets.serverWallet,
            agent: profileWithWallets.agentWallet,
          },
        };
      }),
      c
    )
  );

  // GET /api/profile — Get the authenticated user's profile
  app.get("/profile", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const onboarding = yield* OnboardingService;
        const profile = yield* onboarding.getProfileWithWallets(userId);
        return { ...profile, username: profile.username ?? null };
      }),
      c
    )
  );

  // PUT /api/profile/username — Claim or update username
  app.put("/profile/username", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ username: string }>(),
          catch: () => new Error("Invalid request body"),
        });

        const onboarding = yield* OnboardingService;
        return yield* onboarding.setUsername(userId, body.username);
      }),
      c
    )
  );

  // GET /api/profile/resolve/:username — Resolve username to address
  app.get("/profile/resolve/:username", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const username = c.req.param("username");
        const onboarding = yield* OnboardingService;
        const resolved = yield* onboarding.resolveUsername(username);
        return {
          username: username.toLowerCase().trim(),
          userId: resolved.privyUserId,
          address: resolved.address,
        };
      }),
      c
    )
  );

  // GET /api/profile/wallets — Get just the wallet addresses
  app.get("/profile/wallets", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const onboarding = yield* OnboardingService;
        const profile = yield* onboarding.getProfileWithWallets(userId);

        return {
          user: profile.userWallet.address,
          server: profile.serverWallet.address,
          agent: profile.agentWallet.address,
        };
      }),
      c
    )
  );

  return app;
}
