import { Effect, Context, Layer, Data } from "effect";
import { eq, and, lte } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import {
  recurringPayments,
  recurringPaymentExecutions,
  type RecurringPayment,
  type NewRecurringPayment,
  type RecurringPaymentExecution,
  type NewRecurringPaymentExecution,
  type Transaction,
} from "../../db/schema/index.js";
import {
  TransactionService,
  type TransactionError,
} from "../transaction/transaction-service.js";
import { ConfigService } from "../../config.js";
import type { LedgerError } from "../ledger/ledger-service.js";
import { OfframpAdapterRegistry } from "../offramp/index.js";
import {
  PretiumService,
  SETTLEMENT_ADDRESS,
  type SupportedCountry,
  type FiatPaymentType,
} from "../pretium/pretium-service.js";
import { ExchangeRateService } from "../pretium/exchange-rate-service.js";
import { getFiatDisbursementFee } from "../pretium/fee-tiers.js";

// ── Error type ───────────────────────────────────────────────────────

export class RecurringPaymentError extends Data.TaggedError(
  "RecurringPaymentError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export interface OfframpDetails {
  readonly currency: string;
  readonly fiatAmount: string;
  readonly provider: string;
  readonly destinationId: string;
  readonly metadata?: Record<string, unknown>;
}

export interface CreateScheduleParams {
  readonly userId: string;
  readonly name?: string;
  readonly walletId: string;
  readonly walletType: "user" | "server" | "agent";
  readonly recipientAddress: string;
  readonly paymentType: "erc20_transfer" | "raw_transfer" | "contract_call" | "offramp";
  readonly amount: string;
  readonly tokenContractName?: string;
  readonly contractName?: string;
  readonly contractMethod?: string;
  readonly contractArgs?: unknown[];
  readonly chainId?: number;
  readonly frequency: string;
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly maxRetries?: number;
  readonly offramp?: OfframpDetails;
  readonly categoryId?: string;
  /** If true, execute the first payment immediately at startDate; otherwise first payment is at startDate + frequency */
  readonly executeImmediately?: boolean;
}

export interface UpdateScheduleParams {
  readonly name?: string;
  readonly categoryId?: string;
  readonly amount?: string;
  readonly recipientAddress?: string;
  readonly frequency?: string;
  readonly endDate?: Date | null;
  readonly maxRetries?: number;
}

// ── Service interface ────────────────────────────────────────────────

export interface RecurringPaymentServiceApi {
  readonly createSchedule: (
    params: CreateScheduleParams
  ) => Effect.Effect<RecurringPayment, RecurringPaymentError>;

  readonly getSchedule: (
    id: string
  ) => Effect.Effect<RecurringPayment | undefined, RecurringPaymentError>;

  readonly listSchedulesByUser: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<RecurringPayment>, RecurringPaymentError>;

  readonly listAllSchedules: (
    limit?: number,
    offset?: number
  ) => Effect.Effect<ReadonlyArray<RecurringPayment>, RecurringPaymentError>;

  readonly updateSchedule: (
    id: string,
    params: UpdateScheduleParams
  ) => Effect.Effect<RecurringPayment, RecurringPaymentError>;

  readonly pauseSchedule: (
    id: string
  ) => Effect.Effect<RecurringPayment, RecurringPaymentError>;

  readonly resumeSchedule: (
    id: string
  ) => Effect.Effect<RecurringPayment, RecurringPaymentError>;

  readonly cancelSchedule: (
    id: string
  ) => Effect.Effect<RecurringPayment, RecurringPaymentError>;

  readonly getExecutionHistory: (
    scheduleId: string,
    limit?: number
  ) => Effect.Effect<
    ReadonlyArray<RecurringPaymentExecution>,
    RecurringPaymentError
  >;

  readonly processDuePayments: () => Effect.Effect<
    ReadonlyArray<RecurringPaymentExecution>,
    RecurringPaymentError
  >;

  readonly executeSchedule: (
    id: string
  ) => Effect.Effect<RecurringPaymentExecution, RecurringPaymentError>;
}

export class RecurringPaymentService extends Context.Tag(
  "RecurringPaymentService"
)<RecurringPaymentService, RecurringPaymentServiceApi>() {}

// ── Helpers ──────────────────────────────────────────────────────────

