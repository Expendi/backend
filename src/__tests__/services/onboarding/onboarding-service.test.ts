import { describe, it, expect, vi } from "vitest";
import { Effect, Layer } from "effect";
import {
  OnboardingService,
  OnboardingServiceLive,
  OnboardingError,
} from "../../../services/onboarding/onboarding-service.js";
import {
  WalletService,
  WalletError,
} from "../../../services/wallet/wallet-service.js";
import { DatabaseService } from "../../../db/client.js";
import type { UserProfile, Wallet } from "../../../db/schema/index.js";

const TEST_USER_ID = "did:privy:user-abc-123";
const now = new Date("2025-06-15T12:00:00Z");

function makeFakeWallet(overrides?: Partial<Wallet>): Wallet {
  return {
    id: "wallet-user-1",
    type: "user",
    privyWalletId: "privy-wallet-u1",
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
    userWalletId: "wallet-user-1",
    serverWalletId: "wallet-server-1",
    agentWalletId: "wallet-agent-1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const USER_WALLET = makeFakeWallet({
  id: "wallet-user-1",
  type: "user",
  address: "0xuser1111111111111111111111111111111111111",
});
const SERVER_WALLET = makeFakeWallet({
  id: "wallet-server-1",
  type: "server",
  privyWalletId: "privy-wallet-s1",
  ownerId: "system",
  address: "0xserver2222222222222222222222222222222222222",
});
const AGENT_WALLET = makeFakeWallet({
  id: "wallet-agent-1",
  type: "agent",
  privyWalletId: "privy-wallet-a1",
  ownerId: `agent-${TEST_USER_ID}`,
  address: "0xagent3333333333333333333333333333333333333",
});

/**
 * Creates a mock drizzle-style DB object.
 *
 * The onboarding service uses the following query patterns:
 * - SELECT ... FROM user_profiles WHERE ... LIMIT 1  (findProfile)
 * - SELECT ... FROM wallets WHERE address = ? LIMIT 1  (find wallet after creation)
 * - SELECT ... FROM wallets WHERE id = ? LIMIT 1  (findWallet by id)
 * - UPDATE wallets SET ... WHERE ...  (update ownerId)
 * - INSERT INTO user_profiles (...) VALUES (...) RETURNING *  (create profile)
 *
 * We use a call-sequence counter on `select` to route each select call to the
 * appropriate result set. Each call returns a chained builder whose `.limit()`
 * resolves to a Promise.
 */
