import { useState, useEffect, useCallback } from "react";
import { useDashboard } from "../context/DashboardContext";
import { useApi } from "../hooks/useApi";
import { BottomSheet } from "../components/BottomSheet";
import { TokenIcon } from "../components/TokenAmountInput";
import type { Transaction } from "../lib/types";
import "../styles/wallet-home.css";
import "../styles/page-transition.css";

/* ─── Deposit Type ───────────────────────────────────────────────── */

interface Deposit {
  walletId: string;
  walletType: string;
  walletAddress: string;
  from: string;
  tokenAddress: string;
  tokenSymbol: string;
  amount: string;
  formattedAmount: string;
  blockNumber: string;
  transactionHash: string;
}

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

function truncateAddress(s: string): string {
  return s ? `${s.slice(0, 8)}...${s.slice(-6)}` : "—";
}

function TxStatusBadge({ status }: { status: string }) {
  const statusClass = status === "submitted" ? "confirmed" : status;
  const label = status === "submitted" ? "success" : status;
  return <span className={`activity-badge ${statusClass}`}>{label}</span>;
}

/* ─── Transaction Detail ─────────────────────────────────────────── */

function TxDetail({ tx }: { tx: Transaction }) {
  const truncate = (s: string | null) => s ? `${s.slice(0, 10)}...${s.slice(-6)}` : "—";

  return (
    <div className="activity-detail" style={{ padding: 0 }}>
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

/* ─── Deposit Detail ─────────────────────────────────────────────── */

function DepositDetail({ deposit }: { deposit: Deposit }) {
  return (
    <div className="activity-detail" style={{ padding: 0 }}>
      <div className="activity-detail-rows">
        <div className="activity-detail-row">
          <span className="activity-detail-label">Type</span>
          <TxStatusBadge status="confirmed" />
        </div>
        <div className="activity-detail-row">
          <span className="activity-detail-label">Amount</span>
          <span className="activity-detail-value" style={{ fontWeight: 600, color: "var(--exo-lime, #a3e635)" }}>
            +{deposit.formattedAmount} {deposit.tokenSymbol}
          </span>
        </div>
        <div className="activity-detail-row">
          <span className="activity-detail-label">From</span>
          <span className="activity-detail-value" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{truncateAddress(deposit.from)}</span>
        </div>
        <div className="activity-detail-row">
          <span className="activity-detail-label">To Wallet</span>
          <span className="activity-detail-value">{deposit.walletType}</span>
        </div>
        <div className="activity-detail-row">
          <span className="activity-detail-label">Block</span>
          <span className="activity-detail-value">{deposit.blockNumber}</span>
        </div>
        {deposit.transactionHash && (
          <div className="activity-detail-row">
            <span className="activity-detail-label">Tx Hash</span>
            <a className="activity-detail-link" href={`https://basescan.org/tx/${deposit.transactionHash}`} target="_blank" rel="noopener noreferrer">
              {truncateAddress(deposit.transactionHash)}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Filter Tabs ─────────────────────────────────────────────────── */

type Filter = "all" | "confirmed" | "pending" | "failed" | "deposits";

/* ─── Page ────────────────────────────────────────────────────────── */

export function ActivityPage() {
  const { recentTransactions, loading } = useDashboard();
  const { request } = useApi();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [selectedDeposit, setSelectedDeposit] = useState<Deposit | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [depositsLoading, setDepositsLoading] = useState(false);

  const fetchDeposits = useCallback(async () => {
    setDepositsLoading(true);
    try {
      const data = await request<Deposit[]>("/wallets/deposits");
      setDeposits(data);
    } catch { /* silent */ }
    setDepositsLoading(false);
  }, [request]);

  useEffect(() => {
    fetchDeposits();
  }, [fetchDeposits]);

  const filtered = filter === "deposits"
    ? []
    : filter === "all"
      ? recentTransactions
      : recentTransactions.filter((tx) => {
          if (filter === "confirmed") return tx.status === "confirmed" || tx.status === "submitted";
          return tx.status === filter;
        });

  const showDeposits = filter === "all" || filter === "deposits";

  return (
    <div className="wallet-home">
      <div className="wh-section" style={{ paddingTop: 24 }}>
        <div className="wh-section-header">
          <span className="wh-section-title">Activity</span>
          <span className="wh-section-count">{recentTransactions.length + deposits.length}</span>
        </div>

        {/* Filters */}
        <div className="activity-filters">
          {(["all", "confirmed", "pending", "failed", "deposits"] as Filter[]).map((f) => (
            <button
              key={f}
              className={`activity-filter-btn ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Deposits section */}
        {showDeposits && deposits.length > 0 && (
          <>
            {filter === "all" && (
              <div className="wh-section-header" style={{ marginTop: 8, marginBottom: 4 }}>
                <span className="wh-section-title" style={{ fontSize: 14 }}>Deposits</span>
                <span className="wh-section-count">{deposits.length}</span>
              </div>
            )}
            <div className="activity-list" style={{ marginBottom: filter === "all" ? 16 : 0 }}>
              {deposits.map((dep) => (
                <button className="activity-item" key={dep.transactionHash + dep.walletId} onClick={() => setSelectedDeposit(dep)}>
                  <div className="activity-item-left" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <TokenIcon name={dep.tokenSymbol} size={28} />
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span className="activity-method">Deposit</span>
                      <span className="activity-time" style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
                        from {truncateAddress(dep.from)}
                      </span>
                    </div>
                  </div>
                  <span style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--exo-lime, #a3e635)",
                  }}>
                    +{dep.formattedAmount} {dep.tokenSymbol}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Transactions section */}
        {filter !== "deposits" && (
          <>
            {filter === "all" && deposits.length > 0 && (
              <div className="wh-section-header" style={{ marginBottom: 4 }}>
                <span className="wh-section-title" style={{ fontSize: 14 }}>Transactions</span>
                <span className="wh-section-count">{recentTransactions.length}</span>
              </div>
            )}

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
          </>
        )}

        {filter === "deposits" && deposits.length === 0 && (
          <div className="wh-insight-card">
            <span className="wh-insight-text">
              {depositsLoading ? "Loading deposits..." : "No deposits found."}
            </span>
          </div>
        )}
      </div>

      {/* Transaction Detail */}
      <BottomSheet open={!!selectedTx} onClose={() => setSelectedTx(null)} title={selectedTx ? formatMethod(selectedTx.method) : undefined}>
        {selectedTx && <TxDetail tx={selectedTx} />}
      </BottomSheet>

      {/* Deposit Detail */}
      <BottomSheet open={!!selectedDeposit} onClose={() => setSelectedDeposit(null)} title="Deposit">
        {selectedDeposit && <DepositDetail deposit={selectedDeposit} />}
      </BottomSheet>
    </div>
  );
}