function parseFrequencyToMs(frequency: string): number {
  const match = frequency.match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) return 86400000; // default 1 day
  const [, value, unit] = match;
  const num = parseInt(value!, 10);
  switch (unit) {
    case "s":
      return num * 1000;
    case "m":
      return num * 60 * 1000;
    case "h":
      return num * 60 * 60 * 1000;
    case "d":
      return num * 24 * 60 * 60 * 1000;
    case "w":
      return num * 7 * 24 * 60 * 60 * 1000;
    default:
      return 86400000;
  }
}

/**
 * Compute the next execution time anchored to startDate so recurring
 * payments always fire at the same time-of-day on the correct cycle.
 *
 * E.g. startDate = March 11 10:00, frequency = "7d"
 *   → March 18 10:00, March 25 10:00, April 1 10:00, …
 */
function computeNextExecution(startDate: Date, frequency: string): Date {
  const intervalMs = parseFrequencyToMs(frequency);
  const now = Date.now();
  const start = startDate.getTime();

  if (now < start) {
    return new Date(start);
  }

  const elapsed = now - start;
  const cyclesPassed = Math.floor(elapsed / intervalMs);
  return new Date(start + (cyclesPassed + 1) * intervalMs);
}

// ── Live implementation ──────────────────────────────────────────────

export const RecurringPaymentServiceLive: Layer.Layer<
  RecurringPaymentService,
  never,
  DatabaseService | TransactionService | ConfigService | OfframpAdapterRegistry | PretiumService | ExchangeRateService
