import { Hono } from "hono";
import { Effect } from "effect";
import { eq, and } from "drizzle-orm";
import { isAddress } from "viem";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { TransactionService } from "../services/transaction/transaction-service.js";
import { LedgerService } from "../services/ledger/ledger-service.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import { ConfigService } from "../config.js";
import { DatabaseService } from "../db/client.js";
import { wallets } from "../db/schema/index.js";
import type { AuthVariables } from "../middleware/auth.js";

/** Chain IDs supported by CHAIN_MAP in the contract executor. */
const SUPPORTED_CHAINS = new Set([1, 11155111, 137, 42161, 10, 8453, 480]);

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

  // Submit a transfer -- send native ETH or any ERC20 token.
  // Resolves wallet from walletType or walletId, validates inputs,
  // then delegates to TransactionService.submitTransfer.
  app.post("/transfer", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId?: string;
              walletType?: "server" | "embedded";
              to: string;
              amount: string;
              token: string;
              chainId: number;
              categoryId?: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        // ── Validation ──
        if (!body.to || !isAddress(body.to)) {
          return yield* Effect.fail(
            new Error("Invalid 'to' address: must be a valid EVM address")
          );
        }

        if (
          !body.amount ||
          Number.isNaN(Number(body.amount)) ||
          Number(body.amount) <= 0
        ) {
          return yield* Effect.fail(
            new Error("Invalid 'amount': must be a positive decimal string")
          );
        }

        if (!body.token) {
          return yield* Effect.fail(new Error("'token' is required"));
        }

        if (!body.chainId || !SUPPORTED_CHAINS.has(body.chainId)) {
          return yield* Effect.fail(
            new Error(
              `Unsupported chainId: ${body.chainId}. Supported: ${[...SUPPORTED_CHAINS].join(", ")}`
            )
          );
        }

        // ── Wallet resolution ──
        // Map "embedded" → "user" for internal wallet type
        const internalWalletType =
          body.walletType === "embedded" ? "user" : (body.walletType ?? "server");

        let resolvedWalletId = body.walletId;
        if (!resolvedWalletId) {
          const onboarding = yield* OnboardingService;
          const profile = yield* onboarding.getProfile(userId);
          if (internalWalletType === "user") {
            resolvedWalletId = profile.userWalletId;
          } else {
            resolvedWalletId = profile.serverWalletId;
          }
        }

        // ── Ownership check ──
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
          catch: (error) =>
            new Error(`Failed to verify wallet ownership: ${error}`),
        });
        if (!walletRecord) {
          return yield* Effect.fail(
            new Error("Wallet not found or not owned by the authenticated user")
          );
        }

        const walletType = internalWalletType === "user"
          ? "user" as const
          : "server" as const;

        const txService = yield* TransactionService;
        const tx = yield* txService.submitTransfer({
          walletId: resolvedWalletId!,
          walletType,
          to: body.to as `0x${string}`,
          amount: body.amount,
          token: body.token,
          chainId: body.chainId,
          categoryId: body.categoryId,
          userId,
        });

        return {
          transactionId: tx.id,
          txHash: tx.txHash,
          status: tx.status,
          amount: body.amount,
          token: body.token,
          to: body.to,
          chainId: body.chainId,
        };
      }),
      c
    )
  );

  return app;
}
