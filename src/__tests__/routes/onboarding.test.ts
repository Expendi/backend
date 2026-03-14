import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createOnboardingRoutes } from "../../routes/onboarding.js";
import {
  OnboardingService,
  OnboardingError,
  type UserProfileWithWallets,
} from "../../services/onboarding/onboarding-service.js";
import { DatabaseService } from "../../db/client.js";
import { ConfigService } from "../../config.js";
import type { UserProfile, Wallet } from "../../db/schema/index.js";
import type { AuthVariables } from "../../middleware/auth.js";

const TEST_USER_ID = "did:privy:test-user-456";
const now = new Date("2025-06-15T12:00:00Z");

function makeFakeWallet(overrides?: Partial<Wallet>): Wallet {
  return {
    id: "wallet-u1",
    type: "user",
    privyWalletId: "privy-wu1",
    ownerId: TEST_USER_ID,
    address: "0xuser1111111111111111111111111111111111111",
    chainId: null,
    createdAt: now,
    ...overrides,
  };
}

function makeFakeProfile(overrides?: Partial<UserProfile>): UserProfile {
  return {
    id: "profile-1",
    privyUserId: TEST_USER_ID,
    userWalletId: "wallet-u1",
    serverWalletId: "wallet-s1",
    agentWalletId: "wallet-a1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeProfileWithWallets(
  overrides?: Partial<UserProfileWithWallets>
): UserProfileWithWallets {
  return {
    ...makeFakeProfile(),
    userWallet: makeFakeWallet({
      id: "wallet-u1",
      type: "user",
      address: "0xuser1111111111111111111111111111111111111",
    }),
    serverWallet: makeFakeWallet({
      id: "wallet-s1",
      type: "server",
      address: "0xserver2222222222222222222222222222222222222",
    }),
    agentWallet: makeFakeWallet({
      id: "wallet-a1",
      type: "agent",
      address: "0xagent3333333333333333333333333333333333333",
    }),
    ...overrides,
  };
}

function makeTestRuntime(opts?: {
  onboardResult?: UserProfile;
  onboardFail?: string;
  getProfileWithWalletsResult?: UserProfileWithWallets;
  getProfileWithWalletsFail?: string;
}) {
  const profileWithWallets =
    opts?.getProfileWithWalletsResult ?? makeFakeProfileWithWallets();

  const MockOnboardingLayer = Layer.succeed(OnboardingService, {
    onboardUser: (_params: { privyUserId: string; chainId: number }) =>
      opts?.onboardFail
        ? Effect.fail(new OnboardingError({ message: opts.onboardFail }))
        : Effect.succeed(opts?.onboardResult ?? makeFakeProfile()),

    getProfile: (privyUserId: string) =>
      opts?.getProfileWithWalletsFail
        ? Effect.fail(
            new OnboardingError({
              message: opts.getProfileWithWalletsFail,
            })
          )
        : Effect.succeed(makeFakeProfile({ privyUserId })),

    getProfileWithWallets: (_privyUserId: string) =>
      opts?.getProfileWithWalletsFail
        ? Effect.fail(
            new OnboardingError({
              message: opts.getProfileWithWalletsFail,
            })
          )
        : Effect.succeed(profileWithWallets),

    isOnboarded: (_privyUserId: string) => Effect.succeed(true),

    setUsername: (privyUserId: string, _username: string) =>
      Effect.succeed(makeFakeProfile({ privyUserId, username: _username } as any)),

    resolveUsername: (_username: string) =>
      Effect.succeed({
        privyUserId: TEST_USER_ID,
        address: "0xuser1111111111111111111111111111111111111",
      }),
  });

  const mockSelectLimit = vi.fn().mockResolvedValue([{ preferences: {} }]);
  const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: {
      select: mockSelect,
      update: mockUpdate,
    } as any,
    pool: {} as any,
  });

  const MockConfigLayer = Layer.succeed(ConfigService, {
    databaseUrl: "postgresql://test",
    privyAppId: "test",
    privyAppSecret: "test",
    coinmarketcapApiKey: "test",
    adminApiKey: "test",
    defaultChainId: 1,
    port: 3000,
  });

  return ManagedRuntime.make(Layer.mergeAll(MockOnboardingLayer, MockConfigLayer, MockDbLayer));
}

