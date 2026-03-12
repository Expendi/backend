import { Hono } from "hono";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  maxUint256,
  type Hash,
} from "viem";
import { base } from "viem/chains";
import { erc20Abi } from "viem";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { UniswapService, BASE_CHAIN_ID } from "../services/uniswap/uniswap-service.js";
import { TransactionService } from "../services/transaction/transaction-service.js";
import { DatabaseService } from "../db/client.js";
import { wallets } from "../db/schema/index.js";
import type { AuthVariables } from "../middleware/auth.js";

const publicClient = createPublicClient({ chain: base, transport: http() });

// Permit2 canonical address (same on all chains)
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

// Universal Router V2 on Base
const UNIVERSAL_ROUTER_BASE = "0x6ff5693b99212da76ad316178a184ab56d299b43" as const;

const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

// Max values for Permit2 allowance (uint160, uint48)
const MAX_UINT160 = BigInt("1461501637330902918203684832716283019655932542975");
const MAX_UINT48 = BigInt("281474976710655");

// Minimal Permit2 ABI for allowance checks and on-chain approve
const permit2Abi = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

const waitForConfirmation = (txHash: Hash) =>
  Effect.tryPromise({
    try: async () => {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
        timeout: 60_000,
      });
      if (receipt.status === "reverted") {
        throw new Error(`Transaction reverted: ${txHash}`);
      }
      return receipt;
    },
    catch: (error) => new Error(`Failed waiting for tx confirmation: ${error}`),
  });

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

  /** Execute a full swap: legacy approve → quote → swap */
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

        let approvalTxId: string | undefined;

        // 1. Permit2-based approval for smart accounts (no EIP-712 signatures needed).
        //    Universal Router pulls tokens via Permit2's AllowanceTransfer, so we need:
        //    a) ERC20 approve token → Permit2 contract
        //    b) Permit2.approve(token, universalRouter, amount, expiration)
        //    ETH (zero address) doesn't need approval.
        const tokenIn = body.tokenIn.toLowerCase();
        if (tokenIn !== ETH_ADDRESS) {
          const tokenAddress = body.tokenIn as `0x${string}`;
          const requiredAmount = BigInt(body.amount);

          // Step 1a: Check ERC20 allowance to Permit2
          const erc20Allowance = yield* Effect.tryPromise({
            try: () =>
              publicClient.readContract({
                address: tokenAddress,
                abi: erc20Abi,
                functionName: "allowance",
                args: [wallet.address, PERMIT2_ADDRESS],
              }),
            catch: (error) =>
              new Error(`Failed to check ERC20 allowance: ${error}`),
          });

          if (erc20Allowance < requiredAmount) {
            // Approve token → Permit2 (max allowance, one-time)
            const approveData = encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [PERMIT2_ADDRESS, maxUint256],
            });

            const erc20ApproveTx = yield* txService.submitRawTransaction({
              walletId: body.walletId,
              walletType: wallet.type,
              chainId: BASE_CHAIN_ID,
              to: tokenAddress,
              data: approveData,
              value: 0n,
              userId,
              sponsor: true,
            });

            yield* waitForConfirmation(erc20ApproveTx.txHash as Hash);
          }

          // Step 1b: Check Permit2 allowance for Universal Router
          const [permit2Amount, permit2Expiration] = yield* Effect.tryPromise({
            try: () =>
              publicClient.readContract({
                address: PERMIT2_ADDRESS,
                abi: permit2Abi,
                functionName: "allowance",
                args: [wallet.address, tokenAddress, UNIVERSAL_ROUTER_BASE],
              }),
            catch: (error) =>
              new Error(`Failed to check Permit2 allowance: ${error}`),
          });

          const now = BigInt(Math.floor(Date.now() / 1000));
          if (permit2Amount < requiredAmount || permit2Expiration <= now) {
            // Set Permit2 allowance for Universal Router (on-chain, no signature)
            const permit2ApproveData = encodeFunctionData({
              abi: permit2Abi,
              functionName: "approve",
              args: [tokenAddress, UNIVERSAL_ROUTER_BASE, MAX_UINT160, Number(MAX_UINT48)],
            });

            const permit2ApproveTx = yield* txService.submitRawTransaction({
              walletId: body.walletId,
              walletType: wallet.type,
              chainId: BASE_CHAIN_ID,
              to: PERMIT2_ADDRESS,
              data: permit2ApproveData,
              value: 0n,
              userId,
              sponsor: true,
            });
            approvalTxId = permit2ApproveTx.id;

            yield* waitForConfirmation(permit2ApproveTx.txHash as Hash);
          }
        }

        // 2. Get a fresh quote
        const quote = yield* uniswap.getQuote({
          swapper: wallet.address,
          tokenIn: body.tokenIn,
          tokenOut: body.tokenOut,
          amount: body.amount,
          type: body.type,
          slippageTolerance: body.slippageTolerance,
          chainId: BASE_CHAIN_ID,
        });

        // 3. Get the swap transaction
        const swapTx = yield* uniswap.getSwapTransaction(quote);

        // 4. Submit the swap transaction
        const swapResult = yield* txService.submitRawTransaction({
          walletId: body.walletId,
          walletType: wallet.type,
          chainId: BASE_CHAIN_ID,
          to: swapTx.to as `0x${string}`,
          data: swapTx.data as `0x${string}`,
          value: BigInt(swapTx.value || "0"),
          userId,
          sponsor: true,
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
