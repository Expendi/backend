import { Effect } from "effect";
import type { PrivyClient } from "@privy-io/node";
import type { Hash } from "viem";
import {
  type WalletInstance,
  type SendTransactionParams,
  WalletError,
} from "./wallet-service.js";

export function createUserWalletInstance(
  privy: PrivyClient,
  privyWalletId: string
): WalletInstance {
  return {
    getAddress: () =>
      Effect.tryPromise({
        try: async () => {
          const wallet = await privy.wallets().get(privyWalletId);
          return wallet.address as `0x${string}`;
        },
        catch: (error) =>
          new WalletError({
            message: `Failed to get user wallet address: ${error}`,
            cause: error,
          }),
      }),

    sign: (message: string) =>
      Effect.tryPromise({
        try: async () => {
          const result = await privy.wallets().rpc(privyWalletId, {
            method: "personal_sign",
            params: { encoding: "utf-8", message },
          });
          return result.data.signature as `0x${string}`;
        },
        catch: (error) =>
          new WalletError({
            message: `Failed to sign with user wallet: ${error}`,
            cause: error,
          }),
      }),

    sendTransaction: (tx: SendTransactionParams) =>
      Effect.tryPromise({
        try: async () => {
          const result = await privy.wallets().rpc(privyWalletId, {
            method: "eth_sendTransaction",
            caip2: `eip155:${tx.chainId}`,
            params: {
              transaction: {
                to: tx.to,
                value: tx.value ? Number(tx.value) : 0,
                data: tx.data ?? "0x",
              },
            },
            sponsor: tx.sponsor,
          });
          return result.data.hash as Hash;
        },
        catch: (error) =>
          new WalletError({
            message: `Failed to send transaction from user wallet: ${error}`,
            cause: error,
          }),
      }),
  };
}
