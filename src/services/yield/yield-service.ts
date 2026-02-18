import { Effect, Context, Layer, Data } from "effect";
import { eq, and, desc } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import {
  yieldVaults,
  yieldPositions,
  yieldSnapshots,
  type YieldVault,
  type NewYieldVault,
  type YieldPosition,
  type NewYieldPosition,
  type YieldSnapshot,
  type NewYieldSnapshot,
} from "../../db/schema/index.js";
import {
  TransactionService,
} from "../transaction/transaction-service.js";
import {
  ContractExecutor,
} from "../contract/contract-executor.js";
import { ConfigService } from "../../config.js";

// ── Error type ───────────────────────────────────────────────────────

export class YieldError extends Data.TaggedError("YieldError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export interface AddVaultParams {
  readonly vaultAddress: string;
  readonly chainId: number;
  readonly name: string;
  readonly description?: string;
  readonly underlyingToken?: string;
  readonly underlyingSymbol?: string;
  readonly underlyingDecimals?: number;
}

export interface CreatePositionParams {
  readonly userId: string;
  readonly walletId: string;
  readonly walletType: "user" | "server" | "agent";
  readonly vaultId: string;
  readonly amount: string;
  readonly unlockTime: number;
  readonly label?: string;
  readonly chainId?: number;
}

export interface PortfolioSummary {
  readonly totalPrincipal: string;
  readonly totalCurrentValue: string;
  readonly totalYield: string;
  readonly averageApy: string;
  readonly positionCount: number;
}

// ── Service interface ────────────────────────────────────────────────

export interface YieldServiceApi {
  // ── Vault management (admin) ──────────────────────────────────────
  readonly listVaults: (
    chainId?: number,
    includeInactive?: boolean
  ) => Effect.Effect<ReadonlyArray<YieldVault>, YieldError>;

  readonly getVault: (
    id: string
  ) => Effect.Effect<YieldVault | undefined, YieldError>;

  readonly addVault: (
    params: AddVaultParams
  ) => Effect.Effect<YieldVault, YieldError>;

  readonly removeVault: (
    id: string
  ) => Effect.Effect<YieldVault, YieldError>;

  readonly syncVaultsFromChain: (
    chainId: number
  ) => Effect.Effect<ReadonlyArray<YieldVault>, YieldError>;

  // ── Position management (user) ────────────────────────────────────
  readonly createPosition: (
    params: CreatePositionParams
  ) => Effect.Effect<YieldPosition, YieldError>;

  readonly getUserPositions: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<YieldPosition>, YieldError>;

  readonly getPosition: (
    id: string
  ) => Effect.Effect<YieldPosition | undefined, YieldError>;

  readonly withdrawPosition: (
    positionId: string,
    walletId: string,
    walletType: "user" | "server" | "agent"
  ) => Effect.Effect<YieldPosition, YieldError>;

  readonly syncPositionFromChain: (
    positionId: string
  ) => Effect.Effect<YieldPosition, YieldError>;

  // ── Yield tracking ────────────────────────────────────────────────
  readonly snapshotYield: (
    positionId: string
  ) => Effect.Effect<YieldSnapshot, YieldError>;

  readonly snapshotAllActivePositions: () => Effect.Effect<
    ReadonlyArray<YieldSnapshot>,
    YieldError
  >;

  readonly getYieldHistory: (
    positionId: string,
    limit?: number
  ) => Effect.Effect<ReadonlyArray<YieldSnapshot>, YieldError>;

  readonly getPortfolioSummary: (
    userId: string
  ) => Effect.Effect<PortfolioSummary, YieldError>;

  // ── Admin queries ─────────────────────────────────────────────────
  readonly listAllPositions: (
    limit?: number,
    offset?: number
  ) => Effect.Effect<ReadonlyArray<YieldPosition>, YieldError>;
}

export class YieldService extends Context.Tag("YieldService")<
  YieldService,
  YieldServiceApi
>() {}

// ── Live implementation ──────────────────────────────────────────────

export const YieldServiceLive: Layer.Layer<
  YieldService,
  never,
  DatabaseService | TransactionService | ContractExecutor | ConfigService
