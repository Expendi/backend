import { Effect, Context, Layer, Data } from "effect";
import { eq, and, lte, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import {
  dcaStrategies,
  dcaExecutions,
  wallets,
  type DcaStrategy,
  type NewDcaStrategy,
  type DcaExecution,
  type NewDcaExecution,
  type IndicatorConfig,
} from "../../db/schema/index.js";
import { TransactionService } from "../transaction/transaction-service.js";
import { UniswapService, BASE_CHAIN_ID } from "../uniswap/uniswap-service.js";
import { AdapterService, type PriceData } from "../adapters/adapter-service.js";
import { WalletService } from "../wallet/wallet-service.js";
import { ConfigService } from "../../config.js";
import {
  IndicatorService,
  type IndicatorValues,
} from "./indicator-service.js";
import { erc20Abi, type Hash } from "viem";
import { createBasePublicClient } from "../chain/public-client.js";

// ── Token decimals ───────────────────────────────────────────────────

const TOKEN_DECIMALS_BY_ADDRESS: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6, // USDC on Base
  "0x2d1adb45bb1d7d2556c6558adb76cfd4f9f4ed16": 6, // USDT on Base
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": 18, // DAI on Base
  "0x4200000000000000000000000000000000000006": 18, // WETH on Base
  "0x0000000000000000000000000000000000000000": 18, // ETH (native)
};

function toRawAmountStr(amount: string, tokenAddress: string): string {
  const decimals = TOKEN_DECIMALS_BY_ADDRESS[tokenAddress.toLowerCase()] ?? 18;
  return String(Math.floor(Number(amount) * Math.pow(10, decimals)));
}

function normalizeToHumanReadable(
  amount: string,
  tokenAddress: string
): string {
  const decimals = TOKEN_DECIMALS_BY_ADDRESS[tokenAddress.toLowerCase()] ?? 18;
  const num = Number(amount);
  if (isNaN(num) || num === 0) return amount;
  if (amount.includes(".")) return amount;
  const threshold = Math.pow(10, decimals);
  if (num >= threshold) return String(num / threshold);
  return amount;
}

// ── Error ────────────────────────────────────────────────────────────

export class DcaStrategyError extends Data.TaggedError("DcaStrategyError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export type DcaFrequency = "daily" | "weekly" | "biweekly" | "monthly";

export interface CreateDcaStrategyParams {
  readonly userId: string;
  readonly name?: string;
  readonly walletId: string;
  readonly walletType: "server" | "agent";
  readonly strategyType: "frequency" | "indicator";
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amount: string;
  readonly slippageTolerance?: number;
  readonly chainId?: number;
  readonly frequency: DcaFrequency;
  readonly indicatorConfig?: IndicatorConfig;
  readonly indicatorToken?: string;
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly maxExecutions?: number;
  readonly maxRetries?: number;
}

export interface UpdateDcaStrategyParams {
  readonly name?: string;
  readonly amount?: string;
  readonly slippageTolerance?: number;
  readonly frequency?: DcaFrequency;
  readonly indicatorConfig?: IndicatorConfig;
  readonly maxExecutions?: number | null;
  readonly maxRetries?: number;
  readonly endDate?: Date | null;
}

// ── Service interface ────────────────────────────────────────────────

export interface DcaStrategyServiceApi {
  readonly createStrategy: (
    params: CreateDcaStrategyParams
  ) => Effect.Effect<DcaStrategy, DcaStrategyError>;

  readonly getStrategy: (
    id: string
  ) => Effect.Effect<DcaStrategy | undefined, DcaStrategyError>;

  readonly listByUser: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<DcaStrategy>, DcaStrategyError>;

  readonly updateStrategy: (
    id: string,
    params: UpdateDcaStrategyParams
  ) => Effect.Effect<DcaStrategy, DcaStrategyError>;

  readonly pauseStrategy: (
    id: string
  ) => Effect.Effect<DcaStrategy, DcaStrategyError>;

  readonly resumeStrategy: (
    id: string
  ) => Effect.Effect<DcaStrategy, DcaStrategyError>;

  readonly cancelStrategy: (
    id: string
  ) => Effect.Effect<DcaStrategy, DcaStrategyError>;

  readonly getExecutionHistory: (
    strategyId: string,
    limit?: number
  ) => Effect.Effect<ReadonlyArray<DcaExecution>, DcaStrategyError>;

  readonly processDueStrategies: () => Effect.Effect<
    ReadonlyArray<DcaExecution>,
    DcaStrategyError
  >;
}

export class DcaStrategyService extends Context.Tag("DcaStrategyService")<
  DcaStrategyService,
  DcaStrategyServiceApi
>() {}

// ── Helpers ──────────────────────────────────────────────────────────

const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Calculate the next execution time based on frequency and an anchor date */
function computeNextExecution(
  frequency: DcaFrequency,
  anchor: Date
): Date {
  const next = new Date(anchor);
  switch (frequency) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "biweekly":
      next.setUTCDate(next.getUTCDate() + 14);
      break;
    case "monthly":
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
  }
  return next;
}

