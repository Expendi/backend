import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../useApi";
import { queryKeys } from "../../lib/query-client";
import type { SwapQuote, SwapResult } from "../../lib/types";

export function useSwapQuoteMutation() {
  const { request } = useApi();

  return useMutation({
    mutationFn: (body: {
      walletId: string;
      tokenIn: string;
      tokenOut: string;
      amount: string;
      type?: string;
      slippageTolerance?: number;
    }) =>
      request<SwapQuote>("/uniswap/quote", {
        method: "POST",
        body,
      }),
  });
}

export function useSwapMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      walletId: string;
      tokenIn: string;
      tokenOut: string;
      amount: string;
      type?: string;
      slippageTolerance?: number;
      approvalToken?: string;
    }) => {
      const { approvalToken, ...rest } = body;
      return request<SwapResult>("/uniswap/swap", {
        method: "POST",
        body: rest,
        approvalToken,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.walletBalances });
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions() });
    },
  });
}
