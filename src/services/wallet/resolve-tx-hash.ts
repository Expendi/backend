import type { PrivyClient } from "@privy-io/node";
import type { Hash } from "viem";

const POLL_INTERVAL_MS = 1000;
const MAX_ATTEMPTS = 30;

/**
 * Polls Privy's transactions API to resolve a transaction_id
 * to an actual on-chain transaction hash. Used for sponsored
 * transactions where hash is empty on initial response.
 */
export async function resolveTransactionHash(
  privy: PrivyClient,
  transactionId: string
): Promise<Hash> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const tx = await privy.transactions().get(transactionId);

    if (tx.transaction_hash) {
      return tx.transaction_hash as Hash;
    }

    if (tx.status === "failed" || tx.status === "execution_reverted") {
      throw new Error(
        `Transaction ${transactionId} failed with status: ${tx.status}`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Timed out waiting for transaction hash for tx: ${transactionId}`
  );
}
