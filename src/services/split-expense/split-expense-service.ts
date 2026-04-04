import { Effect, Context, Layer, Data } from "effect";
import { eq, and, or, inArray } from "drizzle-orm";
import { encodeFunctionData } from "viem";
import { DatabaseService } from "../../db/client.js";
import {
  splitExpenses,
  splitExpenseShares,
  userProfiles,
  wallets,
  transactions,
  type SplitExpense,
  type SplitExpenseShare,
  type Transaction,
} from "../../db/schema/index.js";
import {
  TransactionService,
  type TransactionError,
} from "../transaction/transaction-service.js";
import {
  OnboardingService,
  type OnboardingError,
} from "../onboarding/onboarding-service.js";
import type { ContractExecutionError } from "../contract/contract-executor.js";
import type { ContractNotFoundError } from "../contract/contract-registry.js";
import type { LedgerError } from "../ledger/ledger-service.js";
import type { WalletError } from "../wallet/wallet-service.js";

// ── Error type ───────────────────────────────────────────────────────

export class SplitExpenseError extends Data.TaggedError("SplitExpenseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export type SplitTx = Transaction & { amount: string };

export interface SplitExpenseWithShares extends SplitExpense {
  shares: (SplitExpenseShare & { username: string | null })[];
  splitTxs: SplitTx[];
}

export interface CreateSplitExpenseParams {
  readonly title: string;
  readonly tokenAddress: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly totalAmount: string;
  readonly chainId: number;
  readonly transactionId?: string | null;
  readonly categoryId?: string | null;
  readonly shares: readonly { userId: string; amount: string }[];
}

// ── ERC-20 ABI fragment ──────────────────────────────────────────────

const ERC20_TRANSFER_ABI = [
  {
    type: "function" as const,
    name: "transfer",
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ── Service interface ────────────────────────────────────────────────

type ServiceErrors =
  | SplitExpenseError
  | OnboardingError
  | TransactionError
  | ContractExecutionError
  | ContractNotFoundError
  | WalletError
  | LedgerError;

export interface SplitExpenseServiceApi {
  readonly createExpense: (
    userId: string,
    params: CreateSplitExpenseParams
  ) => Effect.Effect<SplitExpenseWithShares, ServiceErrors>;

  readonly getExpense: (
    id: string,
    userId: string
  ) => Effect.Effect<SplitExpenseWithShares, SplitExpenseError>;

  readonly listByUser: (
    userId: string
  ) => Effect.Effect<SplitExpense[], SplitExpenseError>;

  readonly payShare: (
    shareId: string,
    userId: string,
    walletId: string,
    walletType: "user" | "server" | "agent"
  ) => Effect.Effect<SplitExpenseShare, ServiceErrors>;

  readonly listOwed: (
    userId: string
  ) => Effect.Effect<SplitExpenseWithShares[], SplitExpenseError>;

  readonly cancelExpense: (
    expenseId: string,
    userId: string
  ) => Effect.Effect<SplitExpense, SplitExpenseError>;
}

export class SplitExpenseService extends Context.Tag("SplitExpenseService")<
  SplitExpenseService,
  SplitExpenseServiceApi
>() {}

// ── Live implementation ──────────────────────────────────────────────

export const SplitExpenseServiceLive: Layer.Layer<
  SplitExpenseService,
  never,
  DatabaseService | TransactionService | OnboardingService
> = Layer.effect(
  SplitExpenseService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const txService = yield* TransactionService;
    const onboarding = yield* OnboardingService;

    // ── Helpers ────────────────────────────────────────────────────

    const fetchExpenseWithShares = (expenseId: string) =>
      Effect.gen(function* () {
        const rows = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(splitExpenses)
              .where(eq(splitExpenses.id, expenseId))
              .limit(1),
          catch: (error) =>
            new SplitExpenseError({
              message: `Failed to fetch expense: ${error}`,
              cause: error,
            }),
        });

        const expense = rows[0];
        if (!expense) {
          return yield* Effect.fail(
            new SplitExpenseError({
              message: `Expense not found: ${expenseId}`,
            })
          );
        }

        const shareRows = yield* Effect.tryPromise({
          try: () =>
            db
              .select({
                id: splitExpenseShares.id,
                expenseId: splitExpenseShares.expenseId,
                debtorUserId: splitExpenseShares.debtorUserId,
                amount: splitExpenseShares.amount,
                status: splitExpenseShares.status,
                transactionId: splitExpenseShares.transactionId,
                paidAt: splitExpenseShares.paidAt,
                createdAt: splitExpenseShares.createdAt,
                username: userProfiles.username,
              })
              .from(splitExpenseShares)
              .leftJoin(
                userProfiles,
                eq(splitExpenseShares.debtorUserId, userProfiles.privyUserId)
              )
              .where(eq(splitExpenseShares.expenseId, expenseId)),
          catch: (error) =>
            new SplitExpenseError({
              message: `Failed to fetch expense shares: ${error}`,
              cause: error,
            }),
        });

        // Fetch transactions for paid shares
        const paidShares = shareRows.filter((s) => s.transactionId != null);
        const txIds = paidShares.map((s) => s.transactionId!);

        let splitTxs: SplitTx[] = [];
        if (txIds.length > 0) {
          const txRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(transactions)
                .where(inArray(transactions.id, txIds)),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to fetch split transactions: ${error}`,
                cause: error,
              }),
          });

          // Build a map of txId → share amount
          const amountByTxId = new Map(
            paidShares.map((s) => [s.transactionId!, s.amount])
          );

          splitTxs = txRows.map((tx) => ({
            ...tx,
            amount: amountByTxId.get(tx.id) ?? (tx.payload as Record<string, unknown>)?.amount as string ?? "0",
          }));
        }

        return { ...expense, shares: shareRows, splitTxs };
      });

    // ── Service methods ───────────────────────────────────────────

    return {
      createExpense: (userId, params) =>
        Effect.gen(function* () {
          // Validate all debtor userIds exist
          for (const share of params.shares) {
            const profileRows = yield* Effect.tryPromise({
              try: () =>
                db
                  .select({ privyUserId: userProfiles.privyUserId })
                  .from(userProfiles)
                  .where(eq(userProfiles.privyUserId, share.userId))
                  .limit(1),
              catch: (error) =>
                new SplitExpenseError({
                  message: `Failed to validate user: ${error}`,
                  cause: error,
                }),
            });
            if (!profileRows[0]) {
              return yield* Effect.fail(
                new SplitExpenseError({
                  message: `User not found: ${share.userId}`,
                })
              );
            }
          }

          // Create the expense
          const [expense] = yield* Effect.tryPromise({
            try: () =>
              db
                .insert(splitExpenses)
                .values({
                  creatorUserId: userId,
                  title: params.title,
                  tokenAddress: params.tokenAddress,
                  tokenSymbol: params.tokenSymbol,
                  tokenDecimals: params.tokenDecimals,
                  totalAmount: params.totalAmount,
                  chainId: params.chainId,
                  transactionId: params.transactionId ?? undefined,
                  categoryId: params.categoryId ?? undefined,
                })
                .returning(),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to create expense: ${error}`,
                cause: error,
              }),
          });

          // Create shares
          const shareValues = params.shares.map((s) => ({
            expenseId: expense!.id,
            debtorUserId: s.userId,
            amount: s.amount,
          }));

          yield* Effect.tryPromise({
            try: () =>
              db.insert(splitExpenseShares).values(shareValues),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to create expense shares: ${error}`,
                cause: error,
              }),
          });

          return yield* fetchExpenseWithShares(expense!.id);
        }),

      getExpense: (id, userId) =>
        Effect.gen(function* () {
          const expense = yield* fetchExpenseWithShares(id);

          // Verify user is creator or a debtor
          const isParticipant =
            expense.creatorUserId === userId ||
            expense.shares.some((s) => s.debtorUserId === userId);

          if (!isParticipant) {
            return yield* Effect.fail(
              new SplitExpenseError({
                message: "Not authorized to view this expense",
              })
            );
          }

          return expense;
        }),

      listByUser: (userId) =>
        Effect.gen(function* () {
          // Get expenses where user is creator
          const createdRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(splitExpenses)
                .where(eq(splitExpenses.creatorUserId, userId)),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to list created expenses: ${error}`,
                cause: error,
              }),
          });

          // Get expenses where user is debtor
          const debtorShareRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select({ expenseId: splitExpenseShares.expenseId })
                .from(splitExpenseShares)
                .where(eq(splitExpenseShares.debtorUserId, userId)),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to list debtor expenses: ${error}`,
                cause: error,
              }),
          });

          const debtorExpenseIds = debtorShareRows
            .map((r) => r.expenseId)
            .filter((id) => !createdRows.some((e) => e.id === id));

          // Fetch debtor expenses not already in createdRows
          const debtorExpenses: typeof createdRows = [];
          for (const eid of debtorExpenseIds) {
            const rows = yield* Effect.tryPromise({
              try: () =>
                db
                  .select()
                  .from(splitExpenses)
                  .where(eq(splitExpenses.id, eid))
                  .limit(1),
              catch: (error) =>
                new SplitExpenseError({
                  message: `Failed to fetch expense: ${error}`,
                  cause: error,
                }),
            });
            if (rows[0]) debtorExpenses.push(rows[0]);
          }

          return [...createdRows, ...debtorExpenses];
        }),

      payShare: (shareId, userId, walletId, walletType) =>
        Effect.gen(function* () {
          // 1. Look up the share
          const shareRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(splitExpenseShares)
                .where(eq(splitExpenseShares.id, shareId))
                .limit(1),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to fetch share: ${error}`,
                cause: error,
              }),
          });

          const share = shareRows[0];
          if (!share) {
            return yield* Effect.fail(
              new SplitExpenseError({ message: `Share not found: ${shareId}` })
            );
          }

          // Verify debtor and status
          if (share.debtorUserId !== userId) {
            return yield* Effect.fail(
              new SplitExpenseError({
                message: "Only the debtor can pay this share",
              })
            );
          }
          if (share.status !== "pending") {
            return yield* Effect.fail(
              new SplitExpenseError({
                message: `Share is not pending (status: ${share.status})`,
              })
            );
          }

          // 2. Look up the expense
          const expenseRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(splitExpenses)
                .where(eq(splitExpenses.id, share.expenseId))
                .limit(1),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to fetch expense: ${error}`,
                cause: error,
              }),
          });

          const expense = expenseRows[0];
          if (!expense) {
            return yield* Effect.fail(
              new SplitExpenseError({
                message: `Expense not found: ${share.expenseId}`,
              })
            );
          }

          // 3. Look up creator's wallet address (settle to user/personal wallet)
          const creatorProfile = yield* onboarding.getProfileWithWallets(
            expense.creatorUserId
          );
          const recipientAddress = creatorProfile.userWallet
            .address as `0x${string}`;

          // 4. Execute ERC-20 transfer via raw transaction
          // share.amount is human-readable; convert to raw units using expense token decimals
          const rawShareAmount = String(Math.floor(Number(share.amount) * Math.pow(10, expense.tokenDecimals)));
          const transferData = encodeFunctionData({
            abi: ERC20_TRANSFER_ABI,
            functionName: "transfer",
            args: [recipientAddress, BigInt(rawShareAmount)],
          });

          // Look up creator's profile name for the payload
          const creatorProfileRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select({ username: userProfiles.username })
                .from(userProfiles)
                .where(eq(userProfiles.privyUserId, expense.creatorUserId))
                .limit(1),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to fetch creator profile: ${error}`,
                cause: error,
              }),
          });

          const tx = yield* txService.submitRawTransaction({
            walletId,
            walletType,
            chainId: expense.chainId,
            to: expense.tokenAddress as `0x${string}`,
            data: transferData,
            userId,
            categoryId: expense.categoryId ?? undefined,
            amount: share.amount,
            recipientProfileName: creatorProfileRows[0]?.username ?? undefined,
          });

          // 5. Update share status
          const [updatedShare] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(splitExpenseShares)
                .set({
                  status: "paid",
                  transactionId: tx.id,
                  paidAt: new Date(),
                })
                .where(eq(splitExpenseShares.id, shareId))
                .returning(),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to update share status: ${error}`,
                cause: error,
              }),
          });

          // 6. Check if all shares are paid → settle expense
          const allShares = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(splitExpenseShares)
                .where(eq(splitExpenseShares.expenseId, expense.id)),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to check all shares: ${error}`,
                cause: error,
              }),
          });

          const allPaid = allShares.every((s) => s.status === "paid");
          if (allPaid) {
            yield* Effect.tryPromise({
              try: () =>
                db
                  .update(splitExpenses)
                  .set({ status: "settled", updatedAt: new Date() })
                  .where(eq(splitExpenses.id, expense.id)),
              catch: (error) =>
                new SplitExpenseError({
                  message: `Failed to settle expense: ${error}`,
                  cause: error,
                }),
            });
          }

          return updatedShare!;
        }),

      listOwed: (userId) =>
        Effect.gen(function* () {
          // Find shares where this user is the debtor with pending status
          const pendingShares = yield* Effect.tryPromise({
            try: () =>
              db
                .select({ expenseId: splitExpenseShares.expenseId })
                .from(splitExpenseShares)
                .where(
                  and(
                    eq(splitExpenseShares.debtorUserId, userId),
                    eq(splitExpenseShares.status, "pending")
                  )
                ),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to list owed expenses: ${error}`,
                cause: error,
              }),
          });

          // Deduplicate expense IDs
          const expenseIds = [...new Set(pendingShares.map((s) => s.expenseId))];

          // Fetch each expense with its shares
          const results: SplitExpenseWithShares[] = [];
          for (const eid of expenseIds) {
            const expense = yield* fetchExpenseWithShares(eid);
            // Only include if the expense is still active
            if (expense.status === "active") {
              results.push(expense);
            }
          }

          return results;
        }),

      cancelExpense: (expenseId, userId) =>
        Effect.gen(function* () {
          // Look up the expense
          const rows = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(splitExpenses)
                .where(eq(splitExpenses.id, expenseId))
                .limit(1),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to fetch expense: ${error}`,
                cause: error,
              }),
          });

          const expense = rows[0];
          if (!expense) {
            return yield* Effect.fail(
              new SplitExpenseError({
                message: `Expense not found: ${expenseId}`,
              })
            );
          }

          // Only the creator can cancel
          if (expense.creatorUserId !== userId) {
            return yield* Effect.fail(
              new SplitExpenseError({
                message: "Only the creator can cancel this expense",
              })
            );
          }

          // Check no shares are paid
          const shareRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(splitExpenseShares)
                .where(eq(splitExpenseShares.expenseId, expenseId)),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to fetch shares: ${error}`,
                cause: error,
              }),
          });

          const hasPaidShares = shareRows.some((s) => s.status === "paid");
          if (hasPaidShares) {
            return yield* Effect.fail(
              new SplitExpenseError({
                message:
                  "Cannot cancel expense with paid shares",
              })
            );
          }

          // Cancel all pending shares
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(splitExpenseShares)
                .set({ status: "cancelled" })
                .where(
                  and(
                    eq(splitExpenseShares.expenseId, expenseId),
                    eq(splitExpenseShares.status, "pending")
                  )
                ),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to cancel shares: ${error}`,
                cause: error,
              }),
          });

          // Cancel the expense
          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(splitExpenses)
                .set({ status: "cancelled", updatedAt: new Date() })
                .where(eq(splitExpenses.id, expenseId))
                .returning(),
            catch: (error) =>
              new SplitExpenseError({
                message: `Failed to cancel expense: ${error}`,
                cause: error,
              }),
          });

          return updated!;
        }),
    };
  })
);
