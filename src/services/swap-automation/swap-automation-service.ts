import { Effect, Context, Layer, Data } from "effect";
import { eq, and, gte, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import {
  swapAutomations,
  swapAutomationExecutions,
  wallets,
  type SwapAutomation,
  type NewSwapAutomation,
  type SwapAutomationExecution,
  type NewSwapAutomationExecution,
} from "../../db/schema/index.js";
import { TransactionService } from "../transaction/transaction-service.js";
import { UniswapService, BASE_CHAIN_ID } from "../uniswap/uniswap-service.js";
import { AdapterService, type PriceData } from "../adapters/adapter-service.js";
import { WalletService } from "../wallet/wallet-service.js";
import { ConfigService } from "../../config.js";
import { getSwapFeeBips, estimateSwapUsd } from "../uniswap/swap-fee-tiers.js";
import { erc20Abi, type Hash } from "viem";
import { createBasePublicClient } from "../chain/public-client.js";

// ── Token decimals by address (lowercase) for human-readable → raw conversion ─

const TOKEN_DECIMALS_BY_ADDRESS: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,   // USDC on Base
  "0x2d1adb45bb1d7d2556c6558adb76cfd4f9f4ed16": 6,   // USDT on Base
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": 18,  // DAI on Base
  "0x4200000000000000000000000000000000000006": 18,    // WETH on Base
  "0x0000000000000000000000000000000000000000": 18,    // ETH (native)
};

/** Convert human-readable amount to raw units string for a token address. */
function toRawAmountStr(amount: string, tokenAddress: string): string {
  const decimals = TOKEN_DECIMALS_BY_ADDRESS[tokenAddress.toLowerCase()] ?? 18;
  return String(Math.floor(Number(amount) * Math.pow(10, decimals)));
}

/**
 * Ensure an amount string is human-readable (e.g. "5" for 5 USDC, not "5000000").
 * The frontend may send amounts already multiplied by 10^decimals — this function
 * detects that and converts back to human-readable form.
 *
 * Heuristic: if the amount has no decimal point and its numeric value is >= 10^decimals,
 * it's very likely a raw amount. We divide by 10^decimals to normalise it.
 */
function normalizeToHumanReadable(amount: string, tokenAddress: string): string {
  const decimals = TOKEN_DECIMALS_BY_ADDRESS[tokenAddress.toLowerCase()] ?? 18;
  const num = Number(amount);
  if (isNaN(num) || num === 0) return amount;

  // If the amount already contains a decimal point, assume it's human-readable
  if (amount.includes(".")) return amount;

  // If the value is >= 10^decimals and has no decimal point, it's likely raw
  const threshold = Math.pow(10, decimals);
  if (num >= threshold) {
    return String(num / threshold);
  }

  return amount;
}

// ── Error type ───────────────────────────────────────────────────────

