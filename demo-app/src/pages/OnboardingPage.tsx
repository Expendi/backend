import { useEffect, useState, useRef } from "react";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../context/AuthContext";
import type { OnboardResult } from "../lib/types";

/**
 * OnboardingPage — Branded splash screen that auto-provisions wallets.
 *
 * Design rationale:
 * - This screen appears after authentication but before profile exists.
 * - It auto-calls POST /api/onboard on mount to create wallets + profile.
 * - The UI is a minimal branded splash (matching LoginScreen aesthetic)
 *   with a pulsing logo and subtle status text.
 * - On success, it calls refreshProfile() which sets the profile in
 *   AuthContext, causing App.tsx to render the main routes.
 * - The real onboarding (asking about goals, location, etc.) happens
 *   conversationally in Agent Mode via the system prompt.
 */
export function OnboardingPage() {
  const { request } = useApi();
  const { refreshProfile } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"provisioning" | "ready" | "error">("provisioning");
  const hasStarted = useRef(false);

  const runOnboarding = async () => {
    setError(null);
    setStatus("provisioning");

    try {
      await request<OnboardResult>("/onboard", {
        method: "POST",
        body: { chainId: 8453 },
      });

      setStatus("ready");

      // Brief pause so the user sees "Ready" before the page swaps.
      // Without this, the transition feels jarring -- the screen disappears
      // before the user registers what happened.
      await new Promise((r) => setTimeout(r, 600));

      await refreshProfile();
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong setting up your wallet."
      );
    }
  };

  // Auto-onboard on mount. The ref guard prevents double-fire in StrictMode.
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    runOnboarding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="login-screen">
      <div className="exo-onboarding">
        {/* Brand mark -- same as login screen */}
        <h1 className="exo-onboarding-logo" aria-hidden="true">
          exo<span className="dot">.</span>
        </h1>

        {/* Animated progress bar */}
        <div
          className="exo-onboarding-bar"
          role="progressbar"
          aria-label="Setting up your wallet"
        >
          <div
            className={`exo-onboarding-bar-fill ${
              status === "ready" ? "complete" : ""
            } ${status === "error" ? "error" : ""}`}
          />
        </div>

        {/* Status messages */}
        {status === "provisioning" && (
          <p className="exo-onboarding-status" aria-live="polite">
            Setting up your wallets
          </p>
        )}

        {status === "ready" && (
          <p className="exo-onboarding-status ready" aria-live="polite">
            You're all set
          </p>
        )}

        {status === "error" && (
          <div className="exo-onboarding-error" role="alert">
            <p className="exo-onboarding-error-msg">
              {error || "Unable to create your wallet."}
            </p>
            <button
              className="btn-exo btn-secondary exo-onboarding-retry"
              onClick={() => {
                hasStarted.current = false;
                runOnboarding();
              }}
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
