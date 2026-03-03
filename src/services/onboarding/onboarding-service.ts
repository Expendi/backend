import { Effect, Context, Layer, Data } from "effect";
import { eq, and } from "drizzle-orm";
import { WalletService, WalletError } from "../wallet/wallet-service.js";
import { DatabaseService } from "../../db/client.js";
import {
  userProfiles,
  wallets,
  type UserProfile,
  type Wallet,
} from "../../db/schema/index.js";

// ── Error type ───────────────────────────────────────────────────────

export class OnboardingError extends Data.TaggedError("OnboardingError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export type UserProfileWithWallets = UserProfile & {
  userWallet: Wallet;
  serverWallet: Wallet;
  agentWallet: Wallet;
};

// ── Service interface ────────────────────────────────────────────────

export interface OnboardingServiceApi {
  /** Full onboarding: creates user + server + agent wallets and a profile record. Idempotent. */
  readonly onboardUser: (params: {
    privyUserId: string;
    chainId: number;
  }) => Effect.Effect<UserProfile, OnboardingError | WalletError>;

  /** Get user profile by Privy DID. */
  readonly getProfile: (
    privyUserId: string
  ) => Effect.Effect<UserProfile, OnboardingError>;

  /** Get user profile with all wallet details populated. */
  readonly getProfileWithWallets: (
    privyUserId: string
  ) => Effect.Effect<UserProfileWithWallets, OnboardingError>;

  /** Check if user is already onboarded. */
  readonly isOnboarded: (
    privyUserId: string
  ) => Effect.Effect<boolean, OnboardingError>;

  /** Claim or update a username for the authenticated user. */
  readonly setUsername: (
    privyUserId: string,
    username: string
  ) => Effect.Effect<UserProfile, OnboardingError>;

  /** Resolve a username to its user ID and wallet address. */
  readonly resolveUsername: (
    username: string
  ) => Effect.Effect<
    { privyUserId: string; address: string },
    OnboardingError
  >;
}

export class OnboardingService extends Context.Tag("OnboardingService")<
  OnboardingService,
  OnboardingServiceApi
>() {}

// ── Live implementation ──────────────────────────────────────────────

export const OnboardingServiceLive: Layer.Layer<
  OnboardingService,
  never,
  WalletService | DatabaseService
