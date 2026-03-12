/**
 * Shared rich UI components for Glove tool rendering.
 * Uses the Exo design system CSS classes (btn-exo, card-exo, tag-exo, etc.)
 */
import type { ReactNode } from "react";

// ─── Status Badge ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  submitted: "success",
  confirmed: "confirmed",
  pending: "pending",
  failed: "failed",
  active: "active",
  inactive: "inactive",
  paused: "paused",
  cancelled: "cancelled",
  completed: "completed",
  processing: "processing",
};

export function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  return <span className={`tag-exo status-${status}`}>{label}</span>;
}

// ─── Confirm Dialog (pushAndWait) ────────────────────────────────────────────

export function ConfirmDialog({
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  onConfirm,
  onCancel,
}: {
  title?: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="glove-confirm">
      {title && <div className="glove-confirm-title">{title}</div>}
      <div className="glove-confirm-body">{children}</div>
      <div className="glove-confirm-actions">
        <button className={`btn-exo btn-${variant}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button className="btn-exo btn-secondary" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Data Card ───────────────────────────────────────────────────────────────

export function DataCard({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="glove-result">
      {label && <div className="glove-result-label">{label}</div>}
      {children}
    </div>
  );
}

// ─── Stat Card (for portfolio/summary displays) ─────────────────────────────

export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="card-exo" style={{ textAlign: "center", padding: 16 }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          fontWeight: 900,
          color: accent ? "var(--exo-lime)" : "var(--text-primary)",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-secondary)",
            marginTop: 4,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Stats Grid ──────────────────────────────────────────────────────────────

export function StatsGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}

// ─── Progress Bar ────────────────────────────────────────────────────────────

export function ProgressBar({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label?: string;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div>
      {label && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-secondary)",
            marginBottom: 4,
          }}
        >
          <span>{label}</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
      )}
      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: "var(--bg-elevated)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "var(--exo-lime)",
            borderRadius: 4,
            transition: "width 0.6s ease",
          }}
        />
      </div>
    </div>
  );
}

// ─── Key-Value Row ───────────────────────────────────────────────────────────

export function KVRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 0",
        borderBottom: "1px solid var(--border)",
        fontSize: 13,
      }}
    >
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span
        style={{
          fontFamily: mono ? "var(--font-mono)" : undefined,
          fontSize: mono ? 12 : undefined,
          color: "var(--text-primary)",
          maxWidth: "60%",
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Address Display ─────────────────────────────────────────────────────────

export function Address({ value }: { value: string }) {
  if (!value) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "var(--exo-sky)",
      }}
    >
      {value.slice(0, 10)}...{value.slice(-6)}
    </span>
  );
}

// ─── Token Amount Display ────────────────────────────────────────────────────

export function TokenAmount({
  amount,
  symbol,
  decimals,
}: {
  amount: string;
  symbol?: string;
  decimals?: number;
}) {
  let display = amount;
  if (decimals && decimals > 0) {
    const num = Number(amount) / 10 ** decimals;
    display = num.toLocaleString(undefined, {
      maximumFractionDigits: decimals,
    });
  }
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
      {display}
      {symbol && (
        <span
          style={{
            marginLeft: 4,
            fontSize: 11,
            color: "var(--text-secondary)",
          }}
        >
          {symbol}
        </span>
      )}
    </span>
  );
}

// ─── Wallet Type Badge ───────────────────────────────────────────────────────

const WALLET_TYPE_STATUS: Record<string, string> = {
  user: "active",
  server: "pending",
  agent: "processing",
};

export function WalletBadge({ type }: { type: string }) {
  return (
    <span className={`tag-exo status-${WALLET_TYPE_STATUS[type] ?? "pending"}`}>
      {type}
    </span>
  );
}

// ─── Data List Item ──────────────────────────────────────────────────────────

export function ListItem({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className="data-list-item"
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : undefined }}
    >
      {children}
    </div>
  );
}

// ─── Transaction Hash ────────────────────────────────────────────────────────

export function TxHash({ hash }: { hash: string | null }) {
  if (!hash) return <span style={{ color: "var(--text-muted)" }}>pending</span>;
  return (
    <a
      href={`https://basescan.org/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "var(--exo-sky)",
        textDecoration: "none",
      }}
    >
      {hash.slice(0, 10)}...{hash.slice(-6)}
    </a>
  );
}