function makeApp(runtime: ReturnType<typeof makeTestRuntime>) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", TEST_USER_ID);
    await next();
  });
  app.route("/", createOnboardingRoutes(runtime as any));
  return app;
}

describe("Onboarding Routes", () => {
  describe("POST /onboard", () => {
    it("should successfully onboard user and return profile with wallets", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.profile).toBeDefined();
      expect(body.data.profile.privyUserId).toBe(TEST_USER_ID);
      expect(body.data.profile.userWalletId).toBe("wallet-u1");
      expect(body.data.profile.serverWalletId).toBe("wallet-s1");
      expect(body.data.profile.agentWalletId).toBe("wallet-a1");
      expect(body.data.wallets).toBeDefined();
      expect(body.data.wallets.user.address).toBe(
        "0xuser1111111111111111111111111111111111111"
      );
      expect(body.data.wallets.server.address).toBe(
        "0xserver2222222222222222222222222222222222222"
      );
      expect(body.data.wallets.agent.address).toBe(
        "0xagent3333333333333333333333333333333333333"
      );

      await runtime.dispose();
    });

    it("should be idempotent and return existing profile on second call", async () => {
      const existingProfile = makeFakeProfile({
        id: "profile-already-exists",
      });
      const existingProfileWithWallets = makeFakeProfileWithWallets({
        id: "profile-already-exists",
      });
      const runtime = makeTestRuntime({
        onboardResult: existingProfile,
        getProfileWithWalletsResult: existingProfileWithWallets,
      });
      const app = makeApp(runtime);

      const res = await app.request("/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.profile.id).toBe("profile-already-exists");

      await runtime.dispose();
    });

    it("should accept optional chainId in body", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId: 137 }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.profile).toBeDefined();

      await runtime.dispose();
    });

    it("should default chainId to 1 when not provided", async () => {
      const onboardFn = vi.fn().mockImplementation(
        (params: { privyUserId: string; chainId: number }) => {
          expect(params.chainId).toBe(1);
          return Effect.succeed(makeFakeProfile());
        }
      );

      const MockOnboardingLayer = Layer.succeed(OnboardingService, {
        onboardUser: onboardFn,
        getProfile: () => Effect.succeed(makeFakeProfile()),
        getProfileWithWallets: () =>
          Effect.succeed(makeFakeProfileWithWallets()),
        isOnboarded: () => Effect.succeed(true),
      });

      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgresql://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 1,
        port: 3000,
      });

      const runtime = ManagedRuntime.make(Layer.mergeAll(MockOnboardingLayer, MockConfigLayer));
      const app = makeApp(runtime);

      const res = await app.request("/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(onboardFn).toHaveBeenCalled();

      await runtime.dispose();
    });

    it("should return 400 when onboarding service returns error", async () => {
      const runtime = makeTestRuntime({
        onboardFail: "Wallet creation limit exceeded",
      });
      const app = makeApp(runtime);

      const res = await app.request("/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();

      await runtime.dispose();
    });
  });

  describe("GET /profile", () => {
    it("should return profile with wallet details for authenticated user", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/profile");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.privyUserId).toBe(TEST_USER_ID);
      expect(body.data.userWallet).toBeDefined();
      expect(body.data.serverWallet).toBeDefined();
      expect(body.data.agentWallet).toBeDefined();
      expect(body.data.userWallet.address).toBe(
        "0xuser1111111111111111111111111111111111111"
      );

      await runtime.dispose();
    });

    it("should return 400 when user is not onboarded", async () => {
      const runtime = makeTestRuntime({
        getProfileWithWalletsFail: "Profile not found for user",
      });
      const app = makeApp(runtime);

      const res = await app.request("/profile");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();

      await runtime.dispose();
    });
  });

  describe("GET /profile/wallets", () => {
    it("should return wallet addresses for authenticated user", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/profile/wallets");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.user).toBe(
        "0xuser1111111111111111111111111111111111111"
      );
      expect(body.data.server).toBe(
        "0xserver2222222222222222222222222222222222222"
      );
      expect(body.data.agent).toBe(
        "0xagent3333333333333333333333333333333333333"
      );

      await runtime.dispose();
    });

    it("should return 400 when user is not onboarded", async () => {
      const runtime = makeTestRuntime({
        getProfileWithWalletsFail: "Profile not found for user",
      });
      const app = makeApp(runtime);

      const res = await app.request("/profile/wallets");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });
});
