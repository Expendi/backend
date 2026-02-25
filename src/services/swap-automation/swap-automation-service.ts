import { Effect, Context, Layer, Data } from "effect";
import { eq, and } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import {
  swapAutomations,
  swapAutomationExecutions,
  type SwapAutomation,
  type NewSwapAutomation,
  type SwapAutomationExecution,
  type NewSwapAutomationExecution,
} from "../../db/schema/index.js";
import {
  TransactionService,
} from "../transaction/transaction-service.js";
import {
  UniswapService,
  BASE_CHAIN_ID,
} from "../uniswap/uniswap-service.js";
import { AdapterService, type PriceData } from "../adapters/adapter-service.js";
import { WalletService } from "../wallet/wallet-service.js";
import { ConfigService } from "../../config.js";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { base } from "viem/chains";

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
  readonly cooldownSeconds?: number;
  readonly maxRetries?: number;
}

export interface UpdateAutomationParams {
  readonly thresholdValue?: number;
  readonly amount?: string;
  readonly slippageTolerance?: number;
  readonly maxExecutions?: number;
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

    const publicClient = createPublicClient({
      chain: base,
      transport: http(),
    });

    // Check if the wallet has enough balance of tokenIn
    const checkBalance = (
      walletAddress: `0x${string}`,
      tokenIn: string,
      requiredAmount: bigint
    ) =>
      Effect.tryPromise({
        try: async () => {
          if (
            tokenIn.toLowerCase() === ETH_ADDRESS.toLowerCase()
          ) {
            const balance = await publicClient.getBalance({
              address: walletAddress,
            });
            return balance >= requiredAmount;
          }
          // ERC-20 balance check
          const balance = await publicClient.readContract({
            address: tokenIn as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [walletAddress],
          });
          return balance >= requiredAmount;
        },
        catch: (error) =>
          new SwapAutomationError({
            message: `Balance check failed: ${error}`,
            cause: error,
          }),
      });

    // Resolve wallet address from walletId
    const resolveWalletAddress = (
      walletId: string,
      walletType: "server" | "agent"
    ) =>
      Effect.gen(function* () {
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
        return yield* wallet.getAddress().pipe(
          Effect.mapError(
            (e) =>
              new SwapAutomationError({
                message: `Failed to get wallet address: ${e.message}`,
                cause: e,
              })
          )
        );
      });

    // Execute a single automation swap
    const executeOne = (
      automation: SwapAutomation,
      currentPrice: number
    ) =>
      Effect.gen(function* () {
        const walletAddress = yield* resolveWalletAddress(
          automation.walletId,
          automation.walletType as "server" | "agent"
        );

        // Check balance
        const hasSufficientBalance = yield* checkBalance(
          walletAddress,
          automation.tokenIn,
          BigInt(automation.amount)
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
                  error: "Insufficient wallet balance",
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

        // Execute swap: approval → quote → swap
        const swapResult = yield* Effect.gen(function* () {
          // 1. Check approval
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

          // 2. Submit approval if needed
          if (approvalResult.approval) {
            yield* txService
              .submitRawTransaction({
                walletId: automation.walletId,
                walletType: automation.walletType as "server" | "agent",
                chainId: automation.chainId,
                to: approvalResult.approval.to as `0x${string}`,
                data: approvalResult.approval.data as `0x${string}`,
                value: BigInt(approvalResult.approval.value || "0"),
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
          }

          // 3. Get quote
          const quote = yield* uniswap.getQuote({
            swapper: walletAddress,
            tokenIn: automation.tokenIn,
            tokenOut: automation.tokenOut,
            amount: automation.amount,
            type: "EXACT_INPUT",
            slippageTolerance: automation.slippageTolerance,
            chainId: automation.chainId,
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
              walletId: automation.walletId,
              walletType: automation.walletType as "server" | "agent",
              chainId: automation.chainId,
              to: swapTx.to as `0x${string}`,
              data: swapTx.data as `0x${string}`,
              value: BigInt(swapTx.value || "0"),
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
          const values: NewSwapAutomation = {
            userId: params.userId,
            walletId: params.walletId,
            walletType: params.walletType,
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amount: params.amount,
            slippageTolerance: params.slippageTolerance ?? 0.5,
            chainId,
            indicatorType: params.indicatorType,
            indicatorToken: params.indicatorToken,
            thresholdValue: params.thresholdValue,
            referencePrice,
            maxExecutions: params.maxExecutions ?? 1,
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
            if (params.amount !== undefined) updates.amount = params.amount;
            if (params.slippageTolerance !== undefined)
              updates.slippageTolerance = params.slippageTolerance;
            if (params.maxExecutions !== undefined)
              updates.maxExecutions = params.maxExecutions;
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
