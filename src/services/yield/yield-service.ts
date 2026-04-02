import { Effect, Context, Layer, Data } from "effect";
import { eq, and, desc, inArray, notInArray, isNotNull } from "drizzle-orm";
import {
  createPublicClient,
  http,
  decodeEventLog,
  type Hash,
  type Chain,
} from "viem";
import { mainnet, base, polygon, arbitrum, optimism } from "viem/chains";
import { createBasePublicClient } from "../chain/public-client.js";
import { DatabaseService } from "../../db/client.js";
import {
  yieldVaults,
  yieldPositions,
  yieldSnapshots,
  goalSavingsDeposits,
  wallets,
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
import {
  ContractRegistry,
} from "../contract/contract-registry.js";
import { WalletService } from "../wallet/wallet-service.js";
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
  readonly withdrawnCount: number;
}

export interface AccruedYieldInfo {
  readonly positionId: string;
  readonly principalAmount: string;
  readonly currentAssets: string;
  readonly accruedYield: string;
  readonly estimatedApy: string;
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
    userId: string,
    type?: "goal" | "lock"
  ) => Effect.Effect<ReadonlyArray<YieldPosition>, YieldError>;

  readonly getPosition: (
    id: string
  ) => Effect.Effect<YieldPosition | undefined, YieldError>;

  readonly withdrawPosition: (
    positionId: string
  ) => Effect.Effect<YieldPosition, YieldError>;

  readonly batchWithdrawPositions: (
    positionIds: string[]
  ) => Effect.Effect<ReadonlyArray<YieldPosition>, YieldError>;

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

  readonly getAccruedYield: (
    positionId: string
  ) => Effect.Effect<AccruedYieldInfo, YieldError>;

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
  DatabaseService | TransactionService | ContractExecutor | ContractRegistry | WalletService | ConfigService
