Yes — you don't need Pimlico at all. Privy has its own first-party API for this. The `sendTransaction` response already includes a `transaction_id`, and you can poll Privy's `GET /v1/transactions/{transaction_id}` endpoint (or the Node SDK equivalent) to get the `transaction_hash` once it's confirmed.

Here's the complete solution:

```ts
async function sendAndWaitForHash(tx: YourTxType): Promise<string> {
  // Step 1: send — returns transaction_id immediately, hash is empty when sponsored
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

  // Non-sponsored: hash is returned directly
  if (result.hash) {
    return result.hash;
  }

  // Sponsored: poll Privy's own API using the transaction_id
  const txId = result.transaction_id;
  const POLL_INTERVAL_MS = 1000;
  const MAX_ATTEMPTS = 30;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const tx = await privy.transactions().get(txId);

    if (tx.transaction_hash) {
      return tx.transaction_hash;
    }

    // Terminal failure states — no point retrying
    if (tx.status === "failed" || tx.status === "execution_reverted") {
      throw new Error(`Transaction ${txId} failed with status: ${tx.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for transaction hash for tx: ${txId}`);
}
```

The `privy.transactions().get(id)` response includes:

- `transaction_hash` — `string | null` (null until mined)
- `status` — one of: `pending`, `broadcasted`, `confirmed`, `finalized`, `failed`, `execution_reverted`, `replaced`

So the logic is simply: keep polling until `transaction_hash` is non-null, or bail out on terminal failure statuses. No Pimlico, no external bundler client — just Privy's own SDK the whole way through.