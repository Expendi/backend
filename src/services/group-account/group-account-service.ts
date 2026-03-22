import { Effect, Context, Layer, Data } from "effect";
import { eq, and } from "drizzle-orm";
import { encodeFunctionData, formatUnits } from "viem";
import { createBasePublicClient } from "../chain/public-client.js";
import { DatabaseService } from "../../db/client.js";
import {
  groupAccounts,
  groupAccountMembers,
  userProfiles,
  wallets,
  type GroupAccount,
  type GroupAccountMember,
} from "../../db/schema/index.js";
import {
  TransactionService,
  type TransactionError,
} from "../transaction/transaction-service.js";
import {
  OnboardingService,
  type OnboardingError,
} from "../onboarding/onboarding-service.js";
import { WalletService, type WalletError } from "../wallet/wallet-service.js";
import { ConfigService } from "../../config.js";
import type { ContractExecutionError } from "../contract/contract-executor.js";
import type { ContractNotFoundError } from "../contract/contract-registry.js";
import type { LedgerError } from "../ledger/ledger-service.js";
import { GROUP_ACCOUNT_ABI } from "../../connectors/group-account.js";

// ── Error type ───────────────────────────────────────────────────────

export class GroupAccountError extends Data.TaggedError("GroupAccountError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export interface GroupWithMembers extends GroupAccount {
  members: (GroupAccountMember & { username: string | null })[];
}

export interface CreateGroupParams {
  readonly name: string;
  readonly description?: string;
  readonly members: readonly string[]; // usernames or 0x addresses
}

export interface PayParams {
  readonly to: string; // username or 0x address
  readonly amount: string;
  readonly token?: string; // ERC-20 address, omit for ETH
}

export interface DepositParams {
  readonly amount: string;
  readonly token?: string; // ERC-20 address, omit for ETH
}

// ── Service interface ────────────────────────────────────────────────

type ServiceErrors =
  | GroupAccountError
  | OnboardingError
  | TransactionError
  | ContractExecutionError
  | ContractNotFoundError
  | WalletError
  | LedgerError;

export interface GroupAccountServiceApi {
  readonly createGroup: (
    userId: string,
    params: CreateGroupParams
  ) => Effect.Effect<GroupAccount, ServiceErrors>;

  readonly getMyGroups: (
    userId: string
  ) => Effect.Effect<GroupAccount[], GroupAccountError>;

  readonly getGroup: (
    groupId: string
  ) => Effect.Effect<GroupWithMembers, GroupAccountError>;

  readonly addMember: (
    groupId: string,
    adminUserId: string,
    identifier: string
  ) => Effect.Effect<GroupAccountMember, ServiceErrors>;

  readonly removeMember: (
    groupId: string,
    adminUserId: string,
    identifier: string
  ) => Effect.Effect<void, ServiceErrors>;

  readonly pay: (
    groupId: string,
    adminUserId: string,
    params: PayParams
  ) => Effect.Effect<{ transactionId: string }, ServiceErrors>;

  readonly deposit: (
    groupId: string,
    userId: string,
    params: DepositParams
  ) => Effect.Effect<{ transactionId: string }, ServiceErrors>;

  readonly transferAdmin: (
    groupId: string,
    adminUserId: string,
    newAdminIdentifier: string
  ) => Effect.Effect<void, ServiceErrors>;

  readonly getBalance: (
    groupId: string,
    tokens?: string[]
  ) => Effect.Effect<
    { eth: string; tokens: Record<string, string> },
    GroupAccountError
  >;
}

export class GroupAccountService extends Context.Tag("GroupAccountService")<
  GroupAccountService,
  GroupAccountServiceApi
>() {}

// ── Token decimals by address (lowercase) ───────────────────────────

const TOKEN_DECIMALS_BY_ADDRESS: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,   // USDC on Base
  "0x2d1adb45bb1d7d2556c6558adb76cfd4f9f4ed16": 6,   // USDT on Base
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": 18,  // DAI on Base
  "0x4200000000000000000000000000000000000006": 18,    // WETH on Base
};

