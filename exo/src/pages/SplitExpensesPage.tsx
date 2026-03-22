import { useState, useEffect, useCallback, useRef } from "react";
import { useApi, ApiRequestError } from "../hooks/useApi";
import { useApprovalContext } from "../context/ApprovalContext";
import { useDashboard } from "../context/DashboardContext";
import { Spinner } from "../components/Spinner";
import { StatusTag } from "../components/StatusTag";
import { BottomSheet } from "../components/BottomSheet";
import { TokenAmountInput, TokenSelect } from "../components/TokenAmountInput";
import { TOKEN_ADDRESSES } from "../lib/constants";
import type { SplitExpense, SplitExpenseWithShares, SplitShare } from "../lib/types";
import "../styles/pages.css";

type Tab = "splits" | "owed" | "create";
type CreateStep = "form" | "review" | "creating" | "success" | "error";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sharesSummary(shares: SplitShare[] | undefined): string {
  if (!shares || shares.length === 0) return "No shares";
  const paid = shares.filter(s => s.status === "paid").length;
  return `${paid}/${shares.length} paid`;
}

interface ShareRow {
  userId: string;
  amount: string;
  input: string; // username or address entered by user
  resolvedName: string; // display name after resolution
  resolving: boolean;
  resolveError: string;
}

export function SplitExpensesPage() {
  const { request } = useApi();
  const approvalCtx = useApprovalContext();
  const { profile, walletBalances } = useDashboard();

  const [tab, setTab] = useState<Tab>("splits");

  // My Splits
  const [expenses, setExpenses] = useState<SplitExpense[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SplitExpenseWithShares | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // I Owe
  const [owedExpenses, setOwedExpenses] = useState<SplitExpenseWithShares[]>([]);
  const [owedLoading, setOwedLoading] = useState(false);

  // Create form
  const [title, setTitle] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("USDC");
  const [shareRows, setShareRows] = useState<ShareRow[]>([{ userId: "", amount: "", input: "", resolvedName: "", resolving: false, resolveError: "" }]);
  const [createStep, setCreateStep] = useState<CreateStep>("form");
  const [createError, setCreateError] = useState("");

  // Action state
  const [actionLoading, setActionLoading] = useState(false);

  // ── requestWithApproval ──────────────────────────────────────────

  const requestWithApproval = useCallback(
    async <T,>(path: string, options?: { method?: "GET" | "POST" | "DELETE"; body?: unknown }) => {
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

  // ── Fetch helpers ────────────────────────────────────────────────

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<SplitExpense[]>("/split-expenses");
      setExpenses(data);
    } catch { /* handled by useApi */ }
    setLoading(false);
  }, [request]);

  const fetchOwed = useCallback(async () => {
    setOwedLoading(true);
    try {
      const data = await request<SplitExpenseWithShares[]>("/split-expenses/owed");
      setOwedExpenses(data);
    } catch { /* handled by useApi */ }
    setOwedLoading(false);
  }, [request]);

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await request<SplitExpenseWithShares>(`/split-expenses/${id}`);
      setSelected(data);
    } catch { setSelected(null); }
    setDetailLoading(false);
  }, [request]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  useEffect(() => {
    if (tab === "owed") fetchOwed();
  }, [tab, fetchOwed]);

  // ── Derive user wallet info ──────────────────────────────────────

  const userWallet = walletBalances.find(w => w.type === "user");
  const userWalletId = profile?.userWalletId ?? "";

  // ── Create ───────────────────────────────────────────────────────

  const resolveTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup resolve timeouts
  useEffect(() => {
    return () => {
      for (const t of resolveTimeoutsRef.current.values()) clearTimeout(t);
    };
  }, []);

  const addShareRow = () => {
    setShareRows(prev => [...prev, { userId: "", amount: "", input: "", resolvedName: "", resolving: false, resolveError: "" }]);
  };

  const removeShareRow = (index: number) => {
    const existing = resolveTimeoutsRef.current.get(index);
    if (existing) clearTimeout(existing);
    resolveTimeoutsRef.current.delete(index);
    setShareRows(prev => prev.filter((_, i) => i !== index));
  };

  const updateShareAmount = (index: number, value: string) => {
    setShareRows(prev => prev.map((row, i) => i === index ? { ...row, amount: value } : row));
  };

  const updateShareInput = (index: number, value: string) => {
    // Clear previous timeout for this row
    const existing = resolveTimeoutsRef.current.get(index);
    if (existing) clearTimeout(existing);

    setShareRows(prev => prev.map((row, i) => {
      if (i !== index) return row;
      return { ...row, input: value, userId: "", resolvedName: "", resolving: false, resolveError: "" };
    }));

    const trimmed = value.trim();
    if (!trimmed) return;

    // If it's an Ethereum address, accept it directly (no resolution needed)
    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      // We still need to resolve the address to a userId for the backend
      // But we can show the address as accepted
      setShareRows(prev => prev.map((row, i) => {
        if (i !== index) return row;
        return { ...row, input: value, resolving: true, resolveError: "" };
      }));
      // Resolve address to userId
      const timeout = setTimeout(async () => {
        try {
          const data = await request<{ username: string; userId: string; address: string }>(
            `/profile/resolve-address/${encodeURIComponent(trimmed)}`
          );
          setShareRows(prev => prev.map((row, j) =>
            j === index ? { ...row, userId: data.userId, resolvedName: data.username || `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`, resolving: false, resolveError: "" } : row
          ));
        } catch {
          setShareRows(prev => prev.map((row, j) =>
            j === index ? { ...row, resolving: false, resolveError: "Address not found" } : row
          ));
        }
      }, 300);
      resolveTimeoutsRef.current.set(index, timeout);
      return;
    }

    // Otherwise treat as a username — resolve after debounce
    setShareRows(prev => prev.map((row, i) => {
      if (i !== index) return row;
      return { ...row, resolving: true };
    }));

    const timeout = setTimeout(async () => {
      try {
        const data = await request<{ username: string; userId: string; address: string }>(
          `/profile/resolve/${encodeURIComponent(trimmed)}`
        );
        setShareRows(prev => prev.map((row, j) =>
          j === index ? { ...row, userId: data.userId, resolvedName: data.username, resolving: false, resolveError: "" } : row
        ));
      } catch {
        setShareRows(prev => prev.map((row, j) =>
          j === index ? { ...row, resolving: false, resolveError: "User not found" } : row
        ));
      }
    }, 500);
    resolveTimeoutsRef.current.set(index, timeout);
  };

  const isFormValid =
    title.trim().length > 0 &&
    totalAmount.trim().length > 0 &&
    shareRows.length > 0 &&
    shareRows.every(r => r.userId.length > 0 && r.amount.trim().length > 0 && !r.resolving && !r.resolveError);

  const handleCreate = async () => {
    setCreateStep("creating");
    setCreateError("");
    try {
      const tokenMeta = TOKEN_ADDRESSES[tokenSymbol];
      const decimals = tokenMeta?.decimals ?? 6;
      await requestWithApproval("/split-expenses", {
        method: "POST",
        body: {
          title: title.trim(),
          totalAmount: totalAmount.trim(),
          tokenAddress: tokenMeta?.address ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          tokenSymbol: tokenMeta?.symbol ?? tokenSymbol,
          tokenDecimals: decimals,
          chainId: 8453,
          shares: shareRows.map(r => ({
            userId: r.userId.trim(),
            amount: r.amount.trim(),
          })),
        },
      });
      setCreateStep("success");
      fetchExpenses();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create split expense");
      setCreateStep("error");
    }
  };

  const resetForm = () => {
    setTitle("");
    setTotalAmount("");
    setTokenSymbol("USDC");
    setShareRows([{ userId: "", amount: "", input: "", resolvedName: "", resolving: false, resolveError: "" }]);
    setCreateStep("form");
  };

  // ── Actions ──────────────────────────────────────────────────────

  const handlePay = async (expenseId: string) => {
    if (!userWalletId) return;
    setActionLoading(true);
    try {
      await requestWithApproval(`/split-expenses/${expenseId}/pay`, {
        method: "POST",
        body: { walletId: userWalletId, walletType: "user" },
      });
      fetchOwed();
      fetchExpenses();
      if (selected?.id === expenseId) {
        fetchDetail(expenseId);
      }
    } catch { /* handled by useApi */ }
    setActionLoading(false);
  };

  const handleCancel = async (expenseId: string) => {
    setActionLoading(true);
    try {
      await requestWithApproval(`/split-expenses/${expenseId}`, {
        method: "DELETE",
      });
      fetchExpenses();
      if (selected?.id === expenseId) {
        setSelected(null);
      }
    } catch { /* handled by useApi */ }
    setActionLoading(false);
  };

  // ── Categorize expenses ──────────────────────────────────────────

  const activeExpenses = expenses.filter(e => e.status === "active");
  const pastExpenses = expenses.filter(e => e.status === "settled" || e.status === "cancelled");

  return (
    <div className="exo-page">
      <div className="exo-page-header">
        <h1 className="exo-page-title">Split Expenses</h1>
        <p className="exo-page-subtitle">Share costs, settle onchain</p>
      </div>

      <div className="exo-tabs">
        <button className={`exo-tab ${tab === "splits" ? "active" : ""}`} onClick={() => { setTab("splits"); setSelected(null); }}>My Splits</button>
        <button className={`exo-tab ${tab === "owed" ? "active" : ""}`} onClick={() => { setTab("owed"); setSelected(null); }}>I Owe</button>
        <button className={`exo-tab ${tab === "create" ? "active" : ""}`} onClick={() => { setTab("create"); setCreateStep("form"); }}>Create</button>
      </div>

      {/* ─── MY SPLITS TAB ─── */}
      {tab === "splits" && (
        <>
          {loading ? (
            <div className="exo-inline-spinner"><Spinner /></div>
          ) : (
            <div className="exo-animate-in">
              {expenses.length === 0 ? (
                <div className="exo-empty">
                  <div className="exo-empty-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.828L3 3" /><path d="m15 9 6-6" />
                    </svg>
                  </div>
                  <div className="exo-empty-text">No split expenses yet</div>
                  <div className="exo-empty-hint">Create a split to share costs with others</div>
                  <button className="btn-exo btn-primary btn-sm" onClick={() => { setTab("create"); setCreateStep("form"); }}>Create Split</button>
                </div>
              ) : (
                <>
                  {activeExpenses.length > 0 && (
                    <>
                      <div className="exo-form-card-title" style={{ marginBottom: 8 }}>Active</div>
                      {activeExpenses.map(e => (
                        <div key={e.id} className="recurring-card" onClick={() => fetchDetail(e.id)}>
                          <div className="recurring-card-top">
                            <span className="recurring-card-title">
                              <span className="exo-status-dot active" />
                              {e.title}
                            </span>
                            <StatusTag status={e.status} />
                          </div>
                          <div className="recurring-card-detail">
                            {e.totalAmount} {e.tokenSymbol}
                          </div>
                          <div className="recurring-card-meta">
                            {sharesSummary(e.shares)} | Created {formatDate(e.createdAt)}
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {pastExpenses.length > 0 && (
                    <>
                      <div className="exo-form-card-title" style={{ marginBottom: 8, marginTop: 20 }}>Past</div>
                      {pastExpenses.map(e => (
                        <div key={e.id} className="recurring-card" style={{ opacity: 0.7 }} onClick={() => fetchDetail(e.id)}>
                          <div className="recurring-card-top">
                            <span className="recurring-card-title">
                              <span className={`exo-status-dot ${e.status}`} />
                              {e.title}
                            </span>
                            <StatusTag status={e.status} />
                          </div>
                          <div className="recurring-card-detail">
                            {e.totalAmount} {e.tokenSymbol}
                          </div>
                          <div className="recurring-card-meta">
                            {formatDate(e.createdAt)}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Detail tray */}
          <BottomSheet open={!!selected} onClose={() => setSelected(null)} title={selected?.title}>
            {selected && (
              <>
                {detailLoading ? (
                  <div className="exo-inline-spinner"><Spinner /></div>
                ) : (
                  <>
                    <div className="exo-review" style={{ marginBottom: 16 }}>
                      <div className="exo-review-row"><span className="exo-review-label">Status</span><span className="exo-review-value"><StatusTag status={selected.status} /></span></div>
                      <div className="exo-review-row"><span className="exo-review-label">Total</span><span className="exo-review-value">{selected.totalAmount} {selected.tokenSymbol}</span></div>
                      <div className="exo-review-row"><span className="exo-review-label">Chain</span><span className="exo-review-value">Base ({selected.chainId})</span></div>
                      <div className="exo-review-row"><span className="exo-review-label">Created</span><span className="exo-review-value">{formatDate(selected.createdAt)}</span></div>
                    </div>

                    {/* Shares breakdown */}
                    <div className="exo-form-card-title" style={{ marginBottom: 8 }}>Shares</div>
                    {selected.shares.length === 0 ? (
                      <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>No shares</div>
                    ) : (
                      <div className="exo-list">
                        {selected.shares.map(share => (
                          <div key={share.id} className="exo-list-item" style={{ cursor: "default" }}>
                            <div className="exo-list-item-left">
                              <span className="exo-list-item-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span className={`exo-status-dot ${share.status}`} />
                                {share.username ?? share.debtorUserId.slice(0, 12)}
                              </span>
                              <span className="exo-list-item-sub">{share.status}{share.paidAt ? ` | ${formatDate(share.paidAt)}` : ""}</span>
                            </div>
                            <div className="exo-list-item-right">
                              <span className="exo-list-item-value">{share.amount} {selected.tokenSymbol}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Cancel action (creator only, active expense) */}
                    {selected.status === "active" && selected.creatorUserId === profile?.privyUserId && (
                      <div className="exo-actions" style={{ marginTop: 16 }}>
                        <button className="btn-exo btn-danger" disabled={actionLoading} onClick={() => handleCancel(selected.id)}>
                          Cancel Expense
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </BottomSheet>
        </>
      )}

      {/* ─── I OWE TAB ─── */}
      {tab === "owed" && (
        <>
          {owedLoading ? (
            <div className="exo-inline-spinner"><Spinner /></div>
          ) : (
            <div className="exo-animate-in">
              {owedExpenses.length === 0 ? (
                <div className="exo-empty">
                  <div className="exo-empty-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div className="exo-empty-text">All clear</div>
                  <div className="exo-empty-hint">You don't owe anyone right now</div>
                </div>
              ) : (
                owedExpenses.map(expense => {
                  const myShare = expense.shares.find(
                    s => s.debtorUserId === profile?.privyUserId && s.status === "pending"
                  );
                  if (!myShare) return null;
                  return (
                    <div key={expense.id} className="recurring-card">
                      <div className="recurring-card-top">
                        <span className="recurring-card-title">
                          <span className="exo-status-dot pending" />
                          {expense.title}
                        </span>
                        <StatusTag status="pending" />
                      </div>
                      <div className="recurring-card-detail">
                        You owe {myShare.amount} {expense.tokenSymbol}
                      </div>
                      <div className="recurring-card-meta">
                        Total: {expense.totalAmount} {expense.tokenSymbol} | {formatDate(expense.createdAt)}
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <button
                          className="btn-exo btn-primary btn-sm"
                          disabled={actionLoading || !userWalletId}
                          onClick={() => handlePay(myShare.id)}
                        >
                          {actionLoading ? <Spinner /> : "Pay Now"}
                        </button>
                        {!userWalletId && (
                          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                            Wallet not available
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
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
                <div className="exo-form-card-title">Create Split Expense</div>

                <div className="form-group">
                  <label>Title</label>
                  <input className="input-exo" value={title} onChange={e => setTitle(e.target.value)} placeholder="Dinner, rent, trip costs..." />
                </div>

                <TokenAmountInput
                  token={tokenSymbol}
                  onTokenChange={setTokenSymbol}
                  amount={totalAmount}
                  onAmountChange={setTotalAmount}
                  label="Total Amount"
                  placeholder="10.00"
                  tokens={["USDC", "ETH"]}
                />

                {/* Shares builder */}
                <div style={{ margin: "16px 0 8px", fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-muted)" }}>
                  Shares
                </div>

                {shareRows.map((row, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                      <div className="form-group" style={{ flex: 2, marginBottom: 0 }}>
                        {i === 0 && <label>Username or address</label>}
                        <input
                          className="input-exo"
                          value={row.input}
                          onChange={e => updateShareInput(i, e.target.value)}
                          placeholder="alice or 0x..."
                          spellCheck={false}
                          autoComplete="off"
                        />
                      </div>
                      <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        {i === 0 && <label>Amount</label>}
                        <input
                          className="input-exo"
                          value={row.amount}
                          onChange={e => updateShareAmount(i, e.target.value)}
                          placeholder="5.00"
                          inputMode="decimal"
                        />
                      </div>
                      {shareRows.length > 1 && (
                        <button
                          type="button"
                          className="btn-exo btn-secondary"
                          style={{ padding: "8px 10px", fontSize: 12, lineHeight: 1, flexShrink: 0 }}
                          onClick={() => removeShareRow(i)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      )}
                    </div>
                    {/* Resolution status */}
                    {row.resolving && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, fontFamily: "var(--font-mono)" }}>Resolving...</div>
                    )}
                    {row.resolvedName && !row.resolving && (
                      <div style={{ fontSize: 11, color: "var(--exo-lime, #a3e635)", marginTop: 4, fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 4 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        {row.resolvedName}
                      </div>
                    )}
                    {row.resolveError && !row.resolving && (
                      <div style={{ fontSize: 11, color: "var(--exo-error, #ef4444)", marginTop: 4, fontFamily: "var(--font-mono)" }}>{row.resolveError}</div>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  className="btn-exo btn-secondary btn-sm"
                  style={{ marginTop: 4 }}
                  onClick={addShareRow}
                >
                  + Add Share
                </button>
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
                <div className="exo-review-row"><span className="exo-review-label">Title</span><span className="exo-review-value">{title}</span></div>
                <div className="exo-review-row"><span className="exo-review-label">Total</span><span className="exo-review-value">{Number(totalAmount).toLocaleString(undefined, { maximumFractionDigits: 6 })} {tokenSymbol}</span></div>
                <div className="exo-review-row"><span className="exo-review-label">Chain</span><span className="exo-review-value">Base (8453)</span></div>
                <div className="exo-review-row"><span className="exo-review-label">Token Address</span><span className="exo-review-value" style={{ fontSize: 10 }}>0x8335...2913</span></div>
                <div className="exo-review-row"><span className="exo-review-label">Shares</span><span className="exo-review-value">{shareRows.length} participant{shareRows.length !== 1 ? "s" : ""}</span></div>
              </div>

              {/* Share detail */}
              <div style={{ marginTop: 12, marginBottom: 16 }}>
                <div className="exo-form-card-title" style={{ marginBottom: 6 }}>Share Breakdown</div>
                <div className="exo-list">
                  {shareRows.map((row, i) => (
                    <div key={i} className="exo-list-item" style={{ cursor: "default" }}>
                      <div className="exo-list-item-left">
                        <span className="exo-list-item-title">{row.resolvedName || row.input}</span>
                      </div>
                      <div className="exo-list-item-right">
                        <span className="exo-list-item-value">{row.amount} {tokenSymbol}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="exo-actions">
                <button className="btn-exo btn-secondary" onClick={() => setCreateStep("form")}>Back</button>
                <button className="btn-exo btn-primary" onClick={handleCreate}>Create Split</button>
              </div>
            </div>
          )}

          {createStep === "creating" && (
            <div className="exo-feedback"><Spinner /><div className="exo-feedback-title">Creating split expense...</div></div>
          )}

          {createStep === "success" && (
            <div className="exo-feedback exo-animate-in">
              <div className="exo-feedback-icon success">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div className="exo-feedback-title">Split Created</div>
              <div className="exo-actions" style={{ width: "100%" }}>
                <button className="btn-exo btn-secondary" onClick={resetForm}>Create Another</button>
                <button className="btn-exo btn-primary" onClick={() => { setTab("splits"); resetForm(); fetchExpenses(); }}>View Splits</button>
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
