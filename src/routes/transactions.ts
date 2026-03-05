import { Hono } from "hono";
import { Effect } from "effect";
import { eq, and } from "drizzle-orm";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { TransactionService } from "../services/transaction/transaction-service.js";
import { LedgerService } from "../services/ledger/ledger-service.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import { ConfigService } from "../config.js";
import { DatabaseService } from "../db/client.js";
import { wallets } from "../db/schema/index.js";
import type { AuthVariables } from "../middleware/auth.js";

/**
 * Public transaction routes -- all behind Privy auth middleware.
 * Every operation is scoped to the authenticated user.
 */
export function createTransactionRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // List the authenticated user's own transactions
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const ledger = yield* LedgerService;
        return yield* ledger.listByUser(userId);
      }),
      c
    )
  );

  // Get a single transaction -- verify the authenticated user owns it
  app.get("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const txService = yield* TransactionService;
        const tx = yield* txService.getTransaction(id);
        if (!tx) {
          return yield* Effect.fail(new Error("Transaction not found"));
        }
        if (tx.userId !== userId) {
          return yield* Effect.fail(new Error("Transaction not found"));
        }
        return tx;
      }),
      c
    )
  );

  // Submit a contract transaction -- userId comes from auth context.
  // The caller must own the wallet being used.
  // Accepts either `walletId` directly or `walletType` ("user" | "server" | "agent")
  // to resolve the wallet from the user's onboarding profile.
  app.post("/contract", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const config = yield* ConfigService;
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId?: string;
              walletType?: "user" | "server" | "agent";
              contractName: string;
              chainId?: number;
              method: string;
              args: unknown[];
              value?: string;
              categoryId?: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const chainId = body.chainId ?? config.defaultChainId;

        // Resolve walletId from walletType if not provided directly
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

        // Verify the user owns the wallet
        const { db } = yield* DatabaseService;
        const [walletRecord] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(
                and(
                  eq(wallets.id, resolvedWalletId!),
                  eq(wallets.ownerId, userId)
                )
              ),
          catch: (error) => new Error(`Failed to verify wallet ownership: ${error}`),
        });
        if (!walletRecord) {
          return yield* Effect.fail(
            new Error("Wallet not found or not owned by the authenticated user")
          );
        }

        const walletType = body.walletType ?? walletRecord.type;

        const txService = yield* TransactionService;
        return yield* txService.submitContractTransaction({
          walletId: resolvedWalletId!,
          walletType,
          contractName: body.contractName,
          chainId,
          method: body.method,
          args: body.args,
          value: body.value ? BigInt(body.value) : undefined,
          categoryId: body.categoryId,
          userId,
        });
      }),
      c
    )
  );

  // Submit a raw transaction -- userId comes from auth context.
  // The caller must own the wallet being used.
  // Accepts either `walletId` directly or `walletType` ("user" | "server" | "agent")
  // to resolve the wallet from the user's onboarding profile.
  app.post("/raw", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const config = yield* ConfigService;
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId?: string;
              walletType?: "user" | "server" | "agent";
              chainId?: number;
              to: `0x${string}`;
              data?: `0x${string}`;
              value?: string;
              categoryId?: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const chainId = body.chainId ?? config.defaultChainId;

        // Resolve walletId from walletType if not provided directly
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

        // Verify the user owns the wallet
        const { db } = yield* DatabaseService;
        const [walletRecord] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(
                and(
                  eq(wallets.id, resolvedWalletId!),
                  eq(wallets.ownerId, userId)
                )
              ),
          catch: (error) => new Error(`Failed to verify wallet ownership: ${error}`),
        });
        if (!walletRecord) {
          return yield* Effect.fail(
            new Error("Wallet not found or not owned by the authenticated user")
          );
        }

        const walletType = body.walletType ?? walletRecord.type;

        const txService = yield* TransactionService;
        return yield* txService.submitRawTransaction({
          walletId: resolvedWalletId!,
          walletType,
          chainId,
          to: body.to,
          data: body.data,
          value: body.value ? BigInt(body.value) : undefined,
          categoryId: body.categoryId,
          userId,
        });
      }),
      c
    )
  );

  return app;
}
