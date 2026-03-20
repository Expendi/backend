import { useState, useRef, useCallback } from "react";
import { Drawer } from "vaul";
import { TOKEN_ADDRESSES, type TokenMeta } from "../lib/constants";
import "./token-amount-input.css";

/* ─── Shared helpers ─────────────────────────────────────────────── */

/** Convert human-readable decimal (e.g. "1.5") to base units string */
export function toBaseUnits(amount: string, decimals: number): string {
  if (!amount || isNaN(Number(amount))) return "0";
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const combined = whole + frac;
  return combined.replace(/^0+/, "") || "0";
}

/** Convert base units string to human-readable decimal */
export function fromBaseUnits(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals);
  const trimmedFrac = frac.replace(/0+$/, "");
  return trimmedFrac ? `${whole}.${trimmedFrac}` : whole;
}

/** Format raw base units for display (e.g. balance) */
export function formatHumanAmount(raw: string, decimals: number): string {
  const num = Number(raw) / 10 ** decimals;
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/* ─── TokenIcon ──────────────────────────────────────────────────── */

export function TokenIcon({ name, size = 24 }: { name: string; size?: number }) {
  const meta = TOKEN_ADDRESSES[name];
  const [imgError, setImgError] = useState(false);
  if (!meta) return null;
  if (imgError) {
    return (
      <span
        className="tai-icon-fallback"
        style={{
          width: size,
          height: size,
          background: meta.color,
          fontSize: size * 0.5,
        }}
      >
        {meta.symbol.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={meta.icon}
      alt={meta.symbol}
      width={size}
      height={size}
      className="tai-icon-img"
      style={{ background: meta.color }}
      onError={() => setImgError(true)}
    />
  );
}

/* ─── TokenSelect ────────────────────────────────────────────────── */

interface TokenSelectProps {
  value: string;
  onChange: (token: string) => void;
  tokens?: string[];
  /** If true, the selector is read-only (just shows the token, no picker) */
  disabled?: boolean;
}

export function TokenSelect({ value, onChange, tokens, disabled }: TokenSelectProps) {
  const [open, setOpen] = useState(false);
  const meta = TOKEN_ADDRESSES[value];

  const tokenList = (tokens ?? Object.keys(TOKEN_ADDRESSES))
    .filter(t => t !== "WETH")
    .map(t => ({ key: t, meta: TOKEN_ADDRESSES[t] }))
    .filter(t => t.meta);

  const handleSelect = useCallback((key: string) => {
    onChange(key);
    setOpen(false);
  }, [onChange]);

  return (
    <>
      <button
        type="button"
        className="tai-token-btn"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
      >
        <TokenIcon name={value} size={20} />
        <span className="tai-token-symbol">{meta?.symbol ?? value}</span>
        {!disabled && (
          <svg className="tai-token-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="tai-picker-overlay" />
          <Drawer.Content className="tai-picker-content">
            <div className="tai-picker-handle" />
            <Drawer.Title className="tai-picker-title">Select Token</Drawer.Title>
            <div className="tai-picker-list">
              {tokenList.map(({ key, meta: m }) => (
                <button
                  key={key}
                  type="button"
                  className={`tai-picker-item${key === value ? " active" : ""}`}
                  onClick={() => handleSelect(key)}
                >
                  <TokenIcon name={key} size={32} />
                  <div className="tai-picker-item-info">
                    <span className="tai-picker-item-symbol">{m.symbol}</span>
                    <span className="tai-picker-item-name">{m.name}</span>
                  </div>
                  {key === value && (
                    <svg className="tai-picker-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}

/* ─── TokenAmountInput ───────────────────────────────────────────── */

interface TokenAmountInputProps {
  /** Token key from TOKEN_ADDRESSES (e.g. "USDC", "ETH") */
  token: string;
  /** Called when user changes token via picker */
  onTokenChange?: (token: string) => void;
  /** Human-readable amount string (e.g. "10.5") */
  amount: string;
  /** Called with human-readable amount */
  onAmountChange: (amount: string) => void;
  /** Raw balance in base units (optional — shows balance line if provided) */
  balance?: string;
  /** Label above the input */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Read-only amount (e.g. for output display) */
  readOnly?: boolean;
  /** Which tokens to show in picker. Defaults to all. */
  tokens?: string[];
  /** Disable token picker (just show icon+symbol) */
  tokenFixed?: boolean;
  /** Extra class name */
  className?: string;
  /** Show MAX button */
  showMax?: boolean;
  /** Error message to display below */
  error?: string;
}

export function TokenAmountInput({
  token,
  onTokenChange,
  amount,
  onAmountChange,
  balance,
  label,
  placeholder = "0.00",
  readOnly = false,
  tokens,
  tokenFixed = false,
  className = "",
  showMax = false,
  error,
}: TokenAmountInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const meta = TOKEN_ADDRESSES[token] as TokenMeta | undefined;
  const decimals = meta?.decimals ?? 6;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Allow empty
    if (val === "") { onAmountChange(""); return; }
    // Validate decimal format
    if (!/^\d*\.?\d*$/.test(val)) return;
    // Limit decimal places
    const parts = val.split(".");
    if (parts[1] && parts[1].length > decimals) return;
    onAmountChange(val);
  };

  const handleMax = () => {
    if (!balance) return;
    const human = fromBaseUnits(balance, decimals);
    onAmountChange(human);
  };

  const displayBalance = balance ? formatHumanAmount(balance, decimals) : null;

  // Check if amount exceeds balance
  const exceedsBalance = (() => {
    if (!balance || !amount || amount === "0" || amount === "") return false;
    try {
      return BigInt(toBaseUnits(amount, decimals)) > BigInt(balance);
    } catch { return false; }
  })();

  return (
    <div className={`tai-wrapper ${className}`}>
      {label && <label className="tai-label">{label}</label>}
      <div className={`tai-field${exceedsBalance ? " exceeds" : ""}${error ? " has-error" : ""}`}>
        <input
          ref={inputRef}
          className="tai-input"
          type="text"
          inputMode="decimal"
          placeholder={placeholder}
          value={amount}
          onChange={handleChange}
          readOnly={readOnly}
        />
        {onTokenChange && !tokenFixed ? (
          <TokenSelect
            value={token}
            onChange={onTokenChange}
            tokens={tokens}
          />
        ) : (
          <div className="tai-token-display">
            <TokenIcon name={token} size={20} />
            <span className="tai-token-symbol">{meta?.symbol ?? token}</span>
          </div>
        )}
      </div>
      {(displayBalance || showMax || error || exceedsBalance) && (
        <div className="tai-sub">
          {error ? (
            <span className="tai-error">{error}</span>
          ) : exceedsBalance ? (
            <span className="tai-error">Exceeds balance</span>
          ) : null}
          {displayBalance && (
            <span className="tai-balance">
              Balance: {displayBalance} {meta?.symbol}
              {showMax && balance && balance !== "0" && (
                <button type="button" className="tai-max" onClick={handleMax}>MAX</button>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