> = Layer.effect(
  YieldService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const txService = yield* TransactionService;
    const executor = yield* ContractExecutor;
    const registry = yield* ContractRegistry;
    const walletService = yield* WalletService;
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

          // Approve the YieldTimeLock contract to spend the underlying token
          const tokenContractName = (vault.underlyingSymbol ?? "usdc").toLowerCase();
          const timelockConnector = yield* registry
            .get(CONTRACT_NAME, chainId)
            .pipe(
              Effect.mapError(
                (e) =>
                  new YieldError({
                    message: `Failed to resolve timelock contract address: ${e}`,
                    cause: e,
                  })
              )
            );

          // params.amount is human-readable (e.g. "5" for 5 USDC)
          // Convert to raw units using the vault's underlying token decimals
          const tokenDecimals = vault.underlyingDecimals ?? 6;
          const rawAmount = Math.floor(Number(params.amount) * Math.pow(10, tokenDecimals));

          yield* txService
            .submitContractTransaction({
              walletId: params.walletId,
              walletType: params.walletType,
              contractName: tokenContractName,
              chainId,
              method: "approve",
              args: [timelockConnector.address, rawAmount],
              userId: params.userId,
            })
            .pipe(
              Effect.mapError(
                (e) =>
                  new YieldError({
                    message: `Failed to approve token spend: ${e}`,
                    cause: e,
                  })
              )
            );

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
                rawAmount,
                Number(params.unlockTime),
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

          // Parse the transaction receipt to extract the actual lockId
          // from the YieldLockCreated event
          let onChainLockId = tx.txHash ?? "pending";

          if (tx.txHash) {
            const isBase = chainId === 8453 || chainId === 84532;
            const publicClient = isBase
              ? createBasePublicClient(config.baseRpcUrl || undefined, chainId)
              : createPublicClient({
                  chain: ({ 1: mainnet, 137: polygon, 42161: arbitrum, 10: optimism } as Record<number, Chain>)[chainId] ?? base,
                  transport: http(),
                });

            const receipt = yield* Effect.tryPromise({
              try: () => publicClient.getTransactionReceipt({ hash: tx.txHash as Hash }),
              catch: () => new YieldError({ message: "Failed to fetch transaction receipt" }),
            });

            const timelockConnectorAddr = timelockConnector.address.toLowerCase();
            const yieldLockCreatedAbi = [{
              type: "event" as const,
              name: "YieldLockCreated",
              inputs: [
                { name: "lockId", type: "uint256", indexed: true },
                { name: "depositor", type: "address", indexed: true },
                { name: "vault", type: "address", indexed: true },
                { name: "underlyingToken", type: "address", indexed: false },
                { name: "principalAssets", type: "uint256", indexed: false },
                { name: "shares", type: "uint256", indexed: false },
                { name: "unlockTime", type: "uint256", indexed: false },
                { name: "label", type: "string", indexed: false },
              ],
            }];

            for (const log of receipt.logs) {
              if (log.address.toLowerCase() === timelockConnectorAddr) {
                try {
                  const decoded = decodeEventLog({
                    abi: yieldLockCreatedAbi,
                    data: log.data,
                    topics: log.topics,
                  });
                  if (decoded.eventName === "YieldLockCreated") {
                    onChainLockId = String((decoded.args as { lockId: bigint }).lockId);
                    break;
                  }
                } catch {
                  // Not the event we're looking for, continue
                }
              }
            }
          }

          // Record the position in the database
          const values: NewYieldPosition = {
            userId: params.userId,
            walletId: params.walletId,
            vaultId: params.vaultId,
            onChainLockId,
            principalAmount: String(rawAmount),
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

      getUserPositions: (userId: string, type?: "goal" | "lock") =>
        Effect.tryPromise({
          try: async () => {
            if (type) {
              // Get all position IDs linked to goals for this user
              // Filter out null yieldPositionIds to avoid SQL NOT IN (…, NULL)
              // returning no rows due to SQL ternary logic
              const goalPositionIds = db
                .select({ id: goalSavingsDeposits.yieldPositionId })
                .from(goalSavingsDeposits)
                .where(isNotNull(goalSavingsDeposits.yieldPositionId));

              if (type === "goal") {
                return db
                  .select()
                  .from(yieldPositions)
                  .where(
                    and(
                      eq(yieldPositions.userId, userId),
                      inArray(yieldPositions.id, goalPositionIds),
                      inArray(yieldPositions.status, ["active", "matured"])
                    )
                  )
                  .orderBy(desc(yieldPositions.createdAt));
              } else {
                return db
                  .select()
                  .from(yieldPositions)
                  .where(
                    and(
                      eq(yieldPositions.userId, userId),
                      notInArray(yieldPositions.id, goalPositionIds),
                      inArray(yieldPositions.status, ["active", "matured"])
                    )
                  )
                  .orderBy(desc(yieldPositions.createdAt));
              }
            }

            return db
              .select()
              .from(yieldPositions)
              .where(
                and(
                  eq(yieldPositions.userId, userId),
                  inArray(yieldPositions.status, ["active", "matured"])
                )
              )
              .orderBy(desc(yieldPositions.createdAt));
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

      withdrawPosition: (positionId: string) =>
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

          // Look up the wallet type from the original depositor wallet
          const [wallet] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(wallets)
                .where(eq(wallets.id, position.walletId)),
            catch: (error) =>
              new YieldError({
                message: `Failed to look up wallet: ${error}`,
                cause: error,
              }),
          });

          if (!wallet) {
            return yield* Effect.fail(
              new YieldError({
                message: `Wallet not found for position: ${position.walletId}`,
              })
            );
          }

          // Verify the on-chain depositor matches the wallet we're about to use
          const walletInstance = yield* walletService
            .getWallet(position.walletId, wallet.type as "user" | "server" | "agent")
            .pipe(
              Effect.mapError(
                (e) =>
                  new YieldError({
                    message: `Failed to resolve wallet instance: ${e}`,
                    cause: e,
                  })
              )
            );

          const walletAddress = yield* walletInstance.getAddress().pipe(
            Effect.mapError(
              (e) =>
                new YieldError({
                  message: `Failed to get wallet address: ${e}`,
                  cause: e,
                })
            )
          );

          // Read on-chain lock to check depositor
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
                    message: `Failed to read on-chain lock: ${e}`,
                    cause: e,
                  })
              )
            ) as Effect.Effect<{ depositor: string; unlockTime: bigint; withdrawn: boolean; isEmergencyWithdrawn: boolean }, YieldError>;

          const onChainDepositor = lockData.depositor.toLowerCase();
          const ourAddress = walletAddress.toLowerCase();

          if (onChainDepositor !== ourAddress) {
            return yield* Effect.fail(
              new YieldError({
                message: `Depositor mismatch: on-chain depositor is ${lockData.depositor}, but wallet ${position.walletId} (${wallet.type}) resolves to ${walletAddress}. DB address: ${wallet.address ?? "null"}`,
              })
            );
          }

          // Check if lock has already been withdrawn
          if (lockData.withdrawn) {
            return yield* Effect.fail(
              new YieldError({
                message: `Lock ${position.onChainLockId} has already been withdrawn`,
              })
            );
          }

          // Check if lock has been emergency-withdrawn (must use claimEmergencyFunds instead)
          if (lockData.isEmergencyWithdrawn) {
            return yield* Effect.fail(
              new YieldError({
                message: `Lock ${position.onChainLockId} was emergency-withdrawn. Use claimEmergencyFunds instead`,
              })
            );
          }

          // Verify the lock has expired before attempting withdrawal
          const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
          if (lockData.unlockTime > nowSeconds) {
            const unlockDate = new Date(Number(lockData.unlockTime) * 1000);
            return yield* Effect.fail(
              new YieldError({
                message: `Lock ${position.onChainLockId} has not expired yet. Unlock time: ${unlockDate.toISOString()}`,
              })
            );
          }

          // Submit the withdraw transaction using the original depositor wallet
          yield* txService
            .submitContractTransaction({
              walletId: position.walletId,
              walletType: wallet.type as "user" | "server" | "agent",
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

      batchWithdrawPositions: (positionIds: string[]) =>
        Effect.gen(function* () {
          if (positionIds.length === 0) {
            return [] as YieldPosition[];
          }

          // Fetch all positions
          const positions = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(yieldPositions)
                .where(inArray(yieldPositions.id, positionIds)),
            catch: (error) =>
              new YieldError({
                message: `Failed to fetch positions: ${error}`,
                cause: error,
              }),
          });

          if (positions.length === 0) {
            return yield* Effect.fail(
              new YieldError({ message: "No positions found" })
            );
          }

          // Validate all positions are withdrawable
          for (const position of positions) {
            if (!["active", "matured"].includes(position.status)) {
              return yield* Effect.fail(
                new YieldError({
                  message: `Position ${position.id} is not withdrawable (status: ${position.status})`,
                })
              );
            }
          }

          // Ensure all positions belong to the same wallet and chain
          const walletId = positions[0]!.walletId;
          const chainId = positions[0]!.chainId;
          const userId = positions[0]!.userId;

          for (const position of positions) {
            if (position.walletId !== walletId) {
              return yield* Effect.fail(
                new YieldError({
                  message: `All positions must belong to the same wallet for batch withdrawal`,
                })
              );
            }
            if (position.chainId !== chainId) {
              return yield* Effect.fail(
                new YieldError({
                  message: `All positions must be on the same chain for batch withdrawal`,
                })
              );
            }
          }

          // Look up wallet
          const [wallet] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(wallets)
                .where(eq(wallets.id, walletId)),
            catch: (error) =>
              new YieldError({
                message: `Failed to look up wallet: ${error}`,
                cause: error,
              }),
          });

          if (!wallet) {
            return yield* Effect.fail(
              new YieldError({
                message: `Wallet not found: ${walletId}`,
              })
            );
          }

          // Verify wallet address matches on-chain depositor
          const walletInstance = yield* walletService
            .getWallet(walletId, wallet.type as "user" | "server" | "agent")
            .pipe(
              Effect.mapError(
                (e) =>
                  new YieldError({
                    message: `Failed to resolve wallet instance: ${e}`,
                    cause: e,
                  })
              )
            );

          const walletAddress = yield* walletInstance.getAddress().pipe(
            Effect.mapError(
              (e) =>
                new YieldError({
                  message: `Failed to get wallet address: ${e}`,
                  cause: e,
                })
            )
          );

          // Validate each lock on-chain, then withdraw individually
          for (const position of positions) {
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
                      message: `Failed to read on-chain lock ${position.onChainLockId}: ${e}`,
                      cause: e,
                    })
                )
              ) as Effect.Effect<{ depositor: string; unlockTime: bigint; withdrawn: boolean; isEmergencyWithdrawn: boolean }, YieldError>;

            if (lockData.depositor.toLowerCase() !== walletAddress.toLowerCase()) {
              return yield* Effect.fail(
                new YieldError({
                  message: `Depositor mismatch for lock ${position.onChainLockId}`,
                })
              );
            }

            if (lockData.withdrawn) {
              // Already withdrawn on-chain — just update DB status and skip
              yield* Effect.tryPromise({
                try: () =>
                  db
                    .update(yieldPositions)
                    .set({ status: "withdrawn", updatedAt: new Date() })
                    .where(eq(yieldPositions.id, position.id)),
                catch: (error) =>
                  new YieldError({
                    message: `Failed to update position status: ${error}`,
                    cause: error,
                  }),
              });
              continue;
            }

            if (lockData.isEmergencyWithdrawn) {
              return yield* Effect.fail(
                new YieldError({
                  message: `Lock ${position.onChainLockId} was emergency-withdrawn. Use claimEmergencyFunds instead`,
                })
              );
            }

            const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
            if (lockData.unlockTime > nowSeconds) {
              const unlockDate = new Date(Number(lockData.unlockTime) * 1000);
              return yield* Effect.fail(
                new YieldError({
                  message: `Lock ${position.onChainLockId} has not expired yet. Unlock time: ${unlockDate.toISOString()}`,
                })
              );
            }

            // Submit individual withdraw transaction
            yield* txService
              .submitContractTransaction({
                walletId,
                walletType: wallet.type as "user" | "server" | "agent",
                contractName: CONTRACT_NAME,
                chainId,
                method: "withdraw",
                args: [BigInt(position.onChainLockId)],
                userId,
              })
              .pipe(
                Effect.mapError(
                  (e) =>
                    new YieldError({
                      message: `Failed to submit withdraw for lock ${position.onChainLockId}: ${e}`,
                      cause: e,
                    })
                )
              );

            // Update position status
            yield* Effect.tryPromise({
              try: () =>
                db
                  .update(yieldPositions)
                  .set({ status: "withdrawn", updatedAt: new Date() })
                  .where(eq(yieldPositions.id, position.id)),
              catch: (error) =>
                new YieldError({
                  message: `Failed to update position status: ${error}`,
                  cause: error,
                }),
            });
          }

          // Return updated positions
          const updated = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(yieldPositions)
                .where(inArray(yieldPositions.id, positionIds)),
            catch: (error) =>
              new YieldError({
                message: `Failed to fetch updated positions: ${error}`,
                cause: error,
              }),
          });

          return updated;
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

      getAccruedYield: (positionId: string) =>
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

          return {
            positionId,
            principalAmount: position.principalAmount,
            currentAssets: String(currentAssets),
            accruedYield: String(accruedYield),
            estimatedApy,
          } satisfies AccruedYieldInfo;
        }),

      getPortfolioSummary: (userId: string) =>
        Effect.gen(function* () {
          const activeStatuses = ["active", "matured"] as const;

          const positions = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(yieldPositions)
                .where(
                  and(
                    eq(yieldPositions.userId, userId),
                    inArray(yieldPositions.status, [...activeStatuses])
                  )
                ),
            catch: (error) =>
              new YieldError({
                message: `Failed to list positions for portfolio: ${error}`,
                cause: error,
              }),
          });

          // Count withdrawn positions separately for the frontend
          const withdrawnPositions = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(yieldPositions)
                .where(
                  and(
                    eq(yieldPositions.userId, userId),
                    inArray(yieldPositions.status, ["withdrawn", "emergency"])
                  )
                ),
            catch: (error) =>
              new YieldError({
                message: `Failed to count withdrawn positions: ${error}`,
                cause: error,
              }),
          });

          const withdrawnCount = withdrawnPositions.length;

          let totalPrincipal = 0n;
          let totalCurrentValue = 0n;
          let totalYield = 0n;
          let apySum = 0;
          let apyCount = 0;

          const twentyFourHoursAgo = new Date(
            Date.now() - 24 * 60 * 60 * 1000
          );

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

            if (
              latestSnapshot &&
              latestSnapshot.snapshotAt > twentyFourHoursAgo
            ) {
              totalCurrentValue += BigInt(latestSnapshot.currentAssets);
              totalYield += BigInt(latestSnapshot.accruedYield);
              if (latestSnapshot.estimatedApy) {
                apySum += parseFloat(latestSnapshot.estimatedApy);
                apyCount++;
              }
            } else {
              // No snapshot or stale (>24h) — fall back to principal as floor
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
            withdrawnCount,
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
