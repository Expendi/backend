import { Effect, Context, Layer, Data } from "effect";
import type { Hash } from "viem";
import {
  LedgerService,
  type LedgerError,
  type CreateIntentParams,
} from "../ledger/ledger-service.js";
import {
  ContractExecutor,
  type ContractExecutionError,
} from "../contract/contract-executor.js";
import { type ContractNotFoundError } from "../contract/contract-registry.js";
import {
  WalletService,
  type WalletError,
} from "../wallet/wallet-service.js";
import type { Transaction } from "../../db/schema/index.js";

export class TransactionError extends Data.TaggedError("TransactionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SubmitContractTxParams {
  readonly walletId: string;
  readonly walletType: "user" | "server" | "agent";
  readonly contractName: string;
  readonly chainId: number;
  readonly method: string;
  readonly args: readonly unknown[];
  readonly value?: bigint;
  readonly categoryId?: string;
  readonly userId?: string;
}

export interface SubmitRawTxParams {
  readonly walletId: string;
  readonly walletType: "user" | "server" | "agent";
  readonly chainId: number;
  readonly to: `0x${string}`;
  readonly data?: `0x${string}`;
  readonly value?: bigint;
  readonly categoryId?: string;
  readonly userId?: string;
  readonly sponsor?: boolean;
}

export interface TransactionServiceApi {
  readonly submitContractTransaction: (
    params: SubmitContractTxParams
  ) => Effect.Effect<
    Transaction,
    | TransactionError
    | LedgerError
    | ContractExecutionError
    | ContractNotFoundError
    | WalletError
  >;
  readonly submitRawTransaction: (
    params: SubmitRawTxParams
  ) => Effect.Effect<Transaction, TransactionError | LedgerError | WalletError>;
  readonly getTransaction: (
    id: string
  ) => Effect.Effect<Transaction | undefined, LedgerError>;
  readonly listTransactions: (
    limit?: number,
    offset?: number
  ) => Effect.Effect<ReadonlyArray<Transaction>, LedgerError>;
}

export class TransactionService extends Context.Tag("TransactionService")<
  TransactionService,
  TransactionServiceApi
>() {}

export const TransactionServiceLive: Layer.Layer<
  TransactionService,
  never,
  LedgerService | ContractExecutor | WalletService
> = Layer.effect(
  TransactionService,
  Effect.gen(function* () {
    const ledger = yield* LedgerService;
    const executor = yield* ContractExecutor;
    const walletService = yield* WalletService;

    return {
      submitContractTransaction: (params: SubmitContractTxParams) =>
        Effect.gen(function* () {
          const serializeArg = (v: unknown): unknown =>
            typeof v === "bigint" ? v.toString() : v;

          const intentParams: CreateIntentParams = {
            walletId: params.walletId,
            walletType: params.walletType,
            chainId: String(params.chainId),
            contractId: params.contractName,
            method: params.method,
            payload: {
              args: (params.args as unknown[]).map(serializeArg),
              value: params.value ? String(params.value) : undefined,
            },
            categoryId: params.categoryId,
            userId: params.userId,
          };

          const intent = yield* ledger.createIntent(intentParams);

          const result = yield* executor
            .execute(
              {
                contractName: params.contractName,
                chainId: params.chainId,
                method: params.method,
                args: params.args,
                value: params.value,
              },
              params.walletId,
              params.walletType
            )
            .pipe(
              Effect.tapError((error) =>
                ledger.markFailed(intent.id, String(error)).pipe(Effect.ignore)
              )
            );

          const submitted = yield* ledger.markSubmitted(
            intent.id,
            result.txHash
          );

          return submitted;
        }),

      submitRawTransaction: (params: SubmitRawTxParams) =>
        Effect.gen(function* () {
          const intent = yield* ledger.createIntent({
            walletId: params.walletId,
            walletType: params.walletType,
            chainId: String(params.chainId),
            method: "raw_transfer",
            payload: {
              to: params.to,
              data: params.data,
              value: params.value ? String(params.value) : undefined,
            },
            categoryId: params.categoryId,
            userId: params.userId,
          });

          const wallet = yield* walletService.getWallet(
            params.walletId,
            params.walletType
          );

          const txHash = yield* wallet
            .sendTransaction({
              to: params.to,
              data: params.data,
              value: params.value,
              chainId: params.chainId,
              sponsor: params.sponsor ?? true,
            })
            .pipe(
              Effect.tapError((error) =>
                ledger.markFailed(intent.id, String(error)).pipe(Effect.ignore)
              )
            );

          const submitted = yield* ledger.markSubmitted(intent.id, txHash);
          return submitted;
        }),

      getTransaction: (id: string) => ledger.getById(id),

      listTransactions: (limit?: number, offset?: number) =>
        ledger.listAll(limit, offset),
    };
  })
);
