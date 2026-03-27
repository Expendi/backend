import { Hono } from "hono";
import { Effect } from "effect";
import { isAddress } from "viem";
import { eq, and } from "drizzle-orm";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { CctpService } from "../services/cctp/cctp-service.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import { DatabaseService } from "../db/client.js";
import { wallets } from "../db/schema/index.js";
import { CCTP_DOMAIN_IDS } from "../connectors/cctp.js";
import type { AuthVariables } from "../middleware/auth.js";

const CCTP_SUPPORTED_CHAINS = new Set(Object.keys(CCTP_DOMAIN_IDS).map(Number));

/**
 * CCTP cross-chain transfer routes -- all behind Privy auth.
 */
export function createCctpRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // List supported CCTP chains
  app.get("/chains", (c) =>
    c.json({
      success: true,
      data: {
        chains: Object.entries(CCTP_DOMAIN_IDS).map(([chainId, domain]) => ({
          chainId: Number(chainId),
          domain,
        })),
      },
    })
  );

  // Initiate a cross-chain USDC transfer
  app.post("/transfer", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId?: string;
              walletType?: "user" | "server" | "agent";
              sourceChainId: number;
              destinationChainId: number;
              amount: string;
              recipient: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        // Validation
        if (!body.sourceChainId || !CCTP_SUPPORTED_CHAINS.has(body.sourceChainId)) {
          return yield* Effect.fail(
            new Error(
              `Unsupported source chain: ${body.sourceChainId}. Supported: ${[...CCTP_SUPPORTED_CHAINS].join(", ")}`
            )
          );
        }
        if (
          !body.destinationChainId ||
          !CCTP_SUPPORTED_CHAINS.has(body.destinationChainId)
        ) {
          return yield* Effect.fail(
            new Error(
              `Unsupported destination chain: ${body.destinationChainId}. Supported: ${[...CCTP_SUPPORTED_CHAINS].join(", ")}`
            )
          );
        }
        if (body.sourceChainId === body.destinationChainId) {
          return yield* Effect.fail(
            new Error("Source and destination chains must be different")
          );
        }
        if (!body.recipient || !isAddress(body.recipient)) {
          return yield* Effect.fail(
            new Error("Invalid recipient: must be a valid EVM address")
          );
        }
        if (
          !body.amount ||
          Number.isNaN(Number(body.amount)) ||
          Number(body.amount) <= 0
        ) {
          return yield* Effect.fail(
            new Error("Invalid amount: must be a positive decimal string")
          );
        }

        // Wallet resolution
        const internalWalletType = body.walletType ?? "server";
        let resolvedWalletId = body.walletId;
        if (!resolvedWalletId) {
          const onboarding = yield* OnboardingService;
          const profile = yield* onboarding.getProfile(userId);
          if (internalWalletType === "user") {
            resolvedWalletId = profile.userWalletId;
          } else if (internalWalletType === "agent") {
            resolvedWalletId = profile.agentWalletId;
          } else {
            resolvedWalletId = profile.serverWalletId;
          }
        }

        // Ownership check
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

        const cctp = yield* CctpService;
        return yield* cctp.initiate({
          walletId: resolvedWalletId!,
          walletType: internalWalletType,
          sourceChainId: body.sourceChainId,
          destinationChainId: body.destinationChainId,
          amount: body.amount,
          recipient: body.recipient as `0x${string}`,
          userId,
        });
      }),
      c
    )
  );

  // Get transfer status
  app.get("/transfer/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const cctp = yield* CctpService;
        const transfer = yield* cctp.getTransfer(id);
        if (!transfer) {
          return yield* Effect.fail(new Error("Transfer not found"));
        }
        if (transfer.userId !== userId) {
          return yield* Effect.fail(new Error("Transfer not found"));
        }
        return transfer;
      }),
      c
    )
  );

  // List user's CCTP transfers
  app.get("/transfers", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const cctp = yield* CctpService;
        return yield* cctp.listTransfers(userId);
      }),
      c
    )
  );

  // Poll attestation status for a transfer
  app.post("/transfer/:id/attest", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const cctp = yield* CctpService;

        // Verify ownership
        const transfer = yield* cctp.getTransfer(id);
        if (!transfer || transfer.userId !== userId) {
          return yield* Effect.fail(new Error("Transfer not found"));
        }

        return yield* cctp.pollAttestation(id);
      }),
      c
    )
  );

  // Complete the mint on the destination chain
  app.post("/transfer/:id/mint", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId?: string;
              walletType?: "user" | "server" | "agent";
            }>(),
          catch: () => ({ walletId: undefined, walletType: undefined } as {
            walletId?: string;
            walletType?: "user" | "server" | "agent";
          }),
        });

        const cctp = yield* CctpService;

        // Verify ownership
        const transfer = yield* cctp.getTransfer(id);
        if (!transfer || transfer.userId !== userId) {
          return yield* Effect.fail(new Error("Transfer not found"));
        }

        // Resolve wallet for destination chain mint
        const walletType = body.walletType ?? transfer.walletType;
        let resolvedWalletId = body.walletId ?? transfer.walletId;
        if (!body.walletId) {
          const onboarding = yield* OnboardingService;
          const profile = yield* onboarding.getProfile(userId);
          if (walletType === "user") {
            resolvedWalletId = profile.userWalletId;
          } else if (walletType === "agent") {
            resolvedWalletId = profile.agentWalletId;
          } else {
            resolvedWalletId = profile.serverWalletId;
          }
        }

        return yield* cctp.completeMint(id, resolvedWalletId, walletType);
      }),
      c
    )
  );

  return app;
}