/** Evaluate indicator conditions — returns true if all enabled indicators signal a buy */
function evaluateIndicators(
  config: IndicatorConfig,
  indicators: IndicatorValues
): { shouldBuy: boolean; reason: string } {
  const results: string[] = [];
  let allMet = true;

  if (config.sma200?.enabled) {
    if (indicators.sma200 === null) {
      return { shouldBuy: false, reason: "SMA-200 data unavailable" };
    }
    const smaMet =
      config.sma200.condition === "price_below"
        ? indicators.currentPrice < indicators.sma200
        : indicators.currentPrice > indicators.sma200;
    if (!smaMet) allMet = false;
    results.push(
      `SMA-200: price=${indicators.currentPrice.toFixed(2)}, sma=${indicators.sma200.toFixed(2)} → ${smaMet ? "BUY" : "WAIT"}`
    );
  }

  if (config.rsi?.enabled) {
    if (indicators.rsi === null) {
      return { shouldBuy: false, reason: "RSI data unavailable" };
    }
    const rsiMet = indicators.rsi <= config.rsi.oversoldThreshold;
    if (!rsiMet) allMet = false;
    results.push(
      `RSI-${config.rsi.period}: ${indicators.rsi.toFixed(1)} (threshold=${config.rsi.oversoldThreshold}) → ${rsiMet ? "BUY" : "WAIT"}`
    );
  }

  if (config.fearGreed?.enabled) {
    if (indicators.fearGreedIndex === null) {
      return { shouldBuy: false, reason: "Fear & Greed data unavailable" };
    }
    const fgMet =
      config.fearGreed.condition === "below"
        ? indicators.fearGreedIndex <= config.fearGreed.threshold
        : indicators.fearGreedIndex >= config.fearGreed.threshold;
    if (!fgMet) allMet = false;
    results.push(
      `Fear&Greed: ${indicators.fearGreedIndex} (threshold=${config.fearGreed.threshold}, condition=${config.fearGreed.condition}) → ${fgMet ? "BUY" : "WAIT"}`
    );
  }

  return {
    shouldBuy: allMet,
    reason: results.join("; "),
  };
}

// ── Live implementation ──────────────────────────────────────────────

export const DcaStrategyServiceLive: Layer.Layer<
  DcaStrategyService,
  never,
  | DatabaseService
  | TransactionService
  | UniswapService
  | AdapterService
  | WalletService
  | ConfigService
  | IndicatorService
