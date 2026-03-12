import { useState, useRef, useEffect, useCallback } from "react";
import "../styles/pin-prompt.css";

export interface ApprovalPromptProps {
  open: boolean;
  /** null = show method chooser */
  selectedMethod: "pin" | "passkey" | null;
  hasPin: boolean;
  hasPasskey: boolean;
  onSelectMethod: (method: "pin" | "passkey") => void;
  onPinSubmit: (pin: string) => void;
  onPasskeyVerify: () => void;
  onCancel: () => void;
  onBack: () => void;
  error?: string | null;
  loading?: boolean;
}

export function ApprovalPrompt({
  open,
  selectedMethod,
  hasPin,
  hasPasskey,
  onSelectMethod,
  onPinSubmit,
  onPasskeyVerify,
  onCancel,
  onBack,
  error,
  loading,
}: ApprovalPromptProps) {
  const [pin, setPin] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [closing, setClosing] = useState(false);
  const passkeyTriggered = useRef(false);

  // Reset state when opened or method changes
  useEffect(() => {
    if (open) {
      setPin("");
      passkeyTriggered.current = false;
      if (selectedMethod === "pin") {
        setTimeout(() => inputRef.current?.focus(), 200);
      }
    }
  }, [open, selectedMethod]);

  // Auto-trigger passkey when selected
  useEffect(() => {
    if (open && selectedMethod === "passkey" && !passkeyTriggered.current && !loading) {
      passkeyTriggered.current = true;
      onPasskeyVerify();
    }
  }, [open, selectedMethod, loading, onPasskeyVerify]);

  const handleClose = useCallback(() => {
    if (loading) return;
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onCancel();
    }, 200);
  }, [loading, onCancel]);

  const handlePinSubmit = useCallback(() => {
    const trimmed = pin.trim();
    if (!trimmed || loading) return;
    onPinSubmit(trimmed);
  }, [pin, loading, onPinSubmit]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  if (!open && !closing) return null;

  const showChooser = selectedMethod === null && hasPin && hasPasskey;
  const showBack = selectedMethod !== null && hasPin && hasPasskey;

  return (
    <div
      className={`pin-overlay${closing ? " closing" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Transaction approval"
    >
      <div className="pin-card">
        <div className="pin-header">
          <span className="pin-title">Transaction Approval</span>
          {!loading && (
            <button className="pin-close" onClick={handleClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <div className="pin-body">
          {showChooser ? (
            /* ─── Method Chooser ─── */
            <>
              <div className="pin-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <p className="pin-description">
                Choose how to verify this transaction.
              </p>
              <div className="pin-method-chooser">
                <button
                  className="pin-method-option"
                  onClick={() => onSelectMethod("passkey")}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a5 5 0 0 1 5 5v3" />
                    <path d="M7 10V7a5 5 0 0 1 10 0" />
                    <rect x="3" y="14" width="18" height="8" rx="2" />
                    <circle cx="12" cy="18" r="1" />
                  </svg>
                  <div className="pin-method-text">
                    <span className="pin-method-label">Passkey</span>
                    <span className="pin-method-desc">Biometric or security key</span>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <button
                  className="pin-method-option"
                  onClick={() => onSelectMethod("pin")}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <div className="pin-method-text">
                    <span className="pin-method-label">PIN</span>
                    <span className="pin-method-desc">Enter your numeric PIN</span>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </>
          ) : selectedMethod === "passkey" ? (
            /* ─── Passkey UI ─── */
            <>
              <div className="pin-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a5 5 0 0 1 5 5v3" />
                  <path d="M7 10V7a5 5 0 0 1 10 0" />
                  <rect x="3" y="14" width="18" height="8" rx="2" />
                  <circle cx="12" cy="18" r="1" />
                </svg>
              </div>
              {loading ? (
                <p className="pin-description">Waiting for passkey verification...</p>
              ) : error ? (
                <p className="pin-description">Passkey verification failed. Try again.</p>
              ) : (
                <p className="pin-description">
                  Verify your identity with your passkey to approve this transaction.
                </p>
              )}
              {loading && (
                <div className="pin-passkey-loading">
                  <span className="pin-spinner" />
                </div>
              )}
              {error && <span className="pin-error">{error}</span>}
            </>
          ) : (
            /* ─── PIN UI ─── */
            <>
              <div className="pin-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <p className="pin-description">Enter your PIN to approve this transaction.</p>
              <input
                ref={inputRef}
                className={`pin-input${error ? " pin-input-error" : ""}`}
                type="password"
                inputMode="numeric"
                placeholder="Enter PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handlePinSubmit();
                }}
                disabled={loading}
                autoComplete="off"
                aria-label="PIN"
              />
              {error && <span className="pin-error">{error}</span>}
            </>
          )}
        </div>
        {!showChooser && (
          <div className="pin-actions">
            {showBack ? (
              <button className="pin-btn pin-btn-secondary" onClick={onBack} disabled={loading}>
                Back
              </button>
            ) : (
              <button className="pin-btn pin-btn-secondary" onClick={handleClose} disabled={loading}>
                Cancel
              </button>
            )}
            {selectedMethod === "passkey" ? (
              <button
                className="pin-btn pin-btn-primary"
                onClick={() => {
                  passkeyTriggered.current = false;
                  onPasskeyVerify();
                }}
                disabled={loading}
              >
                {loading ? <span className="pin-spinner" /> : "Retry"}
              </button>
            ) : (
              <button
                className="pin-btn pin-btn-primary"
                onClick={handlePinSubmit}
                disabled={!pin.trim() || loading}
              >
                {loading ? <span className="pin-spinner" /> : "Approve"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