function makeTestLayers(opts?: {
  profileExists?: boolean;
  createUserWalletFail?: string;
  createServerWalletFail?: string;
  createAgentWalletFail?: string;
  dbInsertFail?: string;
  walletLookupEmpty?: boolean;
  /** For getProfileWithWallets: set to null to simulate a missing wallet. */
  userWallet?: Wallet | null;
  serverWallet?: Wallet | null;
  agentWallet?: Wallet | null;
}) {
  const existingProfile = makeFakeProfile();

  // -- WalletService mock --
  const MockWalletServiceLayer = Layer.succeed(WalletService, {
    createUserWallet: (_userId: string) =>
      opts?.createUserWalletFail
        ? Effect.fail(new WalletError({ message: opts.createUserWalletFail }))
        : Effect.succeed({
            getAddress: () =>
              Effect.succeed(USER_WALLET.address as `0x${string}`),
            sign: () => Effect.succeed("0xsig" as `0x${string}`),
            sendTransaction: () =>
              Effect.succeed("0xhash" as `0x${string}`),
          }),
    createServerWallet: () =>
      opts?.createServerWalletFail
        ? Effect.fail(
            new WalletError({ message: opts.createServerWalletFail })
          )
        : Effect.succeed({
            getAddress: () =>
              Effect.succeed(SERVER_WALLET.address as `0x${string}`),
            sign: () => Effect.succeed("0xsig" as `0x${string}`),
            sendTransaction: () =>
              Effect.succeed("0xhash" as `0x${string}`),
          }),
    createAgentWallet: (_agentId: string) =>
      opts?.createAgentWalletFail
        ? Effect.fail(
            new WalletError({ message: opts.createAgentWalletFail })
          )
        : Effect.succeed({
            getAddress: () =>
              Effect.succeed(AGENT_WALLET.address as `0x${string}`),
            sign: () => Effect.succeed("0xsig" as `0x${string}`),
            sendTransaction: () =>
              Effect.succeed("0xhash" as `0x${string}`),
          }),
    getWallet: () =>
      Effect.succeed({
        getAddress: () =>
          Effect.succeed("0xresolved" as `0x${string}`),
        sign: () => Effect.succeed("0xsig" as `0x${string}`),
        sendTransaction: () =>
          Effect.succeed("0xhash" as `0x${string}`),
      }),
  });

  // -- Database mock --
  // We track select call order to return proper results for each query.
  let selectCallIndex = 0;

  // The select result sequence depends on the scenario:
  //
  // For onboardUser (profileExists=false):
  //   1. findProfile -> [] (not found)
  //   2. find user wallet by address -> [USER_WALLET]
  //   3. find server wallet by address -> [SERVER_WALLET]
  //   4. find agent wallet by address -> [AGENT_WALLET]
  //
  // For onboardUser (profileExists=true):
  //   1. findProfile -> [existingProfile] (already exists, returns early)
  //
  // For getProfile / isOnboarded (profileExists=true):
  //   1. findProfile -> [existingProfile]
  //
  // For getProfile / isOnboarded (profileExists=false):
  //   1. findProfile -> []
  //
  // For getProfileWithWallets (profileExists=true):
  //   1. findProfile -> [existingProfile]
  //   2. findWallet(userWalletId) -> [USER_WALLET]
  //   3. findWallet(serverWalletId) -> [SERVER_WALLET]
  //   4. findWallet(agentWalletId) -> [AGENT_WALLET]

  const resolvedUserWallet =
    opts?.userWallet === null ? null : (opts?.userWallet ?? USER_WALLET);
  const resolvedServerWallet =
    opts?.serverWallet === null ? null : (opts?.serverWallet ?? SERVER_WALLET);
  const resolvedAgentWallet =
    opts?.agentWallet === null ? null : (opts?.agentWallet ?? AGENT_WALLET);

  function getSelectResult(): unknown[] {
    selectCallIndex++;
    const idx = selectCallIndex;

    if (opts?.profileExists) {
      // Profile found scenarios
      if (idx === 1) return [existingProfile];
      // getProfileWithWallets wallet lookups
      if (idx === 2) return resolvedUserWallet ? [resolvedUserWallet] : [];
      if (idx === 3)
        return resolvedServerWallet ? [resolvedServerWallet] : [];
      if (idx === 4)
        return resolvedAgentWallet ? [resolvedAgentWallet] : [];
    } else {
      // Profile not found (onboardUser flow or getProfile failure)
      if (idx === 1) return [];
      // Wallet lookups after creation during onboardUser
      if (opts?.walletLookupEmpty) return [];
      if (idx === 2) return [USER_WALLET];
      if (idx === 3) return [SERVER_WALLET];
      if (idx === 4) return [AGENT_WALLET];
    }

    return [];
  }

  // Each select call returns a builder chain: select() -> { from } -> { where } -> { limit }
  // The limit() call must return a Promise.
  const selectFn = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => ({
        limit: vi.fn().mockImplementation(() =>
          Promise.resolve(getSelectResult())
        ),
      })),
      orderBy: vi.fn().mockResolvedValue([]),
    })),
  }));

  const returningFn = opts?.dbInsertFail
    ? vi.fn().mockRejectedValue(new Error(opts.dbInsertFail))
    : vi.fn().mockResolvedValue([existingProfile]);

  const insertFn = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockReturnValue({ returning: returningFn }),
  }));

  const updateFn = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  }));

  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: {
      select: selectFn,
      insert: insertFn,
      update: updateFn,
    } as any,
    pool: {} as any,
  });

  return {
    layer: OnboardingServiceLive.pipe(
      Layer.provide(MockWalletServiceLayer),
      Layer.provide(MockDbLayer)
    ),
    mocks: {
      selectFn,
      insertFn,
      updateFn,
      returningFn,
    },
  };
}

