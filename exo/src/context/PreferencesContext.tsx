import {
  createContext,
  useContext,
  useCallback,
  type ReactNode,
} from "react";
import { usePreferencesQuery, usePreferencesMutation } from "../hooks/queries";
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
  const { data: preferences = {}, isLoading } = usePreferencesQuery();
  const mutation = usePreferencesMutation();

  const updatePreferences = useCallback(
    async (patch: Partial<UserPreferences>) => {
      await mutation.mutateAsync(patch);
    },
    [mutation]
  );

  return (
    <PreferencesContext.Provider value={{ preferences, loading: isLoading, updatePreferences }}>
      {children}
    </PreferencesContext.Provider>
  );
}
