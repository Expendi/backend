import { useEffect, useState, useRef } from "react";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../context/AuthContext";
import type { OnboardResult } from "../lib/types";

/**
 * OnboardingPage — Two-step onboarding flow:
 *
 * Step 1: Auto-provision wallets (runs on mount)
 * Step 2: Pick a username (shown after wallets are ready)
 *
 * The username is used for sending tokens between users (e.g., "send 5 USDC to @alice").
 * It's optional — users can skip and set it later in Settings.
 */
export function OnboardingPage() {
  const { request } = useApi();
  const { refreshProfile } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "provisioning" | "choose_username" | "saving_username" | "error"
  >("provisioning");
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const hasStarted = useRef(false);

  const runOnboarding = async () => {
    setError(null);
    setStatus("provisioning");

    try {
      await request<OnboardResult>("/onboard", {
        method: "POST",
        body: { chainId: 8453 },
      });

      setStatus("choose_username");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong setting up your wallet."
      );
    }
  };

  const handleSetUsername = async () => {
    const trimmed = username.trim().toLowerCase();

    // Basic validation
    if (!trimmed) {
      setUsernameError("Please enter a username");
      return;
    }
    if (trimmed.length < 3) {
      setUsernameError("Must be at least 3 characters");
      return;
    }
    if (trimmed.length > 20) {
      setUsernameError("Must be 20 characters or less");
      return;
    }
    if (!/^[a-z0-9_]+$/.test(trimmed)) {
      setUsernameError("Only lowercase letters, numbers, and underscores");
      return;
    }

    setUsernameError(null);
    setStatus("saving_username");

    try {
      await request("/profile/username", {
        method: "PUT",
        body: { username: trimmed },
      });
      await refreshProfile();
    } catch (err) {
      setStatus("choose_username");
      const msg =
        err instanceof Error ? err.message : "Could not set username";
      // Check for "taken" style errors from backend
      if (msg.toLowerCase().includes("taken") || msg.toLowerCase().includes("exists")) {
        setUsernameError("That username is already taken");
      } else {
        setUsernameError(msg);
      }
    }
  };

  const handleSkip = async () => {
    setStatus("saving_username");
    await refreshProfile();
  };

  // Auto-onboard on mount
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    runOnboarding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="login-screen">
      <div className="exo-onboarding">
        {/* Brand mark */}
        <h1 className="exo-onboarding-logo" aria-hidden="true">
          exo<span className="dot">.</span>
        </h1>

        {/* Step 1: Provisioning */}
        {status === "provisioning" && (
          <>
            <div
              className="exo-onboarding-bar"
              role="progressbar"
              aria-label="Setting up your wallet"
            >
              <div className="exo-onboarding-bar-fill" />
            </div>
            <p className="exo-onboarding-status" aria-live="polite">
              Setting up your wallets
            </p>
          </>
        )}

        {/* Step 2: Choose username */}
        {(status === "choose_username" || status === "saving_username") && (
          <div className="exo-onboarding-username" style={{ animation: "onboardFadeIn 0.4s ease both" }}>
            <p className="exo-onboarding-subtitle">
              Pick a username so friends can send you tokens
            </p>

            <div className="exo-onboarding-input-row">
              <span className="exo-onboarding-at">@</span>
              <input
                type="text"
                className={`exo-onboarding-input ${usernameError ? "error" : ""}`}
                placeholder="username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
                  setUsernameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !status.includes("saving")) handleSetUsername();
                }}
                disabled={status === "saving_username"}
                autoFocus
                maxLength={20}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            {usernameError && (
              <p className="exo-onboarding-input-error" role="alert">
                {usernameError}
              </p>
            )}

            <div className="exo-onboarding-actions">
              <button
                className="btn-exo btn-primary exo-onboarding-continue"
                onClick={handleSetUsername}
                disabled={status === "saving_username" || !username.trim()}
              >
                {status === "saving_username" ? "Setting up..." : "Continue"}
              </button>
              <button
                className="exo-onboarding-skip"
                onClick={handleSkip}
                disabled={status === "saving_username"}
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* Error state */}
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
