import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { ProfileWithWallets } from "../lib/types";
import { apiRequest } from "../lib/api";

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
  const { authenticated, ready, getAccessToken } = usePrivy();
  const [profile, setProfile] = useState<ProfileWithWallets | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("exo-theme");
    return (saved === "light" ? "light" : "dark");
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("exo-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const refreshProfile = async () => {
    try {
      const accessToken = await getAccessToken();
      const result = await apiRequest<ProfileWithWallets>("/profile", { accessToken });
      if (result.success) {
        setProfile(result.data);
      }
    } catch {
      // Profile may not exist yet
    }
  };

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    refreshProfile().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, ready]);

  return (
    <AuthContext.Provider value={{ authenticated, loading, profile, refreshProfile, theme, toggleTheme }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