> = Layer.effect(
  RecurringPaymentService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const txService = yield* TransactionService;
    const config = yield* ConfigService;
    const offrampRegistry = yield* OfframpAdapterRegistry;
    const pretium = yield* PretiumService;
    const exchangeRateService = yield* ExchangeRateService;

    // Execute a single schedule and record the execution
    const executeOne = (schedule: RecurringPayment) =>
      Effect.gen(function* () {
        let transactionId: string | undefined;
        let executionError: string | undefined;
        let feeAmount: string | undefined;
        let feeCurrency: string | undefined;

        // Attempt the payment
        const paymentResult = yield* Effect.gen(function* () {
          if (schedule.paymentType === "erc20_transfer") {
            // ERC-20 token transfer via contract
            const result = yield* txService.submitContractTransaction({
              walletId: schedule.walletId,
              walletType: schedule.walletType,
              contractName: schedule.tokenContractName!,
              chainId: schedule.chainId,
              method: "transfer",
              args: [schedule.recipientAddress, BigInt(schedule.amount)],
              userId: schedule.userId,
            });
            return result;
          } else if (schedule.paymentType === "raw_transfer") {
            // Raw ETH transfer
            const result = yield* txService.submitRawTransaction({
              walletId: schedule.walletId,
              walletType: schedule.walletType,
              chainId: schedule.chainId,
              to: schedule.recipientAddress as `0x${string}`,
              value: BigInt(schedule.amount),
              userId: schedule.userId,
            });
            return result;
          } else if (schedule.paymentType === "contract_call") {
            // contract_call
            const result = yield* txService.submitContractTransaction({
              walletId: schedule.walletId,
              walletType: schedule.walletType,
              contractName: schedule.contractName!,
              chainId: schedule.chainId,
              method: schedule.contractMethod!,
              args: schedule.contractArgs ?? [],
              value: BigInt(schedule.amount),
              userId: schedule.userId,
            });
            return result;
          } else {
            // Offramp execution: crypto-to-fiat via provider adapter
            const providerName = schedule.offrampProvider;
            if (!providerName) {
              return yield* Effect.fail(
                new RecurringPaymentError({
                  message: `Offramp schedule ${schedule.id} is missing offrampProvider`,
                })
              );
            }

            // ── Pretium offramp: send USDC then disburse fiat ──
            if (providerName === "pretium") {
              const meta = (schedule.offrampMetadata ?? {}) as Record<string, unknown>;
              const country = meta.country as string;
              const phoneNumber = meta.phoneNumber as string;
              const mobileNetwork = meta.mobileNetwork as string;

              if (!country || !phoneNumber || !mobileNetwork) {
                return yield* Effect.fail(
                  new RecurringPaymentError({
                    message: `Pretium offramp schedule ${schedule.id} is missing required metadata (country, phoneNumber, mobileNetwork)`,
                  })
                );
              }

              const countries = pretium.getSupportedCountries();
              const countryConfig = countries[country as SupportedCountry];
              if (!countryConfig) {
                return yield* Effect.fail(
                  new RecurringPaymentError({
                    message: `Country ${country} is not supported by Pretium`,
                  })
                );
              }

              // Determine if amount is denominated in fiat or USDC
              const isFiatDenominated = !!(meta.amountInFiat && schedule.offrampFiatAmount);

              let usdcAmount: number;
              let fiatAmount: number;

              if (isFiatDenominated) {
                // Amount is in local currency — convert fiat → USDC
                fiatAmount = parseFloat(schedule.offrampFiatAmount!);
                const conversion = yield* exchangeRateService
                  .convertFiatToUsdc(fiatAmount, countryConfig.currency)
                  .pipe(
                    Effect.catchAll((err) =>
                      Effect.fail(
                        new RecurringPaymentError({
                          message: `Exchange rate conversion failed: ${err}`,
                          cause: err,
                        })
                      )
                    )
                  );
                usdcAmount = conversion.amount;
              } else {
                // Amount is in USDC — convert USDC → fiat
                usdcAmount = parseFloat(schedule.amount);
                const conversion = yield* exchangeRateService
                  .convertUsdcToFiat(usdcAmount, countryConfig.currency)
                  .pipe(
                    Effect.catchAll((err) =>
                      Effect.fail(
                        new RecurringPaymentError({
                          message: `Exchange rate conversion failed: ${err}`,
                          cause: err,
                        })
                      )
                    )
                  );
                fiatAmount = conversion.amount;
              }

              // 1. Send USDC to Pretium settlement address
              const transferTx = yield* txService
                .submitContractTransaction({
                  walletId: schedule.walletId,
                  walletType: schedule.walletType,
                  contractName: schedule.tokenContractName || "usdc",
                  chainId: schedule.chainId,
                  method: "send",
                  args: [
                    SETTLEMENT_ADDRESS,
                    Math.floor(usdcAmount * 1e6),
                  ],
                  userId: schedule.userId,
                })
                .pipe(
                  Effect.catchAll((txErr) =>
                    Effect.fail(
                      new RecurringPaymentError({
                        message: `USDC transfer to Pretium settlement failed: ${txErr}`,
                        cause: txErr,
                      })
                    )
                  )
                );

              // 3. Call Pretium disburse with the on-chain tx hash
              const callbackUrl =
                (meta.callbackUrl as string) ||
                `${config.serverBaseUrl}/webhooks/pretium`;

              // Compute fee server-side from tiered schedule
              const fee = getFiatDisbursementFee(fiatAmount);
              feeAmount = String(fee);
              feeCurrency = countryConfig.currency;

              const disburseResult = yield* pretium
                .disburse({
                  country: country as SupportedCountry,
                  amount: fiatAmount,
                  phoneNumber,
                  mobileNetwork,
                  transactionHash: transferTx.txHash!,
                  callbackUrl,
                  fee,
                  paymentType: (meta.paymentType as FiatPaymentType) || undefined,
                  accountNumber: meta.accountNumber as string | undefined,
                  accountName: meta.accountName as string | undefined,
                  accountNumber_bank: meta.bankAccount as string | undefined,
                  bankCode: meta.bankCode as string | undefined,
                  bankName: meta.bankName as string | undefined,
                })
                .pipe(
                  Effect.catchAll((err) =>
                    Effect.fail(
                      new RecurringPaymentError({
                        message: `Pretium disburse failed for schedule ${schedule.id}: ${err.message}`,
                        cause: err,
                      })
                    )
                  )
                );

              // 4. Store disburse result in offrampMetadata
              yield* Effect.tryPromise({
                try: () =>
                  db
                    .update(recurringPayments)
                    .set({
                      offrampMetadata: {
                        ...meta,
                        lastTransactionCode:
                          disburseResult.data.transaction_code,
                        lastDisburseStatus: disburseResult.data.status,
                        onChainTxHash: transferTx.txHash,
                        onChainTxId: transferTx.id,
                      },
                      updatedAt: new Date(),
                    })
                    .where(eq(recurringPayments.id, schedule.id)),
                catch: (error) =>
                  new RecurringPaymentError({
                    message: `Failed to update Pretium offramp metadata: ${error}`,
                    cause: error,
                  }),
              });

              return transferTx;
            }

            // ── Generic offramp: other providers (Moonpay, Bridge, Transak) ──

            // 1. Resolve the adapter for this provider
            const adapter = yield* offrampRegistry.getAdapter(providerName).pipe(
              Effect.mapError(
                (e) =>
                  new RecurringPaymentError({
                    message: e.message,
                    cause: e,
                  })
              )
            );

            // 2. Initiate the offramp conversion
            const offrampOrder = yield* adapter
              .initiateOfframp({
                cryptoAmount: schedule.amount,
                fiatCurrency: schedule.offrampCurrency ?? "USD",
                fiatAmount: schedule.offrampFiatAmount ?? "0",
                sourceAddress: schedule.recipientAddress,
                chainId: schedule.chainId,
                destinationId: schedule.offrampDestinationId ?? "",
                metadata: schedule.offrampMetadata ?? undefined,
              })
              .pipe(
                Effect.mapError(
                  (e) =>
                    new RecurringPaymentError({
                      message: `Offramp initiation failed for schedule ${schedule.id}: ${e.message}`,
                      cause: e,
                    })
                )
              );

            // 3. If the provider returned a deposit address, send crypto there
            let onChainTx: Transaction | undefined;
            if (offrampOrder.depositAddress) {
              onChainTx = yield* txService
                .submitRawTransaction({
                  walletId: schedule.walletId,
                  walletType: schedule.walletType,
                  chainId: schedule.chainId,
                  to: offrampOrder.depositAddress as `0x${string}`,
                  value: BigInt(schedule.amount),
                  userId: schedule.userId,
                })
                .pipe(
                  Effect.catchAll((txErr) =>
                    Effect.fail(
                      new RecurringPaymentError({
                        message: `On-chain transfer to offramp deposit address failed: ${txErr}`,
                        cause: txErr,
                      })
                    )
                  )
                );
            }

            // 4. Store the provider order ID in offrampMetadata
            yield* Effect.tryPromise({
              try: () =>
                db
                  .update(recurringPayments)
                  .set({
                    offrampMetadata: {
                      ...(schedule.offrampMetadata ?? {}),
                      lastOrderId: offrampOrder.orderId,
                      lastOrderStatus: offrampOrder.status,
                      onChainTxId: onChainTx?.id ?? null,
                    },
                    updatedAt: new Date(),
                  })
                  .where(eq(recurringPayments.id, schedule.id)),
              catch: (error) =>
                new RecurringPaymentError({
                  message: `Failed to update offramp metadata: ${error}`,
                  cause: error,
                }),
            });

            // 5. Return a Transaction record (the on-chain tx, or a synthetic one)
            if (onChainTx) {
              return onChainTx;
            }

            // If no on-chain tx was needed (provider handles custody),
            // create a ledger record via a raw transaction with zero value
            // to track the offramp in the transaction log.
            const trackingTx = yield* txService
              .submitRawTransaction({
                walletId: schedule.walletId,
                walletType: schedule.walletType,
                chainId: schedule.chainId,
                to: (offrampOrder.depositAddress ??
                  schedule.recipientAddress) as `0x${string}`,
                value: BigInt(0),
                userId: schedule.userId,
              })
              .pipe(
                Effect.catchAll((txErr) =>
                  Effect.fail(
                    new RecurringPaymentError({
                      message: `Failed to create offramp tracking transaction: ${txErr}`,
                      cause: txErr,
                    })
                  )
                )
              );
            return trackingTx;
          }
        }).pipe(
          Effect.map((tx) => ({ success: true as const, tx })),
          Effect.catchAll((error) =>
            Effect.succeed({
              success: false as const,
              error: String(error),
            })
          )
        );

        if (paymentResult.success) {
          transactionId = paymentResult.tx.id;
        } else {
          executionError = paymentResult.error;
        }

        // Record execution
        const executionValues: NewRecurringPaymentExecution = {
          scheduleId: schedule.id,
          transactionId: transactionId ?? null,
          status: paymentResult.success ? "success" : "failed",
          error: executionError ?? null,
          feeAmount: feeAmount ?? null,
          feeCurrency: feeCurrency ?? null,
        };

        const [execution] = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(recurringPaymentExecutions)
              .values(executionValues)
              .returning(),
          catch: (error) =>
            new RecurringPaymentError({
              message: `Failed to record execution: ${error}`,
              cause: error,
            }),
        });

        // Update schedule state — anchor to startDate so time-of-day stays consistent
        const nextExecution = computeNextExecution(schedule.startDate, schedule.frequency);
        const newConsecutiveFailures = paymentResult.success
          ? 0
          : schedule.consecutiveFailures + 1;
        const newTotalExecutions = schedule.totalExecutions + 1;

        // Determine new status
        let newStatus = schedule.status;
        if (
          !paymentResult.success &&
          newConsecutiveFailures >= schedule.maxRetries
        ) {
          // Too many consecutive failures -- pause the schedule
          newStatus = "paused";
        }
        // Check if end date has passed
        if (schedule.endDate && nextExecution > schedule.endDate) {
          newStatus = "completed";
        }

        yield* Effect.tryPromise({
          try: () =>
            db
              .update(recurringPayments)
              .set({
                nextExecutionAt: nextExecution,
                consecutiveFailures: newConsecutiveFailures,
                totalExecutions: newTotalExecutions,
                status: newStatus,
                updatedAt: new Date(),
              })
              .where(eq(recurringPayments.id, schedule.id)),
          catch: (error) =>
            new RecurringPaymentError({
              message: `Failed to update schedule after execution: ${error}`,
              cause: error,
            }),
        });

        return execution!;
      });

    return {
      createSchedule: (params: CreateScheduleParams) =>
        Effect.tryPromise({
          try: async () => {
            const chainId = params.chainId ?? config.defaultChainId;
            const startDate = params.startDate ?? new Date();
            const nextExecutionAt = params.executeImmediately
              ? startDate
              : computeNextExecution(startDate, params.frequency);

            const values: NewRecurringPayment = {
              userId: params.userId,
              name: params.name ?? null,
              walletId: params.walletId,
              walletType: params.walletType,
              recipientAddress: params.recipientAddress,
              paymentType: params.paymentType,
              amount: params.amount,
              tokenContractName: params.tokenContractName ?? null,
              contractName: params.contractName ?? null,
              contractMethod: params.contractMethod ?? null,
              contractArgs: params.contractArgs ?? null,
              chainId,
              frequency: params.frequency,
              startDate,
              endDate: params.endDate ?? null,
              nextExecutionAt,
              maxRetries: params.maxRetries ?? 3,
              // Offramp fields
              isOfframp: params.paymentType === "offramp",
              offrampCurrency: params.offramp?.currency ?? null,
              offrampFiatAmount: params.offramp?.fiatAmount ?? null,
              offrampProvider: params.offramp?.provider ?? null,
              offrampDestinationId: params.offramp?.destinationId ?? null,
              offrampMetadata: params.offramp?.metadata ?? null,
              categoryId: params.categoryId ?? null,
            };

            const [result] = await db
              .insert(recurringPayments)
              .values(values)
              .returning();
            return result!;
          },
          catch: (error) =>
            new RecurringPaymentError({
              message: `Failed to create recurring payment schedule: ${error}`,
              cause: error,
            }),
        }),

      getSchedule: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .select()
              .from(recurringPayments)
              .where(eq(recurringPayments.id, id));
            return result;
          },
          catch: (error) =>
            new RecurringPaymentError({
              message: `Failed to get schedule: ${error}`,
              cause: error,
            }),
        }),

      listSchedulesByUser: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(recurringPayments)
              .where(eq(recurringPayments.userId, userId))
              .orderBy(recurringPayments.createdAt);
            return results;
          },
          catch: (error) =>
            new RecurringPaymentError({
              message: `Failed to list schedules by user: ${error}`,
              cause: error,
            }),
        }),

      listAllSchedules: (limit = 50, offset = 0) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(recurringPayments)
              .orderBy(recurringPayments.createdAt)
              .limit(limit)
              .offset(offset);
            return results;
          },
          catch: (error) =>
            new RecurringPaymentError({
              message: `Failed to list all schedules: ${error}`,
              cause: error,
            }),
        }),

      updateSchedule: (id: string, params: UpdateScheduleParams) =>
        Effect.tryPromise({
          try: async () => {
            const updates: Record<string, unknown> = {
              updatedAt: new Date(),
            };
            if (params.name !== undefined) updates.name = params.name;
            if (params.categoryId !== undefined) updates.categoryId = params.categoryId;
            if (params.amount !== undefined) updates.amount = params.amount;
            if (params.recipientAddress !== undefined)
              updates.recipientAddress = params.recipientAddress;
            if (params.frequency !== undefined) {
              updates.frequency = params.frequency;
              // Fetch current schedule to anchor next execution to startDate
              const [current] = await db
                .select()
                .from(recurringPayments)
                .where(eq(recurringPayments.id, id));
              if (current) {
                updates.nextExecutionAt = computeNextExecution(current.startDate, params.frequency);
              }
            }
            if (params.endDate !== undefined) updates.endDate = params.endDate;
            if (params.maxRetries !== undefined)
              updates.maxRetries = params.maxRetries;

            const [result] = await db
              .update(recurringPayments)
              .set(updates)
              .where(eq(recurringPayments.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new RecurringPaymentError({
              message: `Failed to update schedule: ${error}`,
              cause: error,
            }),
        }),

      pauseSchedule: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(recurringPayments)
              .set({ status: "paused", updatedAt: new Date() })
              .where(eq(recurringPayments.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new RecurringPaymentError({
              message: `Failed to pause schedule: ${error}`,
              cause: error,
            }),
        }),

      resumeSchedule: (id: string) =>
        Effect.gen(function* () {
          // When resuming, recalculate next execution and reset consecutive failures
          const schedule = yield* Effect.tryPromise({
            try: async () => {
              const [result] = await db
                .select()
                .from(recurringPayments)
                .where(eq(recurringPayments.id, id));
              return result;
            },
            catch: (error) =>
              new RecurringPaymentError({
                message: `Failed to find schedule: ${error}`,
                cause: error,
              }),
          });

          if (!schedule) {
            return yield* Effect.fail(
              new RecurringPaymentError({
                message: `Schedule not found: ${id}`,
              })
            );
          }

          const nextExecution = computeNextExecution(schedule.startDate, schedule.frequency);

          const [result] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(recurringPayments)
                .set({
                  status: "active",
                  consecutiveFailures: 0,
                  nextExecutionAt: nextExecution,
                  updatedAt: new Date(),
                })
                .where(eq(recurringPayments.id, id))
                .returning(),
            catch: (error) =>
              new RecurringPaymentError({
                message: `Failed to resume schedule: ${error}`,
                cause: error,
              }),
          });

          return result!;
        }),

      cancelSchedule: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(recurringPayments)
              .set({ status: "cancelled", updatedAt: new Date() })
              .where(eq(recurringPayments.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new RecurringPaymentError({
              message: `Failed to cancel schedule: ${error}`,
              cause: error,
            }),
        }),

      getExecutionHistory: (scheduleId: string, limit = 50) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(recurringPaymentExecutions)
              .where(eq(recurringPaymentExecutions.scheduleId, scheduleId))
              .orderBy(recurringPaymentExecutions.executedAt)
              .limit(limit);
            return results;
          },
          catch: (error) =>
            new RecurringPaymentError({
              message: `Failed to get execution history: ${error}`,
              cause: error,
            }),
        }),

      processDuePayments: () =>
        Effect.gen(function* () {
          const dueSchedules = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(recurringPayments)
                .where(
                  and(
                    eq(recurringPayments.status, "active"),
                    lte(recurringPayments.nextExecutionAt, new Date())
                  )
                ),
            catch: (error) =>
              new RecurringPaymentError({
                message: `Failed to fetch due schedules: ${error}`,
                cause: error,
              }),
          });

          const executions: RecurringPaymentExecution[] = [];

          for (const schedule of dueSchedules) {
            const execution = yield* executeOne(schedule);
            executions.push(execution);
          }

          return executions;
        }),

      executeSchedule: (id: string) =>
        Effect.gen(function* () {
          const schedule = yield* Effect.tryPromise({
            try: async () => {
              const [result] = await db
                .select()
                .from(recurringPayments)
                .where(eq(recurringPayments.id, id));
              return result;
            },
            catch: (error) =>
              new RecurringPaymentError({
                message: `Failed to find schedule for execution: ${error}`,
                cause: error,
              }),
          });

          if (!schedule) {
            return yield* Effect.fail(
              new RecurringPaymentError({
                message: `Schedule not found: ${id}`,
              })
            );
          }

          return yield* executeOne(schedule);
        }),
    };
  })
);
