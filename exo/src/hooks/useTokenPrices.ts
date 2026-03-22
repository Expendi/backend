import { useTokenPricesQuery } from "./queries/useTokenPricesQuery";

export interface TokenPrices {
  [symbol: string]: { usd: number; change24h: number };
}

/**
 * Backward-compatible wrapper around the React Query-based token prices hook.
 */
export function useTokenPrices() {
  const { data, isLoading } = useTokenPricesQuery();
  return { prices: data ?? {}, loading: isLoading };
}