> = Layer.effect(
  YieldService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const txService = yield* TransactionService;
    const executor = yield* ContractExecutor;
    const config = yield* ConfigService;

    const CONTRACT_NAME = "yield-timelock";

    return {
      // ── Vault management ────────────────────────────────────────────

      listVaults: (chainId?: number, includeInactive = false) =>
        Effect.tryPromise({
          try: async () => {
            let query = db.select().from(yieldVaults);
            if (chainId !== undefined && !includeInactive) {
              const results = await query.where(
                and(
                  eq(yieldVaults.chainId, chainId),
                  eq(yieldVaults.isActive, true)
                )
              );
              return results;
            }
            if (chainId !== undefined) {
              const results = await query.where(
                eq(yieldVaults.chainId, chainId)
              );
              return results;
            }
            if (!includeInactive) {
              const results = await query.where(
                eq(yieldVaults.isActive, true)
              );
              return results;
            }
            const results = await query.orderBy(yieldVaults.createdAt);
            return results;
          },
          catch: (error) =>
            new YieldError({
              message: `Failed to list vaults: ${error}`,
              cause: error,
            }),
        }),

      getVault: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .select()
              .from(yieldVaults)
              .where(eq(yieldVaults.id, id));
            return result;
          },
          catch: (error) =>
            new YieldError({
              message: `Failed to get vault: ${error}`,
              cause: error,
            }),
        }),

      addVault: (params: AddVaultParams) =>
        Effect.tryPromise({
          try: async () => {
            const values: NewYieldVault = {
              vaultAddress: params.vaultAddress,
              chainId: params.chainId,
              name: params.name,
              description: params.description ?? null,
              underlyingToken: params.underlyingToken ?? null,
              underlyingSymbol: params.underlyingSymbol ?? null,
              underlyingDecimals: params.underlyingDecimals ?? null,
            };
            const [result] = await db
              .insert(yieldVaults)
              .values(values)
              .returning();
            return result!;
          },
          catch: (error) =>
            new YieldError({
              message: `Failed to add vault: ${error}`,
              cause: error,
            }),
        }),

      removeVault: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(yieldVaults)
              .set({ isActive: false, updatedAt: new Date() })
              .where(eq(yieldVaults.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new YieldError({
              message: `Failed to remove vault: ${error}`,
              cause: error,
            }),
        }),

      syncVaultsFromChain: (chainId: number) =>
        Effect.gen(function* () {
          // Read the on-chain vault list
          const vaultAddresses = yield* executor
            .readContract(CONTRACT_NAME, chainId, "vaults", [])
            .pipe(
              Effect.mapError(
                (e) =>
                  new YieldError({
                    message: `Failed to read vault list from chain: ${e}`,
                    cause: e,
                  })
              )
            ) as Effect.Effect<readonly string[], YieldError>;

          // Get existing DB vaults for this chain
          const existing = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(yieldVaults)
                .where(eq(yieldVaults.chainId, chainId)),
            catch: (error) =>
              new YieldError({
                message: `Failed to query existing vaults: ${error}`,
                cause: error,
              }),
          });

          const existingAddresses = new Set(
            existing.map((v) => v.vaultAddress.toLowerCase())
          );

          const newVaults: YieldVault[] = [];

          for (const addr of vaultAddresses) {
            if (!existingAddresses.has(addr.toLowerCase())) {
              const [vault] = yield* Effect.tryPromise({
                try: () =>
                  db
                    .insert(yieldVaults)
                    .values({
                      vaultAddress: addr,
                      chainId,
                      name: `Vault ${addr.slice(0, 8)}...`,
                    })
                    .returning(),
                catch: (error) =>
                  new YieldError({
                    message: `Failed to insert vault ${addr}: ${error}`,
                    cause: error,
                  }),
              });
              newVaults.push(vault!);
            }
          }

          // Return all vaults for this chain
          const allVaults = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(yieldVaults)
                .where(eq(yieldVaults.chainId, chainId)),
            catch: (error) =>
              new YieldError({
                message: `Failed to list vaults after sync: ${error}`,
                cause: error,
              }),
          });

          return allVaults;
        }),

      // ── Position management ─────────────────────────────────────────

      createPosition: (params: CreatePositionParams) =>
        Effect.gen(function* () {
          const chainId = params.chainId ?? config.defaultChainId;

          // Look up the vault to get the on-chain address
          const [vault] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(yieldVaults)
                .where(eq(yieldVaults.id, params.vaultId)),
            catch: (error) =>
              new YieldError({
                message: `Failed to look up vault: ${error}`,
                cause: error,
              }),
          });

          if (!vault) {
            return yield* Effect.fail(
              new YieldError({ message: `Vault not found: ${params.vaultId}` })
            );
          }

          if (!vault.isActive) {
            return yield* Effect.fail(
              new YieldError({
                message: `Vault is not active: ${params.vaultId}`,
              })
            );
          }

          // Submit the lockWithYield transaction via the contract
          const tx = yield* txService
            .submitContractTransaction({
              walletId: params.walletId,
              walletType: params.walletType,
              contractName: CONTRACT_NAME,
              chainId,
              method: "lock",
              args: [
                vault.vaultAddress,
                BigInt(params.amount),
                BigInt(params.unlockTime),
                params.label ?? "",
              ],
              userId: params.userId,
            })
            .pipe(
              Effect.mapError(
                (e) =>
                  new YieldError({
                    message: `Failed to submit lock transaction: ${e}`,
                    cause: e,
                  })
              )
            );

          // For now, use a placeholder lock ID derived from the tx hash.
          // In production, we would parse the transaction receipt for the
          // YieldLockCreated event to get the actual lockId.
          const onChainLockId = tx.txHash ?? "pending";

          // Record the position in the database
          const values: NewYieldPosition = {
            userId: params.userId,
            walletId: params.walletId,
            vaultId: params.vaultId,
            onChainLockId,
            principalAmount: params.amount,
            shares: "0", // updated after chain confirmation
            unlockTime: new Date(params.unlockTime * 1000),
            label: params.label ?? null,
            transactionId: tx.id,
            chainId,
          };

          const [position] = yield* Effect.tryPromise({
            try: () =>
              db.insert(yieldPositions).values(values).returning(),
            catch: (error) =>
              new YieldError({
                message: `Failed to record position: ${error}`,
                cause: error,
              }),
          });

          return position!;
        }),

      getUserPositions: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(yieldPositions)
              .where(eq(yieldPositions.userId, userId))
              .orderBy(desc(yieldPositions.createdAt));
            return results;
          },
          catch: (error) =>
            new YieldError({
              message: `Failed to list user positions: ${error}`,
              cause: error,
            }),
        }),

      getPosition: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .select()
              .from(yieldPositions)
              .where(eq(yieldPositions.id, id));
            return result;
          },
          catch: (error) =>
            new YieldError({
              message: `Failed to get position: ${error}`,
              cause: error,
            }),
        }),

      withdrawPosition: (
        positionId: string,
        walletId: string,
        walletType: "user" | "server" | "agent"
      ) =>
        Effect.gen(function* () {
          const [position] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(yieldPositions)
                .where(eq(yieldPositions.id, positionId)),
            catch: (error) =>
              new YieldError({
                message: `Failed to find position: ${error}`,
                cause: error,
              }),
          });

          if (!position) {
            return yield* Effect.fail(
              new YieldError({ message: `Position not found: ${positionId}` })
            );
          }

          if (position.status !== "active" && position.status !== "matured") {
            return yield* Effect.fail(
              new YieldError({
                message: `Position cannot be withdrawn (status: ${position.status})`,
              })
            );
          }

          // Submit the withdraw transaction
          yield* txService
            .submitContractTransaction({
              walletId,
              walletType,
              contractName: CONTRACT_NAME,
              chainId: position.chainId,
              method: "withdraw",
              args: [BigInt(position.onChainLockId)],
              userId: position.userId,
            })
            .pipe(
              Effect.mapError(
                (e) =>
                  new YieldError({
                    message: `Failed to submit withdraw transaction: ${e}`,
                    cause: e,
                  })
              )
            );

          // Update position status
          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(yieldPositions)
                .set({ status: "withdrawn", updatedAt: new Date() })
                .where(eq(yieldPositions.id, positionId))
                .returning(),
            catch: (error) =>
              new YieldError({
                message: `Failed to update position status: ${error}`,
                cause: error,
              }),
          });

          return updated!;
        }),

      syncPositionFromChain: (positionId: string) =>
        Effect.gen(function* () {
          const [position] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(yieldPositions)
                .where(eq(yieldPositions.id, positionId)),
            catch: (error) =>
              new YieldError({
                message: `Failed to find position: ${error}`,
                cause: error,
              }),
          });

          if (!position) {
            return yield* Effect.fail(
              new YieldError({ message: `Position not found: ${positionId}` })
            );
          }

          // Read on-chain lock data
          const lockData = yield* executor
            .readContract(
              CONTRACT_NAME,
              position.chainId,
              "getLock",
              [BigInt(position.onChainLockId)]
            )
            .pipe(
              Effect.mapError(
                (e) =>
                  new YieldError({
                    message: `Failed to read lock from chain: ${e}`,
                    cause: e,
                  })
              )
            ) as Effect.Effect<
            {
              shares: bigint;
              principalAssets: bigint;
              withdrawn: boolean;
              isEmergencyWithdrawn: boolean;
            },
            YieldError
          >;

          // Determine status from on-chain data
          let newStatus = position.status;
          if (lockData.withdrawn) {
            newStatus = "withdrawn";
          } else if (lockData.isEmergencyWithdrawn) {
            newStatus = "emergency";
          } else {
            // Check if matured
            const isUnlocked = yield* executor
              .readContract(
                CONTRACT_NAME,
                position.chainId,
                "isUnlocked",
                [BigInt(position.onChainLockId)]
              )
              .pipe(
                Effect.mapError(
                  (e) =>
                    new YieldError({
                      message: `Failed to check unlock status: ${e}`,
                      cause: e,
                    })
                )
              ) as Effect.Effect<boolean, YieldError>;

            if (isUnlocked) {
              newStatus = "matured";
            }
          }

          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(yieldPositions)
                .set({
                  shares: String(lockData.shares),
                  principalAmount: String(lockData.principalAssets),
                  status: newStatus,
                  updatedAt: new Date(),
                })
                .where(eq(yieldPositions.id, positionId))
                .returning(),
            catch: (error) =>
              new YieldError({
                message: `Failed to update position from chain: ${error}`,
                cause: error,
              }),
          });

          return updated!;
        }),

      // ── Yield tracking ──────────────────────────────────────────────

      snapshotYield: (positionId: string) =>
        Effect.gen(function* () {
          const [position] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(yieldPositions)
                .where(eq(yieldPositions.id, positionId)),
            catch: (error) =>
              new YieldError({
                message: `Failed to find position for snapshot: ${error}`,
                cause: error,
              }),
          });

          if (!position) {
            return yield* Effect.fail(
              new YieldError({ message: `Position not found: ${positionId}` })
            );
          }

          // Read accrued yield from chain
          const yieldData = yield* executor
            .readContract(
              CONTRACT_NAME,
              position.chainId,
              "yield",
              [BigInt(position.onChainLockId)]
            )
            .pipe(
              Effect.mapError(
                (e) =>
                  new YieldError({
                    message: `Failed to read yield from chain: ${e}`,
                    cause: e,
                  })
              )
            ) as Effect.Effect<[bigint, bigint], YieldError>;

          const [accruedYield, currentAssets] = yieldData;

          // Calculate APY:
          // ((currentAssets - principalAssets) / principalAssets) * (365 days / elapsed days) * 100
          const principal = BigInt(position.principalAmount);
          let estimatedApy = "0";

          if (principal > 0n) {
            const elapsedMs =
              Date.now() - new Date(position.createdAt).getTime();
            const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

            if (elapsedDays > 0) {
              const yieldAmount = currentAssets - principal;
              const yieldRate =
                Number(yieldAmount) / Number(principal);
              const annualizedRate =
                yieldRate * (365 / elapsedDays) * 100;
              estimatedApy = annualizedRate.toFixed(4);
            }
          }

          const snapshotValues: NewYieldSnapshot = {
            positionId,
            currentAssets: String(currentAssets),
            accruedYield: String(accruedYield),
            estimatedApy,
          };

          const [snapshot] = yield* Effect.tryPromise({
            try: () =>
              db
                .insert(yieldSnapshots)
                .values(snapshotValues)
                .returning(),
            catch: (error) =>
              new YieldError({
                message: `Failed to store yield snapshot: ${error}`,
                cause: error,
              }),
          });

          return snapshot!;
        }),

      snapshotAllActivePositions: () =>
        Effect.gen(function* () {
          const activePositions = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(yieldPositions)
                .where(eq(yieldPositions.status, "active")),
            catch: (error) =>
              new YieldError({
                message: `Failed to list active positions: ${error}`,
                cause: error,
              }),
          });

          const snapshots: YieldSnapshot[] = [];

          for (const position of activePositions) {
            // Snapshot each position individually, catching errors so one
            // failure does not block others
            const snapshotResult = yield* Effect.gen(function* () {
              // Read accrued yield from chain
              const yieldData = yield* executor
                .readContract(
                  CONTRACT_NAME,
                  position.chainId,
                  "yield",
                  [BigInt(position.onChainLockId)]
                )
                .pipe(
                  Effect.mapError(
                    (e) =>
                      new YieldError({
                        message: `Failed to read yield for position ${position.id}: ${e}`,
                        cause: e,
                      })
                  )
                ) as Effect.Effect<[bigint, bigint], YieldError>;

              const [accruedYield, currentAssets] = yieldData;

              const principal = BigInt(position.principalAmount);
              let estimatedApy = "0";

              if (principal > 0n) {
                const elapsedMs =
                  Date.now() - new Date(position.createdAt).getTime();
                const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

                if (elapsedDays > 0) {
                  const yieldAmount = currentAssets - principal;
                  const yieldRate =
                    Number(yieldAmount) / Number(principal);
                  const annualizedRate =
                    yieldRate * (365 / elapsedDays) * 100;
                  estimatedApy = annualizedRate.toFixed(4);
                }
              }

              const [snapshot] = yield* Effect.tryPromise({
                try: () =>
                  db
                    .insert(yieldSnapshots)
                    .values({
                      positionId: position.id,
                      currentAssets: String(currentAssets),
                      accruedYield: String(accruedYield),
                      estimatedApy,
                    })
                    .returning(),
                catch: (error) =>
                  new YieldError({
                    message: `Failed to store snapshot for position ${position.id}: ${error}`,
                    cause: error,
                  }),
              });

              return snapshot!;
            }).pipe(
              Effect.map((s) => ({ success: true as const, snapshot: s })),
              Effect.catchAll(() =>
                Effect.succeed({ success: false as const, snapshot: null })
              )
            );

            if (snapshotResult.success && snapshotResult.snapshot) {
              snapshots.push(snapshotResult.snapshot);
            }
          }

          return snapshots;
        }),

      getYieldHistory: (positionId: string, limit = 50) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(yieldSnapshots)
              .where(eq(yieldSnapshots.positionId, positionId))
              .orderBy(desc(yieldSnapshots.snapshotAt))
              .limit(limit);
            return results;
          },
          catch: (error) =>
            new YieldError({
              message: `Failed to get yield history: ${error}`,
              cause: error,
            }),
        }),

      getPortfolioSummary: (userId: string) =>
        Effect.gen(function* () {
          const positions = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(yieldPositions)
                .where(eq(yieldPositions.userId, userId)),
            catch: (error) =>
              new YieldError({
                message: `Failed to list positions for portfolio: ${error}`,
                cause: error,
              }),
          });

          let totalPrincipal = 0n;
          let totalCurrentValue = 0n;
          let totalYield = 0n;
          let apySum = 0;
          let apyCount = 0;

          for (const position of positions) {
            totalPrincipal += BigInt(position.principalAmount);

            // Get latest snapshot for current value
            const [latestSnapshot] = yield* Effect.tryPromise({
              try: () =>
                db
                  .select()
                  .from(yieldSnapshots)
                  .where(eq(yieldSnapshots.positionId, position.id))
                  .orderBy(desc(yieldSnapshots.snapshotAt))
                  .limit(1),
              catch: (error) =>
                new YieldError({
                  message: `Failed to get latest snapshot: ${error}`,
                  cause: error,
                }),
            });

            if (latestSnapshot) {
              totalCurrentValue += BigInt(latestSnapshot.currentAssets);
              totalYield += BigInt(latestSnapshot.accruedYield);
              if (latestSnapshot.estimatedApy) {
                apySum += parseFloat(latestSnapshot.estimatedApy);
                apyCount++;
              }
            } else {
              // No snapshot yet, use principal as current value
              totalCurrentValue += BigInt(position.principalAmount);
            }
          }

          const averageApy =
            apyCount > 0 ? (apySum / apyCount).toFixed(4) : "0";

          return {
            totalPrincipal: String(totalPrincipal),
            totalCurrentValue: String(totalCurrentValue),
            totalYield: String(totalYield),
            averageApy,
            positionCount: positions.length,
          } satisfies PortfolioSummary;
        }),

      // ── Admin queries ───────────────────────────────────────────────

      listAllPositions: (limit = 50, offset = 0) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(yieldPositions)
              .orderBy(desc(yieldPositions.createdAt))
              .limit(limit)
              .offset(offset);
            return results;
          },
          catch: (error) =>
            new YieldError({
              message: `Failed to list all positions: ${error}`,
              cause: error,
            }),
        }),
    };
  })
);
