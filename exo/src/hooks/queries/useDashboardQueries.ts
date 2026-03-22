import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../useApi";
import { queryKeys } from "../../lib/query-client";
import type { Transaction } from "../../lib/types";
import type { WalletBalanceDetailed } from "../../context/DashboardContext";

export function useWalletBalancesQuery() {
  const { request } = useApi();

  return useQuery({
    queryKey: queryKeys.walletBalances,
    queryFn: () => request<WalletBalanceDetailed[]>("/wallets/balances"),
    refetchInterval: 30_000,
  });
}

export function useTransactionsQuery(limit = 20) {
  const { request } = useApi();

  return useQuery({
    queryKey: queryKeys.transactions({ limit }),
    queryFn: () =>
      request<Transaction[]>("/transactions", { query: { limit } }),
    refetchInterval: 60_000,
  });
}

export function useTransferMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      from: string;
      to: string;
      amount: string;
      token?: string;
      categoryId?: string;
      approvalToken?: string;
    }) => {
      const { approvalToken, ...rest } = body;
      return request<{ txHash?: string }>("/wallets/transfer", {
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
