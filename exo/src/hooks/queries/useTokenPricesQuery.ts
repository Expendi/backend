import { useQuery } from "@tanstack/react-query";
import { useApi } from "../useApi";
import { queryKeys } from "../../lib/query-client";
import type { TokenPrices } from "../useTokenPrices";

export function useTokenPricesQuery() {
  const { request } = useApi();

  return useQuery({
    queryKey: queryKeys.tokenPrices,
    queryFn: () => request<TokenPrices>("/tokens/prices"),
    refetchInterval: 60_000,
    initialData: {} as TokenPrices,
  });
}