describe("OnboardingServiceLive", () => {
  describe("onboardUser", () => {
    it("should create all 3 wallets and a profile, then return the profile", async () => {
      const { layer, mocks } = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service.onboardUser({
            privyUserId: TEST_USER_ID,
            chainId: 1,
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.privyUserId).toBe(TEST_USER_ID);
      expect(result.userWalletId).toBe("wallet-user-1");
      expect(result.serverWalletId).toBe("wallet-server-1");
      expect(result.agentWalletId).toBe("wallet-agent-1");
      // DB insert was called for the profile
      expect(mocks.insertFn).toHaveBeenCalled();
      // DB update was called twice (server wallet ownerId + agent wallet ownerId)
      expect(mocks.updateFn).toHaveBeenCalledTimes(2);
    });

    it("should return existing profile without creating new wallets when already onboarded", async () => {
      const { layer, mocks } = makeTestLayers({ profileExists: true });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service.onboardUser({
            privyUserId: TEST_USER_ID,
            chainId: 1,
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.privyUserId).toBe(TEST_USER_ID);
      expect(result.id).toBe("profile-1");
      // No wallet creation or DB insert/update should have happened
      expect(mocks.insertFn).not.toHaveBeenCalled();
      expect(mocks.updateFn).not.toHaveBeenCalled();
    });

    it("should return WalletError when createUserWallet fails", async () => {
      const { layer } = makeTestLayers({
        createUserWalletFail: "Privy user wallet creation failed",
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service
            .onboardUser({ privyUserId: TEST_USER_ID, chainId: 1 })
            .pipe(
              Effect.matchEffect({
                onSuccess: (p) =>
                  Effect.succeed({ tag: "ok" as const, profile: p }),
                onFailure: (e) =>
                  Effect.succeed({ tag: "err" as const, error: e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.error).toBeInstanceOf(WalletError);
        expect((result.error as WalletError).message).toContain(
          "Privy user wallet creation failed"
        );
      }
    });

    it("should return WalletError when createServerWallet fails", async () => {
      const { layer } = makeTestLayers({
        createServerWalletFail: "Privy server wallet creation failed",
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service
            .onboardUser({ privyUserId: TEST_USER_ID, chainId: 1 })
            .pipe(
              Effect.matchEffect({
                onSuccess: (p) =>
                  Effect.succeed({ tag: "ok" as const, profile: p }),
                onFailure: (e) =>
                  Effect.succeed({ tag: "err" as const, error: e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.error).toBeInstanceOf(WalletError);
        expect((result.error as WalletError).message).toContain(
          "Privy server wallet creation failed"
        );
      }
    });

    it("should return WalletError when createAgentWallet fails", async () => {
      const { layer } = makeTestLayers({
        createAgentWalletFail: "Privy agent wallet creation failed",
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service
            .onboardUser({ privyUserId: TEST_USER_ID, chainId: 1 })
            .pipe(
              Effect.matchEffect({
                onSuccess: (p) =>
                  Effect.succeed({ tag: "ok" as const, profile: p }),
                onFailure: (e) =>
                  Effect.succeed({ tag: "err" as const, error: e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.error).toBeInstanceOf(WalletError);
        expect((result.error as WalletError).message).toContain(
          "Privy agent wallet creation failed"
        );
      }
    });

    it("should return OnboardingError when DB insert for profile fails", async () => {
      const { layer } = makeTestLayers({
        dbInsertFail: "unique constraint violation",
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service
            .onboardUser({ privyUserId: TEST_USER_ID, chainId: 1 })
            .pipe(
              Effect.matchEffect({
                onSuccess: (p) =>
                  Effect.succeed({ tag: "ok" as const, profile: p }),
                onFailure: (e) =>
                  Effect.succeed({ tag: "err" as const, error: e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.error).toBeInstanceOf(OnboardingError);
        expect((result.error as OnboardingError).message).toContain(
          "Failed to create user profile"
        );
      }
    });

    it("should return OnboardingError when wallet record not found after creation", async () => {
      const { layer } = makeTestLayers({ walletLookupEmpty: true });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service
            .onboardUser({ privyUserId: TEST_USER_ID, chainId: 1 })
            .pipe(
              Effect.matchEffect({
                onSuccess: (p) =>
                  Effect.succeed({ tag: "ok" as const, profile: p }),
                onFailure: (e) =>
                  Effect.succeed({ tag: "err" as const, error: e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.error).toBeInstanceOf(OnboardingError);
        expect((result.error as OnboardingError).message).toContain(
          "wallet record not found after creation"
        );
      }
    });
  });

  describe("getProfile", () => {
    it("should return profile for an existing user", async () => {
      const { layer } = makeTestLayers({ profileExists: true });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service.getProfile(TEST_USER_ID);
        }).pipe(Effect.provide(layer))
      );

      expect(result.privyUserId).toBe(TEST_USER_ID);
      expect(result.id).toBe("profile-1");
      expect(result.userWalletId).toBe("wallet-user-1");
      expect(result.serverWalletId).toBe("wallet-server-1");
      expect(result.agentWalletId).toBe("wallet-agent-1");
    });

    it("should return OnboardingError when user not found", async () => {
      const { layer } = makeTestLayers({ profileExists: false });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service.getProfile("did:privy:nonexistent").pipe(
            Effect.matchEffect({
              onSuccess: (p) =>
                Effect.succeed({ tag: "ok" as const, profile: p }),
              onFailure: (e) =>
                Effect.succeed({ tag: "err" as const, error: e }),
            })
          );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.error).toBeInstanceOf(OnboardingError);
        expect((result.error as OnboardingError).message).toContain(
          "Profile not found for user"
        );
      }
    });
  });

  describe("getProfileWithWallets", () => {
    it("should return profile with all 3 wallet records populated", async () => {
      const { layer } = makeTestLayers({ profileExists: true });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service.getProfileWithWallets(TEST_USER_ID);
        }).pipe(Effect.provide(layer))
      );

      expect(result.privyUserId).toBe(TEST_USER_ID);
      expect(result.userWallet).toBeDefined();
      expect(result.userWallet.id).toBe("wallet-user-1");
      expect(result.userWallet.type).toBe("user");
      expect(result.serverWallet).toBeDefined();
      expect(result.serverWallet.id).toBe("wallet-server-1");
      expect(result.serverWallet.type).toBe("server");
      expect(result.agentWallet).toBeDefined();
      expect(result.agentWallet.id).toBe("wallet-agent-1");
      expect(result.agentWallet.type).toBe("agent");
    });

    it("should return OnboardingError when profile not found", async () => {
      const { layer } = makeTestLayers({ profileExists: false });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service
            .getProfileWithWallets("did:privy:nonexistent")
            .pipe(
              Effect.matchEffect({
                onSuccess: (p) =>
                  Effect.succeed({ tag: "ok" as const, profile: p }),
                onFailure: (e) =>
                  Effect.succeed({ tag: "err" as const, error: e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.error).toBeInstanceOf(OnboardingError);
        expect((result.error as OnboardingError).message).toContain(
          "Profile not found for user"
        );
      }
    });

    it("should return OnboardingError when a wallet record is missing", async () => {
      const { layer } = makeTestLayers({
        profileExists: true,
        serverWallet: null,
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service
            .getProfileWithWallets(TEST_USER_ID)
            .pipe(
              Effect.matchEffect({
                onSuccess: (p) =>
                  Effect.succeed({ tag: "ok" as const, profile: p }),
                onFailure: (e) =>
                  Effect.succeed({ tag: "err" as const, error: e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.error).toBeInstanceOf(OnboardingError);
        expect((result.error as OnboardingError).message).toContain(
          "One or more wallets missing"
        );
      }
    });
  });

  describe("isOnboarded", () => {
    it("should return true when profile exists", async () => {
      const { layer } = makeTestLayers({ profileExists: true });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service.isOnboarded(TEST_USER_ID);
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBe(true);
    });

    it("should return false when profile does not exist", async () => {
      const { layer } = makeTestLayers({ profileExists: false });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* OnboardingService;
          return yield* service.isOnboarded("did:privy:unknown-user");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBe(false);
    });
  });
});
