import { Hono } from "hono";
import { Effect } from "effect";
import { eq, and } from "drizzle-orm";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { WalletService } from "../services/wallet/wallet-service.js";
import { WalletResolver } from "../services/wallet/wallet-resolver.js";
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
          privyWalletId: walletRecord.privyWalletId,
          type: walletRecord.type,
        });
        const signature = yield* wallet.sign(body.message);
        return { signature };
      }),
      c
    )
  );

  return app;
}
