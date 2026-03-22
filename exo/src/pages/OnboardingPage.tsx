import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "../context/AuthContext";
import { useOnboardMutation, useUsernameMutation } from "../hooks/queries";
import { usernameSchema, type UsernameFormData } from "../lib/schemas";

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
  const { refreshProfile } = useAuth();
  const onboardMutation = useOnboardMutation();
  const usernameMutation = useUsernameMutation();
  const [status, setStatus] = useState<
    "provisioning" | "choose_username" | "saving_username" | "error"
  >("provisioning");
  const hasStarted = useRef(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
    watch,
  } = useForm<UsernameFormData>({
    resolver: zodResolver(usernameSchema),
    defaultValues: { username: "" },
  });

  const usernameValue = watch("username");

  const runOnboarding = async () => {
    setStatus("provisioning");
    try {
      await onboardMutation.mutateAsync(8453);
      setStatus("choose_username");
    } catch (err) {
      setStatus("error");
    }
  };

  const onUsernameSubmit = async (data: UsernameFormData) => {
    setStatus("saving_username");
    try {
      await usernameMutation.mutateAsync(data.username);
      await refreshProfile();
    } catch (err) {
      setStatus("choose_username");
      const msg = err instanceof Error ? err.message : "Could not set username";
      if (msg.toLowerCase().includes("taken") || msg.toLowerCase().includes("exists")) {
        setError("username", { message: "That username is already taken" });
      } else {
        setError("username", { message: msg });
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
          <form
            className="exo-onboarding-username"
            style={{ animation: "onboardFadeIn 0.4s ease both" }}
            onSubmit={handleSubmit(onUsernameSubmit)}
          >
            <p className="exo-onboarding-subtitle">
              Pick a username so friends can send you tokens
            </p>

            <div className="exo-onboarding-input-row">
              <span className="exo-onboarding-at">@</span>
              <input
                type="text"
                className={`exo-onboarding-input ${errors.username ? "error" : ""}`}
                placeholder="username"
                {...register("username", {
                  onChange: (e) => {
                    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                  },
                })}
                disabled={status === "saving_username"}
                autoFocus
                maxLength={20}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            {errors.username && (
              <p className="exo-onboarding-input-error" role="alert">
                {errors.username.message}
              </p>
            )}

            <div className="exo-onboarding-actions">
              <button
                type="submit"
                className="btn-exo btn-primary exo-onboarding-continue"
                disabled={status === "saving_username" || !usernameValue?.trim()}
              >
                {status === "saving_username" ? "Setting up..." : "Continue"}
              </button>
              <button
                type="button"
                className="exo-onboarding-skip"
                onClick={handleSkip}
                disabled={status === "saving_username"}
              >
                Skip for now
              </button>
            </div>
          </form>
        )}

        {/* Error state */}
        {status === "error" && (
          <div className="exo-onboarding-error" role="alert">
            <p className="exo-onboarding-error-msg">
              {onboardMutation.error instanceof Error
                ? onboardMutation.error.message
                : "Unable to create your wallet."}
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
