import { Hono } from "hono";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { UniswapService, BASE_CHAIN_ID } from "../services/uniswap/uniswap-service.js";
import { TransactionService } from "../services/transaction/transaction-service.js";
import { DatabaseService } from "../db/client.js";
import { wallets } from "../db/schema/index.js";
import type { AuthVariables } from "../middleware/auth.js";

// ── Helper: resolve wallet address from walletId ────────────────────

const resolveWalletAddress = (walletId: string) =>
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const [wallet] = yield* Effect.tryPromise({
      try: () =>
        db.select().from(wallets).where(eq(wallets.id, walletId)),
      catch: (error) => new Error(`Failed to resolve wallet: ${error}`),
    });

    if (!wallet?.address) {
      return yield* Effect.fail(
        new Error(`Wallet not found or has no address: ${walletId}`)
      );
    }

    return { address: wallet.address as `0x${string}`, type: wallet.type };
  });

// ── Uniswap routes (behind Privy auth) ──────────────────────────────

export function createUniswapRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  /** Check if a token approval is needed before swapping */
  app.post("/check-approval", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId: string;
              tokenIn: string;
              amount: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const wallet = yield* resolveWalletAddress(body.walletId);
        const uniswap = yield* UniswapService;

        return yield* uniswap.checkApproval({
          walletAddress: wallet.address,
          token: body.tokenIn,
          amount: body.amount,
          chainId: BASE_CHAIN_ID,
        });
      }),
      c
    )
  );

  /** Get a swap quote (does not execute) */
  app.post("/quote", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId: string;
              tokenIn: string;
              tokenOut: string;
              amount: string;
              type?: "EXACT_INPUT" | "EXACT_OUTPUT";
              slippageTolerance?: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const wallet = yield* resolveWalletAddress(body.walletId);
        const uniswap = yield* UniswapService;

        return yield* uniswap.getQuote({
          swapper: wallet.address,
          tokenIn: body.tokenIn,
          tokenOut: body.tokenOut,
          amount: body.amount,
          type: body.type,
          slippageTolerance: body.slippageTolerance,
          chainId: BASE_CHAIN_ID,
        });
      }),
      c
    )
  );

  /** Execute a full swap: check approval → approve if needed → quote → swap */
  app.post("/swap", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId: string;
              tokenIn: string;
              tokenOut: string;
              amount: string;
              type?: "EXACT_INPUT" | "EXACT_OUTPUT";
              slippageTolerance?: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const wallet = yield* resolveWalletAddress(body.walletId);
        const uniswap = yield* UniswapService;
        const txService = yield* TransactionService;

        // 1. Check if token approval is needed
        const approvalResult = yield* uniswap.checkApproval({
          walletAddress: wallet.address,
          token: body.tokenIn,
          amount: body.amount,
          chainId: BASE_CHAIN_ID,
        });

        let approvalTxId: string | undefined;

        if (approvalResult.approval) {
          // 2. Submit the approval transaction
          const approvalTx = yield* txService.submitRawTransaction({
            walletId: body.walletId,
            walletType: wallet.type,
            chainId: BASE_CHAIN_ID,
            to: approvalResult.approval.to as `0x${string}`,
            data: approvalResult.approval.data as `0x${string}`,
            value: BigInt(approvalResult.approval.value || "0"),
            userId,
          });
          approvalTxId = approvalTx.id;
        }

        // 3. Get a fresh quote
        const quote = yield* uniswap.getQuote({
          swapper: wallet.address,
          tokenIn: body.tokenIn,
          tokenOut: body.tokenOut,
          amount: body.amount,
          type: body.type,
          slippageTolerance: body.slippageTolerance,
          chainId: BASE_CHAIN_ID,
        });

        // 4. Get the swap transaction
        const swapTx = yield* uniswap.getSwapTransaction(quote);

        // 5. Submit the swap transaction
        const swapResult = yield* txService.submitRawTransaction({
          walletId: body.walletId,
          walletType: wallet.type,
          chainId: BASE_CHAIN_ID,
          to: swapTx.to as `0x${string}`,
          data: swapTx.data as `0x${string}`,
          value: BigInt(swapTx.value || "0"),
          userId,
        });

        return {
          approvalTxId,
          swapTxId: swapResult.id,
          swapTxHash: swapResult.txHash,
          quote: {
            routing: quote.routing,
            input: quote.quote.input,
            output: quote.quote.output,
            gasFeeUSD: quote.quote.gasFeeUSD,
          },
        };
      }),
      c
    )
  );

  return app;
}
