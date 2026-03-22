import {
  createContext,
  useContext,
  useCallback,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./AuthContext";
import { useWalletBalancesQuery, useTransactionsQuery } from "../hooks/queries";
import { queryKeys } from "../lib/query-client";
import type { ProfileWithWallets, Transaction } from "../lib/types";

/* ─── Types ───────────────────────────────────────────────────────── */

export interface WalletBalance {
  type: "user" | "server" | "agent";
  address: string | null;
  balance: string | null;
}

export interface WalletBalanceDetailed {
  walletId: string;
  type: string;
  address: string;
  balances: Record<string, string>;
}

interface DashboardContextValue {
  profile: ProfileWithWallets | null;
  wallets: WalletBalance[];
  walletBalances: WalletBalanceDetailed[];
  recentTransactions: Transaction[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue>({
  profile: null,
  wallets: [],
  walletBalances: [],
  recentTransactions: [],
  loading: true,
  error: null,
  refresh: async () => {},
});

export function useDashboard() {
  return useContext(DashboardContext);
}

/* ─── Provider ────────────────────────────────────────────────────── */

export function DashboardProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const balancesQuery = useWalletBalancesQuery();
  const transactionsQuery = useTransactionsQuery(20);

  const walletBalances = balancesQuery.data ?? [];
  const recentTransactions = transactionsQuery.data ?? [];

  const wallets: WalletBalance[] = profile?.wallets
    ? [
        { type: "user", address: profile.wallets.user.address, balance: null },
        { type: "server", address: profile.wallets.server.address, balance: null },
        { type: "agent", address: profile.wallets.agent.address, balance: null },
      ]
    : [];

  const loading = balancesQuery.isLoading || transactionsQuery.isLoading;
  const error = balancesQuery.error
    ? balancesQuery.error instanceof Error
      ? balancesQuery.error.message
      : "Failed to fetch balances"
    : null;

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.walletBalances }),
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.profile }),
    ]);
  }, [queryClient]);

  const value: DashboardContextValue = {
    profile,
    wallets,
    walletBalances,
    recentTransactions,
    loading,
    error,
    refresh,
  };

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}
