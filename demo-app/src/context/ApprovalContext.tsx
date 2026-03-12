import { createContext, useContext, useCallback, useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { useApproval } from "../hooks/useApproval";
import { setApprovalHandler } from "../tools/api";
import { ApprovalPrompt } from "../components/ApprovalPrompt";
import type { ApprovalSettings } from "../lib/types";

interface ApprovalContextValue {
  requestApproval: (method: string) => Promise<string | null>;
}

const ApprovalContext = createContext<ApprovalContextValue | null>(null);

export function useApprovalContext() {
  return useContext(ApprovalContext);
}

interface PendingApproval {
  resolve: (token: string | null) => void;
}

export function ApprovalProvider({ children }: { children: ReactNode }) {
  const { verifyPin, verifyPasskey, fetchSettings } = useApproval();
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [settings, setSettings] = useState<ApprovalSettings | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<"pin" | "passkey" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pendingRef = useRef<PendingApproval | null>(null);

  const requestApproval = useCallback(
    async (method: string): Promise<string | null> => {
      // Fetch latest settings to know available methods
      let s: ApprovalSettings;
      try {
        s = await fetchSettings();
      } catch {
        s = {
          enabled: true,
          method: method === "passkey" ? "passkey" : "pin",
          hasPin: method === "pin",
          passkeyCount: method === "passkey" ? 1 : 0,
        };
      }
      setSettings(s);

      const hasBoth = s.hasPin && s.passkeyCount > 0;

      return new Promise<string | null>((resolve) => {
        const approval: PendingApproval = { resolve };
        pendingRef.current = approval;
        setError(null);
        setLoading(false);
        // If both methods available, show chooser. Otherwise auto-select the available one.
        setSelectedMethod(hasBoth ? null : s.hasPin ? "pin" : "passkey");
        setPending(approval);
      });
    },
    [fetchSettings]
  );

  useEffect(() => {
    setApprovalHandler(requestApproval);
    return () => setApprovalHandler(() => Promise.resolve(null));
  }, [requestApproval]);

  const handleSelectMethod = useCallback((method: "pin" | "passkey") => {
    setSelectedMethod(method);
    setError(null);
  }, []);

  const handlePinSubmit = useCallback(
    async (pin: string) => {
      if (!pendingRef.current) return;
      setLoading(true);
      setError(null);
      try {
        const token = await verifyPin(pin);
        const approval = pendingRef.current;
        pendingRef.current = null;
        setPending(null);
        setSettings(null);
        setSelectedMethod(null);
        setLoading(false);
        approval.resolve(token);
      } catch (err) {
        setLoading(false);
        setError(err instanceof Error ? err.message : "Invalid PIN");
      }
    },
    [verifyPin]
  );

  const handlePasskeyVerify = useCallback(async () => {
    if (!pendingRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const token = await verifyPasskey();
      const approval = pendingRef.current;
      pendingRef.current = null;
      setPending(null);
      setSettings(null);
      setSelectedMethod(null);
      setLoading(false);
      approval.resolve(token);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Passkey verification failed");
    }
  }, [verifyPasskey]);

  const handleCancel = useCallback(() => {
    if (pendingRef.current) {
      pendingRef.current.resolve(null);
      pendingRef.current = null;
    }
    setPending(null);
    setSettings(null);
    setSelectedMethod(null);
    setError(null);
    setLoading(false);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedMethod(null);
    setError(null);
  }, []);

  return (
    <ApprovalContext.Provider value={{ requestApproval }}>
      {children}
      <ApprovalPrompt
        open={pending !== null}
        selectedMethod={selectedMethod}
        hasPin={settings?.hasPin ?? false}
        hasPasskey={(settings?.passkeyCount ?? 0) > 0}
        onSelectMethod={handleSelectMethod}
        onPinSubmit={handlePinSubmit}
        onPasskeyVerify={handlePasskeyVerify}
        onCancel={handleCancel}
        onBack={handleBack}
        error={error}
        loading={loading}
      />
    </ApprovalContext.Provider>
  );
}
