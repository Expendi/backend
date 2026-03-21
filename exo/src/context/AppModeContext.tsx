import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type AppMode = "simple" | "agent";

interface AppModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
}

const AppModeContext = createContext<AppModeContextValue>({
  mode: "simple",
  setMode: () => {},
  toggleMode: () => {},
});

export function useAppMode() {
  return useContext(AppModeContext);
}

const STORAGE_KEY = "exo-app-mode";

export function AppModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "agent" ? "agent" : "simple";
  });

  const setMode = useCallback((newMode: AppMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "simple" ? "agent" : "simple");
  }, [mode, setMode]);

  return (
    <AppModeContext.Provider value={{ mode, setMode, toggleMode }}>
      {children}
    </AppModeContext.Provider>
  );
}