export class SwapAutomationError extends Data.TaggedError(
  "SwapAutomationError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export type IndicatorType =
  | "price_above"
  | "price_below"
  | "percent_change_up"
  | "percent_change_down";

export interface CreateAutomationParams {
  readonly userId: string;
  readonly walletId: string;
  readonly walletType: "server" | "agent";
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amount: string;
  readonly slippageTolerance?: number;
  readonly chainId?: number;
  readonly indicatorType: IndicatorType;
  readonly indicatorToken: string;
  readonly thresholdValue: number;
  readonly maxExecutions?: number;
  readonly maxExecutionsPerDay?: number;
  readonly cooldownSeconds?: number;
  readonly maxRetries?: number;
}

export interface UpdateAutomationParams {
  readonly thresholdValue?: number;
  readonly amount?: string;
  readonly slippageTolerance?: number;
  readonly maxExecutions?: number;
  readonly maxExecutionsPerDay?: number | null;
  readonly cooldownSeconds?: number;
  readonly maxRetries?: number;
}

// ── Service interface ────────────────────────────────────────────────

export interface SwapAutomationServiceApi {
  readonly createAutomation: (
    params: CreateAutomationParams
  ) => Effect.Effect<SwapAutomation, SwapAutomationError>;

  readonly getAutomation: (
    id: string
  ) => Effect.Effect<SwapAutomation | undefined, SwapAutomationError>;

  readonly listByUser: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<SwapAutomation>, SwapAutomationError>;

  readonly updateAutomation: (
    id: string,
    params: UpdateAutomationParams
  ) => Effect.Effect<SwapAutomation, SwapAutomationError>;

  readonly pauseAutomation: (
    id: string
  ) => Effect.Effect<SwapAutomation, SwapAutomationError>;

  readonly resumeAutomation: (
    id: string
  ) => Effect.Effect<SwapAutomation, SwapAutomationError>;

  readonly cancelAutomation: (
    id: string
  ) => Effect.Effect<SwapAutomation, SwapAutomationError>;

  readonly getExecutionHistory: (
    automationId: string,
    limit?: number
  ) => Effect.Effect<
    ReadonlyArray<SwapAutomationExecution>,
    SwapAutomationError
  >;

  readonly processDueAutomations: () => Effect.Effect<
    ReadonlyArray<SwapAutomationExecution>,
    SwapAutomationError
  >;
}

export class SwapAutomationService extends Context.Tag(
  "SwapAutomationService"
)<SwapAutomationService, SwapAutomationServiceApi>() {}

// ── Helpers ──────────────────────────────────────────────────────────

const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

function isConditionMet(
  indicatorType: IndicatorType,
  thresholdValue: number,
  currentPrice: number,
  referencePrice: number | null
): boolean {
  switch (indicatorType) {
    case "price_above":
      return currentPrice >= thresholdValue;
    case "price_below":
      return currentPrice <= thresholdValue;
    case "percent_change_up": {
      if (!referencePrice || referencePrice === 0) return false;
      const pctChange =
        ((currentPrice - referencePrice) / referencePrice) * 100;
      return pctChange >= thresholdValue;
    }
    case "percent_change_down": {
      if (!referencePrice || referencePrice === 0) return false;
      const pctChange =
        ((referencePrice - currentPrice) / referencePrice) * 100;
      return pctChange >= thresholdValue;
    }
  }
}

/** Return the start of the current UTC day */
function startOfUTCDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ── Live implementation ──────────────────────────────────────────────

export const SwapAutomationServiceLive: Layer.Layer<
  SwapAutomationService,
  never,
  | DatabaseService
  | TransactionService
  | UniswapService
  | AdapterService
  | WalletService
  | ConfigService
> = Layer.effect(
  SwapAutomationService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const txService = yield* TransactionService;
    const uniswap = yield* UniswapService;
    const adapter = yield* AdapterService;
    const walletService = yield* WalletService;
    const config = yield* ConfigService;

    const publicClient = createBasePublicClient(config.baseRpcUrl || undefined);

    // Check if the wallet has enough balance of tokenIn
    const checkBalance = (
      walletAddress: `0x${string}`,
      tokenIn: string,
      requiredAmount: number
    ) =>
      Effect.tryPromise({
        try: async () => {
          if (
            tokenIn.toLowerCase() === ETH_ADDRESS.toLowerCase()
          ) {
            const balance = await publicClient.getBalance({
              address: walletAddress,
            });
            return Number(balance) >= requiredAmount;
          }
          // ERC-20 balance check
          const balance = await publicClient.readContract({
            address: tokenIn as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [walletAddress],
          });
          return Number(balance) >= requiredAmount;
        },
        catch: (error) =>
          new SwapAutomationError({
            message: `Balance check failed: ${error}`,
            cause: error,
          }),
      });

    // Resolve wallet from internal walletId to get both address and privyWalletId
    const resolveWallet = (
      walletId: string,
      walletType: "server" | "agent"
    ) =>
      Effect.gen(function* () {
        // Look up the wallet record to get the privyWalletId
        const [walletRecord] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(eq(wallets.id, walletId))
              .limit(1),
          catch: (error) =>
            new SwapAutomationError({
              message: `Failed to look up wallet: ${error}`,
              cause: error,
            }),
        });

        if (!walletRecord) {
          return yield* Effect.fail(
            new SwapAutomationError({
              message: `Wallet not found: ${walletId}`,
            })
          );
        }

        const wallet = yield* walletService
          .getWallet(walletId, walletType)
          .pipe(
            Effect.mapError(
              (e) =>
                new SwapAutomationError({
                  message: `Wallet resolution failed: ${e.message}`,
                  cause: e,
                })
            )
          );

        const address = yield* wallet.getAddress().pipe(
          Effect.mapError(
            (e) =>
              new SwapAutomationError({
                message: `Failed to get wallet address: ${e.message}`,
                cause: e,
              })
          )
        );

        return { wallet, address, walletId };
      });

    // Wait for transaction confirmation on chain
    const waitForConfirmation = (txHash: Hash) =>
      Effect.tryPromise({
        try: async () => {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: txHash,
            confirmations: 1,
            timeout: 60_000, // 60 second timeout
          });
          if (receipt.status === "reverted") {
            throw new Error(`Transaction reverted: ${txHash}`);
          }
          return receipt;
        },
        catch: (error) =>
          new SwapAutomationError({
            message: `Transaction confirmation failed: ${error}`,
            cause: error,
          }),
      });

    // Count successful executions for an automation since the start of today (UTC)
    const countTodayExecutions = (automationId: string) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(swapAutomationExecutions)
            .where(
              and(
                eq(swapAutomationExecutions.automationId, automationId),
                eq(swapAutomationExecutions.status, "success"),
                gte(swapAutomationExecutions.executedAt, startOfUTCDay())
              )
            );
          return rows[0]?.count ?? 0;
        },
        catch: (error) =>
          new SwapAutomationError({
            message: `Failed to count today's executions: ${error}`,
            cause: error,
          }),
      });

    // Execute a single automation swap
    const executeOne = (
      automation: SwapAutomation,
      currentPrice: number
    ) =>
      Effect.gen(function* () {
        const { address: walletAddress, walletId } = yield* resolveWallet(
          automation.walletId,
          automation.walletType as "server" | "agent"
        );

        // Convert human-readable amount to raw units for on-chain operations
        const rawAmount = toRawAmountStr(automation.amount, automation.tokenIn);

        // Check balance (add gas buffer for ETH swaps)
        const isEthSwap = automation.tokenIn.toLowerCase() === ETH_ADDRESS.toLowerCase();
        const gasBuffer = isEthSwap ? 50000000000000000 : 0; // 0.05 ETH buffer for gas
        const requiredAmount = Number(rawAmount) + gasBuffer;

        const hasSufficientBalance = yield* checkBalance(
          walletAddress,
          automation.tokenIn,
          requiredAmount
        );

        if (!hasSufficientBalance) {
          // Record as skipped
          const [execution] = yield* Effect.tryPromise({
            try: () =>
              db
                .insert(swapAutomationExecutions)
                .values({
                  automationId: automation.id,
                  status: "skipped",
                  priceAtExecution: currentPrice,
                  error: isEthSwap
                    ? "Insufficient wallet balance (including gas buffer)"
                    : "Insufficient wallet balance",
                } satisfies NewSwapAutomationExecution)
                .returning(),
            catch: (error) =>
              new SwapAutomationError({
                message: `Failed to record skipped execution: ${error}`,
                cause: error,
              }),
          });

          // Increment consecutive failures
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(swapAutomations)
                .set({
                  lastCheckedAt: new Date(),
                  consecutiveFailures: automation.consecutiveFailures + 1,
                  status:
                    automation.consecutiveFailures + 1 >= automation.maxRetries
                      ? "failed"
                      : automation.status,
                  updatedAt: new Date(),
                })
                .where(eq(swapAutomations.id, automation.id)),
            catch: (error) =>
              new SwapAutomationError({
                message: `Failed to update automation after skip: ${error}`,
                cause: error,
              }),
          });

          return execution!;
        }

        // Execute swap: approval (if ERC-20) → wait for confirmation → quote → swap
        const swapResult = yield* Effect.gen(function* () {
          // 1. Check and submit approval ONLY for ERC-20 tokens (not ETH)
          if (!isEthSwap) {
            const approvalResult = yield* uniswap.checkApproval({
              walletAddress,
              token: automation.tokenIn,
              amount: automation.amount,
              chainId: automation.chainId,
            }).pipe(
              Effect.mapError(
                (e) =>
                  new SwapAutomationError({
                    message: `Approval check failed: ${e.message}`,
                    cause: e,
                  })
              )
            );

            // 2. Submit approval if needed and WAIT for confirmation
            if (approvalResult.approval) {
              const approvalTx = yield* txService
                .submitRawTransaction({
                  walletId,
                  walletType: automation.walletType as "server" | "agent",
                  chainId: automation.chainId,
                  to: approvalResult.approval.to as `0x${string}`,
                  data: approvalResult.approval.data as `0x${string}`,
                  value: Number(approvalResult.approval.value || "0"),
                  userId: automation.userId,
                })
                .pipe(
                  Effect.mapError(
                    (e) =>
                      new SwapAutomationError({
                        message: `Approval tx failed: ${e}`,
                        cause: e,
                      })
                  )
                );

              // Wait for approval to be confirmed on-chain before proceeding
              yield* waitForConfirmation(approvalTx.txHash as Hash);
            }
          }

          // 3. Get quote (after approval is confirmed) — use raw amount
          //    Determine platform fee: get a fee-less quote first to estimate USD,
          //    then re-quote with the fee when a recipient is configured.
          const feeRecipient = config.swapFeeRecipient || undefined;
          let portionBips: number | undefined;
          let portionRecipient: string | undefined;

          if (feeRecipient) {
            const preQuote = yield* uniswap.getQuote({
              swapper: walletAddress,
              tokenIn: automation.tokenIn,
              tokenOut: automation.tokenOut,
              amount: rawAmount,
              type: "EXACT_INPUT",
              slippageTolerance: automation.slippageTolerance,
              chainId: automation.chainId,
            }).pipe(
              Effect.mapError(
                (e) =>
                  new SwapAutomationError({
                    message: `Pre-quote for fee estimation failed: ${e.message}`,
                    cause: e,
                  })
              )
            );
            const estimatedUsd = estimateSwapUsd(
              automation.tokenIn,
              automation.tokenOut,
              preQuote.quote.input.amount,
              preQuote.quote.output.amount
            );
            portionBips = getSwapFeeBips(estimatedUsd);
            portionRecipient = feeRecipient;
          }

          const quote = yield* uniswap.getQuote({
            swapper: walletAddress,
            tokenIn: automation.tokenIn,
            tokenOut: automation.tokenOut,
            amount: rawAmount,
            type: "EXACT_INPUT",
            slippageTolerance: automation.slippageTolerance,
            chainId: automation.chainId,
            portionBips,
            portionRecipient,
          }).pipe(
            Effect.mapError(
              (e) =>
                new SwapAutomationError({
                  message: `Quote failed: ${e.message}`,
                  cause: e,
                })
            )
          );

          // 4. Get swap tx
          const swapTx = yield* uniswap.getSwapTransaction(quote).pipe(
            Effect.mapError(
              (e) =>
                new SwapAutomationError({
                  message: `Swap tx build failed: ${e.message}`,
                  cause: e,
                })
            )
          );

          // 5. Submit swap
          const tx = yield* txService
            .submitRawTransaction({
              walletId,
              walletType: automation.walletType as "server" | "agent",
              chainId: automation.chainId,
              to: swapTx.to as `0x${string}`,
              data: swapTx.data as `0x${string}`,
              value: Number(swapTx.value || "0"),
              userId: automation.userId,
            })
            .pipe(
              Effect.mapError(
                (e) =>
                  new SwapAutomationError({
                    message: `Swap tx submission failed: ${e}`,
                    cause: e,
                  })
              )
            );

          return { tx, quote };
        }).pipe(
          Effect.map((r) => ({
            success: true as const,
            txId: r.tx.id,
            quote: {
              input: r.quote.quote.input,
              output: r.quote.quote.output,
              gasFeeUSD: r.quote.quote.gasFeeUSD,
            },
          })),
          Effect.catchAll((error) =>
            Effect.succeed({
              success: false as const,
              error: String(error),
              txId: undefined as string | undefined,
              quote: undefined as Record<string, unknown> | undefined,
            })
          )
        );

        // Record execution
        const [execution] = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(swapAutomationExecutions)
              .values({
                automationId: automation.id,
                transactionId: swapResult.txId ?? null,
                status: swapResult.success ? "success" : "failed",
                priceAtExecution: currentPrice,
                error: swapResult.success ? null : swapResult.error,
                quoteSnapshot: swapResult.quote as Record<string, unknown> | null,
              } satisfies NewSwapAutomationExecution)
              .returning(),
          catch: (error) =>
            new SwapAutomationError({
              message: `Failed to record execution: ${error}`,
              cause: error,
            }),
        });

        // Update automation state
        const newTotalExecutions = automation.totalExecutions + (swapResult.success ? 1 : 0);
        const newConsecutiveFailures = swapResult.success
          ? 0
          : automation.consecutiveFailures + 1;

        let newStatus = automation.status;
        if (swapResult.success && newTotalExecutions >= automation.maxExecutions) {
          newStatus = "triggered";
        } else if (
          !swapResult.success &&
          newConsecutiveFailures >= automation.maxRetries
        ) {
          newStatus = "failed";
        }

        yield* Effect.tryPromise({
          try: () =>
            db
              .update(swapAutomations)
              .set({
                totalExecutions: newTotalExecutions,
                consecutiveFailures: newConsecutiveFailures,
                lastCheckedAt: new Date(),
                lastTriggeredAt: swapResult.success ? new Date() : automation.lastTriggeredAt,
                status: newStatus,
                updatedAt: new Date(),
              })
              .where(eq(swapAutomations.id, automation.id)),
          catch: (error) =>
            new SwapAutomationError({
              message: `Failed to update automation after execution: ${error}`,
              cause: error,
            }),
        });

        return execution!;
      });

    return {
      createAutomation: (params: CreateAutomationParams) =>
        Effect.gen(function* () {
          // Fetch reference price for percent_change indicators
          let referencePrice: number | null = null;
          if (
            params.indicatorType === "percent_change_up" ||
            params.indicatorType === "percent_change_down"
          ) {
            const priceData = yield* adapter
              .getPrice(params.indicatorToken)
              .pipe(
                Effect.mapError(
                  (e) =>
                    new SwapAutomationError({
                      message: `Failed to fetch reference price: ${e.message}`,
                      cause: e,
                    })
                )
              );
            referencePrice = priceData.price;
          }

          const chainId = params.chainId ?? BASE_CHAIN_ID;
          // Normalise amount: the frontend may send raw units (e.g. "5000000"
          // for 5 USDC). We always store human-readable values.
          const humanAmount = normalizeToHumanReadable(params.amount, params.tokenIn);
          const values: NewSwapAutomation = {
            userId: params.userId,
            walletId: params.walletId,
            walletType: params.walletType,
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amount: humanAmount,
            slippageTolerance: params.slippageTolerance ?? 0.5,
            chainId,
            indicatorType: params.indicatorType,
            indicatorToken: params.indicatorToken,
            thresholdValue: params.thresholdValue,
            referencePrice,
            maxExecutions: params.maxExecutions ?? 1,
            maxExecutionsPerDay: params.maxExecutionsPerDay ?? null,
            cooldownSeconds: params.cooldownSeconds ?? 60,
            maxRetries: params.maxRetries ?? 3,
          };

          const [result] = yield* Effect.tryPromise({
            try: () =>
              db.insert(swapAutomations).values(values).returning(),
            catch: (error) =>
              new SwapAutomationError({
                message: `Failed to create swap automation: ${error}`,
                cause: error,
              }),
          });

          return result!;
        }),

      getAutomation: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .select()
              .from(swapAutomations)
              .where(eq(swapAutomations.id, id));
            return result;
          },
          catch: (error) =>
            new SwapAutomationError({
              message: `Failed to get automation: ${error}`,
              cause: error,
            }),
        }),

      listByUser: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(swapAutomations)
              .where(eq(swapAutomations.userId, userId))
              .orderBy(swapAutomations.createdAt);
            return results;
          },
          catch: (error) =>
            new SwapAutomationError({
              message: `Failed to list automations: ${error}`,
              cause: error,
            }),
        }),

      updateAutomation: (id: string, params: UpdateAutomationParams) =>
        Effect.tryPromise({
          try: async () => {
            const updates: Record<string, unknown> = {
              updatedAt: new Date(),
            };
            if (params.thresholdValue !== undefined)
              updates.thresholdValue = params.thresholdValue;
            if (params.amount !== undefined) {
              // Normalise amount: fetch the existing automation to know the token
              const [existing] = await db
                .select({ tokenIn: swapAutomations.tokenIn })
                .from(swapAutomations)
                .where(eq(swapAutomations.id, id));
              const tokenIn = existing?.tokenIn ?? "";
              updates.amount = normalizeToHumanReadable(params.amount, tokenIn);
            }
            if (params.slippageTolerance !== undefined)
              updates.slippageTolerance = params.slippageTolerance;
            if (params.maxExecutions !== undefined)
              updates.maxExecutions = params.maxExecutions;
            if (params.maxExecutionsPerDay !== undefined)
              updates.maxExecutionsPerDay = params.maxExecutionsPerDay;
            if (params.cooldownSeconds !== undefined)
              updates.cooldownSeconds = params.cooldownSeconds;
            if (params.maxRetries !== undefined)
              updates.maxRetries = params.maxRetries;

            const [result] = await db
              .update(swapAutomations)
              .set(updates)
              .where(eq(swapAutomations.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new SwapAutomationError({
              message: `Failed to update automation: ${error}`,
              cause: error,
            }),
        }),

      pauseAutomation: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(swapAutomations)
              .set({ status: "paused", updatedAt: new Date() })
              .where(eq(swapAutomations.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new SwapAutomationError({
              message: `Failed to pause automation: ${error}`,
              cause: error,
            }),
        }),

      resumeAutomation: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(swapAutomations)
              .set({
                status: "active",
                consecutiveFailures: 0,
                updatedAt: new Date(),
              })
              .where(eq(swapAutomations.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new SwapAutomationError({
              message: `Failed to resume automation: ${error}`,
              cause: error,
            }),
        }),

      cancelAutomation: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(swapAutomations)
              .set({ status: "cancelled", updatedAt: new Date() })
              .where(eq(swapAutomations.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new SwapAutomationError({
              message: `Failed to cancel automation: ${error}`,
              cause: error,
            }),
        }),

      getExecutionHistory: (automationId: string, limit = 50) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(swapAutomationExecutions)
              .where(
                eq(swapAutomationExecutions.automationId, automationId)
              )
              .orderBy(swapAutomationExecutions.executedAt)
              .limit(limit);
            return results;
          },
          catch: (error) =>
            new SwapAutomationError({
              message: `Failed to get execution history: ${error}`,
              cause: error,
            }),
        }),

      processDueAutomations: () =>
        Effect.gen(function* () {
          // 1. Fetch all active automations
          const activeAutomations = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(swapAutomations)
                .where(eq(swapAutomations.status, "active")),
            catch: (error) =>
              new SwapAutomationError({
                message: `Failed to fetch active automations: ${error}`,
                cause: error,
              }),
          });

          if (activeAutomations.length === 0) return [];

          // 2. Filter by cooldown
          const now = Date.now();
          const readyAutomations = activeAutomations.filter((a) => {
            if (!a.lastCheckedAt) return true;
            const elapsed = (now - a.lastCheckedAt.getTime()) / 1000;
            return elapsed >= a.cooldownSeconds;
          });

          if (readyAutomations.length === 0) return [];

          // 3. Collect unique indicator tokens to batch price lookups
          const uniqueTokens = [
            ...new Set(readyAutomations.map((a) => a.indicatorToken)),
          ];

          const priceMap = new Map<string, PriceData>();
          const priceResult = yield* adapter.getPrices(uniqueTokens).pipe(
            Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<PriceData>))
          );

          for (const p of priceResult) {
            priceMap.set(p.symbol.toUpperCase(), p);
          }

          // 4. Evaluate each automation
          const executions: SwapAutomationExecution[] = [];

          for (const automation of readyAutomations) {
            const priceData = priceMap.get(
              automation.indicatorToken.toUpperCase()
            );

            if (!priceData) {
              // Mark as checked but skip — no price data
              yield* Effect.tryPromise({
                try: () =>
                  db
                    .update(swapAutomations)
                    .set({ lastCheckedAt: new Date(), updatedAt: new Date() })
                    .where(eq(swapAutomations.id, automation.id)),
                catch: () =>
                  new SwapAutomationError({
                    message: "Failed to update lastCheckedAt",
                  }),
              });
              continue;
            }

            const conditionMet = isConditionMet(
              automation.indicatorType as IndicatorType,
              automation.thresholdValue,
              priceData.price,
              automation.referencePrice
            );

            if (!conditionMet) {
              // Update lastCheckedAt only
              yield* Effect.tryPromise({
                try: () =>
                  db
                    .update(swapAutomations)
                    .set({ lastCheckedAt: new Date(), updatedAt: new Date() })
                    .where(eq(swapAutomations.id, automation.id)),
                catch: () =>
                  new SwapAutomationError({
                    message: "Failed to update lastCheckedAt",
                  }),
              });
              continue;
            }

            // Check daily execution limit
            if (automation.maxExecutionsPerDay != null) {
              const todayCount = yield* countTodayExecutions(automation.id);
              if (todayCount >= automation.maxExecutionsPerDay) {
                // Daily limit reached — update lastCheckedAt and skip
                yield* Effect.tryPromise({
                  try: () =>
                    db
                      .update(swapAutomations)
                      .set({ lastCheckedAt: new Date(), updatedAt: new Date() })
                      .where(eq(swapAutomations.id, automation.id)),
                  catch: () =>
                    new SwapAutomationError({
                      message: "Failed to update lastCheckedAt",
                    }),
                });
                continue;
              }
            }

            // Condition met — execute the swap
            const execution = yield* executeOne(
              automation,
              priceData.price
            ).pipe(
              Effect.catchAll((error) =>
                // If executeOne itself fails unexpectedly, record a failed execution
                Effect.tryPromise({
                  try: () =>
                    db
                      .insert(swapAutomationExecutions)
                      .values({
                        automationId: automation.id,
                        status: "failed",
                        priceAtExecution: priceData.price,
                        error: String(error),
                      } satisfies NewSwapAutomationExecution)
                      .returning()
                      .then((rows) => rows[0]!),
                  catch: () =>
                    new SwapAutomationError({
                      message: `Failed to record error execution: ${error}`,
                    }),
                })
              )
            );

            executions.push(execution);
          }

          return executions;
        }),
    };
  })
);
