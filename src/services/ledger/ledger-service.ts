import { Effect, Context, Layer, Data } from "effect";
import { eq, desc } from "drizzle-orm";
import type { Hash } from "viem";
import { DatabaseService } from "../../db/client.js";
import {
  transactions,
  type Transaction,
  type NewTransaction,
} from "../../db/schema/index.js";

export class LedgerError extends Data.TaggedError("LedgerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface CreateIntentParams {
  readonly walletId: string;
  readonly walletType: "user" | "server" | "agent";
  readonly chainId: string;
  readonly contractId?: string;
  readonly method: string;
  readonly payload: Record<string, unknown>;
  readonly categoryId?: string;
  readonly userId?: string;
}

export interface LedgerServiceApi {
  readonly createIntent: (
    params: CreateIntentParams
  ) => Effect.Effect<Transaction, LedgerError>;
  readonly markSubmitted: (
    id: string,
    txHash: Hash
  ) => Effect.Effect<Transaction, LedgerError>;
  readonly markConfirmed: (
    id: string,
    gasUsed?: bigint
  ) => Effect.Effect<Transaction, LedgerError>;
  readonly markFailed: (
    id: string,
    error: string
  ) => Effect.Effect<Transaction, LedgerError>;
  readonly getById: (
    id: string
  ) => Effect.Effect<Transaction | undefined, LedgerError>;
  readonly listByWallet: (
    walletId: string
  ) => Effect.Effect<ReadonlyArray<Transaction>, LedgerError>;
  readonly listByUser: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<Transaction>, LedgerError>;
  readonly listAll: (
    limit?: number,
    offset?: number
  ) => Effect.Effect<ReadonlyArray<Transaction>, LedgerError>;
}

export class LedgerService extends Context.Tag("LedgerService")<
  LedgerService,
  LedgerServiceApi
>() {}

export const LedgerServiceLive: Layer.Layer<
  LedgerService,
  never,
  DatabaseService
> = Layer.effect(
  LedgerService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    return {
      createIntent: (params: CreateIntentParams) =>
        Effect.tryPromise({
          try: async () => {
            const values: NewTransaction = {
              walletId: params.walletId,
              walletType: params.walletType,
              chainId: params.chainId,
              contractId: params.contractId ?? null,
              method: params.method,
              payload: params.payload,
              status: "pending",
              categoryId: params.categoryId ?? null,
              userId: params.userId ?? null,
            };
            const [result] = await db
              .insert(transactions)
              .values(values)
              .returning();
            return result!;
          },
          catch: (error) =>
            new LedgerError({
              message: `Failed to create intent: ${error}`,
              cause: error,
            }),
        }),

      markSubmitted: (id: string, txHash: Hash) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(transactions)
              .set({ status: "submitted", txHash })
              .where(eq(transactions.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new LedgerError({
              message: `Failed to mark submitted: ${error}`,
              cause: error,
            }),
        }),

      markConfirmed: (id: string, gasUsed?: bigint) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(transactions)
              .set({
                status: "confirmed",
                gasUsed: gasUsed ?? null,
                confirmedAt: new Date(),
              })
              .where(eq(transactions.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new LedgerError({
              message: `Failed to mark confirmed: ${error}`,
              cause: error,
            }),
        }),

      markFailed: (id: string, error: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(transactions)
              .set({ status: "failed", error })
              .where(eq(transactions.id, id))
              .returning();
            return result!;
          },
          catch: (err) =>
            new LedgerError({
              message: `Failed to mark failed: ${err}`,
              cause: err,
            }),
        }),

      getById: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .select()
              .from(transactions)
              .where(eq(transactions.id, id));
            return result;
          },
          catch: (error) =>
            new LedgerError({
              message: `Failed to get transaction: ${error}`,
              cause: error,
            }),
        }),

      listByWallet: (walletId: string) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(transactions)
              .where(eq(transactions.walletId, walletId))
              .orderBy(desc(transactions.createdAt));
            return results;
          },
          catch: (error) =>
            new LedgerError({
              message: `Failed to list by wallet: ${error}`,
              cause: error,
            }),
        }),

      listByUser: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(transactions)
              .where(eq(transactions.userId, userId))
              .orderBy(desc(transactions.createdAt));
            return results;
          },
          catch: (error) =>
            new LedgerError({
              message: `Failed to list by user: ${error}`,
              cause: error,
            }),
        }),

      listAll: (limit = 50, offset = 0) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(transactions)
              .orderBy(desc(transactions.createdAt))
              .limit(limit)
              .offset(offset);
            return results;
          },
          catch: (error) =>
            new LedgerError({
              message: `Failed to list transactions: ${error}`,
              cause: error,
            }),
        }),
    };
  })
);
