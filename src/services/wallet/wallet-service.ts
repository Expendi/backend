import { Effect, Context, Data } from "effect";
import type { Hash } from "viem";

export class WalletError extends Data.TaggedError("WalletError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SendTransactionParams {
  readonly to: string;
  readonly value?: number | bigint;
  readonly data?: string;
  readonly chainId: number;
  readonly sponsor?: boolean;
}

export interface WalletInstance {
  readonly getAddress: () => Effect.Effect<`0x${string}`, WalletError>;
  readonly sign: (message: string) => Effect.Effect<`0x${string}`, WalletError>;
  readonly sendTransaction: (
    tx: SendTransactionParams
  ) => Effect.Effect<Hash, WalletError>;
}

export interface WalletServiceApi {
  readonly createUserWallet: (
    userId: string
  ) => Effect.Effect<WalletInstance, WalletError>;
  readonly createServerWallet: () => Effect.Effect<WalletInstance, WalletError>;
  readonly createAgentWallet: (
    agentId: string
  ) => Effect.Effect<WalletInstance, WalletError>;
  readonly getWallet: (
    walletId: string,
    type: "user" | "server" | "agent"
  ) => Effect.Effect<WalletInstance, WalletError>;
}

export class WalletService extends Context.Tag("WalletService")<
  WalletService,
  WalletServiceApi
>() {}
