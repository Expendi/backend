import { useState, useEffect, useRef, useCallback } from "react";
import { useApi, ApiRequestError } from "../hooks/useApi";
import { useApprovalContext } from "../context/ApprovalContext";
import "../styles/send-modal.css";

/* ─── Types ──────────────────────────────────────────────────────── */

type Token = "ETH" | "USDC";
type WalletType = "user" | "server" | "agent";
type ModalStep = "idle" | "review" | "sending" | "success" | "error";

interface WalletBalanceEntry {
  type: string;
  address: string;
  balances: Record<string, string>;
}

export interface SendModalProps {
  open: boolean;
  onClose: () => void;
  walletBalances: WalletBalanceEntry[] | null;
}

interface ResolvedUser {
  username: string;
  userId: string;
  address: string;
}

interface TransactionResult {
  id: string;
  txHash: string | null;
  status: string;
}

interface TransferResult {
  txHash?: string;
  id?: string;
  status?: string;
}

/* ─── Constants ──────────────────────────────────────────────────── */

const TOKEN_DECIMALS: Record<Token, number> = {
  ETH: 18,
  USDC: 6,
};

const USDC_CONTRACT_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const WALLET_TYPE_LABELS: Record<WalletType, string> = {
  user: "User",
  server: "Server",
  agent: "Agent",
};

/* ─── Helpers ────────────────────────────────────────────────────── */

function formatBalanceFromRaw(raw: string, decimals: number): string {
  const num = Number(raw) / 10 ** decimals;
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function formatBalanceHuman(raw: string, decimals: number): string {
  const num = Number(raw) / 10 ** decimals;
  if (num === 0) return "0";
  if (decimals === 6) {
    return num.toFixed(6).replace(/\.?0+$/, "");
  }
  return num.toFixed(8).replace(/\.?0+$/, "");
}

function parseAmountToBaseUnits(amount: string, decimals: number): string {
  if (!amount || isNaN(Number(amount))) return "0";
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const combined = whole + frac;
  // Remove leading zeros but keep at least "0"
  const trimmed = combined.replace(/^0+/, "") || "0";
  return trimmed;
}

function isValidEthAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function truncateAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
}

/* ─── Component ──────────────────────────────────────────────────── */

