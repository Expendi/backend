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
  /** Upper USD threshold (inclusive) for this tier */
  maxUsd: number;
  /** Fee in basis points (e.g. 25 = 0.25%) */
  bips: number;
}

/** Tiers ordered by ascending threshold — first match wins. */
export const SWAP_FEE_TIERS: SwapFeeTier[] = [
  { maxUsd: 100,       bips: 25 },   // 0.25%  — $0 – $100
  { maxUsd: 1_000,     bips: 20 },   // 0.20%  — $100.01 – $1,000
  { maxUsd: 10_000,    bips: 15 },   // 0.15%  — $1,000.01 – $10,000
  { maxUsd: 50_000,    bips: 10 },   // 0.10%  — $10,000.01 – $50,000
  { maxUsd: Infinity,  bips: 5 },    // 0.05%  — $50,000+
];

/**
 * Return the platform fee in basis points for a given swap USD value.
 */
export function getSwapFeeBips(usdValue: number): number {
  const tier = SWAP_FEE_TIERS.find((t) => usdValue <= t.maxUsd);
  return tier?.bips ?? 5;
}

// ── Known stablecoin addresses (Base chain, lowercase) ───────────────

const STABLECOIN_DECIMALS: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,   // USDC
  "0x2d1adb45bb1d7d2556c6558adb76cfd4f9f4ed16": 6,   // USDT
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": 18,  // DAI
};

/**
 * Estimate the USD value of a swap from a Uniswap quote.
 *
 * Strategy: if either the input or output token is a known stablecoin,
 * use the corresponding raw amount divided by the token's decimals.
 * Falls back to 0 (which maps to the highest-fee tier — safe default).
 */
export function estimateSwapUsd(
  tokenIn: string,
  tokenOut: string,
  inputAmount: string,
  outputAmount: string
): number {
  const inDecimals = STABLECOIN_DECIMALS[tokenIn.toLowerCase()];
  if (inDecimals != null) {
    return Number(inputAmount) / 10 ** inDecimals;
  }

  const outDecimals = STABLECOIN_DECIMALS[tokenOut.toLowerCase()];
  if (outDecimals != null) {
    return Number(outputAmount) / 10 ** outDecimals;
  }

  // Neither side is a recognised stablecoin — return 0 so the
  // highest fee tier (0.25%) is applied as a safe default.
  return 0;
}
