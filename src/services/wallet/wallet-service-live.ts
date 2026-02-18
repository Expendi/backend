import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { WalletService, WalletError } from "./wallet-service.js";
import { PrivyService } from "./privy-layer.js";
import { DatabaseService } from "../../db/client.js";
import { wallets } from "../../db/schema/index.js";
import { createUserWalletInstance } from "./user-wallet.js";
import { createServerWalletInstance } from "./server-wallet.js";
import { createAgentWalletInstance } from "./agent-wallet.js";

export const WalletServiceLive: Layer.Layer<
  WalletService,
  never,
  PrivyService | DatabaseService
> = Layer.effect(
  WalletService,
  Effect.gen(function* () {
    const { client: privy } = yield* PrivyService;
    const { db } = yield* DatabaseService;

    return {
      createUserWallet: (userId: string) =>
        Effect.gen(function* () {
          const wallet = yield* Effect.tryPromise({
            try: () =>
              privy.wallets().create({ chain_type: "ethereum" }),
            catch: (error) =>
              new WalletError({
                message: `Failed to create user wallet: ${error}`,
                cause: error,
              }),
          });

          yield* Effect.tryPromise({
            try: () =>
              db.insert(wallets).values({
                type: "user",
                privyWalletId: wallet.id,
                ownerId: userId,
                address: wallet.address,
              }),
            catch: (error) =>
              new WalletError({
                message: `Failed to persist user wallet: ${error}`,
                cause: error,
              }),
          });

          return createUserWalletInstance(privy, wallet.id);
        }),

      createServerWallet: () =>
        Effect.gen(function* () {
          const wallet = yield* Effect.tryPromise({
            try: () =>
              privy.wallets().create({ chain_type: "ethereum" }),
            catch: (error) =>
              new WalletError({
                message: `Failed to create server wallet: ${error}`,
                cause: error,
              }),
          });

          yield* Effect.tryPromise({
            try: () =>
              db.insert(wallets).values({
                type: "server",
                privyWalletId: wallet.id,
                ownerId: "system",
                address: wallet.address,
              }),
            catch: (error) =>
              new WalletError({
                message: `Failed to persist server wallet: ${error}`,
                cause: error,
              }),
          });

          return createServerWalletInstance(privy, wallet.id);
        }),

      createAgentWallet: (agentId: string) =>
        Effect.gen(function* () {
          const wallet = yield* Effect.tryPromise({
            try: () =>
              privy.wallets().create({ chain_type: "ethereum" }),
            catch: (error) =>
              new WalletError({
                message: `Failed to create agent wallet: ${error}`,
                cause: error,
              }),
          });

          yield* Effect.tryPromise({
            try: () =>
              db.insert(wallets).values({
                type: "agent",
                privyWalletId: wallet.id,
                ownerId: agentId,
                address: wallet.address,
              }),
            catch: (error) =>
              new WalletError({
                message: `Failed to persist agent wallet: ${error}`,
                cause: error,
              }),
          });

          return createAgentWalletInstance(privy, wallet.id, agentId);
        }),

      getWallet: (privyWalletId: string, type: "user" | "server" | "agent") =>
        Effect.gen(function* () {
          if (type === "user") {
            return createUserWalletInstance(privy, privyWalletId);
          }
          if (type === "server") {
            return createServerWalletInstance(privy, privyWalletId);
          }

          const rows = yield* Effect.tryPromise({
            try: () =>
              db
                .select({ ownerId: wallets.ownerId })
                .from(wallets)
                .where(eq(wallets.privyWalletId, privyWalletId))
                .limit(1),
            catch: (error) =>
              new WalletError({
                message: `Failed to look up agent wallet owner: ${error}`,
                cause: error,
              }),
          });

          const walletRecord = rows[0];
          if (!walletRecord) {
            return yield* Effect.fail(
              new WalletError({
                message: `No wallet record found for privy wallet ID: ${privyWalletId}`,
              })
            );
          }

          return createAgentWalletInstance(privy, privyWalletId, walletRecord.ownerId);
        }),
    };
  })
);