export function SendModal({ open, onClose, walletBalances }: SendModalProps) {
  const { request } = useApi();
  const approvalCtx = useApprovalContext();

  /** Make a request, automatically handling TransactionApprovalRequired by prompting for PIN and retrying. */
  const requestWithApproval = useCallback(
    async <T,>(
      path: string,
      options?: {
        method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
        body?: unknown;
        query?: Record<string, string | number | undefined>;
      }
    ): Promise<T> => {
      try {
        return await request<T>(path, options);
      } catch (err) {
        if (
          err instanceof ApiRequestError &&
          err._tag === "TransactionApprovalRequired" &&
          approvalCtx
        ) {
          const method = err.method ?? "pin";
          const token = await approvalCtx.requestApproval(method);
          if (!token) throw new Error("Transaction approval was cancelled");
          return request<T>(path, { ...options, approvalToken: token });
        }
        throw err;
      }
    },
    [request, approvalCtx]
  );

  // Form state
  const [token, setToken] = useState<Token>("USDC");
  const [amount, setAmount] = useState("");
  const [ownWalletMode, setOwnWalletMode] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [fromWallet, setFromWallet] = useState<WalletType>("user");
  const [toWallet, setToWallet] = useState<WalletType>("server");

  // Resolution state
  const [resolvedUser, setResolvedUser] = useState<ResolvedUser | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");

  // Flow state
  const [step, setStep] = useState<ModalStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Closing animation state
  const [closing, setClosing] = useState(false);

  // Refs
  const amountInputRef = useRef<HTMLInputElement>(null);
  const resolveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setToken("USDC");
      setAmount("");
      setOwnWalletMode(false);
      setRecipient("");
      setFromWallet("user");
      setToWallet("server");
      setResolvedUser(null);
      setResolving(false);
      setResolveError("");
      setStep("idle");
      setTxHash(null);
      setErrorMessage("");
      setClosing(false);

      // Focus amount input after animation
      setTimeout(() => {
        amountInputRef.current?.focus();
      }, 300);
    }
  }, [open]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (resolveTimeoutRef.current) clearTimeout(resolveTimeoutRef.current);
      if (autoCloseTimeoutRef.current) clearTimeout(autoCloseTimeoutRef.current);
    };
  }, []);

  // Resolve username with debounce
  useEffect(() => {
    if (resolveTimeoutRef.current) {
      clearTimeout(resolveTimeoutRef.current);
      resolveTimeoutRef.current = null;
    }

    // Only resolve if it looks like a username (not an address)
    const trimmed = recipient.trim();
    if (!trimmed || isValidEthAddress(trimmed) || ownWalletMode) {
      setResolvedUser(null);
      setResolving(false);
      setResolveError("");
      return;
    }

    // If it starts with 0x but is not valid, that's an address typo - don't resolve
    if (trimmed.startsWith("0x")) {
      setResolvedUser(null);
      setResolving(false);
      setResolveError("");
      return;
    }

    // Looks like a username - resolve after debounce
    setResolving(true);
    setResolvedUser(null);
    setResolveError("");

    resolveTimeoutRef.current = setTimeout(async () => {
      try {
        const data = await request<ResolvedUser>(
          `/profile/resolve/${encodeURIComponent(trimmed)}`
        );
        setResolvedUser(data);
        setResolveError("");
      } catch (err) {
        setResolvedUser(null);
        setResolveError(
          err instanceof Error ? err.message : "Username not found"
        );
      } finally {
        setResolving(false);
      }
    }, 500);
  }, [recipient, ownWalletMode, request]);

  // Get the balance for the selected FROM wallet and token
  const getBalance = useCallback(
    (walletType: WalletType, selectedToken: Token): string => {
      if (!walletBalances) return "0";
      const wallet = walletBalances.find((w) => w.type === walletType);
      if (!wallet) return "0";
      return wallet.balances[selectedToken] ?? "0";
    },
    [walletBalances]
  );

  const sourceWalletType = ownWalletMode ? fromWallet : "user";
  const rawBalance = getBalance(sourceWalletType, token);
  const displayBalance = formatBalanceFromRaw(rawBalance, TOKEN_DECIMALS[token]);

  // Compute MAX amount as human-readable
  const maxAmount = formatBalanceHuman(rawBalance, TOKEN_DECIMALS[token]);

  // Determine the actual recipient address
  const getRecipientAddress = (): string | null => {
    if (ownWalletMode) return null; // Not needed for own wallet transfers
    const trimmed = recipient.trim();
    if (isValidEthAddress(trimmed)) return trimmed;
    if (resolvedUser) return resolvedUser.address;
    return null;
  };

  // Validation
  const getValidationError = (): string | null => {
    if (!amount || Number(amount) <= 0) {
      return "Enter an amount";
    }

    const amountBaseUnits = parseAmountToBaseUnits(amount, TOKEN_DECIMALS[token]);
    const balanceBaseUnits = BigInt(rawBalance);
    const amountBigInt = BigInt(amountBaseUnits);

    if (amountBigInt > balanceBaseUnits) {
      return "Insufficient balance";
    }

    if (amountBigInt === 0n) {
      return "Amount must be greater than zero";
    }

    if (ownWalletMode) {
      if (fromWallet === toWallet) {
        return "Source and destination wallets must be different";
      }
      return null;
    }

    const trimmedRecipient = recipient.trim();
    if (!trimmedRecipient) {
      return "Enter a recipient address or username";
    }

    if (trimmedRecipient.startsWith("0x") && !isValidEthAddress(trimmedRecipient)) {
      return "Invalid Ethereum address";
    }

    if (!isValidEthAddress(trimmedRecipient) && !resolvedUser) {
      if (resolving) return "Resolving username...";
      if (resolveError) return resolveError;
      return "Enter a valid address or username";
    }

    return null;
  };

  const validationError = getValidationError();
  const canReview = validationError === null;

  // Handle animated close
  const handleClose = useCallback(() => {
    if (step === "sending") return; // Don't allow close while sending
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 200);
  }, [step, onClose]);

  // Handle overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        handleClose();
      }
    },
    [handleClose]
  );

  // Handle keyboard
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  // Send transaction
  const handleSend = async () => {
    setStep("sending");
    setErrorMessage("");
    setTxHash(null);

    try {
      if (ownWalletMode) {
        // Inter-wallet transfer
        // Backend expects contract registry name (e.g. "usdc"), not address
        const body: Record<string, string> = {
          from: fromWallet,
          to: toWallet,
          amount: parseAmountToBaseUnits(amount, TOKEN_DECIMALS[token]),
        };
        if (token === "USDC") {
          body.token = "usdc";
        }

        const result = await requestWithApproval<TransferResult>("/wallets/transfer", {
          method: "POST",
          body,
        });
        setTxHash(result.txHash ?? null);
      } else {
        // Send to external address
        const recipientAddress = getRecipientAddress();
        if (!recipientAddress) {
          throw new Error("No valid recipient address");
        }

        if (token === "USDC") {
          // ERC20 transfer via contract call
          const result = await requestWithApproval<TransactionResult>(
            "/transactions/contract",
            {
              method: "POST",
              body: {
                walletType: "user",
                contractName: "ERC20",
                method: "transfer",
                args: [
                  recipientAddress,
                  parseAmountToBaseUnits(amount, TOKEN_DECIMALS.USDC),
                ],
              },
            }
          );
          setTxHash(result.txHash);
        } else {
          // Raw ETH transfer
          const result = await requestWithApproval<TransactionResult>(
            "/transactions/raw",
            {
              method: "POST",
              body: {
                walletType: "user",
                to: recipientAddress,
                value: parseAmountToBaseUnits(amount, TOKEN_DECIMALS.ETH),
              },
            }
          );
          setTxHash(result.txHash);
        }
      }

      setStep("success");

      // Auto-close after 3 seconds
      autoCloseTimeoutRef.current = setTimeout(() => {
        handleClose();
      }, 3000);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Transaction failed. Please try again.";
      setErrorMessage(msg);
      setStep("error");
    }
  };

  if (!open && !closing) return null;

  // Build review description
  const reviewRecipientDisplay = ownWalletMode
    ? null
    : isValidEthAddress(recipient.trim())
      ? truncateAddress(recipient.trim())
      : resolvedUser
        ? `${resolvedUser.username} (${truncateAddress(resolvedUser.address)})`
        : recipient.trim();

  return (
    <div
      className={`send-overlay${closing ? " closing" : ""}`}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="Send tokens"
    >
      <div className="send-card">
        {/* Header */}
        <div className="send-header">
          <span className="send-title">
            {step === "review"
              ? "Confirm"
              : step === "success"
                ? "Sent"
                : step === "error"
                  ? "Error"
                  : step === "sending"
                    ? "Sending"
                    : "Send"}
          </span>
          {step !== "sending" && (
            <button
              className="send-close"
              onClick={handleClose}
              aria-label="Close"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="send-body">
          {/* ─── Sending State ─── */}
          {step === "sending" && (
            <div className="send-sending">
              <div className="send-sending-spinner" />
              <div className="send-sending-label">Processing transaction...</div>
            </div>
          )}

          {/* ─── Success State ─── */}
          {step === "success" && (
            <>
              <div className="send-success">
                <div className="send-success-icon">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div className="send-success-label">Transaction sent</div>
                {txHash && (
                  <a
                    className="send-success-hash"
                    href={`https://basescan.org/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {truncateAddress(txHash)}
                  </a>
                )}
              </div>
              <div className="send-actions">
                <button
                  className="send-btn send-btn-secondary"
                  onClick={handleClose}
                >
                  Close
                </button>
              </div>
            </>
          )}

          {/* ─── Error State ─── */}
          {step === "error" && (
            <>
              <div className="send-error">
                <div className="send-error-icon">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
                <div className="send-error-label">Transaction failed</div>
                <div className="send-error-message">{errorMessage}</div>
              </div>
              <div className="send-actions">
                <button
                  className="send-btn send-btn-retry"
                  onClick={() => setStep("review")}
                >
                  Back to review
                </button>
                <button
                  className="send-btn send-btn-primary"
                  onClick={handleSend}
                >
                  Retry
                </button>
              </div>
            </>
          )}

          {/* ─── Review Step ─── */}
          {step === "review" && (
            <>
              <div className="send-review">
                <div className="send-review-amount">
                  <span className="send-review-amount-value">{amount}</span>
                  <span className="send-review-amount-symbol">{token}</span>
                </div>

                <div className="send-review-details">
                  <div className="send-review-row">
                    <span className="send-review-row-label">Token</span>
                    <span className="send-review-row-value">{token}</span>
                  </div>

                  {ownWalletMode ? (
                    <>
                      <div className="send-review-row">
                        <span className="send-review-row-label">From</span>
                        <span className="send-review-row-value wallet-type">
                          {WALLET_TYPE_LABELS[fromWallet]} wallet
                        </span>
                      </div>
                      <div className="send-review-row">
                        <span className="send-review-row-label">To</span>
                        <span className="send-review-row-value wallet-type">
                          {WALLET_TYPE_LABELS[toWallet]} wallet
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="send-review-row">
                        <span className="send-review-row-label">From</span>
                        <span className="send-review-row-value wallet-type">
                          User wallet
                        </span>
                      </div>
                      <div className="send-review-row">
                        <span className="send-review-row-label">To</span>
                        <span className="send-review-row-value address">
                          {reviewRecipientDisplay}
                        </span>
                      </div>
                    </>
                  )}

                  <div className="send-review-row">
                    <span className="send-review-row-label">Network</span>
                    <span className="send-review-row-value">Base</span>
                  </div>
                </div>
              </div>

              <div className="send-actions">
                <button
                  className="send-btn send-btn-secondary"
                  onClick={() => setStep("idle")}
                >
                  Back
                </button>
                <button
                  className="send-btn send-btn-primary"
                  onClick={handleSend}
                >
                  Confirm &amp; send
                </button>
              </div>
            </>
          )}

          {/* ─── Idle (Input) Step ─── */}
          {step === "idle" && (
            <>
              {/* Token Selector */}
              <div className="send-token-selector">
                <button
                  className={`send-token-pill${token === "USDC" ? " active" : ""}`}
                  onClick={() => {
                    setToken("USDC");
                    setAmount("");
                  }}
                >
                  USDC
                </button>
                <button
                  className={`send-token-pill${token === "ETH" ? " active" : ""}`}
                  onClick={() => {
                    setToken("ETH");
                    setAmount("");
                  }}
                >
                  ETH
                </button>
              </div>

              {/* Amount Input */}
              <div className="send-amount-section">
                <div className="send-amount-row">
                  <input
                    ref={amountInputRef}
                    className="send-amount-input"
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={amount}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Limit decimal places
                      const maxDecimals = TOKEN_DECIMALS[token];
                      const parts = val.split(".");
                      if (parts[1] && parts[1].length > maxDecimals) {
                        return;
                      }
                      // Prevent negative numbers
                      if (Number(val) < 0) return;
                      setAmount(val);
                    }}
                    aria-label={`Amount in ${token}`}
                  />
                </div>
                <div className="send-balance-row">
                  <span className="send-balance-label">Available:</span>
                  <span className="send-balance-value">
                    {displayBalance} {token}
                  </span>
                  <button
                    className="send-max-btn"
                    onClick={() => setAmount(maxAmount)}
                    aria-label="Set maximum amount"
                  >
                    MAX
                  </button>
                </div>
              </div>

              {/* Own Wallet Toggle */}
              <div
                className="send-mode-toggle"
                onClick={() => {
                  setOwnWalletMode(!ownWalletMode);
                  setRecipient("");
                  setResolvedUser(null);
                  setResolveError("");
                }}
                role="switch"
                aria-checked={ownWalletMode}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOwnWalletMode(!ownWalletMode);
                    setRecipient("");
                    setResolvedUser(null);
                    setResolveError("");
                  }
                }}
              >
                <span className="send-mode-label">Transfer between own wallets</span>
                <span
                  className={`send-mode-switch${ownWalletMode ? " active" : ""}`}
                />
              </div>

              {/* Recipient / Wallet Selectors */}
              {ownWalletMode ? (
                <div className="send-wallet-selectors">
                  <div className="send-wallet-row">
                    <span className="send-field-label">From</span>
                    <div className="send-wallet-options">
                      {(["user", "server", "agent"] as WalletType[]).map(
                        (wt) => (
                          <button
                            key={wt}
                            className={`send-wallet-opt${fromWallet === wt ? " active" : ""}`}
                            disabled={toWallet === wt}
                            onClick={() => setFromWallet(wt)}
                          >
                            {WALLET_TYPE_LABELS[wt]}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  <div className="send-wallet-row">
                    <span className="send-field-label">To</span>
                    <div className="send-wallet-options">
                      {(["user", "server", "agent"] as WalletType[]).map(
                        (wt) => (
                          <button
                            key={wt}
                            className={`send-wallet-opt${toWallet === wt ? " active" : ""}`}
                            disabled={fromWallet === wt}
                            onClick={() => setToWallet(wt)}
                          >
                            {WALLET_TYPE_LABELS[wt]}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="send-field-group">
                  <span className="send-field-label">Recipient</span>
                  <input
                    className="send-field-input"
                    type="text"
                    placeholder="0x... address or username"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Recipient address or username"
                  />
                  {resolving && (
                    <span className="send-field-hint">Resolving username...</span>
                  )}
                  {resolvedUser && (
                    <span className="send-field-resolved">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {resolvedUser.username} ({truncateAddress(resolvedUser.address)})
                    </span>
                  )}
                  {resolveError && !resolving && (
                    <span className="send-field-error">{resolveError}</span>
                  )}
                </div>
              )}

              {/* Review Button */}
              <div className="send-actions">
                <button
                  className="send-btn send-btn-primary"
                  disabled={!canReview}
                  onClick={() => setStep("review")}
                  title={validationError ?? undefined}
                >
                  Review transfer
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
