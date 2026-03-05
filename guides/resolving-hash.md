# Resolving Transaction Hashes for Sponsored Transactions

## The problem

Privy's `sendTransaction` with `sponsor: true` returns an empty `hash` and only populates `user_operation_hash` and `transaction_id`. There is no way to get the on-chain transaction hash directly from the send response.

## The solution

We poll Privy's native `transactions().get()` API using the returned `transaction_id` until the on-chain hash is available. No external bundler (Pimlico) is needed.

> **Note:** This replaced an earlier approach that used a Pimlico bundler client to resolve `user_operation_hash` via `waitForUserOperationReceipt`. That is no longer necessary because Privy provides this natively through their transactions API.

---

### How it works in our codebase

The core logic lives in `src/services/wallet/resolve-tx-hash.ts`, which exports a single function:

```ts
resolveTransactionHash(privy: PrivyClient, transactionId: string): Promise<Hash>
```

- Polls `privy.transactions().get(transactionId)` every 1 second, up to 30 attempts
- Returns `transaction_hash` as soon as it is available
- Throws immediately on terminal statuses (`failed`, `execution_reverted`)
- Throws a timeout error if the hash is not resolved after 30 attempts

All wallet types (user, server, agent) call this automatically inside their `sendTransaction` method when the initial response lacks a hash.

---

### The flow

1. `sendTransaction` calls Privy and receives `{ hash: "", transaction_id: "xxx" }`
2. If `hash` is present and non-empty, return it directly (non-sponsored path)
3. Otherwise, call `resolveTransactionHash(privy, transaction_id)` which polls until the hash appears

```ts
const result = await privy.wallets().ethereum().sendTransaction(privyWalletId, {
  caip2: `eip155:${chainId}`,
  params: {
    transaction: { to, value, data },
  },
  sponsor: true,
});

if (result.hash) {
  return result.hash;
}

const txHash = await resolveTransactionHash(privy, result.transaction_id);
return txHash;
```