/** Convert human-readable amount to raw units for a token address (defaults to 18 decimals).
 *  Returns a string to avoid BigInt serialization issues; callers convert to BigInt at the ABI boundary. */
function toRawTokenAmount(amount: string, tokenAddress?: string): string {
  const decimals = tokenAddress
    ? (TOKEN_DECIMALS_BY_ADDRESS[tokenAddress.toLowerCase()] ?? 18)
    : 18; // ETH default
  return String(Math.floor(Number(amount) * Math.pow(10, decimals)));
}

// ── ERC-20 ABI fragments ────────────────────────────────────────────

const ERC20_ABI = [
  {
    type: "function" as const,
    name: "balanceOf",
    stateMutability: "view" as const,
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function" as const,
    name: "allowance",
    stateMutability: "view" as const,
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function" as const,
    name: "approve",
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ── Live implementation ──────────────────────────────────────────────

export const GroupAccountServiceLive: Layer.Layer<
  GroupAccountService,
  never,
  | DatabaseService
  | TransactionService
  | OnboardingService
  | WalletService
  | ConfigService
> = Layer.effect(
  GroupAccountService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const txService = yield* TransactionService;
    const onboarding = yield* OnboardingService;
    const walletService = yield* WalletService;
    const config = yield* ConfigService;

    // ── Helpers ────────────────────────────────────────────────────

    const resolveMemberIdentifier = (identifier: string) =>
      Effect.gen(function* () {
        if (identifier.startsWith("0x")) {
          return identifier as `0x${string}`;
        }
        const resolved = yield* onboarding.resolveUsername(identifier);
        return resolved.address as `0x${string}`;
      });

    const getServerWallet = (userId: string) =>
      Effect.gen(function* () {
        const profile = yield* onboarding.getProfile(userId);
        const rows = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(eq(wallets.id, profile.serverWalletId))
              .limit(1),
          catch: (error) =>
            new GroupAccountError({
              message: `Failed to look up server wallet: ${error}`,
              cause: error,
            }),
        });
        const wallet = rows[0];
        if (!wallet) {
          return yield* Effect.fail(
            new GroupAccountError({
              message: `Server wallet not found for user: ${userId}`,
            })
          );
        }
        return wallet;
      });

    const verifyAdmin = (groupId: string, userId: string) =>
      Effect.gen(function* () {
        const rows = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(groupAccounts)
              .where(eq(groupAccounts.id, groupId))
              .limit(1),
          catch: (error) =>
            new GroupAccountError({
              message: `Failed to look up group: ${error}`,
              cause: error,
            }),
        });
        const group = rows[0];
        if (!group) {
          return yield* Effect.fail(
            new GroupAccountError({ message: `Group not found: ${groupId}` })
          );
        }
        if (group.adminUserId !== userId) {
          return yield* Effect.fail(
            new GroupAccountError({ message: "Only the group admin can perform this action" })
          );
        }
        return group;
      });

    const sendGroupTx = (
      groupAddress: `0x${string}`,
      serverWalletId: string,
      chainId: number,
      data: `0x${string}`,
      value?: number,
      userId?: string
    ) =>
      txService.submitRawTransaction({
        walletId: serverWalletId,
        walletType: "server",
        chainId,
        to: groupAddress,
        data,
        value,
        userId,
      });

    /** Check current allowance and submit an ERC-20 approve tx if insufficient. */
    const ensureApproval = (
      tokenAddress: `0x${string}`,
      ownerAddress: `0x${string}`,
      spenderAddress: `0x${string}`,
      amount: number,
      serverWalletId: string,
      chainId: number,
      userId?: string
    ) =>
      Effect.gen(function* () {
        const client = createBasePublicClient(config.baseRpcUrl || undefined);

        const currentAllowance = yield* Effect.tryPromise({
          try: () =>
            client.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: "allowance",
              args: [ownerAddress, spenderAddress],
            }),
          catch: (error) =>
            new GroupAccountError({
              message: `Failed to check allowance: ${error}`,
              cause: error,
            }),
        });

        if (Number(currentAllowance) >= amount) return;

        // Approve max uint256 to avoid repeated approvals
        const approveData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [
            spenderAddress,
            BigInt(
              "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
            ),
          ],
        });

        yield* txService.submitRawTransaction({
          walletId: serverWalletId,
          walletType: "server",
          chainId,
          to: tokenAddress,
          data: approveData,
          userId,
        });
      });

    // ── Service methods ───────────────────────────────────────────

    return {
      createGroup: (userId, params) =>
        Effect.gen(function* () {
          const serverWallet = yield* getServerWallet(userId);
          const chainId = config.defaultChainId;

          // Resolve all member identifiers to addresses
          const adminProfile =
            yield* onboarding.getProfileWithWallets(userId);
          const adminAddress = adminProfile.userWallet.address as `0x${string}`;

          const memberAddresses: `0x${string}`[] = [adminAddress];
          const memberUserIds: { userId: string; address: string }[] = [
            { userId, address: adminAddress },
          ];

          for (const identifier of params.members) {
            const address = yield* resolveMemberIdentifier(identifier);
            if (
              !memberAddresses.some(
                (a) => a.toLowerCase() === address.toLowerCase()
              )
            ) {
              memberAddresses.push(address);

              // Try to find the user ID for this address
              const profileRows = yield* Effect.tryPromise({
                try: () =>
                  db
                    .select({
                      privyUserId: userProfiles.privyUserId,
                      address: wallets.address,
                    })
                    .from(wallets)
                    .innerJoin(
                      userProfiles,
                      eq(wallets.id, userProfiles.userWalletId)
                    )
                    .where(eq(wallets.address, address))
                    .limit(1),
                catch: (error) =>
                  new GroupAccountError({
                    message: `Failed to look up member profile: ${error}`,
                    cause: error,
                  }),
              });
              const memberProfile = profileRows[0];
              memberUserIds.push({
                userId: memberProfile?.privyUserId ?? address,
                address,
              });
            }
          }

          // Submit factory createGroup transaction
          const tx = yield* txService.submitContractTransaction({
            walletId: serverWallet.id,
            walletType: "server",
            contractName: "group-account-factory",
            chainId,
            method: "create",
            args: [memberAddresses],
            userId,
          });

          // In production, the group address would be parsed from the
          // GroupCreated event log. For now, derive a placeholder.
          const groupAddress =
            `0x${tx.id.replace(/-/g, "").slice(0, 40)}` as `0x${string}`;

          // Store the group in DB
          const [group] = yield* Effect.tryPromise({
            try: () =>
              db
                .insert(groupAccounts)
                .values({
                  groupAddress,
                  adminUserId: userId,
                  name: params.name,
                  description: params.description,
                  chainId,
                  transactionId: tx.id,
                })
                .returning(),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to create group record: ${error}`,
                cause: error,
              }),
          });

          // Store members
          const memberValues = memberUserIds.map((m, i) => ({
            groupId: group!.id,
            userId: m.userId,
            walletAddress: m.address,
            role: i === 0 ? ("admin" as const) : ("member" as const),
          }));

          yield* Effect.tryPromise({
            try: () =>
              db.insert(groupAccountMembers).values(memberValues),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to insert group members: ${error}`,
                cause: error,
              }),
          });

          return group!;
        }),

      getMyGroups: (userId) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () =>
              db
                .select({ groupId: groupAccountMembers.groupId })
                .from(groupAccountMembers)
                .where(eq(groupAccountMembers.userId, userId)),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to list groups: ${error}`,
                cause: error,
              }),
          });

          if (rows.length === 0) return [];

          const groupIds = rows.map((r) => r.groupId);
          const groups = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(groupAccounts)
                .where(
                  groupIds.length === 1
                    ? eq(groupAccounts.id, groupIds[0]!)
                    : // Use inArray for multiple IDs
                      eq(groupAccounts.id, groupIds[0]!) // fallback; refined below
                ),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to fetch groups: ${error}`,
                cause: error,
              }),
          });

          // Fetch all groups by doing individual lookups (safe for reasonable counts)
          if (groupIds.length > 1) {
            const allGroups = yield* Effect.tryPromise({
              try: async () => {
                const results = [];
                for (const gid of groupIds) {
                  const [g] = await db
                    .select()
                    .from(groupAccounts)
                    .where(eq(groupAccounts.id, gid))
                    .limit(1);
                  if (g) results.push(g);
                }
                return results;
              },
              catch: (error) =>
                new GroupAccountError({
                  message: `Failed to fetch groups: ${error}`,
                  cause: error,
                }),
            });
            return allGroups;
          }

          return groups;
        }),

      getGroup: (groupId) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(groupAccounts)
                .where(eq(groupAccounts.id, groupId))
                .limit(1),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to fetch group: ${error}`,
                cause: error,
              }),
          });

          const group = rows[0];
          if (!group) {
            return yield* Effect.fail(
              new GroupAccountError({
                message: `Group not found: ${groupId}`,
              })
            );
          }

          // Fetch members with usernames
          const memberRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select({
                  id: groupAccountMembers.id,
                  groupId: groupAccountMembers.groupId,
                  userId: groupAccountMembers.userId,
                  walletAddress: groupAccountMembers.walletAddress,
                  role: groupAccountMembers.role,
                  joinedAt: groupAccountMembers.joinedAt,
                  username: userProfiles.username,
                })
                .from(groupAccountMembers)
                .leftJoin(
                  userProfiles,
                  eq(groupAccountMembers.userId, userProfiles.privyUserId)
                )
                .where(eq(groupAccountMembers.groupId, groupId)),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to fetch group members: ${error}`,
                cause: error,
              }),
          });

          return {
            ...group,
            members: memberRows,
          };
        }),

      addMember: (groupId, adminUserId, identifier) =>
        Effect.gen(function* () {
          const group = yield* verifyAdmin(groupId, adminUserId);
          const serverWallet = yield* getServerWallet(adminUserId);
          const memberAddress = yield* resolveMemberIdentifier(identifier);

          // Encode addMember calldata
          const data = encodeFunctionData({
            abi: GROUP_ACCOUNT_ABI,
            functionName: "addMember",
            args: [memberAddress],
          });

          yield* sendGroupTx(
            group.groupAddress as `0x${string}`,
            serverWallet.id,
            group.chainId,
            data,
            undefined,
            adminUserId
          );

          // Resolve user ID for the member
          let memberId = memberAddress as string;
          if (!identifier.startsWith("0x")) {
            const resolved =
              yield* onboarding.resolveUsername(identifier);
            memberId = resolved.privyUserId;
          } else {
            // Try to find user by wallet address
            const profileRows = yield* Effect.tryPromise({
              try: () =>
                db
                  .select({ privyUserId: userProfiles.privyUserId })
                  .from(wallets)
                  .innerJoin(
                    userProfiles,
                    eq(wallets.id, userProfiles.userWalletId)
                  )
                  .where(eq(wallets.address, memberAddress))
                  .limit(1),
              catch: (error) =>
                new GroupAccountError({
                  message: `Failed to resolve member: ${error}`,
                  cause: error,
                }),
            });
            if (profileRows[0]) {
              memberId = profileRows[0].privyUserId;
            }
          }

          // Insert DB record
          const [member] = yield* Effect.tryPromise({
            try: () =>
              db
                .insert(groupAccountMembers)
                .values({
                  groupId,
                  userId: memberId,
                  walletAddress: memberAddress,
                  role: "member",
                })
                .returning(),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to add member record: ${error}`,
                cause: error,
              }),
          });

          return member!;
        }),

      removeMember: (groupId, adminUserId, identifier) =>
        Effect.gen(function* () {
          const group = yield* verifyAdmin(groupId, adminUserId);
          const serverWallet = yield* getServerWallet(adminUserId);
          const memberAddress = yield* resolveMemberIdentifier(identifier);

          // Encode removeMember calldata
          const data = encodeFunctionData({
            abi: GROUP_ACCOUNT_ABI,
            functionName: "removeMember",
            args: [memberAddress],
          });

          yield* sendGroupTx(
            group.groupAddress as `0x${string}`,
            serverWallet.id,
            group.chainId,
            data,
            undefined,
            adminUserId
          );

          // Remove from DB
          yield* Effect.tryPromise({
            try: () =>
              db
                .delete(groupAccountMembers)
                .where(
                  and(
                    eq(groupAccountMembers.groupId, groupId),
                    eq(groupAccountMembers.walletAddress, memberAddress)
                  )
                ),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to remove member record: ${error}`,
                cause: error,
              }),
          });
        }),

      pay: (groupId, adminUserId, params) =>
        Effect.gen(function* () {
          const group = yield* verifyAdmin(groupId, adminUserId);
          const serverWallet = yield* getServerWallet(adminUserId);
          const toAddress = yield* resolveMemberIdentifier(params.to);
          // params.amount is human-readable; convert to raw units
          const rawAmount = toRawTokenAmount(params.amount, params.token);

          let data: `0x${string}`;
          if (params.token) {
            // payToken(token, to, amount)
            data = encodeFunctionData({
              abi: GROUP_ACCOUNT_ABI,
              functionName: "payToken",
              args: [
                params.token as `0x${string}`,
                toAddress,
                BigInt(rawAmount),
              ],
            });
          } else {
            // pay(to, amount) — ETH
            const rawEthAmount = String(Math.floor(Number(params.amount) * 1e18));
            data = encodeFunctionData({
              abi: GROUP_ACCOUNT_ABI,
              functionName: "pay",
              args: [toAddress, BigInt(rawEthAmount)],
            });
          }

          const tx = yield* sendGroupTx(
            group.groupAddress as `0x${string}`,
            serverWallet.id,
            group.chainId,
            data,
            undefined,
            adminUserId
          );

          return { transactionId: tx.id };
        }),

      deposit: (groupId, userId, params) =>
        Effect.gen(function* () {
          // Verify membership
          const memberRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(groupAccountMembers)
                .where(
                  and(
                    eq(groupAccountMembers.groupId, groupId),
                    eq(groupAccountMembers.userId, userId)
                  )
                )
                .limit(1),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to verify membership: ${error}`,
                cause: error,
              }),
          });

          if (!memberRows[0]) {
            return yield* Effect.fail(
              new GroupAccountError({
                message: "Only group members can deposit",
              })
            );
          }

          // Get the group
          const groupRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(groupAccounts)
                .where(eq(groupAccounts.id, groupId))
                .limit(1),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to fetch group: ${error}`,
                cause: error,
              }),
          });

          const group = groupRows[0];
          if (!group) {
            return yield* Effect.fail(
              new GroupAccountError({ message: `Group not found: ${groupId}` })
            );
          }

          const serverWallet = yield* getServerWallet(userId);
          // params.amount is human-readable; convert to raw units
          const rawAmount = toRawTokenAmount(params.amount, params.token);

          let data: `0x${string}`;
          let value: number | undefined;

          if (params.token) {
            // Approve the group contract to spend the token on behalf of the server wallet
            yield* ensureApproval(
              params.token as `0x${string}`,
              serverWallet.address as `0x${string}`,
              group.groupAddress as `0x${string}`,
              Number(rawAmount),
              serverWallet.id,
              group.chainId,
              userId
            );

            // depositToken(token, amount)
            data = encodeFunctionData({
              abi: GROUP_ACCOUNT_ABI,
              functionName: "depositToken",
              args: [params.token as `0x${string}`, BigInt(rawAmount)],
            });
          } else {
            // deposit() with ETH value — convert human-readable to wei
            const rawEthAmount = Math.floor(Number(params.amount) * 1e18);
            data = encodeFunctionData({
              abi: GROUP_ACCOUNT_ABI,
              functionName: "deposit",
              args: [],
            });
            value = rawEthAmount;
          }

          const tx = yield* sendGroupTx(
            group.groupAddress as `0x${string}`,
            serverWallet.id,
            group.chainId,
            data,
            value,
            userId
          );

          return { transactionId: tx.id };
        }),

      transferAdmin: (groupId, adminUserId, newAdminIdentifier) =>
        Effect.gen(function* () {
          const group = yield* verifyAdmin(groupId, adminUserId);
          const serverWallet = yield* getServerWallet(adminUserId);
          const newAdminAddress =
            yield* resolveMemberIdentifier(newAdminIdentifier);

          // Encode transferAdmin calldata
          const data = encodeFunctionData({
            abi: GROUP_ACCOUNT_ABI,
            functionName: "transferAdmin",
            args: [newAdminAddress],
          });

          yield* sendGroupTx(
            group.groupAddress as `0x${string}`,
            serverWallet.id,
            group.chainId,
            data,
            undefined,
            adminUserId
          );

          // Resolve new admin user ID
          let newAdminUserId = newAdminAddress as string;
          if (!newAdminIdentifier.startsWith("0x")) {
            const resolved =
              yield* onboarding.resolveUsername(newAdminIdentifier);
            newAdminUserId = resolved.privyUserId;
          } else {
            const profileRows = yield* Effect.tryPromise({
              try: () =>
                db
                  .select({ privyUserId: userProfiles.privyUserId })
                  .from(wallets)
                  .innerJoin(
                    userProfiles,
                    eq(wallets.id, userProfiles.userWalletId)
                  )
                  .where(eq(wallets.address, newAdminAddress))
                  .limit(1),
              catch: (error) =>
                new GroupAccountError({
                  message: `Failed to resolve new admin: ${error}`,
                  cause: error,
                }),
            });
            if (profileRows[0]) {
              newAdminUserId = profileRows[0].privyUserId;
            }
          }

          // Update DB: group admin + member roles
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(groupAccounts)
                .set({
                  adminUserId: newAdminUserId,
                  updatedAt: new Date(),
                })
                .where(eq(groupAccounts.id, groupId)),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to update group admin: ${error}`,
                cause: error,
              }),
          });

          // Update old admin role to member
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(groupAccountMembers)
                .set({ role: "member" })
                .where(
                  and(
                    eq(groupAccountMembers.groupId, groupId),
                    eq(groupAccountMembers.userId, adminUserId)
                  )
                ),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to update old admin role: ${error}`,
                cause: error,
              }),
          });

          // Update new admin role
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(groupAccountMembers)
                .set({ role: "admin" })
                .where(
                  and(
                    eq(groupAccountMembers.groupId, groupId),
                    eq(groupAccountMembers.userId, newAdminUserId)
                  )
                ),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to update new admin role: ${error}`,
                cause: error,
              }),
          });
        }),

      getBalance: (groupId, tokens) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(groupAccounts)
                .where(eq(groupAccounts.id, groupId))
                .limit(1),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to fetch group: ${error}`,
                cause: error,
              }),
          });

          const group = rows[0];
          if (!group) {
            return yield* Effect.fail(
              new GroupAccountError({
                message: `Group not found: ${groupId}`,
              })
            );
          }

          const client = createBasePublicClient(config.baseRpcUrl || undefined);

          // Read ETH balance
          const ethBalance = yield* Effect.tryPromise({
            try: () =>
              client.getBalance({
                address: group.groupAddress as `0x${string}`,
              }),
            catch: (error) =>
              new GroupAccountError({
                message: `Failed to read ETH balance: ${error}`,
                cause: error,
              }),
          });

          // Read ERC-20 balances — return human-readable amounts
          const tokenBalances: Record<string, string> = {};
          if (tokens && tokens.length > 0) {
            for (const tokenAddress of tokens) {
              const balance = yield* Effect.tryPromise({
                try: () =>
                  client.readContract({
                    address: tokenAddress as `0x${string}`,
                    abi: ERC20_ABI,
                    functionName: "balanceOf",
                    args: [group.groupAddress as `0x${string}`],
                  }),
                catch: (error) =>
                  new GroupAccountError({
                    message: `Failed to read token balance for ${tokenAddress}: ${error}`,
                    cause: error,
                  }),
              });
              const decimals = TOKEN_DECIMALS_BY_ADDRESS[tokenAddress.toLowerCase()] ?? 18;
              tokenBalances[tokenAddress] = formatUnits(balance as bigint, decimals);
            }
          }

          return {
            eth: formatUnits(ethBalance, 18),
            tokens: tokenBalances,
          };
        }),
    };
  })
);
