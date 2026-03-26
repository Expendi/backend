import { Effect, Context, Layer, Data } from "effect";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  type Hash,
  type Chain,
} from "viem";
import { mainnet, sepolia, polygon, arbitrum, optimism, base } from "viem/chains";
import {
  ContractRegistry,
  ContractNotFoundError,
} from "./contract-registry.js";
import {
  WalletService,
  WalletError,
} from "../wallet/wallet-service.js";
import { ConfigService } from "../../config.js";
import type { ContractExecutionRequest } from "./types.js";

export class ContractExecutionError extends Data.TaggedError(
  "ContractExecutionError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> { }

export interface ContractExecutionResult {
  readonly txHash: Hash;
  readonly contractName: string;
  readonly method: string;
  readonly chainId: number;
}

export interface ContractExecutorApi {
  readonly execute: (
    request: ContractExecutionRequest,
    walletId: string,
    walletType: "user" | "server" | "agent"
  ) => Effect.Effect<
    ContractExecutionResult,
    ContractExecutionError | ContractNotFoundError | WalletError
  >;
  readonly readContract: (
    contractName: string,
    chainId: number,
    method: string,
    args: readonly unknown[]
  ) => Effect.Effect<unknown, ContractExecutionError | ContractNotFoundError>;
}

export class ContractExecutor extends Context.Tag("ContractExecutor")<
  ContractExecutor,
  ContractExecutorApi
>() { }

const worldchain: Chain = {
  id: 480,
  name: "World Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://worldchain-mainnet.g.alchemy.com/public"] },
  },
};

const CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  137: polygon,
  42161: arbitrum,
  10: optimism,
  8453: base,
  480: worldchain,
};

function getChain(chainId: number): Chain {
  return CHAIN_MAP[chainId] ?? mainnet;
}

export const ContractExecutorLive: Layer.Layer<
  ContractExecutor,
  never,
  ContractRegistry | WalletService | ConfigService
> = Layer.effect(
  ContractExecutor,
  Effect.gen(function* () {
    const registry = yield* ContractRegistry;
    const walletService = yield* WalletService;
    const config = yield* ConfigService;

    return {
      execute: (
        request: ContractExecutionRequest,
        walletId: string,
        walletType: "user" | "server" | "agent"
      ) =>
        Effect.gen(function* () {
          const connector = yield* registry.get(
            request.contractName,
            request.chainId
          );

          const methodEntry = connector.methods?.[request.method];
          const functionName = methodEntry
            ? methodEntry.functionName
            : request.method;

          const data = yield* Effect.try({
            try: () =>
              encodeFunctionData({
                abi: connector.abi,
                functionName,
                args: request.args as unknown[],
              }),
            catch: (error) =>
              new ContractExecutionError({
                message: `Failed to encode function data: ${error}`,
                cause: error,
              }),
          });

          const wallet = yield* walletService.getWallet(walletId, walletType);

          const txHash = yield* wallet
            .sendTransaction({
              to: connector.address,
              data,
              value: request.value,
              chainId: request.chainId,
            })
            .pipe(
              Effect.mapError(
                (e) =>
                  new ContractExecutionError({
                    message: e.message,
                    cause: e.cause,
                  }) as ContractExecutionError | ContractNotFoundError | WalletError
              )
            );

          return {
            txHash,
            contractName: request.contractName,
            method: request.method,
            chainId: request.chainId,
          } satisfies ContractExecutionResult;
        }),

      readContract: (
        contractName: string,
        chainId: number,
        method: string,
        args: readonly unknown[]
      ) =>
        Effect.gen(function* () {
          const connector = yield* registry.get(contractName, chainId);
          const chain = getChain(chainId);
          const rpcUrl = chainId === 8453 && config.baseRpcUrl ? config.baseRpcUrl : undefined;
          const client = createPublicClient({
            chain,
            transport: http(rpcUrl),
          });

          const methodEntry = connector.methods?.[method];
          const functionName = methodEntry
            ? methodEntry.functionName
            : method;

          const result = yield* Effect.tryPromise({
            try: () =>
              client.readContract({
                address: connector.address,
                abi: connector.abi,
                functionName,
                args: args as unknown[],
              }),
            catch: (error) =>
              new ContractExecutionError({
                message: `Failed to read contract: ${error}`,
                cause: error,
              }),
          });

          return result;
        }),
    };
  })
);
