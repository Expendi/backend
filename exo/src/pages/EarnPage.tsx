import { useState, useEffect, useCallback, useRef } from "react";
import { useApi, ApiRequestError } from "../hooks/useApi";
import { useDashboard } from "../context/DashboardContext";
import { useApprovalContext } from "../context/ApprovalContext";
import { Spinner } from "../components/Spinner";
import { BottomSheet } from "../components/BottomSheet";
import { TokenAmountInput } from "../components/TokenAmountInput";
import type { YieldVault, YieldPosition, YieldPortfolio } from "../lib/types";
import "../styles/pages.css";
import "../styles/page-transition.css";

type Tab = "vaults" | "positions" | "portfolio";
type DepositStep = "idle" | "form" | "review" | "depositing" | "success" | "error";
type WithdrawStep = "idle" | "confirm" | "withdrawing" | "success" | "error";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function EarnPage() {
  const { request } = useApi();
  const { walletBalances, refresh } = useDashboard();
  const approvalCtx = useApprovalContext();

  const [tab, setTabState] = useState<Tab>("vaults");
  const EARN_TAB_ORDER: Tab[] = ["vaults", "positions", "portfolio"];
  const prevEarnTabIdxRef = useRef(0);
  const [earnTabSlide, setEarnTabSlide] = useState<"left" | "right" | null>(null);
  const setTab = (newTab: Tab) => {
    const newIdx = EARN_TAB_ORDER.indexOf(newTab);
    const prevIdx = prevEarnTabIdxRef.current;
    if (newIdx !== prevIdx && newIdx >= 0) {
      setEarnTabSlide(newIdx > prevIdx ? "right" : "left");
      prevEarnTabIdxRef.current = newIdx;
    }
    setTabState(newTab);
  };

  const [vaults, setVaults] = useState<YieldVault[]>([]);
  const [positions, setPositions] = useState<YieldPosition[]>([]);
  const [portfolio, setPortfolio] = useState<YieldPortfolio | null>(null);
  const [loading, setLoading] = useState(false);

  // Deposit
  const [depositStep, setDepositStep] = useState<DepositStep>("idle");
  const [selectedVault, setSelectedVault] = useState<YieldVault | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositLabel, setDepositLabel] = useState("");
  const [depositError, setDepositError] = useState("");

  // Withdraw
  const [withdrawStep, setWithdrawStep] = useState<WithdrawStep>("idle");
  const [selectedPosition, setSelectedPosition] = useState<YieldPosition | null>(null);
  const [withdrawError, setWithdrawError] = useState("");

  // Accrued yield
  const [accruedYield, setAccruedYield] = useState<string | null>(null);
  const [accruedLoading, setAccruedLoading] = useState(false);

  const requestWithApproval = useCallback(
    async <T,>(path: string, options?: { method?: "GET" | "POST"; body?: unknown }) => {
      try {
        return await request<T>(path, options);
      } catch (err) {
        if (err instanceof ApiRequestError && err._tag === "TransactionApprovalRequired" && approvalCtx) {
          const token = await approvalCtx.requestApproval(err.method ?? "pin");
          if (!token) throw new Error("Approval cancelled");
          return request<T>(path, { ...options, approvalToken: token });
        }
        throw err;
      }
    },
    [request, approvalCtx]
  );

  const fetchVaults = useCallback(async () => {
    try {
      const data = await request<YieldVault[]>("/yield/vaults", { query: { chainId: "8453" } });
      setVaults(data);
    } catch { /* handled */ }
  }, [request]);

  const fetchPositions = useCallback(async () => {
    try {
      const data = await request<YieldPosition[]>("/yield/positions");
      setPositions(data);
    } catch { /* handled */ }
  }, [request]);

  const fetchPortfolio = useCallback(async () => {
    try {
      const data = await request<YieldPortfolio>("/yield/portfolio");
      setPortfolio(data);
    } catch { /* handled */ }
  }, [request]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchVaults(), fetchPositions(), fetchPortfolio()]);
    setLoading(false);
  }, [fetchVaults, fetchPositions, fetchPortfolio]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Fetch accrued yield when a position is selected
  useEffect(() => {
    if (!selectedPosition) {
      setAccruedYield(null);
      return;
    }
    setAccruedYield(null);
    setAccruedLoading(true);
    let cancelled = false;
    request<{ accruedYield: string }>(`/yield/positions/${selectedPosition.id}/accrued-yield`)
      .then(data => {
        if (!cancelled) setAccruedYield(data.accruedYield);
      })
      .catch(() => {
        if (!cancelled) setAccruedYield(null);
      })
      .finally(() => {
        if (!cancelled) setAccruedLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedPosition, request]);

  const userWallet = walletBalances.find(w => w.type === "user");

  // Handle deposit
  const handleDeposit = async () => {
    if (!selectedVault) return;
    setDepositStep("depositing");
    setDepositError("");
    try {
      const decimals = selectedVault.underlyingSymbol === "ETH" ? 18 : 6;
      const body: Record<string, unknown> = {
        walletType: "user",
        vaultId: selectedVault.id,
        amount: depositAmount,
        unlockTime: Math.floor(Date.now() / 1000) + 86400,
      };
      if (depositLabel) body.label = depositLabel;
      await requestWithApproval("/yield/positions", { method: "POST", body });
      setDepositStep("success");
      fetchPositions();
      fetchPortfolio();
      refresh();
    } catch (err) {
      setDepositError(err instanceof Error ? err.message : "Deposit failed");
      setDepositStep("error");
    }
  };

  // Handle withdraw
  const handleWithdraw = async () => {
    if (!selectedPosition) return;
    setWithdrawStep("withdrawing");
    setWithdrawError("");
    try {
      await requestWithApproval(`/yield/positions/${selectedPosition.id}/withdraw`, {
        method: "POST",
        body: { walletType: "user" },
      });
      setWithdrawStep("success");
      fetchPositions();
      fetchPortfolio();
      refresh();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Withdrawal failed");
      setWithdrawStep("error");
    }
  };

  return (
    <div className="exo-page">
      <div className="exo-page-header">
        <h1 className="exo-page-title">Grow</h1>
        <p className="exo-page-subtitle">Put your money to work and earn returns</p>
      </div>

      {/* Portfolio summary strip */}
      <div className="exo-stats exo-animate-in">
        <div className="exo-stat">
          <div className="exo-stat-label">Deposited</div>
          <div className="exo-stat-value">{portfolio?.totalDeposited || "$0.00"}</div>
        </div>
        <div className="exo-stat">
          <div className="exo-stat-label">Earned</div>
          <div className="exo-stat-value lime">{portfolio?.totalYieldEarned || "$0.00"}</div>
        </div>
        <div className="exo-stat">
          <div className="exo-stat-label">Current Value</div>
          <div className="exo-stat-value">{portfolio?.totalCurrentValue || "$0.00"}</div>
        </div>
        <div className="exo-stat">
          <div className="exo-stat-label">Avg APY</div>
          <div className="exo-stat-value violet">{portfolio?.weightedApy || "0%"}</div>
        </div>
      </div>

      <div className="exo-tabs">
        <button className={`exo-tab ${tab === "vaults" ? "active" : ""}`} onClick={() => { setTab("vaults"); setDepositStep("idle"); }}>Ways to Earn</button>
        <button className={`exo-tab ${tab === "positions" ? "active" : ""}`} onClick={() => { setTab("positions"); setWithdrawStep("idle"); }}>Currently Earning</button>
      </div>

      <div key={tab} className={`tab-content-slide ${earnTabSlide === "left" ? "slide-from-left" : earnTabSlide === "right" ? "slide-from-right" : ""}`}>
      {loading && (
        <div className="exo-inline-spinner"><Spinner /></div>
      )}

      {/* ─── VAULTS TAB ─── */}
      {tab === "vaults" && !loading && (
        <>
          {depositStep === "idle" && (
            <div className="exo-animate-in">
              {vaults.length === 0 ? (
                <div className="exo-empty">
                  <div className="exo-empty-text">No earning options available right now</div>
                </div>
              ) : (
                vaults.map(v => (
                  <div key={v.id} className="vault-card" onClick={() => { setSelectedVault(v); setDepositStep("form"); setDepositAmount(""); setDepositLabel(""); }}>
                    <div className="vault-card-top">
                      <span className="vault-card-name" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {v.vaultImage && <img src={v.vaultImage} alt="" style={{ width: 20, height: 20, borderRadius: "50%" }} />}
                        {v.name}
                      </span>
                      <span className="vault-card-apy">{v.apy ?? "N/A"} APY</span>
                    </div>
                    <div className="vault-card-detail">
                      {v.underlyingSymbol} | Chain {v.chainId}
                      {v.totalAssetsUsd && <> | TVL ${Number(v.totalAssetsUsd).toLocaleString()}</>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {depositStep === "form" && selectedVault && (
            <div className="exo-animate-in">
              <div className="exo-form-card">
                <div className="exo-form-card-title">Deposit into {selectedVault.name}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--exo-violet)", marginBottom: 12 }}>
                  APY: {selectedVault.apy ?? "N/A"}{selectedVault.netApy && selectedVault.netApy !== selectedVault.apy ? ` (Net: ${selectedVault.netApy})` : ""} | {selectedVault.underlyingSymbol}
                  {selectedVault.performanceFee && <> | Fee: {selectedVault.performanceFee}</>}
                </div>
                <TokenAmountInput
                  token={selectedVault.underlyingSymbol ?? "USDC"}
                  amount={depositAmount}
                  onAmountChange={setDepositAmount}
                  balance={userWallet?.balances?.[selectedVault.underlyingSymbol ?? "USDC"]}
                  label={`Amount (${selectedVault.underlyingSymbol})`}
                  placeholder="10.00"
                  tokenFixed
                  showMax
                />
                <div className="form-group">
                  <label>Label (optional)</label>
                  <input
                    className="input-exo"
                    value={depositLabel}
                    onChange={e => setDepositLabel(e.target.value)}
                    placeholder="My savings"
                  />
                </div>
              </div>
              <div className="exo-actions">
                <button className="btn-exo btn-secondary" onClick={() => setDepositStep("idle")}>Cancel</button>
                <button className="btn-exo btn-primary" disabled={!depositAmount} onClick={() => setDepositStep("review")}>Review</button>
              </div>
            </div>
          )}

          {depositStep === "review" && selectedVault && (
            <div className="exo-animate-in">
              <div className="exo-review">
                <div className="exo-review-row">
                  <span className="exo-review-label">Vault</span>
                  <span className="exo-review-value">{selectedVault.name}</span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">Amount</span>
                  <span className="exo-review-value">{Number(depositAmount).toLocaleString(undefined, { maximumFractionDigits: 6 })} {selectedVault.underlyingSymbol}</span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">APY</span>
                  <span className="exo-review-value" style={{ color: "var(--exo-violet)" }}>{selectedVault.apy ?? "N/A"}</span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">Lock</span>
                  <span className="exo-review-value">24 hours</span>
                </div>
                {depositLabel && (
                  <div className="exo-review-row">
                    <span className="exo-review-label">Label</span>
                    <span className="exo-review-value">{depositLabel}</span>
                  </div>
                )}
              </div>
              <div className="exo-actions">
                <button className="btn-exo btn-secondary" onClick={() => setDepositStep("form")}>Back</button>
                <button className="btn-exo btn-primary" onClick={handleDeposit}>Confirm Deposit</button>
              </div>
            </div>
          )}

          {depositStep === "depositing" && (
            <div className="exo-feedback"><Spinner /><div className="exo-feedback-title">Depositing...</div></div>
          )}

          {depositStep === "success" && (
            <div className="exo-feedback exo-animate-in">
              <div className="exo-feedback-icon success">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div className="exo-feedback-title">Deposit Successful</div>
              <div className="exo-actions" style={{ width: "100%" }}>
                <button className="btn-exo btn-secondary" onClick={() => setDepositStep("idle")}>Back</button>
                <button className="btn-exo btn-primary" onClick={() => { setTab("positions"); setDepositStep("idle"); }}>See Earnings</button>
              </div>
            </div>
          )}

          {depositStep === "error" && (
            <div className="exo-feedback exo-animate-in">
              <div className="exo-feedback-icon error">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
              </div>
              <div className="exo-feedback-title">Deposit Failed</div>
              <div className="exo-feedback-sub">{depositError}</div>
              <button className="btn-exo btn-primary" onClick={() => setDepositStep("review")}>Try Again</button>
            </div>
          )}
        </>
      )}

      {/* ─── POSITIONS TAB ─── */}
      {tab === "positions" && !loading && (
        <>
          {withdrawStep === "idle" && (
            <div className="exo-animate-in">
              {positions.length === 0 ? (
                <div className="exo-empty">
                  <div className="exo-empty-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                    </svg>
                  </div>
                  <div className="exo-empty-text">You're not earning yet</div>
                  <div className="exo-empty-hint">Choose an option to start growing your money</div>
                  <button className="btn-exo btn-primary btn-sm" onClick={() => { setTab("vaults"); }}>Start Earning</button>
                </div>
              ) : (
                <div className="exo-list">
                  {positions.map(p => (
                    <div key={p.id} className="exo-list-item" onClick={() => { setSelectedPosition(p); }}>
                      <div className="exo-list-item-left">
                        <span className="exo-list-item-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span className={`exo-status-dot ${p.status}`} />
                          {p.label || "Position"}
                        </span>
                        <span className="exo-list-item-sub">
                          Deposited {p.depositAmount} | Unlocks {formatDate(p.unlockTime)}
                        </span>
                      </div>
                      <div className="exo-list-item-right">
                        <span className="exo-list-item-value" style={{ color: p.currentValue ? "var(--exo-lime)" : "inherit" }}>
                          {p.currentValue ?? p.depositAmount}
                        </span>
                        <span className="exo-list-item-meta">{p.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Position detail tray */}
          <BottomSheet
            open={!!selectedPosition && withdrawStep === "idle"}
            onClose={() => setSelectedPosition(null)}
            title={selectedPosition?.label || "Position Details"}
          >
            {selectedPosition && (
              <>
                <div className="exo-review">
                  <div className="exo-review-row">
                    <span className="exo-review-label">Status</span>
                    <span className="exo-review-value"><span className={`tag-exo status-${selectedPosition.status}`}>{selectedPosition.status}</span></span>
                  </div>
                  <div className="exo-review-row">
                    <span className="exo-review-label">Deposited</span>
                    <span className="exo-review-value">{selectedPosition.depositAmount}</span>
                  </div>
                  <div className="exo-review-row">
                    <span className="exo-review-label">Current Value</span>
                    <span className="exo-review-value" style={{ color: "var(--exo-lime)" }}>{selectedPosition.currentValue ?? "N/A"}</span>
                  </div>
                  <div className="exo-review-row">
                    <span className="exo-review-label">Accrued Yield</span>
                    <span className="exo-review-value" style={{ color: "var(--exo-lime)" }}>
                      {accruedLoading ? "Loading..." : accruedYield ?? "N/A"}
                    </span>
                  </div>
                  <div className="exo-review-row">
                    <span className="exo-review-label">Unlock</span>
                    <span className="exo-review-value">{formatDate(selectedPosition.unlockTime)}</span>
                  </div>
                  <div className="exo-review-row">
                    <span className="exo-review-label">Shares</span>
                    <span className="exo-review-value">{selectedPosition.shares}</span>
                  </div>
                </div>
                {selectedPosition.status === "active" && (
                  <div className="exo-actions">
                    <button className="btn-exo btn-danger" style={{ flex: 1 }} onClick={() => setWithdrawStep("confirm")}>
                      Withdraw
                    </button>
                  </div>
                )}
              </>
            )}
          </BottomSheet>

          {/* Confirm withdrawal tray */}
          <BottomSheet
            open={withdrawStep === "confirm" && !!selectedPosition}
            onClose={() => { setWithdrawStep("idle"); setSelectedPosition(null); }}
            title="Confirm Withdrawal"
          >
            {selectedPosition && (
              <>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 }}>
                  Withdraw your position? Funds will be returned to your user wallet.
                </p>
                <div className="exo-actions">
                  <button className="btn-exo btn-secondary" onClick={() => setWithdrawStep("idle")}>Cancel</button>
                  <button className="btn-exo btn-danger" onClick={handleWithdraw}>Withdraw</button>
                </div>
              </>
            )}
          </BottomSheet>

          {withdrawStep === "withdrawing" && (
            <div className="exo-feedback"><Spinner /><div className="exo-feedback-title">Withdrawing...</div></div>
          )}

          {withdrawStep === "success" && (
            <div className="exo-feedback exo-animate-in">
              <div className="exo-feedback-icon success">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div className="exo-feedback-title">Withdrawal Complete</div>
              <button className="btn-exo btn-primary" onClick={() => { setWithdrawStep("idle"); setSelectedPosition(null); }}>Done</button>
            </div>
          )}

          {withdrawStep === "error" && (
            <div className="exo-feedback exo-animate-in">
              <div className="exo-feedback-icon error">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
              </div>
              <div className="exo-feedback-title">Withdrawal Failed</div>
              <div className="exo-feedback-sub">{withdrawError}</div>
              <button className="btn-exo btn-primary" onClick={() => setWithdrawStep("confirm")}>Try Again</button>
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}
