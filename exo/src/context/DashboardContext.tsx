import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useApi } from "../hooks/useApi";
import { useAuth } from "./AuthContext";
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
  const { requestRaw, request } = useApi();
  const { profile, refreshProfile } = useAuth();

  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [walletBalances, setWalletBalances] = useState<WalletBalanceDetailed[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const profileIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const txIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchWallets = useCallback(async () => {
    try {
      const result = await requestRaw<ProfileWithWallets>("/profile");
      if (result.success && result.data.wallets) {
        const w = result.data.wallets;
        const balances: WalletBalance[] = [
          { type: "user", address: w.user.address, balance: null },
          { type: "server", address: w.server.address, balance: null },
          { type: "agent", address: w.agent.address, balance: null },
        ];
        setWallets(balances);
        setError(null);
      } else if (!result.success) {
        setError(result.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch wallets");
    }
  }, [requestRaw]);

  const fetchBalances = useCallback(async () => {
    try {
      const data = await request<WalletBalanceDetailed[]>("/wallets/balances");
      setWalletBalances(data);
    } catch {
      // Non-critical
    }
  }, [request]);

  const fetchTransactions = useCallback(async () => {
    try {
      const result = await requestRaw<Transaction[]>("/transactions", {
        query: { limit: 20 },
      });
      if (result.success) {
        setRecentTransactions(result.data);
      }
    } catch {
      // Non-critical
    }
  }, [requestRaw]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchWallets(), fetchBalances(), fetchTransactions(), refreshProfile()]);
    setLoading(false);
  }, [fetchWallets, fetchBalances, fetchTransactions, refreshProfile]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      await Promise.all([fetchWallets(), fetchBalances(), fetchTransactions()]);
      if (!cancelled) setLoading(false);
    }

    init();

    profileIntervalRef.current = setInterval(() => {
      fetchWallets();
      fetchBalances();
    }, 30000);
    txIntervalRef.current = setInterval(fetchTransactions, 60000);

    return () => {
      cancelled = true;
      if (profileIntervalRef.current) clearInterval(profileIntervalRef.current);
      if (txIntervalRef.current) clearInterval(txIntervalRef.current);
    };
  }, [fetchWallets, fetchBalances, fetchTransactions]);

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
