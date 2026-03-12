import { useState } from "react";
import { useDashboard } from "../context/DashboardContext";
import type { Transaction } from "../lib/types";
import "../styles/wallet-home.css";

/* ─── Helpers ─────────────────────────────────────────────────────── */

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatMethod(method: string): string {
  return method
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function TxStatusBadge({ status }: { status: string }) {
  const statusClass = status === "submitted" ? "confirmed" : status;
  const label = status === "submitted" ? "success" : status;
  return <span className={`activity-badge ${statusClass}`}>{label}</span>;
}

/* ─── Transaction Detail ─────────────────────────────────────────── */

function TxDetail({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const truncate = (s: string | null) => s ? `${s.slice(0, 10)}...${s.slice(-6)}` : "—";

  return (
    <div className="activity-detail">
      <div className="activity-detail-header">
        <span className="wh-section-title">{formatMethod(tx.method)}</span>
        <button className="activity-detail-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="activity-detail-rows">
        <div className="activity-detail-row"><span className="activity-detail-label">Status</span><TxStatusBadge status={tx.status} /></div>
        <div className="activity-detail-row"><span className="activity-detail-label">Wallet</span><span className="activity-detail-value">{tx.walletType}</span></div>
        <div className="activity-detail-row"><span className="activity-detail-label">Chain</span><span className="activity-detail-value">{tx.chainId}</span></div>
        {tx.txHash && (
          <div className="activity-detail-row">
            <span className="activity-detail-label">Tx Hash</span>
            <a className="activity-detail-link" href={`https://basescan.org/tx/${tx.txHash}`} target="_blank" rel="noopener noreferrer">{truncate(tx.txHash)}</a>
          </div>
        )}
        <div className="activity-detail-row"><span className="activity-detail-label">Created</span><span className="activity-detail-value">{new Date(tx.createdAt).toLocaleString()}</span></div>
        {tx.confirmedAt && <div className="activity-detail-row"><span className="activity-detail-label">Confirmed</span><span className="activity-detail-value">{new Date(tx.confirmedAt).toLocaleString()}</span></div>}
        {tx.error && <div className="activity-detail-row"><span className="activity-detail-label">Error</span><span className="activity-detail-value" style={{ color: "var(--exo-coral)" }}>{tx.error}</span></div>}
      </div>
    </div>
  );
}

/* ─── Filter Tabs ─────────────────────────────────────────────────── */

type Filter = "all" | "confirmed" | "pending" | "failed";

/* ─── Page ────────────────────────────────────────────────────────── */

export function ActivityPage() {
  const { recentTransactions, loading } = useDashboard();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  const filtered = filter === "all"
    ? recentTransactions
    : recentTransactions.filter((tx) => {
        if (filter === "confirmed") return tx.status === "confirmed" || tx.status === "submitted";
        return tx.status === filter;
      });

  return (
    <div className="wallet-home">
      <div className="wh-section" style={{ paddingTop: 24 }}>
        <div className="wh-section-header">
          <span className="wh-section-title">Activity</span>
          <span className="wh-section-count">{recentTransactions.length}</span>
        </div>

        {/* Filters */}
        <div className="activity-filters">
          {(["all", "confirmed", "pending", "failed"] as Filter[]).map((f) => (
            <button
              key={f}
              className={`activity-filter-btn ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Transaction List */}
        {loading && recentTransactions.length === 0 ? (
          <div className="wh-wallet-card wh-skeleton-card">
            <div className="wh-skeleton" style={{ width: "80%" }} />
            <div className="wh-skeleton" style={{ width: "50%" }} />
            <div className="wh-skeleton" style={{ width: "60%" }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="wh-insight-card">
            <span className="wh-insight-text">
              {filter === "all" ? "No transactions yet." : `No ${filter} transactions.`}
            </span>
          </div>
        ) : (
          <div className="activity-list">
            {filtered.map((tx) => (
              <button className="activity-item" key={tx.id} onClick={() => setSelectedTx(tx)}>
                <div className="activity-item-left">
                  <span className="activity-method">{formatMethod(tx.method)}</span>
                  <span className="activity-time">{formatTime(tx.createdAt)}</span>
                </div>
                <TxStatusBadge status={tx.status} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedTx && (
        <div className="activity-modal-backdrop" onClick={() => setSelectedTx(null)}>
          <div className="activity-modal" onClick={(e) => e.stopPropagation()}>
            <TxDetail tx={selectedTx} onClose={() => setSelectedTx(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
