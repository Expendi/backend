import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useApi } from "../hooks/useApi";
import "../styles/security-settings.css";

/* ─── Types ──────────────────────────────────────────────────────── */

interface ApprovalStatus {
  enabled: boolean;
  method: "pin" | "passkey" | null;
  passkeyCount: number;
}

interface PasskeyEntry {
  id: string;
  label: string;
  createdAt: string;
}

type SecurityView =
  | "overview"
  | "pin-setup"
  | "pin-change"
  | "pin-remove";

/* ─── Helpers ────────────────────────────────────────────────────── */

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/* ─── Icons ──────────────────────────────────────────────────────── */

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function FingerprintIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" />
      <path d="M5 19.5C5.5 18 6 15 6 12c0-3.5 2.5-6 6-6a6 6 0 0 1 4.8 2.4" />
      <path d="M10 12c0-1.1.9-2 2-2a2 2 0 0 1 2 2c0 3-1.5 6-3 8.5" />
      <path d="M18 12c0 3.5-2 7-4.5 9.5" />
      <path d="M22 12c0 5-3 9-6.5 11.5" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/* ─── Sub-views ──────────────────────────────────────────────────── */

function PinSetupForm({
  onComplete,
  onCancel,
}: {
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { request } = useApi();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePinChange = (value: string, setter: (v: string) => void) => {
    const cleaned = value.replace(/\D/g, "").slice(0, 6);
    setter(cleaned);
    setError(null);
  };

  const handleContinue = () => {
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits");
      return;
    }
    setStep("confirm");
  };

  const handleSave = async () => {
    if (confirmPin !== pin) {
      setError("PINs do not match");
      setConfirmPin("");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await request("/security/approval/pin/setup", {
        method: "POST",
        body: { pin },
      });
      onComplete();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to set up PIN"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="security-form">
      <button className="security-back-btn" onClick={onCancel} type="button">
        <ChevronLeftIcon />
        <span>Back</span>
      </button>
      <h3 className="security-form-title">Set Up Transaction PIN</h3>
      <p className="security-form-desc">
        Choose a 4-6 digit PIN to approve transactions.
      </p>

      {step === "enter" ? (
        <>
          <label className="security-label">Enter PIN</label>
          <input
            className="security-pin-input"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={pin}
            onChange={(e) => handlePinChange(e.target.value, setPin)}
            placeholder="4-6 digits"
            autoFocus
          />
          {error && <div className="security-error">{error}</div>}
          <button
            className="security-btn primary"
            onClick={handleContinue}
            disabled={pin.length < 4}
            type="button"
          >
            Continue
          </button>
        </>
      ) : (
        <>
          <label className="security-label">Confirm PIN</label>
          <input
            className="security-pin-input"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={confirmPin}
            onChange={(e) => handlePinChange(e.target.value, setConfirmPin)}
            placeholder="Re-enter PIN"
            autoFocus
          />
          {error && <div className="security-error">{error}</div>}
          <div className="security-form-actions">
            <button
              className="security-btn secondary"
              onClick={() => {
                setStep("enter");
                setConfirmPin("");
                setError(null);
              }}
              type="button"
            >
              Back
            </button>
            <button
              className="security-btn primary"
              onClick={handleSave}
              disabled={saving || confirmPin.length < 4}
              type="button"
            >
              {saving ? "Saving..." : "Save PIN"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PinChangeForm({
  onComplete,
  onCancel,
}: {
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { request } = useApi();
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePinChange = (value: string, setter: (v: string) => void) => {
    const cleaned = value.replace(/\D/g, "").slice(0, 6);
    setter(cleaned);
    setError(null);
  };

  const handleSave = async () => {
    if (newPin.length < 4) {
      setError("New PIN must be at least 4 digits");
      return;
    }
    if (newPin !== confirmPin) {
      setError("New PINs do not match");
      setConfirmPin("");
      return;
    }
    if (newPin === currentPin) {
      setError("New PIN must be different from current PIN");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await request("/security/approval/pin/change", {
        method: "POST",
        body: { currentPin, newPin },
      });
      onComplete();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to change PIN"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="security-form">
      <button className="security-back-btn" onClick={onCancel} type="button">
        <ChevronLeftIcon />
        <span>Back</span>
      </button>
      <h3 className="security-form-title">Change PIN</h3>

      <label className="security-label">Current PIN</label>
      <input
        className="security-pin-input"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        value={currentPin}
        onChange={(e) => handlePinChange(e.target.value, setCurrentPin)}
        placeholder="Current PIN"
        autoFocus
      />

      <label className="security-label">New PIN</label>
      <input
        className="security-pin-input"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        value={newPin}
        onChange={(e) => handlePinChange(e.target.value, setNewPin)}
        placeholder="4-6 digits"
      />

      <label className="security-label">Confirm New PIN</label>
      <input
        className="security-pin-input"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        value={confirmPin}
        onChange={(e) => handlePinChange(e.target.value, setConfirmPin)}
        placeholder="Re-enter new PIN"
      />

      {error && <div className="security-error">{error}</div>}
      <div className="security-form-actions">
        <button className="security-btn secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="security-btn primary"
          onClick={handleSave}
          disabled={saving || currentPin.length < 4 || newPin.length < 4 || confirmPin.length < 4}
          type="button"
        >
          {saving ? "Saving..." : "Update PIN"}
        </button>
      </div>
    </div>
  );
}

function PinRemoveForm({
  onComplete,
  onCancel,
}: {
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { request } = useApi();
  const [pin, setPin] = useState("");
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePinChange = (value: string) => {
    const cleaned = value.replace(/\D/g, "").slice(0, 6);
    setPin(cleaned);
    setError(null);
  };

  const handleRemove = async () => {
    if (pin.length < 4) {
      setError("Enter your current PIN to confirm removal");
      return;
    }
    setRemoving(true);
    setError(null);
    try {
      await request("/security/approval/pin", {
        method: "DELETE",
        body: { pin },
      });
      onComplete();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to remove PIN"
      );
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="security-form">
      <button className="security-back-btn" onClick={onCancel} type="button">
        <ChevronLeftIcon />
        <span>Back</span>
      </button>
      <h3 className="security-form-title">Remove PIN</h3>
      <p className="security-form-desc">
        Enter your current PIN to confirm removal. Transactions will no longer require PIN approval.
      </p>

      <label className="security-label">Current PIN</label>
      <input
        className="security-pin-input"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        value={pin}
        onChange={(e) => handlePinChange(e.target.value)}
        placeholder="Enter current PIN"
        autoFocus
      />

      {error && <div className="security-error">{error}</div>}
      <div className="security-form-actions">
        <button className="security-btn secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="security-btn danger"
          onClick={handleRemove}
          disabled={removing || pin.length < 4}
          type="button"
        >
          {removing ? "Removing..." : "Remove PIN"}
        </button>
      </div>
    </div>
  );
}

/* ─── Main SecuritySettings Component ────────────────────────────── */

export function SecuritySettings({ onClose }: { onClose?: () => void }) {
  const { request } = useApi();

  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<SecurityView>("overview");
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const showSuccess = useCallback((message: string) => {
    setSuccessMessage(message);
    const timer = setTimeout(() => setSuccessMessage(null), 3000);
    return () => clearTimeout(timer);
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const status = await request<ApprovalStatus>("/security/approval");
      setApprovalStatus(status);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load security settings"
      );
    }
  }, [request]);

  const fetchPasskeys = useCallback(async () => {
    try {
      const list = await request<PasskeyEntry[]>("/security/approval/passkeys");
      setPasskeys(list);
    } catch {
      // Passkey list fetch failure is non-critical if approval status loaded
    }
  }, [request]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStatus(), fetchPasskeys()]);
    setLoading(false);
  }, [fetchStatus, fetchPasskeys]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleAddPasskey = async () => {
    setPasskeyLoading(true);
    setPasskeyError(null);
    try {
      const options = await request<{
        challenge: string;
        rp: { id: string; name: string };
        user: { id: string; name: string; displayName: string };
        pubKeyCredParams: Array<{ type: string; alg: number }>;
        timeout?: number;
        attestation?: string;
        authenticatorSelection?: {
          authenticatorAttachment?: string;
          residentKey?: string;
          requireResidentKey?: boolean;
          userVerification?: string;
        };
        excludeCredentials?: Array<{ id: string; type: string; transports?: string[] }>;
      }>("/security/approval/passkey/register", { method: "POST" });

      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        rp: options.rp,
        challenge: base64urlToBuffer(options.challenge),
        user: {
          ...options.user,
          id: base64urlToBuffer(options.user.id),
        },
        pubKeyCredParams: options.pubKeyCredParams as PublicKeyCredentialParameters[],
        excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({
          ...c,
          id: base64urlToBuffer(c.id),
          type: "public-key" as const,
          transports: c.transports as AuthenticatorTransport[] | undefined,
        })),
        ...(options.timeout !== undefined && { timeout: options.timeout }),
        ...(options.attestation !== undefined && {
          attestation: options.attestation as AttestationConveyancePreference,
        }),
        ...(options.authenticatorSelection !== undefined && {
          authenticatorSelection: {
            ...options.authenticatorSelection,
            authenticatorAttachment: options.authenticatorSelection.authenticatorAttachment as AuthenticatorAttachment | undefined,
            residentKey: options.authenticatorSelection.residentKey as ResidentKeyRequirement | undefined,
            userVerification: options.authenticatorSelection.userVerification as UserVerificationRequirement | undefined,
          },
        }),
      };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions,
      });

      if (!credential) {
        setPasskeyError("Passkey registration was cancelled");
        return;
      }

      const pubKeyCred = credential as PublicKeyCredential;
      const attestationResponse =
        pubKeyCred.response as AuthenticatorAttestationResponse;

      const serialized = {
        id: pubKeyCred.id,
        rawId: bufferToBase64url(pubKeyCred.rawId),
        type: pubKeyCred.type,
        response: {
          attestationObject: bufferToBase64url(
            attestationResponse.attestationObject
          ),
          clientDataJSON: bufferToBase64url(
            attestationResponse.clientDataJSON
          ),
        },
      };

      await request("/security/approval/passkey/register/verify", {
        method: "POST",
        body: { credential: serialized },
      });

      await loadAll();
      showSuccess("Passkey added successfully");
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setPasskeyError("Passkey registration was cancelled or timed out");
      } else if (
        err instanceof DOMException &&
        err.name === "InvalidStateError"
      ) {
        setPasskeyError(
          "This device is already registered as a passkey"
        );
      } else {
        setPasskeyError(
          err instanceof Error ? err.message : "Failed to register passkey"
        );
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleRemovePasskey = async (id: string) => {
    setRemovingPasskeyId(id);
    try {
      await request(`/security/approval/passkeys/${id}`, {
        method: "DELETE",
      });
      await loadAll();
      showSuccess("Passkey removed");
    } catch (err) {
      setPasskeyError(
        err instanceof Error ? err.message : "Failed to remove passkey"
      );
    } finally {
      setRemovingPasskeyId(null);
    }
  };

  const handlePinActionComplete = async () => {
    setView("overview");
    await loadAll();
    const messages: Record<SecurityView, string> = {
      "overview": "",
      "pin-setup": "PIN set up successfully",
      "pin-change": "PIN changed successfully",
      "pin-remove": "PIN removed",
    };
    showSuccess(messages[view] || "Updated successfully");
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  /* ── Render sub-views ──────────────────────────────────────────── */

  if (view === "pin-setup") {
    return (
      <div className="security-settings">
        <PinSetupForm
          onComplete={handlePinActionComplete}
          onCancel={() => setView("overview")}
        />
      </div>
    );
  }

  if (view === "pin-change") {
    return (
      <div className="security-settings">
        <PinChangeForm
          onComplete={handlePinActionComplete}
          onCancel={() => setView("overview")}
        />
      </div>
    );
  }

  if (view === "pin-remove") {
    return (
      <div className="security-settings">
        <PinRemoveForm
          onComplete={handlePinActionComplete}
          onCancel={() => setView("overview")}
        />
      </div>
    );
  }

  /* ── Overview ──────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="security-settings">
        {onClose && (
          <button className="security-back-btn" onClick={onClose} type="button">
            <ChevronLeftIcon />
            <span>Back</span>
          </button>
        )}
        <div className="security-loading">
          <div className="security-loading-spinner" />
          <span>Loading security settings...</span>
        </div>
      </div>
    );
  }

  if (error && !approvalStatus) {
    return (
      <div className="security-settings">
        {onClose && (
          <button className="security-back-btn" onClick={onClose} type="button">
            <ChevronLeftIcon />
            <span>Back</span>
          </button>
        )}
        <div className="security-error-state">
          <span>{error}</span>
          <button className="security-btn secondary" onClick={loadAll} type="button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const pinEnabled = approvalStatus?.method === "pin";
  const hasPasskeys = (approvalStatus?.passkeyCount ?? 0) > 0;
  const approvalEnabled = approvalStatus?.enabled ?? false;

  let statusLabel: ReactNode;
  if (!approvalEnabled) {
    statusLabel = (
      <span className="security-status-badge disabled">Not configured</span>
    );
  } else if (pinEnabled && hasPasskeys) {
    statusLabel = (
      <span className="security-status-badge enabled">PIN + Passkeys</span>
    );
  } else if (pinEnabled) {
    statusLabel = (
      <span className="security-status-badge enabled">PIN enabled</span>
    );
  } else if (hasPasskeys) {
    statusLabel = (
      <span className="security-status-badge enabled">
        {approvalStatus!.passkeyCount} passkey{approvalStatus!.passkeyCount !== 1 ? "s" : ""}
      </span>
    );
  } else {
    statusLabel = (
      <span className="security-status-badge disabled">Not configured</span>
    );
  }

  return (
    <div className="security-settings">
      {onClose && (
        <button className="security-back-btn" onClick={onClose} type="button">
          <ChevronLeftIcon />
          <span>Back</span>
        </button>
      )}

      {successMessage && (
        <div className="security-success">
          <CheckCircleIcon />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Transaction Approval Status */}
      <div className="security-section">
        <div className="security-section-header">
          <ShieldIcon />
          <span>Transaction Approval</span>
        </div>
        <div className="security-status-row">
          <span className="security-status-label">Status</span>
          {statusLabel}
        </div>
        {approvalEnabled && (
          <p className="security-section-desc">
            Transactions require approval before execution.
          </p>
        )}
        {!approvalEnabled && (
          <p className="security-section-desc">
            Add a PIN or passkey to require approval before transactions are executed.
          </p>
        )}
      </div>

      {/* PIN Section */}
      <div className="security-section">
        <div className="security-section-header">
          <KeyIcon />
          <span>PIN</span>
        </div>
        {pinEnabled ? (
          <div className="security-section-content">
            <div className="security-status-row">
              <span className="security-status-label">PIN</span>
              <span className="security-status-badge enabled">Active</span>
            </div>
            <div className="security-action-row">
              <button
                className="security-btn secondary"
                onClick={() => setView("pin-change")}
                type="button"
              >
                Change PIN
              </button>
              <button
                className="security-btn danger-outline"
                onClick={() => setView("pin-remove")}
                type="button"
              >
                Remove PIN
              </button>
            </div>
          </div>
        ) : (
          <div className="security-section-content">
            <p className="security-section-desc">
              A 4-6 digit PIN for quick transaction approval.
            </p>
            <button
              className="security-btn primary"
              onClick={() => setView("pin-setup")}
              type="button"
            >
              <KeyIcon />
              Set Up PIN
            </button>
          </div>
        )}
      </div>

      {/* Passkeys Section */}
      <div className="security-section">
        <div className="security-section-header">
          <FingerprintIcon />
          <span>Passkeys</span>
          {hasPasskeys && (
            <span className="security-count-badge">
              {approvalStatus!.passkeyCount}
            </span>
          )}
        </div>

        <div className="security-section-content">
          {passkeys.length > 0 && (
            <div className="security-passkey-list">
              {passkeys.map((pk) => (
                <div className="security-passkey-item" key={pk.id}>
                  <div className="security-passkey-info">
                    <div className="security-passkey-label">
                      {pk.label || "Passkey"}
                    </div>
                    <div className="security-passkey-date">
                      Added {formatDate(pk.createdAt)}
                    </div>
                  </div>
                  <button
                    className="security-icon-btn danger"
                    onClick={() => handleRemovePasskey(pk.id)}
                    disabled={removingPasskeyId === pk.id}
                    title="Remove passkey"
                    type="button"
                  >
                    {removingPasskeyId === pk.id ? (
                      <div className="security-loading-spinner small" />
                    ) : (
                      <TrashIcon />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}

          {passkeyError && (
            <div className="security-error">{passkeyError}</div>
          )}

          <button
            className="security-btn primary"
            onClick={handleAddPasskey}
            disabled={passkeyLoading}
            type="button"
          >
            {passkeyLoading ? (
              <>
                <div className="security-loading-spinner small" />
                Registering...
              </>
            ) : (
              <>
                <PlusIcon />
                Add Passkey
              </>
            )}
          </button>

          {!hasPasskeys && passkeys.length === 0 && (
            <p className="security-section-desc">
              Use biometrics or a hardware key to approve transactions.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
