import { useState, useEffect, useCallback } from "react";
import { useApi, ApiRequestError } from "../hooks/useApi";
import { useApprovalContext } from "../context/ApprovalContext";
import { usePreferences } from "../context/PreferencesContext";
import { Spinner } from "../components/Spinner";
import type { RecurringPayment, RecurringExecution, Category } from "../lib/types";
import { FREQUENCY_OPTIONS, OFFRAMP_COUNTRIES } from "../lib/constants";
import "../styles/pages.css";

type Tab = "active" | "create";
type CreateStep = "form" | "review" | "creating" | "success" | "error";
type PaymentMode = "token_transfer" | "offramp";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatFreq(freq: string): string {
  const f = FREQUENCY_OPTIONS.find(o => o.value === freq);
  return f ? f.label : freq;
}

function truncAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function scheduleLabel(s: RecurringPayment): string {
  if (s.paymentType === "offramp" || s.isOfframp) return "Cash Out";
  return `${s.tokenContractName ?? "Token"} Transfer`;
}

export function RecurringPaymentsPage() {
  const { request } = useApi();
  const approvalCtx = useApprovalContext();
  const { preferences } = usePreferences();

  const [tab, setTab] = useState<Tab>("active");
  const [schedules, setSchedules] = useState<RecurringPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<RecurringPayment | null>(null);
  const [executions, setExecutions] = useState<RecurringExecution[]>([]);
  const [execLoading, setExecLoading] = useState(false);

  // Create form - shared
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("token_transfer");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("30d");
  const [executeImm, setExecuteImm] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep>("form");
  const [createError, setCreateError] = useState("");

  // Create form - token transfer
  const [recipient, setRecipient] = useState("");
  const [tokenName, setTokenName] = useState("USDC");

  // Create form - offramp
  const [offrampCountry, setOfframpCountry] = useState("");
  const [offrampPhone, setOfframpPhone] = useState("");
  const [offrampNetwork, setOfframpNetwork] = useState("");

  // Create form - category
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");

  // Action state
  const [actionLoading, setActionLoading] = useState(false);

  // Pre-fill offramp fields from preferences on initial load
  useEffect(() => {
    if (preferences.country) {
      const match = OFFRAMP_COUNTRIES.find(c => c.code === preferences.country);
      if (match && !offrampCountry) {
        setOfframpCountry(match.code);
      }
    }
    if (preferences.phoneNumber && !offrampPhone) {
      setOfframpPhone(preferences.phoneNumber);
    }
    if (preferences.mobileNetwork && !offrampNetwork) {
      setOfframpNetwork(preferences.mobileNetwork);
    }
  }, [preferences.country, preferences.phoneNumber, preferences.mobileNetwork]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch categories on mount
  useEffect(() => {
    let cancelled = false;
    request<(Omit<Category, "isGlobal"> & { userId: string | null })[]>("/categories")
      .then(raw => { if (!cancelled) setCategories(raw.map(c => ({ ...c, isGlobal: c.userId === null }))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [request]);

  const selectedCountryData = OFFRAMP_COUNTRIES.find(c => c.code === offrampCountry);
  const availableNetworks = selectedCountryData ? selectedCountryData.networks : [];

  // When country changes, reset network if not valid for new country
  useEffect(() => {
    if (selectedCountryData && offrampNetwork && !selectedCountryData.networks.includes(offrampNetwork as never)) {
      setOfframpNetwork(selectedCountryData.networks.length > 0 ? String(selectedCountryData.networks[0]) : "");
    }
  }, [offrampCountry]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<RecurringPayment[]>("/recurring-payments");
      setSchedules(data);
    } catch { /* handled */ }
    setLoading(false);
  }, [request]);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  // Fetch executions for selected
  const fetchExecutions = useCallback(async (id: string) => {
    setExecLoading(true);
    try {
      const data = await request<RecurringExecution[]>(`/recurring-payments/${id}/executions`, { query: { limit: "20" } });
      setExecutions(data);
    } catch { setExecutions([]); }
    setExecLoading(false);
  }, [request]);

  useEffect(() => {
    if (selected) fetchExecutions(selected.id);
  }, [selected, fetchExecutions]);

  // Determine if form is valid for submission
  const isFormValid = paymentMode === "token_transfer"
    ? recipient.length > 0 && amount.length > 0
    : offrampCountry.length > 0 && offrampPhone.length > 0 && amount.length > 0;

  // Create
  const handleCreate = async () => {
    setCreateStep("creating");
    setCreateError("");
    try {
      const baseBody = {
        walletType: "server" as const,
        frequency,
        executeImmediately: executeImm,
        maxRetries: 3,
        ...(categoryId ? { categoryId } : {}),
      };

      if (paymentMode === "token_transfer") {
        await requestWithApproval("/recurring-payments", {
          method: "POST",
          body: {
            ...baseBody,
            recipientAddress: recipient,
            paymentType: "erc20_transfer",
            amount,
            tokenContractName: tokenName,
          },
        });
      } else {
        await requestWithApproval("/recurring-payments", {
          method: "POST",
          body: {
            ...baseBody,
            recipientAddress: "0x0000000000000000000000000000000000000000",
            paymentType: "offramp",
            amount,
            country: offrampCountry,
            phoneNumber: offrampPhone,
            mobileNetwork: offrampNetwork,
          },
        });
      }
      setCreateStep("success");
      fetchSchedules();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create");
      setCreateStep("error");
    }
  };

  // Actions
  const handleAction = async (id: string, action: "pause" | "resume" | "cancel") => {
    setActionLoading(true);
    try {
      await requestWithApproval(`/recurring-payments/${id}/${action}`, { method: "POST" });
      fetchSchedules();
      if (selected?.id === id) {
        const updated = await request<RecurringPayment>(`/recurring-payments/${id}`).catch(() => null);
        if (updated) setSelected(updated);
        else setSelected(null);
      }
    } catch { /* handled */ }
    setActionLoading(false);
  };

  const resetForm = () => {
    setRecipient("");
    setAmount("");
    setTokenName("USDC");
    setPaymentMode("token_transfer");
    setCategoryId("");
    setCreateStep("form");
  };

  // Group schedules by status
  const activeSchedules = schedules.filter(s => s.status === "active" || s.status === "paused");
  const pastSchedules = schedules.filter(s => s.status === "cancelled" || s.status === "completed" || s.status === "failed");

  return (
    <div className="exo-page">
      <div className="exo-page-header">
        <h1 className="exo-page-title">Autopay</h1>
        <p className="exo-page-subtitle">Set it and forget it</p>
      </div>

      {/* Funding info banner */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 14px",
          marginBottom: 16,
          borderRadius: 10,
          background: "rgba(255, 200, 50, 0.08)",
          border: "1px solid rgba(255, 200, 50, 0.15)",
          fontSize: 12,
          lineHeight: 1.45,
          color: "var(--text-secondary, #aaa)",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(255, 200, 50, 0.7)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0, marginTop: 1 }}
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>
          Autopay and savings run from your custodial wallet. Make sure it's funded before setting up automated payments.
        </span>
      </div>

      <div className="exo-tabs">
        <button className={`exo-tab ${tab === "active" ? "active" : ""}`} onClick={() => { setTab("active"); setSelected(null); }}>My Payments</button>
        <button className={`exo-tab ${tab === "create" ? "active" : ""}`} onClick={() => { setTab("create"); setCreateStep("form"); }}>Set Up</button>
      </div>

      {/* --- SCHEDULES TAB --- */}
      {tab === "active" && (
        <>
          {loading ? (
            <div className="exo-inline-spinner"><Spinner /></div>
          ) : (
            <div className="exo-animate-in">
              {schedules.length === 0 ? (
                <div className="exo-empty">
                  <div className="exo-empty-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>
                  <div className="exo-empty-text">No autopayments yet</div>
                  <div className="exo-empty-hint">Set up automatic payments and never miss one</div>
                  <button className="btn-exo btn-primary btn-sm" onClick={() => { setTab("create"); setCreateStep("form"); }}>Set Up Autopay</button>
                </div>
              ) : (
                <>
                  {activeSchedules.length > 0 && (
                    <>
                      <div className="exo-form-card-title" style={{ marginBottom: 8 }}>Active</div>
                      {activeSchedules.map(s => (
                        <div key={s.id} className="recurring-card" onClick={() => setSelected(s)}>
                          <div className="recurring-card-top">
                            <span className="recurring-card-title">
                              <span className={`exo-status-dot ${s.status}`} />
                              {scheduleLabel(s)}
                            </span>
                            <span className="tag-exo" style={{ fontSize: 9 }}>{s.status}</span>
                          </div>
                          <div className="recurring-card-detail">
                            {s.paymentType === "offramp" || s.isOfframp
                              ? `${s.amount} USDC cash out`
                              : `${s.amount} ${s.tokenContractName ?? "tokens"} to ${truncAddr(s.recipientAddress)}`}
                          </div>
                          <div className="recurring-card-meta">
                            {formatFreq(s.frequency)} | Next: {formatDate(s.nextExecutionAt)} | {s.totalExecutions} runs
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {pastSchedules.length > 0 && (
                    <>
                      <div className="exo-form-card-title" style={{ marginBottom: 8, marginTop: 20 }}>Past</div>
                      {pastSchedules.map(s => (
                        <div key={s.id} className="recurring-card" onClick={() => setSelected(s)} style={{ opacity: 0.7 }}>
                          <div className="recurring-card-top">
                            <span className="recurring-card-title">
                              <span className={`exo-status-dot ${s.status}`} />
                              {scheduleLabel(s)}
                            </span>
                            <span className="tag-exo" style={{ fontSize: 9 }}>{s.status}</span>
                          </div>
                          <div className="recurring-card-detail">
                            {s.paymentType === "offramp" || s.isOfframp
                              ? `${s.amount} USDC cash out`
                              : `${s.amount} to ${truncAddr(s.recipientAddress)}`}
                          </div>
                          <div className="recurring-card-meta">{s.totalExecutions} runs</div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Detail modal */}
          {selected && (
            <div className="exo-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setSelected(null); }}>
              <div className="exo-modal">
                <div className="exo-modal-header">
                  <span className="exo-modal-title">Payment Details</span>
                  <button className="exo-modal-close" onClick={() => setSelected(null)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
                <div className="exo-modal-body">
                  <div className="exo-review" style={{ marginBottom: 16 }}>
                    <div className="exo-review-row"><span className="exo-review-label">Status</span><span className="exo-review-value"><span className={`tag-exo status-${selected.status}`}>{selected.status}</span></span></div>
                    <div className="exo-review-row"><span className="exo-review-label">Type</span><span className="exo-review-value">{scheduleLabel(selected)}</span></div>
                    <div className="exo-review-row"><span className="exo-review-label">Amount</span><span className="exo-review-value">{selected.amount}</span></div>
                    {selected.paymentType !== "offramp" && !selected.isOfframp && (
                      <>
                        <div className="exo-review-row"><span className="exo-review-label">Token</span><span className="exo-review-value">{selected.tokenContractName ?? "ETH"}</span></div>
                        <div className="exo-review-row"><span className="exo-review-label">To</span><span className="exo-review-value" style={{ fontSize: 11 }}>{truncAddr(selected.recipientAddress)}</span></div>
                      </>
                    )}
                    {(selected.paymentType === "offramp" || selected.isOfframp) && selected.offrampMetadata && (
                      <>
                        {selected.offrampMetadata.country && (
                          <div className="exo-review-row"><span className="exo-review-label">Country</span><span className="exo-review-value">{String(selected.offrampMetadata.country)}</span></div>
                        )}
                        {selected.offrampMetadata.phoneNumber && (
                          <div className="exo-review-row"><span className="exo-review-label">Phone</span><span className="exo-review-value">{String(selected.offrampMetadata.phoneNumber)}</span></div>
                        )}
                        {selected.offrampMetadata.mobileNetwork && (
                          <div className="exo-review-row"><span className="exo-review-label">Network</span><span className="exo-review-value">{String(selected.offrampMetadata.mobileNetwork)}</span></div>
                        )}
                      </>
                    )}
                    <div className="exo-review-row"><span className="exo-review-label">Frequency</span><span className="exo-review-value">{formatFreq(selected.frequency)}</span></div>
                    <div className="exo-review-row"><span className="exo-review-label">Next</span><span className="exo-review-value">{formatDate(selected.nextExecutionAt)}</span></div>
                    <div className="exo-review-row"><span className="exo-review-label">Executions</span><span className="exo-review-value">{selected.totalExecutions}</span></div>
                  </div>

                  {/* Actions */}
                  {(selected.status === "active" || selected.status === "paused") && (
                    <div className="exo-actions" style={{ marginBottom: 16 }}>
                      {selected.status === "active" && (
                        <button className="btn-exo btn-secondary" disabled={actionLoading} onClick={() => handleAction(selected.id, "pause")}>
                          Pause
                        </button>
                      )}
                      {selected.status === "paused" && (
                        <button className="btn-exo btn-primary" disabled={actionLoading} onClick={() => handleAction(selected.id, "resume")}>
                          Resume
                        </button>
                      )}
                      <button className="btn-exo btn-danger" disabled={actionLoading} onClick={() => handleAction(selected.id, "cancel")}>
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Execution history */}
                  <div className="exo-form-card-title" style={{ marginBottom: 8 }}>Execution History</div>
                  {execLoading ? (
                    <div className="exo-inline-spinner"><Spinner /></div>
                  ) : executions.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>No executions yet</div>
                  ) : (
                    <div className="exo-list">
                      {executions.map(ex => (
                        <div key={ex.id} className="exo-list-item" style={{ cursor: "default" }}>
                          <div className="exo-list-item-left">
                            <span className="exo-list-item-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span className={`exo-status-dot ${ex.status}`} />
                              {ex.status}
                            </span>
                            <span className="exo-list-item-sub">{formatDate(ex.executedAt)}</span>
                          </div>
                          {ex.txHash && (
                            <a
                              href={`https://basescan.org/tx/${ex.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)" }}
                            >
                              View
                            </a>
                          )}
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

      {/* --- CREATE TAB --- */}
      {tab === "create" && (
        <>
          {createStep === "form" && (
            <div className="exo-animate-in">
              <div className="exo-form-card">
                <div className="exo-form-card-title">Set Up Autopay</div>

                {/* Payment type selector */}
                <div className="form-group">
                  <label>Payment Type</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className={`btn-exo ${paymentMode === "token_transfer" ? "btn-primary" : "btn-secondary"}`}
                      style={{ flex: 1, padding: "10px 12px", fontSize: 13 }}
                      onClick={() => setPaymentMode("token_transfer")}
                    >
                      Token Transfer
                    </button>
                    <button
                      type="button"
                      className={`btn-exo ${paymentMode === "offramp" ? "btn-primary" : "btn-secondary"}`}
                      style={{ flex: 1, padding: "10px 12px", fontSize: 13 }}
                      onClick={() => setPaymentMode("offramp")}
                    >
                      Cash Out (Offramp)
                    </button>
                  </div>
                </div>

                {/* Token transfer fields */}
                {paymentMode === "token_transfer" && (
                  <>
                    <div className="form-group">
                      <label>Recipient Address</label>
                      <input className="input-exo" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x..." />
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Amount</label>
                        <input className="input-exo" value={amount} onChange={e => setAmount(e.target.value)} placeholder="5000000" inputMode="numeric" />
                      </div>
                      <div className="form-group">
                        <label>Token</label>
                        <input className="input-exo" value={tokenName} onChange={e => setTokenName(e.target.value)} placeholder="USDC" />
                      </div>
                    </div>
                  </>
                )}

                {/* Offramp fields */}
                {paymentMode === "offramp" && (
                  <>
                    <div className="form-group">
                      <label>Country</label>
                      <select
                        className="input-exo"
                        value={offrampCountry}
                        onChange={e => setOfframpCountry(e.target.value)}
                      >
                        <option value="">Select country</option>
                        {OFFRAMP_COUNTRIES.map(c => (
                          <option key={c.code} value={c.code}>{c.name} ({c.currency})</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Phone Number</label>
                      <input
                        className="input-exo"
                        value={offrampPhone}
                        onChange={e => setOfframpPhone(e.target.value)}
                        placeholder="0712345678"
                        inputMode="tel"
                      />
                    </div>
                    {availableNetworks.length > 0 && (
                      <div className="form-group">
                        <label>Mobile Network</label>
                        <select
                          className="input-exo"
                          value={offrampNetwork}
                          onChange={e => setOfframpNetwork(e.target.value)}
                        >
                          <option value="">Select network</option>
                          {availableNetworks.map(n => (
                            <option key={n} value={n}>{n.charAt(0).toUpperCase() + n.slice(1)}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="form-group">
                      <label>Amount (USDC)</label>
                      <input
                        className="input-exo"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        placeholder="10"
                        inputMode="numeric"
                      />
                    </div>
                  </>
                )}

                <div className="form-group">
                  <label>Frequency</label>
                  <select className="input-exo" value={frequency} onChange={e => setFrequency(e.target.value)}>
                    {FREQUENCY_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>

                {/* Category selector */}
                {categories.length > 0 && (
                  <div className="form-group">
                    <label>Category</label>
                    <select className="input-exo" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                      <option value="">None</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="form-group">
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={executeImm} onChange={e => setExecuteImm(e.target.checked)} />
                    Execute first payment immediately
                  </label>
                </div>
              </div>

              <button
                className="btn-exo btn-primary"
                style={{ width: "100%", padding: "14px" }}
                disabled={!isFormValid}
                onClick={() => setCreateStep("review")}
              >
                Review
              </button>
            </div>
          )}

          {createStep === "review" && (
            <div className="exo-animate-in">
              <div className="exo-review">
                <div className="exo-review-row">
                  <span className="exo-review-label">Type</span>
                  <span className="exo-review-value">{paymentMode === "token_transfer" ? "Token Transfer" : "Cash Out (Offramp)"}</span>
                </div>
                {paymentMode === "token_transfer" && (
                  <>
                    <div className="exo-review-row"><span className="exo-review-label">To</span><span className="exo-review-value" style={{ fontSize: 11 }}>{truncAddr(recipient)}</span></div>
                    <div className="exo-review-row"><span className="exo-review-label">Amount</span><span className="exo-review-value">{amount} {tokenName}</span></div>
                  </>
                )}
                {paymentMode === "offramp" && (
                  <>
                    <div className="exo-review-row">
                      <span className="exo-review-label">Country</span>
                      <span className="exo-review-value">{OFFRAMP_COUNTRIES.find(c => c.code === offrampCountry)?.name ?? offrampCountry}</span>
                    </div>
                    <div className="exo-review-row"><span className="exo-review-label">Phone</span><span className="exo-review-value">{offrampPhone}</span></div>
                    {offrampNetwork && (
                      <div className="exo-review-row"><span className="exo-review-label">Network</span><span className="exo-review-value">{offrampNetwork.charAt(0).toUpperCase() + offrampNetwork.slice(1)}</span></div>
                    )}
                    <div className="exo-review-row"><span className="exo-review-label">Amount</span><span className="exo-review-value">{amount} USDC</span></div>
                  </>
                )}
                <div className="exo-review-row"><span className="exo-review-label">Frequency</span><span className="exo-review-value">{formatFreq(frequency)}</span></div>
                {categoryId && (
                  <div className="exo-review-row"><span className="exo-review-label">Category</span><span className="exo-review-value">{categories.find(c => c.id === categoryId)?.name ?? "Selected"}</span></div>
                )}
                <div className="exo-review-row"><span className="exo-review-label">Start</span><span className="exo-review-value">{executeImm ? "Immediately" : "Next cycle"}</span></div>
              </div>
              <div className="exo-actions">
                <button className="btn-exo btn-secondary" onClick={() => setCreateStep("form")}>Back</button>
                <button className="btn-exo btn-primary" onClick={handleCreate}>Start Autopay</button>
              </div>
            </div>
          )}

          {createStep === "creating" && (
            <div className="exo-feedback"><Spinner /><div className="exo-feedback-title">Creating...</div></div>
          )}

          {createStep === "success" && (
            <div className="exo-feedback exo-animate-in">
              <div className="exo-feedback-icon success">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div className="exo-feedback-title">Autopay Active</div>
              <div className="exo-actions" style={{ width: "100%" }}>
                <button className="btn-exo btn-secondary" onClick={resetForm}>Set Up Another</button>
                <button className="btn-exo btn-primary" onClick={() => { setTab("active"); resetForm(); }}>View Payments</button>
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
