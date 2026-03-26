/**
 * Platform fee tiers for Uniswap swaps.
 *
 * Fees are expressed in basis points (1 bps = 0.01%) and passed to the
 * Uniswap Trading API via the `portionBips` parameter.  The fee is
 * deducted from the swap output and routed to the platform fee recipient.
 *
 * Tier boundaries are denominated in USD (derived from the quote).
 */

export interface SwapFeeTier {
  /** Minimum swap USD value (inclusive) */
  minUsd: number;
  /** Maximum swap USD value (inclusive) */
  maxUsd: number;
  /** Fee in basis points (e.g. 25 = 0.25%) */
  bips: number;
}

export const SWAP_FEE_TIERS: SwapFeeTier[] = [
  { minUsd: 0,      maxUsd: 100,    bips: 25 },   // 0.25%
  { minUsd: 101,    maxUsd: 1_000,  bips: 20 },   // 0.20%
  { minUsd: 1_001,  maxUsd: 10_000, bips: 15 },   // 0.15%
  { minUsd: 10_001, maxUsd: 50_000, bips: 10 },   // 0.10%
  { minUsd: 50_001, maxUsd: Infinity, bips: 5 },   // 0.05%
];

/**
 * Return the platform fee in basis points for a given swap USD value.
 * Falls back to the lowest tier (5 bps) for amounts above all tiers.
 */
export function getSwapFeeBips(usdValue: number): number {
  const tier = SWAP_FEE_TIERS.find(
    (t) => usdValue >= t.minUsd && usdValue <= t.maxUsd
  );
  return tier?.bips ?? 5;
}
