import { Effect, Context, Layer, Data } from "effect";
import type { Hash } from "viem";
import { parseUnits, parseEther, isAddress, encodeFunctionData } from "viem";
import {
  LedgerService,
  type LedgerError,
  type CreateIntentParams,
} from "../ledger/ledger-service.js";
import {
  ContractExecutor,
  type ContractExecutionError,
} from "../contract/contract-executor.js";
import {
  ContractRegistry,
  type ContractNotFoundError,
} from "../contract/contract-registry.js";
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
  readonly value?: number | bigint;
  readonly categoryId?: string;
  readonly userId?: string;
}

export interface SubmitRawTxParams {
  readonly walletId: string;
  readonly walletType: "user" | "server" | "agent";
  readonly chainId: number;
  readonly to: `0x${string}`;
  readonly data?: `0x${string}`;
  readonly value?: number | bigint;
  readonly categoryId?: string;
  readonly userId?: string;
  readonly sponsor?: boolean;
  readonly amount?: string;
  readonly recipientProfileName?: string;
}

export interface SubmitTransferParams {
  readonly walletId: string;
  readonly walletType: "user" | "server" | "agent";
  readonly to: `0x${string}`;
  readonly amount: string;
  readonly token: string;
  readonly chainId: number;
  readonly categoryId?: string;
  readonly userId?: string;
}

/** Known token decimals for common stablecoins; default to 18 for unknowns. */
const TOKEN_DECIMALS: Record<string, number> = {
  usdc: 6,
  usdt: 6,
};

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
  readonly submitTransfer: (
    params: SubmitTransferParams
  ) => Effect.Effect<
    Transaction,
    | TransactionError
    | LedgerError
    | ContractExecutionError
    | ContractNotFoundError
    | WalletError
  >;
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
  LedgerService | ContractExecutor | ContractRegistry | WalletService
> = Layer.effect(
  TransactionService,
  Effect.gen(function* () {
    const ledger = yield* LedgerService;
    const executor = yield* ContractExecutor;
    const registry = yield* ContractRegistry;
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
              amount: params.amount,
              recipientProfileName: params.recipientProfileName,
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

      submitTransfer: (params: SubmitTransferParams) =>
        Effect.gen(function* () {
          const isNativeETH = params.token.toUpperCase() === "ETH";

          if (isNativeETH) {
            // Native ETH transfer
            const value = yield* Effect.try({
              try: () => parseEther(params.amount),
              catch: (error) =>
                new TransactionError({
                  message: `Invalid amount: ${error}`,
                  cause: error,
                }),
            });

            const intent = yield* ledger.createIntent({
              walletId: params.walletId,
              walletType: params.walletType,
              chainId: String(params.chainId),
              method: "transfer",
              payload: {
                to: params.to,
                value: String(value),
                amount: params.amount,
                token: "ETH",
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
                value,
                chainId: params.chainId,
              })
              .pipe(
                Effect.tapError((error) =>
                  ledger.markFailed(intent.id, String(error)).pipe(Effect.ignore)
                )
              );

            return yield* ledger.markSubmitted(intent.id, txHash);
          }

          // ERC20 transfer — resolve token contract
          const tokenKey = params.token.toLowerCase();
          let tokenAddress: `0x${string}`;
          let decimals: number;

          // Try to look up by name in the connector registry
          const connectorResult = yield* registry
            .get(tokenKey, params.chainId)
            .pipe(Effect.either);

          if (connectorResult._tag === "Right") {
            tokenAddress = connectorResult.right.address;
            decimals = TOKEN_DECIMALS[tokenKey] ?? 18;
          } else if (isAddress(params.token)) {
            // Treat as raw contract address
            tokenAddress = params.token as `0x${string}`;
            decimals = 18;
          } else {
            return yield* Effect.fail(
              new TransactionError({
                message: `Token "${params.token}" not found in registry for chain ${params.chainId} and is not a valid address`,
              })
            );
          }

          const rawAmount = yield* Effect.try({
            try: () => parseUnits(params.amount, decimals),
            catch: (error) =>
              new TransactionError({
                message: `Invalid amount: ${error}`,
                cause: error,
              }),
          });

          const data = yield* Effect.try({
            try: () =>
              encodeFunctionData({
                abi: ERC20_TRANSFER_ABI,
                functionName: "transfer",
                args: [params.to, rawAmount],
              }),
            catch: (error) =>
              new TransactionError({
                message: `Failed to encode transfer: ${error}`,
                cause: error,
              }),
          });

          const intent = yield* ledger.createIntent({
            walletId: params.walletId,
            walletType: params.walletType,
            chainId: String(params.chainId),
            contractId: tokenKey,
            method: "transfer",
            payload: {
              to: params.to,
              amount: params.amount,
              token: params.token,
              tokenAddress,
              rawAmount: String(rawAmount),
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
              to: tokenAddress,
              data,
              chainId: params.chainId,
            })
            .pipe(
              Effect.tapError((error) =>
                ledger.markFailed(intent.id, String(error)).pipe(Effect.ignore)
              )
            );

          return yield* ledger.markSubmitted(intent.id, txHash);
        }),

      getTransaction: (id: string) => ledger.getById(id),

      listTransactions: (limit?: number, offset?: number) =>
        ledger.listAll(limit, offset),
    };
  })
);