> = Layer.effect(
  OnboardingService,
  Effect.gen(function* () {
    const walletService = yield* WalletService;
    const { db } = yield* DatabaseService;

    // ── Helpers ────────────────────────────────────────────────────

    const findProfile = (privyUserId: string) =>
      Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(userProfiles)
            .where(eq(userProfiles.privyUserId, privyUserId))
            .limit(1),
        catch: (error) =>
          new OnboardingError({
            message: `Failed to look up profile: ${error}`,
            cause: error,
          }),
      });

    const findWallet = (walletId: string) =>
      Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(wallets)
            .where(eq(wallets.id, walletId))
            .limit(1),
        catch: (error) =>
          new OnboardingError({
            message: `Failed to look up wallet: ${error}`,
            cause: error,
          }),
      });

    // ── Service methods ───────────────────────────────────────────

    return {
      onboardUser: (params) =>
        Effect.gen(function* () {
          // Idempotent: return existing profile if already onboarded
          const existing = yield* findProfile(params.privyUserId);
          if (existing[0]) {
            return existing[0];
          }

          // 1. Create user wallet (owned by the Privy user)
          const userWalletInstance = yield* walletService.createUserWallet(
            params.privyUserId
          );
          const userWalletAddress = yield* userWalletInstance.getAddress();

          // Look up the wallet record we just created by address + owner
          const userWalletRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(wallets)
                .where(eq(wallets.address, userWalletAddress))
                .limit(1),
            catch: (error) =>
              new OnboardingError({
                message: `Failed to find user wallet record: ${error}`,
                cause: error,
              }),
          });
          const userWalletRecord = userWalletRows[0];
          if (!userWalletRecord) {
            return yield* Effect.fail(
              new OnboardingError({
                message: "User wallet record not found after creation",
              })
            );
          }

          // 2. Create server wallet (backend-controlled, owned by the user)
          const serverWalletInstance =
            yield* walletService.createServerWallet();
          const serverWalletAddress =
            yield* serverWalletInstance.getAddress();

          // Look up the server wallet record and update ownerId to the user
          const serverWalletRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(wallets)
                .where(eq(wallets.address, serverWalletAddress))
                .limit(1),
            catch: (error) =>
              new OnboardingError({
                message: `Failed to find server wallet record: ${error}`,
                cause: error,
              }),
          });
          const serverWalletRecord = serverWalletRows[0];
          if (!serverWalletRecord) {
            return yield* Effect.fail(
              new OnboardingError({
                message: "Server wallet record not found after creation",
              })
            );
          }

          // Update ownerId so the server wallet is associated with this user
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(wallets)
                .set({ ownerId: params.privyUserId })
                .where(eq(wallets.id, serverWalletRecord.id)),
            catch: (error) =>
              new OnboardingError({
                message: `Failed to update server wallet owner: ${error}`,
                cause: error,
              }),
          });

          // 3. Create agent wallet (owned by the user, with a generated agentId)
          const agentId = `agent-${params.privyUserId}`;
          const agentWalletInstance =
            yield* walletService.createAgentWallet(agentId);
          const agentWalletAddress =
            yield* agentWalletInstance.getAddress();

          // Look up the agent wallet record and update ownerId
          const agentWalletRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(wallets)
                .where(eq(wallets.address, agentWalletAddress))
                .limit(1),
            catch: (error) =>
              new OnboardingError({
                message: `Failed to find agent wallet record: ${error}`,
                cause: error,
              }),
          });
          const agentWalletRecord = agentWalletRows[0];
          if (!agentWalletRecord) {
            return yield* Effect.fail(
              new OnboardingError({
                message: "Agent wallet record not found after creation",
              })
            );
          }

          // Update ownerId so the agent wallet is associated with this user
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(wallets)
                .set({ ownerId: params.privyUserId })
                .where(eq(wallets.id, agentWalletRecord.id)),
            catch: (error) =>
              new OnboardingError({
                message: `Failed to update agent wallet owner: ${error}`,
                cause: error,
              }),
          });

          // 4. Insert user_profiles record
          const [profile] = yield* Effect.tryPromise({
            try: () =>
              db
                .insert(userProfiles)
                .values({
                  privyUserId: params.privyUserId,
                  userWalletId: userWalletRecord.id,
                  serverWalletId: serverWalletRecord.id,
                  agentWalletId: agentWalletRecord.id,
                })
                .returning(),
            catch: (error) =>
              new OnboardingError({
                message: `Failed to create user profile: ${error}`,
                cause: error,
              }),
          });

          return profile!;
        }),

      getProfile: (privyUserId) =>
        Effect.gen(function* () {
          const rows = yield* findProfile(privyUserId);
          const profile = rows[0];
          if (!profile) {
            return yield* Effect.fail(
              new OnboardingError({
                message: `Profile not found for user: ${privyUserId}`,
              })
            );
          }
          return profile;
        }),

      getProfileWithWallets: (privyUserId) =>
        Effect.gen(function* () {
          const rows = yield* findProfile(privyUserId);
          const profile = rows[0];
          if (!profile) {
            return yield* Effect.fail(
              new OnboardingError({
                message: `Profile not found for user: ${privyUserId}`,
              })
            );
          }

          const [userWalletRows, serverWalletRows, agentWalletRows] =
            yield* Effect.all([
              findWallet(profile.userWalletId),
              findWallet(profile.serverWalletId),
              findWallet(profile.agentWalletId),
            ]);

          const userWallet = userWalletRows[0];
          const serverWallet = serverWalletRows[0];
          const agentWallet = agentWalletRows[0];

          if (!userWallet || !serverWallet || !agentWallet) {
            return yield* Effect.fail(
              new OnboardingError({
                message: `One or more wallets missing for user: ${privyUserId}`,
              })
            );
          }

          return {
            ...profile,
            userWallet,
            serverWallet,
            agentWallet,
          };
        }),

      isOnboarded: (privyUserId) =>
        Effect.gen(function* () {
          const rows = yield* findProfile(privyUserId);
          return rows.length > 0;
        }),

      setUsername: (privyUserId, username) =>
        Effect.gen(function* () {
          const normalized = username.toLowerCase().trim();

          // Validate format: 3-20 chars, lowercase alphanumeric + underscore
          if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
            return yield* Effect.fail(
              new OnboardingError({
                message:
                  "Username must be 3-20 characters and contain only lowercase letters, numbers, and underscores",
              })
            );
          }

          // Check uniqueness
          const existing = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(userProfiles)
                .where(eq(userProfiles.username, normalized))
                .limit(1),
            catch: (error) =>
              new OnboardingError({
                message: `Failed to check username: ${error}`,
                cause: error,
              }),
          });

          if (existing[0] && existing[0].privyUserId !== privyUserId) {
            return yield* Effect.fail(
              new OnboardingError({ message: "Username is already taken" })
            );
          }

          // Update the profile
          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(userProfiles)
                .set({ username: normalized, updatedAt: new Date() })
                .where(eq(userProfiles.privyUserId, privyUserId))
                .returning(),
            catch: (error) =>
              new OnboardingError({
                message: `Failed to set username: ${error}`,
                cause: error,
              }),
          });

          if (!updated) {
            return yield* Effect.fail(
              new OnboardingError({
                message: `Profile not found for user: ${privyUserId}`,
              })
            );
          }

          return updated;
        }),

      resolveUsername: (username) =>
        Effect.gen(function* () {
          const normalized = username.toLowerCase().trim();

          const rows = yield* Effect.tryPromise({
            try: () =>
              db
                .select({
                  privyUserId: userProfiles.privyUserId,
                  address: wallets.address,
                })
                .from(userProfiles)
                .innerJoin(
                  wallets,
                  eq(userProfiles.userWalletId, wallets.id)
                )
                .where(eq(userProfiles.username, normalized))
                .limit(1),
            catch: (error) =>
              new OnboardingError({
                message: `Failed to resolve username: ${error}`,
                cause: error,
              }),
          });

          const row = rows[0];
          if (!row || !row.address) {
            return yield* Effect.fail(
              new OnboardingError({
                message: `Username not found: ${normalized}`,
              })
            );
          }

          return { privyUserId: row.privyUserId, address: row.address };
        }),
    };
  })
);
