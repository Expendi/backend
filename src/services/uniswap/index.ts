export {
  UniswapService,
  UniswapServiceLive,
  UniswapError,
  BASE_CHAIN_ID,
  BASE_TOKENS,
} from "./uniswap-service.js";

export type {
  UniswapServiceApi,
  CheckApprovalParams,
  ApprovalResult,
  GetQuoteParams,
  QuoteResponse,
  SwapTransaction,
  SwapResponse,
} from "./uniswap-service.js";

export {
  SWAP_FEE_TIERS,
  getSwapFeeBips,
  estimateSwapUsd,
} from "./swap-fee-tiers.js";

export type { SwapFeeTier } from "./swap-fee-tiers.js";