> = Layer.effect(
  DcaStrategyService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const txService = yield* TransactionService;
    const uniswap = yield* UniswapService;
    const adapter = yield* AdapterService;
    const walletService = yield* WalletService;
    const config = yield* ConfigService;
    const indicatorService = yield* IndicatorService;

    const publicClient = createBasePublicClient(
      config.baseRpcUrl || undefined
    );

    // ── Internal helpers (same patterns as SwapAutomationService) ────

    const checkBalance = (
      walletAddress: `0x${string}`,
      tokenIn: string,
      requiredAmount: number
    ) =>
      Effect.tryPromise({
        try: async () => {
          if (tokenIn.toLowerCase() === ETH_ADDRESS.toLowerCase()) {
            const balance = await publicClient.getBalance({
              address: walletAddress,
            });
            return Number(balance) >= requiredAmount;
          }
          const balance = await publicClient.readContract({
            address: tokenIn as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [walletAddress],
          });
          return Number(balance) >= requiredAmount;
        },
        catch: (error) =>
          new DcaStrategyError({
            message: `Balance check failed: ${error}`,
            cause: error,
          }),
      });

    const resolveWallet = (walletId: string, walletType: "server" | "agent") =>
      Effect.gen(function* () {
        const [walletRecord] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(eq(wallets.id, walletId))
              .limit(1),
          catch: (error) =>
            new DcaStrategyError({
              message: `Failed to look up wallet: ${error}`,
              cause: error,
            }),
        });

        if (!walletRecord) {
          return yield* Effect.fail(
            new DcaStrategyError({ message: `Wallet not found: ${walletId}` })
          );
        }

        const wallet = yield* walletService
          .getWallet(walletId, walletType)
          .pipe(
            Effect.mapError(
              (e) =>
                new DcaStrategyError({
                  message: `Wallet resolution failed: ${e.message}`,
                  cause: e,
                })
            )
          );

        const address = yield* wallet.getAddress().pipe(
          Effect.mapError(
            (e) =>
              new DcaStrategyError({
                message: `Failed to get wallet address: ${e.message}`,
                cause: e,
              })
          )
        );

        return { wallet, address, walletId };
      });

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
        catch: (error) =>
          new DcaStrategyError({
            message: `Transaction confirmation failed: ${error}`,
            cause: error,
          }),
      });

    // Execute a single DCA buy
    const executeSwap = (strategy: DcaStrategy, currentPrice: number) =>
      Effect.gen(function* () {
        const { address: walletAddress, walletId } = yield* resolveWallet(
          strategy.walletId,
          strategy.walletType as "server" | "agent"
        );

        const rawAmount = toRawAmountStr(strategy.amount, strategy.tokenIn);
        const isEthSwap =
          strategy.tokenIn.toLowerCase() === ETH_ADDRESS.toLowerCase();
        const gasBuffer = isEthSwap ? 50000000000000000 : 0;
        const requiredAmount = Number(rawAmount) + gasBuffer;

        const hasSufficientBalance = yield* checkBalance(
          walletAddress,
          strategy.tokenIn,
          requiredAmount
        );

        if (!hasSufficientBalance) {
          return yield* Effect.fail(
            new DcaStrategyError({
              message: isEthSwap
                ? "Insufficient wallet balance (including gas buffer)"
                : "Insufficient wallet balance",
            })
          );
        }

        // Approval (ERC-20 only)
        if (!isEthSwap) {
          const approvalResult = yield* uniswap
            .checkApproval({
              walletAddress,
              token: strategy.tokenIn,
              amount: strategy.amount,
              chainId: strategy.chainId,
            })
            .pipe(
              Effect.mapError(
                (e) =>
                  new DcaStrategyError({
                    message: `Approval check failed: ${e.message}`,
                    cause: e,
                  })
              )
            );

          if (approvalResult.approval) {
            const approvalTx = yield* txService
              .submitRawTransaction({
                walletId,
                walletType: strategy.walletType as "server" | "agent",
                chainId: strategy.chainId,
                to: approvalResult.approval.to as `0x${string}`,
                data: approvalResult.approval.data as `0x${string}`,
                value: Number(approvalResult.approval.value || "0"),
                userId: strategy.userId,
              })
              .pipe(
                Effect.mapError(
                  (e) =>
                    new DcaStrategyError({
                      message: `Approval tx failed: ${e}`,
                      cause: e,
                    })
                )
              );
            yield* waitForConfirmation(approvalTx.txHash as Hash);
          }
        }

        // Get quote
        const quote = yield* uniswap
          .getQuote({
            swapper: walletAddress,
            tokenIn: strategy.tokenIn,
            tokenOut: strategy.tokenOut,
            amount: rawAmount,
            type: "EXACT_INPUT",
            slippageTolerance: strategy.slippageTolerance,
            chainId: strategy.chainId,
          })
          .pipe(
            Effect.mapError(
              (e) =>
                new DcaStrategyError({
                  message: `Quote failed: ${e.message}`,
                  cause: e,
                })
            )
          );

        // Build and submit swap tx
        const swapTx = yield* uniswap.getSwapTransaction(quote).pipe(
          Effect.mapError(
            (e) =>
              new DcaStrategyError({
                message: `Swap tx build failed: ${e.message}`,
                cause: e,
              })
          )
        );

        const tx = yield* txService
          .submitRawTransaction({
            walletId,
            walletType: strategy.walletType as "server" | "agent",
            chainId: strategy.chainId,
            to: swapTx.to as `0x${string}`,
            data: swapTx.data as `0x${string}`,
            value: Number(swapTx.value || "0"),
            userId: strategy.userId,
          })
          .pipe(
            Effect.mapError(
              (e) =>
                new DcaStrategyError({
                  message: `Swap tx submission failed: ${e}`,
                  cause: e,
                })
            )
          );

        return {
          txId: tx.id,
          quote: {
            input: quote.quote.input,
            output: quote.quote.output,
            gasFeeUSD: quote.quote.gasFeeUSD,
          },
        };
      });

    // ── API implementation ───────────────────────────────────────────

    return {
      createStrategy: (params: CreateDcaStrategyParams) =>
        Effect.gen(function* () {
          const chainId = params.chainId ?? BASE_CHAIN_ID;
          const humanAmount = normalizeToHumanReadable(
            params.amount,
            params.tokenIn
          );
          const startDate = params.startDate ?? new Date();
          const nextExecutionAt = computeNextExecution(
            params.frequency,
            startDate
          );

          if (
            params.strategyType === "indicator" &&
            !params.indicatorConfig
          ) {
            return yield* Effect.fail(
              new DcaStrategyError({
                message:
                  "indicatorConfig is required for indicator strategy type",
              })
            );
          }

          if (
            params.strategyType === "indicator" &&
            !params.indicatorToken
          ) {
            return yield* Effect.fail(
              new DcaStrategyError({
                message:
                  "indicatorToken is required for indicator strategy type",
              })
            );
          }

          const values: NewDcaStrategy = {
            userId: params.userId,
            name: params.name ?? null,
            walletId: params.walletId,
            walletType: params.walletType,
            strategyType: params.strategyType,
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amount: humanAmount,
            slippageTolerance: params.slippageTolerance ?? 0.5,
            chainId,
            frequency: params.frequency,
            indicatorConfig: params.indicatorConfig ?? null,
            indicatorToken: params.indicatorToken ?? null,
            startDate,
            endDate: params.endDate ?? null,
            nextExecutionAt,
            maxExecutions: params.maxExecutions ?? null,
            maxRetries: params.maxRetries ?? 3,
          };

          const [result] = yield* Effect.tryPromise({
            try: () =>
              db.insert(dcaStrategies).values(values).returning(),
            catch: (error) =>
              new DcaStrategyError({
                message: `Failed to create DCA strategy: ${error}`,
                cause: error,
              }),
          });

          return result!;
        }),

      getStrategy: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .select()
              .from(dcaStrategies)
              .where(eq(dcaStrategies.id, id));
            return result;
          },
          catch: (error) =>
            new DcaStrategyError({
              message: `Failed to get strategy: ${error}`,
              cause: error,
            }),
        }),

      listByUser: (userId: string) =>
        Effect.tryPromise({
          try: async () =>
            db
              .select()
              .from(dcaStrategies)
              .where(eq(dcaStrategies.userId, userId))
              .orderBy(dcaStrategies.createdAt),
          catch: (error) =>
            new DcaStrategyError({
              message: `Failed to list strategies: ${error}`,
              cause: error,
            }),
        }),

      updateStrategy: (id: string, params: UpdateDcaStrategyParams) =>
        Effect.tryPromise({
          try: async () => {
            const updates: Record<string, unknown> = {
              updatedAt: new Date(),
            };
            if (params.name !== undefined) updates.name = params.name;
            if (params.amount !== undefined) {
              const [existing] = await db
                .select({ tokenIn: dcaStrategies.tokenIn })
                .from(dcaStrategies)
                .where(eq(dcaStrategies.id, id));
              updates.amount = normalizeToHumanReadable(
                params.amount,
                existing?.tokenIn ?? ""
              );
            }
            if (params.slippageTolerance !== undefined)
              updates.slippageTolerance = params.slippageTolerance;
            if (params.frequency !== undefined)
              updates.frequency = params.frequency;
            if (params.indicatorConfig !== undefined)
              updates.indicatorConfig = params.indicatorConfig;
            if (params.maxExecutions !== undefined)
              updates.maxExecutions = params.maxExecutions;
            if (params.maxRetries !== undefined)
              updates.maxRetries = params.maxRetries;
            if (params.endDate !== undefined) updates.endDate = params.endDate;

            const [result] = await db
              .update(dcaStrategies)
              .set(updates)
              .where(eq(dcaStrategies.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new DcaStrategyError({
              message: `Failed to update strategy: ${error}`,
              cause: error,
            }),
        }),

      pauseStrategy: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(dcaStrategies)
              .set({ status: "paused", updatedAt: new Date() })
              .where(eq(dcaStrategies.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new DcaStrategyError({
              message: `Failed to pause strategy: ${error}`,
              cause: error,
            }),
        }),

      resumeStrategy: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(dcaStrategies)
              .set({
                status: "active",
                consecutiveFailures: 0,
                updatedAt: new Date(),
              })
              .where(eq(dcaStrategies.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new DcaStrategyError({
              message: `Failed to resume strategy: ${error}`,
              cause: error,
            }),
        }),

      cancelStrategy: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(dcaStrategies)
              .set({ status: "cancelled", updatedAt: new Date() })
              .where(eq(dcaStrategies.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new DcaStrategyError({
              message: `Failed to cancel strategy: ${error}`,
              cause: error,
            }),
        }),

      getExecutionHistory: (strategyId: string, limit = 50) =>
        Effect.tryPromise({
          try: async () =>
            db
              .select()
              .from(dcaExecutions)
              .where(eq(dcaExecutions.strategyId, strategyId))
              .orderBy(dcaExecutions.executedAt)
              .limit(limit),
          catch: (error) =>
            new DcaStrategyError({
              message: `Failed to get execution history: ${error}`,
              cause: error,
            }),
        }),

      processDueStrategies: () =>
        Effect.gen(function* () {
          // 1. Fetch active strategies whose nextExecutionAt <= now
          const now = new Date();
          const dueStrategies = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(dcaStrategies)
                .where(
                  and(
                    eq(dcaStrategies.status, "active"),
                    lte(dcaStrategies.nextExecutionAt, now)
                  )
                ),
            catch: (error) =>
              new DcaStrategyError({
                message: `Failed to fetch due strategies: ${error}`,
                cause: error,
              }),
          });

          if (dueStrategies.length === 0) return [];

          // 2. Batch fetch prices for all indicator tokens
          const indicatorTokens = [
            ...new Set(
              dueStrategies
                .filter((s) => s.indicatorToken)
                .map((s) => s.indicatorToken!)
            ),
          ];

          // Also fetch prices for output tokens (for priceAtExecution)
          const outputTokenSymbols = [
            ...new Set(dueStrategies.map((s) => s.tokenOut)),
          ];

          // Combine unique tokens for price lookup
          const allTokensForPrice = [
            ...new Set([...indicatorTokens, ...outputTokenSymbols]),
          ];

          const priceMap = new Map<string, PriceData>();
          if (allTokensForPrice.length > 0) {
            const priceResult = yield* adapter
              .getPrices(allTokensForPrice)
              .pipe(
                Effect.catchAll(() =>
                  Effect.succeed([] as ReadonlyArray<PriceData>)
                )
              );
            for (const p of priceResult) {
              priceMap.set(p.symbol.toUpperCase(), p);
            }
          }

          const executions: DcaExecution[] = [];

          for (const strategy of dueStrategies) {
            // Check if end date has passed
            if (strategy.endDate && strategy.endDate <= now) {
              yield* Effect.tryPromise({
                try: () =>
                  db
                    .update(dcaStrategies)
                    .set({ status: "completed", updatedAt: new Date() })
                    .where(eq(dcaStrategies.id, strategy.id)),
                catch: () =>
                  new DcaStrategyError({
                    message: "Failed to mark strategy as completed",
                  }),
              });
              continue;
            }

            // Check if max executions reached
            if (
              strategy.maxExecutions !== null &&
              strategy.totalExecutions >= strategy.maxExecutions
            ) {
              yield* Effect.tryPromise({
                try: () =>
                  db
                    .update(dcaStrategies)
                    .set({ status: "completed", updatedAt: new Date() })
                    .where(eq(dcaStrategies.id, strategy.id)),
                catch: () =>
                  new DcaStrategyError({
                    message: "Failed to mark strategy as completed",
                  }),
              });
              continue;
            }

            let indicatorSnapshot: Record<string, unknown> | null = null;

            // For indicator strategies, evaluate conditions
            if (strategy.strategyType === "indicator" && strategy.indicatorConfig) {
              const token = strategy.indicatorToken ?? strategy.tokenOut;
              const indicators = yield* indicatorService
                .getIndicators(token)
                .pipe(
                  Effect.catchAll((error) =>
                    Effect.succeed({
                      sma200: null,
                      rsi: null,
                      fearGreedIndex: null,
                      currentPrice: priceMap.get(token.toUpperCase())?.price ?? 0,
                    } satisfies IndicatorValues)
                  )
                );

              indicatorSnapshot = {
                sma200: indicators.sma200,
                rsi: indicators.rsi,
                fearGreedIndex: indicators.fearGreedIndex,
                currentPrice: indicators.currentPrice,
              };

              const { shouldBuy, reason } = evaluateIndicators(
                strategy.indicatorConfig as IndicatorConfig,
                indicators
              );

              if (!shouldBuy) {
                // Record skipped execution and advance to next scheduled time
                const [execution] = yield* Effect.tryPromise({
                  try: () =>
                    db
                      .insert(dcaExecutions)
                      .values({
                        strategyId: strategy.id,
                        status: "skipped",
                        priceAtExecution: indicators.currentPrice,
                        error: `Indicators not met: ${reason}`,
                        indicatorSnapshot: indicatorSnapshot as Record<string, unknown>,
                      } satisfies NewDcaExecution)
                      .returning(),
                  catch: (error) =>
                    new DcaStrategyError({
                      message: `Failed to record skipped execution: ${error}`,
                      cause: error,
                    }),
                });

                // Advance next execution time
                yield* Effect.tryPromise({
                  try: () =>
                    db
                      .update(dcaStrategies)
                      .set({
                        nextExecutionAt: computeNextExecution(
                          strategy.frequency as DcaFrequency,
                          now
                        ),
                        updatedAt: new Date(),
                      })
                      .where(eq(dcaStrategies.id, strategy.id)),
                  catch: () =>
                    new DcaStrategyError({
                      message: "Failed to advance next execution",
                    }),
                });

                executions.push(execution!);
                continue;
              }
            }

            // Get current price for the output token
            const outputPrice =
              priceMap.get(strategy.tokenOut.toUpperCase())?.price ?? 0;

            // Execute the swap
            const swapResult = yield* executeSwap(strategy, outputPrice).pipe(
              Effect.map((r) => ({
                success: true as const,
                txId: r.txId,
                quote: r.quote as Record<string, unknown>,
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
                  .insert(dcaExecutions)
                  .values({
                    strategyId: strategy.id,
                    transactionId: swapResult.txId ?? null,
                    status: swapResult.success ? "success" : "failed",
                    priceAtExecution: outputPrice,
                    error: swapResult.success ? null : swapResult.error,
                    quoteSnapshot: swapResult.quote ?? null,
                    indicatorSnapshot,
                  } satisfies NewDcaExecution)
                  .returning(),
              catch: (error) =>
                new DcaStrategyError({
                  message: `Failed to record execution: ${error}`,
                  cause: error,
                }),
            });

            // Update strategy state
            const newTotalExecutions =
              strategy.totalExecutions + (swapResult.success ? 1 : 0);
            const newConsecutiveFailures = swapResult.success
              ? 0
              : strategy.consecutiveFailures + 1;

            let newStatus = strategy.status;
            if (
              swapResult.success &&
              strategy.maxExecutions !== null &&
              newTotalExecutions >= strategy.maxExecutions
            ) {
              newStatus = "completed";
            } else if (
              !swapResult.success &&
              newConsecutiveFailures >= strategy.maxRetries
            ) {
              newStatus = "failed";
            }

            yield* Effect.tryPromise({
              try: () =>
                db
                  .update(dcaStrategies)
                  .set({
                    totalExecutions: newTotalExecutions,
                    consecutiveFailures: newConsecutiveFailures,
                    lastExecutedAt: new Date(),
                    nextExecutionAt: computeNextExecution(
                      strategy.frequency as DcaFrequency,
                      now
                    ),
                    status: newStatus,
                    updatedAt: new Date(),
                  })
                  .where(eq(dcaStrategies.id, strategy.id)),
              catch: (error) =>
                new DcaStrategyError({
                  message: `Failed to update strategy after execution: ${error}`,
                  cause: error,
                }),
            });

            executions.push(execution!);
          }

          return executions;
        }),
    };
  })
);
