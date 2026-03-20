import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useDashboard } from "../context/DashboardContext";
import type { WalletBalanceDetailed } from "../context/DashboardContext";
import { SendModal } from "../components/SendModal";
import { AnimatedBalance } from "../components/AnimatedBalance";
import { useAppMode } from "../context/AppModeContext";
import type { YieldPortfolio, GoalSaving, RecurringPayment } from "../lib/types";
import "../styles/wallet-home.css";
import "../styles/pages.css";

/* ─── Helpers ─────────────────────────────────────────────────────── */

function formatBalance(raw: string, decimals: number): string {
  const num = Number(raw) / 10 ** decimals;
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const WALLET_LABELS: Record<string, string> = {
  user: "Personal",
  server: "Custodial",
  agent: "AI Agent",
};

const WALLET_DESCRIPTIONS: Record<string, string> = {
  user: "Your main wallet",
  server: "Managed for you",
  agent: "AI-powered",
};

/* ─── Wallet Carousel Card ────────────────────────────────────────── */

function CarouselCard({
  wallet,
  active,
  onSelect,
  onCopy,
}: {
  wallet: WalletBalanceDetailed;
  active: boolean;
  onSelect: () => void;
  onCopy?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (wallet.address) {
      navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const ethBal = formatBalance(wallet.balances.ETH ?? "0", 18);
  const usdcBal = formatBalance(wallet.balances.USDC ?? "0", 6);

  return (
    <div
      className={`wh-carousel-card ${active ? "active" : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}
    >
      <div className="wh-carousel-card-top">
        <span className="wh-carousel-card-label">
          {WALLET_LABELS[wallet.type] ?? wallet.type}
        </span>
        <button className="wh-wallet-addr" onClick={handleCopy} title={wallet.address} type="button">
          {copied
            ? "Copied"
            : wallet.address
              ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
              : "—"}
        </button>
      </div>
      <div className="wh-carousel-card-desc">
        {WALLET_DESCRIPTIONS[wallet.type] ?? ""}
      </div>
      <div className="wh-carousel-card-balances">
        <div className="wh-token-row">
          <span className="wh-token-symbol">USDC</span>
          <span className="wh-token-amount">{usdcBal}</span>
        </div>
        <div className="wh-token-row">
          <span className="wh-token-symbol">ETH</span>
          <span className="wh-token-amount">{ethBal}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────────────── */

export function WalletHomePage() {
  const { walletBalances, recentTransactions, loading, refresh } = useDashboard();
  const { request } = useApi();
  const navigate = useNavigate();
  const { mode } = useAppMode();
  const [sendOpen, setSendOpen] = useState(false);
  const [activeWalletIdx, setActiveWalletIdx] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  // Quick insights data
  const [yieldPortfolio, setYieldPortfolio] = useState<YieldPortfolio | null>(null);
  const [activeGoals, setActiveGoals] = useState<GoalSaving[]>([]);
  const [nextRecurring, setNextRecurring] = useState<RecurringPayment | null>(null);

  useEffect(() => {
    request<YieldPortfolio>("/yield/portfolio").then(setYieldPortfolio).catch(() => {});
    request<GoalSaving[]>("/goal-savings")
      .then((goals) => setActiveGoals(goals.filter((g) => g.status === "active")))
      .catch(() => {});
    request<RecurringPayment[]>("/recurring-payments")
      .then((payments) => {
        const active = payments.filter((p) => p.status === "active");
        if (active.length > 0) {
          active.sort(
            (a, b) =>
              new Date(a.nextExecutionAt).getTime() - new Date(b.nextExecutionAt).getTime()
          );
          setNextRecurring(active[0]);
        }
      })
      .catch(() => {});
  }, [request]);

  // Active wallet balance
  const activeWallet = walletBalances[activeWalletIdx] ?? null;
  const displayUsdc = activeWallet
    ? Number(activeWallet.balances.USDC ?? "0") / 1e6
    : walletBalances.reduce((s, w) => s + Number(w.balances.USDC ?? "0") / 1e6, 0);
  const displayEth = activeWallet
    ? Number(activeWallet.balances.ETH ?? "0") / 1e18
    : walletBalances.reduce((s, w) => s + Number(w.balances.ETH ?? "0") / 1e18, 0);

  const recentTxs = recentTransactions.slice(0, 5);

  function formatTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // Scroll selected card into view
  const selectWallet = (idx: number) => {
    setActiveWalletIdx(idx);
    const container = carouselRef.current;
    if (container) {
      const cards = container.querySelectorAll(".wh-carousel-card");
      cards[idx]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  };

  return (
    <div className="wallet-home">
      {/* Hero Balance — shows active wallet balance */}
      <div className="wh-hero">
        <div className="wh-hero-glow" aria-hidden="true" />
        <div className="wh-hero-content">
          {loading && walletBalances.length === 0 ? (
            <div className="wh-hero-loading">
              <div className="wh-skeleton wh-skeleton-lg" />
              <div className="wh-skeleton wh-skeleton-sm" />
            </div>
          ) : (
            <>
              <div className="wh-balance-label">
                {activeWallet ? WALLET_LABELS[activeWallet.type] : "Total Balance"}
              </div>
              <div className="wh-total-balance">
                <AnimatedBalance
                  value={displayUsdc}
                  decimals={2}
                  duration={600}
                  className="wh-total-amount"
                />
                <span className="wh-total-symbol">USDC</span>
              </div>
              {displayEth > 0 && (
                <div className="wh-secondary-balance">
                  <AnimatedBalance
                    value={displayEth}
                    decimals={4}
                    duration={600}
                  />
                  {" ETH"}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Wallet Carousel */}
      <div className="wh-carousel-wrapper">
        <div className="wh-carousel" ref={carouselRef}>
          {loading && walletBalances.length === 0 ? (
            <>
              <div className="wh-carousel-card wh-skeleton-card">
                <div className="wh-skeleton" style={{ width: "60%" }} />
                <div className="wh-skeleton" style={{ width: "40%" }} />
              </div>
              <div className="wh-carousel-card wh-skeleton-card">
                <div className="wh-skeleton" style={{ width: "60%" }} />
                <div className="wh-skeleton" style={{ width: "40%" }} />
              </div>
            </>
          ) : (
            walletBalances.map((w, i) => (
              <CarouselCard
                key={w.type}
                wallet={w}
                active={i === activeWalletIdx}
                onSelect={() => selectWallet(i)}
              />
            ))
          )}
        </div>
        {/* Dots */}
        {walletBalances.length > 1 && (
          <div className="wh-carousel-dots">
            {walletBalances.map((_, i) => (
              <button
                key={i}
                className={`wh-carousel-dot ${i === activeWalletIdx ? "active" : ""}`}
                onClick={() => selectWallet(i)}
                aria-label={`Select wallet ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="wh-actions">
        <button className="wh-action-btn" onClick={() => setSendOpen(true)}>
          <span className="wh-action-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" />
            </svg>
          </span>
          <span className="wh-action-label">Send</span>
        </button>
        <button className="wh-action-btn" onClick={() => navigate("/receive")}>
          <span className="wh-action-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="17" y1="7" x2="7" y2="17" /><polyline points="17 17 7 17 7 7" />
            </svg>
          </span>
          <span className="wh-action-label">Receive</span>
        </button>
        <button className="wh-action-btn" onClick={() => navigate("/swap")}>
          <span className="wh-action-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </span>
          <span className="wh-action-label">Swap</span>
        </button>
        <button className="wh-action-btn" onClick={() => navigate("/buy")}>
          <span className="wh-action-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </span>
          <span className="wh-action-label">Fund</span>
        </button>
      </div>

      {/* Quick Insights */}
      {(yieldPortfolio || activeGoals.length > 0 || nextRecurring) && (
        <div className="wh-quick-insights">
          {yieldPortfolio && yieldPortfolio.totalYieldEarned !== "0" && (
            <div className="wh-insight-chip" onClick={() => navigate("/earn")} style={{ cursor: "pointer" }}>
              <span className="wh-insight-chip-dot" style={{ background: "var(--exo-violet)" }} />
              <span className="wh-insight-chip-text">Earnings</span>
              <span className="wh-insight-chip-value">{yieldPortfolio.totalYieldEarned}</span>
            </div>
          )}
          {activeGoals.length > 0 && (
            <div className="wh-insight-chip" onClick={() => navigate("/goals")} style={{ cursor: "pointer" }}>
              <span className="wh-insight-chip-dot" style={{ background: "var(--exo-lime)" }} />
              <span className="wh-insight-chip-text">Saving</span>
              <span className="wh-insight-chip-value">
                {activeGoals.length} goal{activeGoals.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          {nextRecurring && (
            <div className="wh-insight-chip" onClick={() => navigate("/recurring")} style={{ cursor: "pointer" }}>
              <span className="wh-insight-chip-dot" style={{ background: "var(--exo-peach)" }} />
              <span className="wh-insight-chip-text">Next Payment</span>
              <span className="wh-insight-chip-value">{formatTime(nextRecurring.nextExecutionAt)}</span>
            </div>
          )}
        </div>
      )}

      {/* Explore */}
      <div className="wh-section">
        <div className="wh-section-header">
          <span className="wh-section-title">Explore</span>
        </div>
        <div className="wh-feature-grid">
          <button className="wh-feature-card" onClick={() => navigate("/earn")}>
            <span className="wh-feature-icon violet">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
              </svg>
            </span>
            <span className="wh-feature-label">Earn</span>
            <span className="wh-feature-hint">Grow your money</span>
          </button>
          <button className="wh-feature-card" onClick={() => navigate("/goals")}>
            <span className="wh-feature-icon lime">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
              </svg>
            </span>
            <span className="wh-feature-label">Goals</span>
            <span className="wh-feature-hint">Save smarter</span>
          </button>
          <button className="wh-feature-card" onClick={() => navigate("/recurring")}>
            <span className="wh-feature-icon peach">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </span>
            <span className="wh-feature-label">Autopay</span>
            <span className="wh-feature-hint">Set it & forget it</span>
          </button>
          {mode === "agent" && (
            <button className="wh-feature-card" onClick={() => navigate("/agent")}>
              <span className="wh-feature-icon sky">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              <span className="wh-feature-label">exo AI</span>
              <span className="wh-feature-hint">Ask anything</span>
            </button>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      {recentTxs.length > 0 && (
        <div className="wh-section">
          <div className="wh-section-header">
            <span className="wh-section-title">Recent</span>
            <button
              onClick={() => navigate("/activity")}
              style={{
                background: "none",
                border: "none",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--accent)",
                cursor: "pointer",
              }}
            >
              See All
            </button>
          </div>
          <div className="wh-wallet-card" style={{ padding: "4px 16px" }}>
            {recentTxs.map((tx) => (
              <div key={tx.id} className="wh-recent-tx">
                <div className="wh-recent-tx-left">
                  <span className="wh-recent-tx-method">{tx.method}</span>
                  <span className="wh-recent-tx-time">{formatTime(tx.createdAt)}</span>
                </div>
                <span className={`activity-badge ${tx.status}`}>{tx.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <SendModal
        open={sendOpen}
        onClose={() => {
          setSendOpen(false);
          refresh();
        }}
        walletBalances={walletBalances.length > 0 ? walletBalances : null}
      />
    </div>
  );
}
