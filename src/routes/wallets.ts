import { Hono } from "hono";
import { Effect } from "effect";
import { eq, and } from "drizzle-orm";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { WalletService } from "../services/wallet/wallet-service.js";
import { WalletResolver } from "../services/wallet/wallet-resolver.js";
import { TransactionService } from "../services/transaction/transaction-service.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import { ConfigService } from "../config.js";
import { DatabaseService } from "../db/client.js";
import { wallets } from "../db/schema/index.js";
import type { AuthVariables } from "../middleware/auth.js";

/**
 * Public wallet routes -- all behind Privy auth middleware.
 * Every operation is scoped to the authenticated user.
 */
export function createWalletRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // List the authenticated user's own wallets
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;
        const results = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(eq(wallets.ownerId, userId))
              .orderBy(wallets.createdAt),
          catch: (error) => new Error(`Failed to list wallets: ${error}`),
        });
        return results;
      }),
      c
    )
  );

  // Get a single wallet -- verify the authenticated user owns it
  app.get("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;
        const [result] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(and(eq(wallets.id, id), eq(wallets.ownerId, userId))),
          catch: (error) => new Error(`Failed to get wallet: ${error}`),
        });
        if (!result) {
          return yield* Effect.fail(new Error("Wallet not found"));
        }
        return result;
      }),
      c
    )
  );

  // Create a user wallet -- userId comes from the auth context
  app.post("/user", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const walletService = yield* WalletService;
        const wallet = yield* walletService.createUserWallet(userId);
        const address = yield* wallet.getAddress();
        return { address, type: "user" as const };
      }),
      c
    )
  );

  // Sign a message with a wallet -- verify ownership first
  app.post("/:id/sign", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ message: string }>(),
          catch: () => new Error("Invalid request body"),
        });
        const { db } = yield* DatabaseService;
        const [walletRecord] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(and(eq(wallets.id, id), eq(wallets.ownerId, userId))),
          catch: (error) => new Error(`Failed to find wallet: ${error}`),
        });
        if (!walletRecord) {
          return yield* Effect.fail(new Error("Wallet not found"));
        }
        const resolver = yield* WalletResolver;
        const wallet = yield* resolver.resolve({
          walletId: walletRecord.id,
          type: walletRecord.type,
        });
        const signature = yield* wallet.sign(body.message);
        return { signature };
      }),
      c
    )
  );

  // Transfer tokens between the authenticated user's own wallets.
  // Frontend just specifies from/to wallet types and amount — backend handles the rest.
  app.post("/transfer", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const config = yield* ConfigService;
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              from: "user" | "server" | "agent";
              to: "user" | "server" | "agent";
              amount: string;
              token?: string;
              chainId?: number;
              categoryId?: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        if (body.from === body.to) {
          return yield* Effect.fail(
            new Error("Source and destination wallets must be different")
          );
        }

        // Resolve wallet IDs from profile
        const onboarding = yield* OnboardingService;
        const profile = yield* onboarding.getProfile(userId);

        const walletMap = {
          user: profile.userWalletId,
          server: profile.serverWalletId,
          agent: profile.agentWalletId,
        } as const;

        const fromWalletId = walletMap[body.from];
        const toWalletId = walletMap[body.to];

        if (!fromWalletId || !toWalletId) {
          return yield* Effect.fail(
            new Error("One or both wallet types not found on profile")
          );
        }

        // Look up the destination wallet address
        const { db } = yield* DatabaseService;
        const [toWallet] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(
                and(
                  eq(wallets.id, toWalletId),
                  eq(wallets.ownerId, userId)
                )
              ),
          catch: (error) =>
            new Error(`Failed to find destination wallet: ${error}`),
        });

        if (!toWallet?.address) {
          return yield* Effect.fail(
            new Error("Destination wallet not found or has no address")
          );
        }

        const chainId = body.chainId ?? config.defaultChainId;
        const token = body.token ?? "usdc";

        const txService = yield* TransactionService;
        return yield* txService.submitContractTransaction({
          walletId: fromWalletId,
          walletType: body.from,
          contractName: token,
          chainId,
          method: "transfer",
          args: [toWallet.address, BigInt(body.amount)],
          categoryId: body.categoryId,
          userId,
        });
      }),
      c
    )
  );

  return app;
}
