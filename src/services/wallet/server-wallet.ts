import { Effect } from "effect";
import type { PrivyClient } from "@privy-io/node";
import type { Hash } from "viem";
import {
  type WalletInstance,
  type SendTransactionParams,
  WalletError,
} from "./wallet-service.js";
import { resolveTransactionHash } from "./resolve-tx-hash.js";

export function createServerWalletInstance(
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
            message: `Failed to get server wallet address: ${error}`,
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
            message: `Failed to sign with server wallet: ${error}`,
            cause: error,
          }),
      }),

    sendTransaction: (tx: SendTransactionParams) =>
      Effect.tryPromise({
        try: async () => {
          const result = await privy.wallets().ethereum().sendTransaction(privyWalletId, {
            caip2: `eip155:${tx.chainId}`,
            params: {
              transaction: {
                to: tx.to,
                value: tx.value ? Number(tx.value) : 0,
                data: tx.data ?? "0x",
              },
            },
            sponsor: tx.sponsor == undefined ? true : tx.sponsor,
          });

          if (result.hash) {
            return result.hash as Hash;
          }

          if (!result.transaction_id) {
            throw new Error("No hash or transaction_id returned from Privy");
          }

          return await resolveTransactionHash(privy, result.transaction_id);
        },
        catch: (error) =>
          new WalletError({
            message: `Failed to send transaction from server wallet: ${error}`,
            cause: error,
          }),
      }),
  };
}
