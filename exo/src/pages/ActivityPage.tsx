import { useState, useEffect, useCallback, useMemo } from "react";
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
  timestamp?: string;
}

/* ─── Unified Activity Item ──────────────────────────────────────── */

type ActivityItem =
  | { kind: "tx"; data: Transaction; sortTime: number }
  | { kind: "deposit"; data: Deposit; sortTime: number };

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

/** Extract transfer details from a transaction's payload and method */
function getTransferInfo(tx: Transaction): { token: string; amount: string; to: string } | null {
  if (tx.method !== "transfer" || !tx.payload) return null;
  const args = tx.payload.args as unknown[];
  if (!Array.isArray(args) || args.length < 2) return null;

  const to = String(args[0]);
  const rawAmount = Number(args[1]);

  // Determine token from contractId
  const contract = (tx.contractId ?? "").toLowerCase();
  const TOKEN_DECIMALS: Record<string, { symbol: string; decimals: number }> = {
    usdc: { symbol: "USDC", decimals: 6 },
    usdt: { symbol: "USDT", decimals: 6 },
    dai: { symbol: "DAI", decimals: 18 },
    eth: { symbol: "ETH", decimals: 18 },
    weth: { symbol: "WETH", decimals: 18 },
    cbeth: { symbol: "cbETH", decimals: 18 },
    cbbtc: { symbol: "cbBTC", decimals: 8 },
    aero: { symbol: "AERO", decimals: 18 },
  };

  const tokenInfo = TOKEN_DECIMALS[contract] ?? { symbol: contract.toUpperCase() || "TOKEN", decimals: 18 };
  const formatted = rawAmount / Math.pow(10, tokenInfo.decimals);

  return {
    token: tokenInfo.symbol,
    amount: formatted % 1 === 0 ? String(formatted) : formatted.toFixed(formatted < 1 ? 6 : 2),
    to,
  };
}

/** Determine a human-friendly label for a transaction */
function getTxLabel(tx: Transaction): string {
  const transfer = getTransferInfo(tx);
  if (transfer) return "Transfer";
  return formatMethod(tx.method);
}

function TxStatusBadge({ status }: { status: string }) {
  const statusClass = status === "submitted" ? "confirmed" : status;
  const label = status === "submitted" ? "success" : status;
  return <span className={`activity-badge ${statusClass}`}>{label}</span>;
}

/* ─── Transaction Detail ─────────────────────────────────────────── */

function TxDetail({ tx }: { tx: Transaction }) {
  const truncate = (s: string | null) => s ? `${s.slice(0, 10)}...${s.slice(-6)}` : "—";
  const transfer = getTransferInfo(tx);

  return (
    <div className="activity-detail" style={{ padding: 0 }}>
      <div className="activity-detail-rows">
        <div className="activity-detail-row"><span className="activity-detail-label">Status</span><TxStatusBadge status={tx.status} /></div>
        {transfer && (
          <>
            <div className="activity-detail-row">
              <span className="activity-detail-label">Amount</span>
              <span className="activity-detail-value" style={{ fontWeight: 600, color: "var(--exo-coral, #ff6b6b)" }}>
                -{transfer.amount} {transfer.token}
              </span>
            </div>
            <div className="activity-detail-row">
              <span className="activity-detail-label">To</span>
              <span className="activity-detail-value" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{truncateAddress(transfer.to)}</span>
            </div>
          </>
        )}
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

  /* Build a unified, sorted activity list */
  const activityItems = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];

    // Add transactions (filtered by status if needed)
    const txs = filter === "deposits"
      ? []
      : filter === "all"
        ? recentTransactions
        : recentTransactions.filter((tx) => {
            if (filter === "confirmed") return tx.status === "confirmed" || tx.status === "submitted";
            return tx.status === filter;
          });

    for (const tx of txs) {
      items.push({
        kind: "tx",
        data: tx,
        sortTime: new Date(tx.createdAt).getTime(),
      });
    }

    // Add deposits (only when showing all or deposits filter)
    if (filter === "all" || filter === "deposits") {
      for (const dep of deposits) {
        items.push({
          kind: "deposit",
          data: dep,
          // Use timestamp if available, otherwise use a high block number as proxy
          sortTime: dep.timestamp ? new Date(dep.timestamp).getTime() : Number(dep.blockNumber),
        });
      }
    }

    // Sort newest first
    items.sort((a, b) => b.sortTime - a.sortTime);
    return items;
  }, [recentTransactions, deposits, filter]);

  const totalCount = recentTransactions.length + deposits.length;

  return (
    <div className="wallet-home">
      <div className="wh-section" style={{ paddingTop: 24 }}>
        <div className="wh-section-header">
          <span className="wh-section-title">Activity</span>
          <span className="wh-section-count">{totalCount}</span>
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

        {/* Unified Activity List */}
        {loading && recentTransactions.length === 0 && deposits.length === 0 ? (
          <div className="wh-wallet-card wh-skeleton-card">
            <div className="wh-skeleton" style={{ width: "80%" }} />
            <div className="wh-skeleton" style={{ width: "50%" }} />
            <div className="wh-skeleton" style={{ width: "60%" }} />
          </div>
        ) : activityItems.length === 0 ? (
          <div className="wh-insight-card">
            <span className="wh-insight-text">
              {depositsLoading
                ? "Loading..."
                : filter === "all"
                  ? "No activity yet."
                  : filter === "deposits"
                    ? "No deposits found."
                    : `No ${filter} transactions.`}
            </span>
          </div>
        ) : (
          <div className="activity-list">
            {activityItems.map((item) => {
              if (item.kind === "deposit") {
                const dep = item.data;
                return (
                  <button
                    className="activity-item"
                    key={`dep-${dep.transactionHash}-${dep.walletId}`}
                    onClick={() => setSelectedDeposit(dep)}
                  >
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
                );
              }

              const tx = item.data;
              const transfer = getTransferInfo(tx);
              return (
                <button className="activity-item" key={tx.id} onClick={() => setSelectedTx(tx)}>
                  <div className="activity-item-left" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {transfer ? (
                      <TokenIcon name={transfer.token} size={28} />
                    ) : (
                      <span className="activity-item-icon" style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: "var(--bg-elevated, rgba(255,255,255,0.06))",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        flexShrink: 0,
                      }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                        </svg>
                      </span>
                    )}
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span className="activity-method">{getTxLabel(tx)}</span>
                      <span className="activity-time">
                        {transfer
                          ? `to ${truncateAddress(transfer.to)} · ${formatTime(tx.createdAt)}`
                          : formatTime(tx.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    {transfer ? (
                      <span style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}>
                        -{transfer.amount} {transfer.token}
                      </span>
                    ) : null}
                    <TxStatusBadge status={tx.status} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Transaction Detail */}
      <BottomSheet open={!!selectedTx} onClose={() => setSelectedTx(null)} title={selectedTx ? getTxLabel(selectedTx) : undefined}>
        {selectedTx && <TxDetail tx={selectedTx} />}
      </BottomSheet>

      {/* Deposit Detail */}
      <BottomSheet open={!!selectedDeposit} onClose={() => setSelectedDeposit(null)} title="Deposit">
        {selectedDeposit && <DepositDetail deposit={selectedDeposit} />}
      </BottomSheet>
    </div>
  );
}
