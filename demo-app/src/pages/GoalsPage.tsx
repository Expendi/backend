import { useState, useEffect, useCallback } from "react";
import { useApi, ApiRequestError } from "../hooks/useApi";
import { useApprovalContext } from "../context/ApprovalContext";
import { useDashboard } from "../context/DashboardContext";
import { Spinner } from "../components/Spinner";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import type { GoalSaving, GoalSavingsDeposit, Category } from "../lib/types";
import { FREQUENCY_OPTIONS } from "../lib/constants";
import "../styles/pages.css";

type Tab = "goals" | "create";
type CreateStep = "form" | "review" | "creating" | "success" | "error";
type DepositStep = "idle" | "form" | "depositing" | "success" | "error";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatFreq(freq: string | null): string {
  if (!freq) return "Manual";
  const f = FREQUENCY_OPTIONS.find(o => o.value === freq);
  return f ? f.label : freq;
}

function pctComplete(acc: string, target: string): number {
  const a = Number(acc);
  const t = Number(target);
  if (t === 0) return 0;
  return Math.min(100, (a / t) * 100);
}

export function GoalsPage() {
  const { request } = useApi();
  const approvalCtx = useApprovalContext();
  const { refresh } = useDashboard();

  const [tab, setTab] = useState<Tab>("goals");
  const [goals, setGoals] = useState<GoalSaving[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<GoalSaving | null>(null);
  const [deposits, setDeposits] = useState<GoalSavingsDeposit[]>([]);
  const [depositsLoading, setDepositsLoading] = useState(false);

  // Create form
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [frequency, setFrequency] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [createStep, setCreateStep] = useState<CreateStep>("form");
  const [createError, setCreateError] = useState("");

  // Categories
  const [categories, setCategories] = useState<Category[]>([]);

  // Manual deposit
  const [depositStep, setDepositStep] = useState<DepositStep>("idle");
  const [manualAmount, setManualAmount] = useState("");
  const [depositError, setDepositError] = useState("");

  // Action loading
  const [actionLoading, setActionLoading] = useState(false);

  const requestWithApproval = useCallback(
    async <T,>(path: string, options?: { method?: "GET" | "POST" | "PATCH"; body?: unknown }) => {
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

  const fetchGoals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<GoalSaving[]>("/goal-savings");
      setGoals(data);
    } catch { /* handled */ }
    setLoading(false);
  }, [request]);

  useEffect(() => { fetchGoals(); }, [fetchGoals]);

  // Fetch categories on mount
  useEffect(() => {
    let cancelled = false;
    request<(Omit<Category, "isGlobal"> & { userId: string | null })[]>("/categories")
      .then(raw => { if (!cancelled) setCategories(raw.map(c => ({ ...c, isGlobal: c.userId === null }))); })
      .catch(() => { /* categories are optional, silently ignore */ });
    return () => { cancelled = true; };
  }, [request]);

  const fetchDeposits = useCallback(async (id: string) => {
    setDepositsLoading(true);
    try {
      const data = await request<GoalSavingsDeposit[]>(`/goal-savings/${id}/deposits`, { query: { limit: "20" } });
      setDeposits(data);
    } catch { setDeposits([]); }
    setDepositsLoading(false);
  }, [request]);

  useEffect(() => {
    if (selected) fetchDeposits(selected.id);
  }, [selected, fetchDeposits]);

  // Create
  const handleCreate = async () => {
    setCreateStep("creating");
    setCreateError("");
    try {
      const body: Record<string, unknown> = {
        name,
        targetAmount,
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        tokenSymbol: "USDC",
        tokenDecimals: 6,
      };
      if (desc) body.description = desc;
      if (categoryId) body.categoryId = categoryId;
      if (frequency) {
        body.frequency = frequency;
        body.walletType = "server";
        body.unlockTimeOffsetSeconds = 2592000;
        if (depositAmount) body.depositAmount = depositAmount;
      }
      await requestWithApproval("/goal-savings", { method: "POST", body });
      setCreateStep("success");
      fetchGoals();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create");
      setCreateStep("error");
    }
  };

  // Manual deposit
  const handleDeposit = async () => {
    if (!selected) return;
    setDepositStep("depositing");
    setDepositError("");
    try {
      await requestWithApproval(`/goal-savings/${selected.id}/deposit`, {
        method: "POST",
        body: { amount: manualAmount, walletType: "server" },
      });
      setDepositStep("success");
      fetchGoals();
      fetchDeposits(selected.id);
      refresh();
    } catch (err) {
      setDepositError(err instanceof Error ? err.message : "Deposit failed");
      setDepositStep("error");
    }
  };

  // Actions
  const handleAction = async (id: string, action: "pause" | "resume" | "cancel") => {
    setActionLoading(true);
    try {
      await requestWithApproval(`/goal-savings/${id}/${action}`, { method: "POST" });
      fetchGoals();
      if (selected?.id === id) {
        const updated = await request<GoalSaving>(`/goal-savings/${id}`).catch(() => null);
        if (updated) setSelected(updated);
        else setSelected(null);
      }
    } catch { /* handled */ }
    setActionLoading(false);
  };

  const activeGoals = goals.filter(g => g.status === "active" || g.status === "paused");
  const completedGoals = goals.filter(g => g.status === "completed" || g.status === "cancelled");

  const selectedCategoryName = categoryId
    ? categories.find(c => c.id === categoryId)?.name ?? ""
    : "";

  return (
    <div className="exo-page">
      <div className="exo-page-header">
        <h1 className="exo-page-title">Savings</h1>
        <p className="exo-page-subtitle">Set a target, watch it grow</p>
      </div>

      {/* Funding banner */}
      <div style={{
        background: "rgba(255, 200, 50, 0.08)",
        border: "1px solid rgba(255, 200, 50, 0.15)",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 12,
        color: "var(--text-secondary)",
        marginBottom: 16,
      }}>
        Savings goals use your custodial wallet. Make sure it's funded to enable automated deposits.
      </div>

      <div className="exo-tabs">
        <button className={`exo-tab ${tab === "goals" ? "active" : ""}`} onClick={() => { setTab("goals"); setSelected(null); setDepositStep("idle"); }}>My Goals</button>
        <button className={`exo-tab ${tab === "create" ? "active" : ""}`} onClick={() => { setTab("create"); setCreateStep("form"); }}>Start a Goal</button>
      </div>

      {/* ─── GOALS TAB ─── */}
      {tab === "goals" && (
        <>
          {loading ? (
            <div className="exo-inline-spinner"><Spinner /></div>
          ) : (
            <div className="exo-animate-in">
              {goals.length === 0 ? (
                <div className="exo-empty">
                  <div className="exo-empty-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                    </svg>
                  </div>
                  <div className="exo-empty-text">No savings goals yet</div>
                  <div className="exo-empty-hint">Set a target and start saving automatically</div>
                  <button className="btn-exo btn-primary btn-sm" onClick={() => { setTab("create"); setCreateStep("form"); }}>Start Saving</button>
                </div>
              ) : (
                <>
                  {activeGoals.map(g => {
                    const pct = pctComplete(g.accumulatedAmount, g.targetAmount);
                    return (
                      <div key={g.id} className="goal-card" onClick={() => { setSelected(g); setDepositStep("idle"); }}>
                        <div className="goal-card-header">
                          <span className="goal-card-name">
                            <span className={`exo-status-dot ${g.status}`} />
                            {g.name}
                          </span>
                          <span className="goal-card-pct">{pct.toFixed(0)}%</span>
                        </div>
                        <div className="exo-progress">
                          <div className="exo-progress-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="goal-card-amounts">
                          <span className="goal-card-current">{g.accumulatedAmount} {g.tokenSymbol}</span>
                          <span className="goal-card-target">of {g.targetAmount}</span>
                        </div>
                        {g.frequency && (
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
                            Auto: {formatFreq(g.frequency)} | Next: {g.nextDepositAt ? formatDate(g.nextDepositAt) : "N/A"}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {completedGoals.length > 0 && (
                    <>
                      <div className="exo-form-card-title" style={{ marginTop: 20, marginBottom: 8 }}>Completed / Cancelled</div>
                      {completedGoals.map(g => (
                        <div key={g.id} className="goal-card" style={{ opacity: 0.6 }} onClick={() => { setSelected(g); setDepositStep("idle"); }}>
                          <div className="goal-card-header">
                            <span className="goal-card-name">
                              <span className={`exo-status-dot ${g.status}`} />
                              {g.name}
                            </span>
                            <span className="tag-exo" style={{ fontSize: 9 }}>{g.status}</span>
                          </div>
                          <div className="goal-card-amounts">
                            <span className="goal-card-current">{g.accumulatedAmount} {g.tokenSymbol}</span>
                            <span className="goal-card-target">of {g.targetAmount}</span>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Goal detail modal */}
          {selected && (
            <div className="exo-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) { setSelected(null); setDepositStep("idle"); } }}>
              <div className="exo-modal">
                <div className="exo-modal-header">
                  <span className="exo-modal-title">{selected.name}</span>
                  <button className="exo-modal-close" onClick={() => { setSelected(null); setDepositStep("idle"); }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
                <div className="exo-modal-body">
                  {/* Progress */}
                  <div style={{ marginBottom: 16 }}>
                    <div className="exo-progress" style={{ height: 12 }}>
                      <div className="exo-progress-fill" style={{ width: `${pctComplete(selected.accumulatedAmount, selected.targetAmount)}%` }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700 }}>
                        {selected.accumulatedAmount} {selected.tokenSymbol}
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
                        {pctComplete(selected.accumulatedAmount, selected.targetAmount).toFixed(0)}% of {selected.targetAmount}
                      </span>
                    </div>
                  </div>

                  <div className="exo-review" style={{ marginBottom: 16 }}>
                    <div className="exo-review-row"><span className="exo-review-label">Status</span><span className="exo-review-value"><span className={`tag-exo status-${selected.status}`}>{selected.status}</span></span></div>
                    {selected.description && <div className="exo-review-row"><span className="exo-review-label">Desc</span><span className="exo-review-value">{selected.description}</span></div>}
                    <div className="exo-review-row"><span className="exo-review-label">Automation</span><span className="exo-review-value">{formatFreq(selected.frequency)}</span></div>
                    <div className="exo-review-row"><span className="exo-review-label">Deposits</span><span className="exo-review-value">{selected.totalDeposits}</span></div>
                  </div>

                  {/* Manual deposit */}
                  {selected.status === "active" && depositStep === "idle" && (
                    <button className="btn-exo btn-primary" style={{ width: "100%", marginBottom: 12 }} onClick={() => setDepositStep("form")}>
                      Deposit
                    </button>
                  )}

                  {depositStep === "form" && (
                    <div className="exo-form-card" style={{ marginBottom: 12 }}>
                      <div className="exo-form-card-title">Manual Deposit</div>
                      <div className="form-group">
                        <label>Amount ({selected.tokenSymbol})</label>
                        <input className="input-exo" value={manualAmount} onChange={e => setManualAmount(e.target.value)} placeholder="100000000" inputMode="numeric" />
                      </div>
                      <div className="exo-actions">
                        <button className="btn-exo btn-secondary" onClick={() => setDepositStep("idle")}>Cancel</button>
                        <button className="btn-exo btn-primary" disabled={!manualAmount} onClick={handleDeposit}>Deposit</button>
                      </div>
                    </div>
                  )}

                  {depositStep === "depositing" && (
                    <div style={{ textAlign: "center", padding: 16 }}><Spinner /><p style={{ marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>Depositing...</p></div>
                  )}

                  {depositStep === "success" && (
                    <div className="msg-success" style={{ marginBottom: 12 }}>Deposit successful</div>
                  )}

                  {depositStep === "error" && (
                    <div className="msg-error" style={{ marginBottom: 12 }}>{depositError}</div>
                  )}

                  {/* Actions */}
                  {(selected.status === "active" || selected.status === "paused") && (
                    <div className="exo-actions" style={{ marginBottom: 16 }}>
                      {selected.status === "active" && (
                        <button className="btn-exo btn-secondary" disabled={actionLoading} onClick={() => handleAction(selected.id, "pause")}>Pause</button>
                      )}
                      {selected.status === "paused" && (
                        <button className="btn-exo btn-primary" disabled={actionLoading} onClick={() => handleAction(selected.id, "resume")}>Resume</button>
                      )}
                      <button className="btn-exo btn-danger" disabled={actionLoading} onClick={() => handleAction(selected.id, "cancel")}>Cancel</button>
                    </div>
                  )}

                  {/* Savings progress chart */}
                  {deposits.length >= 2 && (() => {
                    // Build cumulative deposits over time
                    const sorted = [...deposits]
                      .filter(d => d.status === "confirmed")
                      .sort((a, b) => new Date(a.depositedAt).getTime() - new Date(b.depositedAt).getTime());
                    let cumulative = 0;
                    const target = Number(selected.targetAmount);
                    const chartData = sorted.map(d => {
                      cumulative += Number(d.amount);
                      return {
                        date: new Date(d.depositedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                        saved: cumulative,
                        target,
                      };
                    });
                    return (
                      <div style={{ marginBottom: 16 }}>
                        <div className="exo-form-card-title" style={{ marginBottom: 8 }}>Savings Progress</div>
                        <ResponsiveContainer width="100%" height={160}>
                          <AreaChart data={chartData}>
                            <defs>
                              <linearGradient id="savingsGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} domain={[0, Math.max(cumulative, target)]} />
                            <Tooltip formatter={(v) => `${Number(v).toLocaleString()} raw`} />
                            <Area type="monotone" dataKey="saved" stroke="#8b5cf6" fill="url(#savingsGrad)" strokeWidth={2} />
                            <Area type="monotone" dataKey="target" stroke="#6b7280" strokeDasharray="5 5" fill="none" strokeWidth={1} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })()}

                  {/* Deposit history */}
                  <div className="exo-form-card-title" style={{ marginBottom: 8 }}>Deposit History</div>
                  {depositsLoading ? (
                    <div className="exo-inline-spinner"><Spinner /></div>
                  ) : deposits.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>No deposits yet</div>
                  ) : (
                    <div className="exo-list">
                      {deposits.map(d => (
                        <div key={d.id} className="exo-list-item" style={{ cursor: "default" }}>
                          <div className="exo-list-item-left">
                            <span className="exo-list-item-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span className={`exo-status-dot ${d.status}`} />
                              {d.depositType === "automated" ? "Auto" : "Manual"}
                            </span>
                            <span className="exo-list-item-sub">{formatDate(d.depositedAt)}</span>
                          </div>
                          <div className="exo-list-item-right">
                            <span className="exo-list-item-value">{d.amount}</span>
                            <span className="exo-list-item-meta">{d.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── CREATE TAB ─── */}
      {tab === "create" && (
        <>
          {createStep === "form" && (
            <div className="exo-animate-in">
              <div className="exo-form-card">
                <div className="exo-form-card-title">Start a Goal</div>
                <div className="form-group">
                  <label>Goal Name</label>
                  <input className="input-exo" value={name} onChange={e => setName(e.target.value)} placeholder="House Fund" />
                </div>
                <div className="form-group">
                  <label>Description (optional)</label>
                  <input className="input-exo" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Saving for a down payment" />
                </div>
                <div className="form-group">
                  <label>Target Amount (USDC)</label>
                  <input className="input-exo" value={targetAmount} onChange={e => setTargetAmount(e.target.value)} placeholder="1000000000" inputMode="numeric" />
                </div>

                <div style={{ margin: "16px 0 8px", fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-muted)" }}>
                  Automation (optional)
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Auto Frequency</label>
                    <select className="input-exo" value={frequency} onChange={e => setFrequency(e.target.value)}>
                      <option value="">Manual only</option>
                      {FREQUENCY_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                  {frequency && (
                    <div className="form-group">
                      <label>Deposit per Cycle</label>
                      <input className="input-exo" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} placeholder="50000000" inputMode="numeric" />
                    </div>
                  )}
                </div>

                <div style={{ margin: "16px 0 8px", fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-muted)" }}>
                  Category (optional)
                </div>

                <div className="form-group">
                  <label>Category</label>
                  <select className="input-exo" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                    <option value="">No category</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <button
                className="btn-exo btn-primary"
                style={{ width: "100%", padding: "14px" }}
                disabled={!name || !targetAmount}
                onClick={() => setCreateStep("review")}
              >
                Review Goal
              </button>
            </div>
          )}

          {createStep === "review" && (
            <div className="exo-animate-in">
              <div className="exo-review">
                <div className="exo-review-row"><span className="exo-review-label">Name</span><span className="exo-review-value">{name}</span></div>
                {desc && <div className="exo-review-row"><span className="exo-review-label">Description</span><span className="exo-review-value">{desc}</span></div>}
                <div className="exo-review-row"><span className="exo-review-label">Target</span><span className="exo-review-value">{targetAmount} USDC</span></div>
                <div className="exo-review-row"><span className="exo-review-label">Automation</span><span className="exo-review-value">{frequency ? `${formatFreq(frequency)}, ${depositAmount} per cycle` : "Manual"}</span></div>
                {selectedCategoryName && <div className="exo-review-row"><span className="exo-review-label">Category</span><span className="exo-review-value">{selectedCategoryName}</span></div>}
              </div>
              <div className="exo-actions">
                <button className="btn-exo btn-secondary" onClick={() => setCreateStep("form")}>Back</button>
                <button className="btn-exo btn-primary" onClick={handleCreate}>Start Saving</button>
              </div>
            </div>
          )}

          {createStep === "creating" && (
            <div className="exo-feedback"><Spinner /><div className="exo-feedback-title">Creating goal...</div></div>
          )}

          {createStep === "success" && (
            <div className="exo-feedback exo-animate-in">
              <div className="exo-feedback-icon success">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div className="exo-feedback-title">Goal Created</div>
              <div className="exo-actions" style={{ width: "100%" }}>
                <button className="btn-exo btn-secondary" onClick={() => { setCreateStep("form"); setName(""); setDesc(""); setTargetAmount(""); setCategoryId(""); }}>Start Another</button>
                <button className="btn-exo btn-primary" onClick={() => { setTab("goals"); setCreateStep("form"); }}>View Goals</button>
              </div>
            </div>
          )}

          {createStep === "error" && (
            <div className="exo-feedback exo-animate-in">
              <div className="exo-feedback-icon error">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
              </div>
              <div className="exo-feedback-title">Creation Failed</div>
              <div className="exo-feedback-sub">{createError}</div>
              <button className="btn-exo btn-primary" onClick={() => setCreateStep("review")}>Try Again</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
