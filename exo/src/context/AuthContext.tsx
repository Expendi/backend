import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useProfileQuery } from "../hooks/queries";
import { queryKeys } from "../lib/query-client";
import type { ProfileWithWallets } from "../lib/types";

interface AuthContextValue {
  authenticated: boolean;
  loading: boolean;
  profile: ProfileWithWallets | null;
  refreshProfile: () => Promise<void>;
  theme: "dark" | "light";
  toggleTheme: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  authenticated: false,
  loading: true,
  profile: null,
  refreshProfile: async () => {},
  theme: "dark",
  toggleTheme: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { authenticated, ready } = usePrivy();
  const queryClient = useQueryClient();
  const profileQuery = useProfileQuery();

  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("exo-theme");
    return (saved === "light" ? "light" : "dark");
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("exo-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const refreshProfile = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.profile });
  }, [queryClient]);

  const loading = !ready || (authenticated && profileQuery.isLoading);
  const profile = authenticated ? (profileQuery.data ?? null) : null;

  return (
    <AuthContext.Provider value={{ authenticated, loading, profile, refreshProfile, theme, toggleTheme }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
