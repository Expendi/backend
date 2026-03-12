import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useApi } from "../hooks/useApi";
import { useAuth } from "./AuthContext";
import type { UserPreferences } from "../lib/types";

interface PreferencesContextValue {
  preferences: UserPreferences;
  loading: boolean;
  updatePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
}

const PreferencesContext = createContext<PreferencesContextValue>({
  preferences: {},
  loading: true,
  updatePreferences: async () => {},
});

export function usePreferences() {
  return useContext(PreferencesContext);
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { request } = useApi();
  const { authenticated } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authenticated) {
      setPreferences({});
      setLoading(false);
      return;
    }

    let cancelled = false;
    request<UserPreferences>("/profile/preferences")
      .then((data) => {
        if (!cancelled) setPreferences(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated, request]);

  const updatePreferences = useCallback(
    async (patch: Partial<UserPreferences>) => {
      const updated = await request<UserPreferences>("/profile/preferences", {
        method: "PATCH",
        body: patch,
      });
      setPreferences(updated);
    },
    [request]
  );

  return (
    <PreferencesContext.Provider value={{ preferences, loading, updatePreferences }}>
      {children}
    </PreferencesContext.Provider>
  );
}
