import { useState, useCallback } from "react";
import { useApi } from "./useApi";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { ApprovalSettings } from "../lib/types";

let cachedToken: string | null = null;
let cachedTokenExpiry = 0;

export function useApproval() {
  const { request } = useApi();
  const [settings, setSettings] = useState<ApprovalSettings | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const s = await request<ApprovalSettings>("/security/approval");
      setSettings(s);
      return s;
    } finally {
      setLoading(false);
    }
  }, [request]);

  const verifyPin = useCallback(
    async (pin: string): Promise<string> => {
      const result = await request<{ approvalToken: string }>("/security/approval/verify", {
        method: "POST",
        body: { method: "pin", pin },
      });
      cachedToken = result.approvalToken;
      cachedTokenExpiry = Date.now() + 4.5 * 60 * 1000;
      return result.approvalToken;
    },
    [request]
  );

  const verifyPasskey = useCallback(
    async (): Promise<string> => {
      // Step 1: Get authentication options (challenge) from backend
      const challengeRes = await request<{ challenge: boolean; options: PublicKeyCredentialRequestOptionsJSON }>(
        "/security/approval/verify",
        { method: "POST", body: { method: "passkey" } }
      );

      // Step 2: Trigger browser WebAuthn prompt
      const credential = await startAuthentication({ optionsJSON: challengeRes.options });

      // Step 3: Send credential to backend for verification
      const result = await request<{ approvalToken: string }>("/security/approval/verify", {
        method: "POST",
        body: { method: "passkey", credential },
      });

      cachedToken = result.approvalToken;
      cachedTokenExpiry = Date.now() + 4.5 * 60 * 1000;
      return result.approvalToken;
    },
    [request]
  );

  const getApprovalToken = useCallback(
    async (method: "pin" | "passkey", pin?: string): Promise<string | null> => {
      if (cachedToken && Date.now() < cachedTokenExpiry) {
        return cachedToken;
      }

      if (method === "pin") {
        if (!pin) throw new Error("PIN required for approval");
        return verifyPin(pin);
      }

      return verifyPasskey();
    },
    [verifyPin, verifyPasskey]
  );

  const clearCachedToken = useCallback(() => {
    cachedToken = null;
    cachedTokenExpiry = 0;
  }, []);

  return {
    settings,
    loading,
    fetchSettings,
    getApprovalToken,
    verifyPin,
    verifyPasskey,
    clearCachedToken,
  };
}
