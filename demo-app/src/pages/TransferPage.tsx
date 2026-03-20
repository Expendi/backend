import { useState, useEffect, useCallback } from "react";
import { useApi, ApiRequestError } from "../hooks/useApi";
import { useApprovalContext } from "../context/ApprovalContext";
import { useDashboard } from "../context/DashboardContext";
import { Spinner } from "../components/Spinner";
import { SuccessCheck } from "../components/SuccessCheck";
import { triggerConfetti } from "../components/Confetti";
import { useToast } from "../components/Toast";
import { TokenAmountInput, toBaseUnits, formatHumanAmount } from "../components/TokenAmountInput";
import { TOKEN_ADDRESSES } from "../lib/constants";
import type { Category } from "../lib/types";
import "../styles/pages.css";

type Step = "form" | "review" | "sending" | "success" | "error";

const WALLET_TYPES = ["user", "server", "agent"] as const;

export function TransferPage() {
  const { request } = useApi();
  const approvalCtx = useApprovalContext();
  const { walletBalances, refresh } = useDashboard();
  const toast = useToast();

  const [step, setStep] = useState<Step>("form");
  const [from, setFrom] = useState<"user" | "server" | "agent">("user");
  const [to, setTo] = useState<"user" | "server" | "agent">("server");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("USDC");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  useEffect(() => {
    let cancelled = false;
    request<(Omit<Category, "isGlobal"> & { userId: string | null })[]>("/categories")
      .then(raw => { if (!cancelled) setCategories(raw.map(c => ({ ...c, isGlobal: c.userId === null }))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [request]);

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

  const handleSend = async () => {
    setStep("sending");
    setError("");
    try {
      const tokenMeta = TOKEN_ADDRESSES[token];
      const decimals = tokenMeta?.decimals ?? 6;
      const rawAmount = toBaseUnits(amount, decimals);
      const result = await requestWithApproval<{ txHash?: string }>("/wallets/transfer", {
        method: "POST",
        body: {
          from,
          to,
          amount: rawAmount,
          token: token.toLowerCase() || undefined,
          categoryId: categoryId || undefined,
        },
      });
      setTxHash(result?.txHash ?? "");
      setStep("success");
      triggerConfetti();
      toast.info("Transaction submitted");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
      setStep("error");
      toast.error("Transfer failed");
    }
  };

  const resetForm = () => {
    setStep("form");
    setAmount("");
    setCategoryId("");
    setError("");
    setTxHash("");
  };

  // Get balance for the selected "from" wallet
  const fromBalance = walletBalances?.find(w => w.type === from);
  const usdcBalance = fromBalance?.balances?.USDC
    ? (Number(fromBalance.balances.USDC) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  const selectedCategory = categoryId ? categories.find(c => c.id === categoryId) : null;

  return (
    <div className="exo-page">
      <div className="exo-page-header">
        <h1 className="exo-page-title">Transfer</h1>
        <p className="exo-page-subtitle">Move funds between your wallets</p>
      </div>

      {step === "form" && (
        <div className="exo-animate-in">
          <div className="exo-form-card">
            <div className="exo-form-card-title">Send Tokens</div>

            <div className="form-row">
              <div className="form-group">
                <label>From</label>
                <select className="input-exo" value={from} onChange={e => setFrom(e.target.value as typeof from)}>
                  {WALLET_TYPES.map(t => <option key={t} value={t}>{t} wallet</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>To</label>
                <select className="input-exo" value={to} onChange={e => setTo(e.target.value as typeof to)}>
                  {WALLET_TYPES.filter(t => t !== from).map(t => <option key={t} value={t}>{t} wallet</option>)}
                </select>
              </div>
            </div>

            <TokenAmountInput
              token={token}
              onTokenChange={setToken}
              amount={amount}
              onAmountChange={setAmount}
              balance={fromBalance?.balances?.[token]}
              label="Amount"
              placeholder="10.00"
              tokens={["USDC", "ETH"]}
              showMax
            />

            <div className="form-group">
              <label>Category (optional)</label>
              <select className="input-exo" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                <option value="">No category</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.isGlobal ? " (global)" : ""}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            className="btn-exo btn-primary"
            style={{ width: "100%", padding: "14px" }}
            disabled={!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || from === to}
            onClick={() => setStep("review")}
          >
            Review Transfer
          </button>
          {from === to && (
            <div style={{ fontSize: 12, color: "var(--exo-error)", marginTop: 6, textAlign: "center" }}>
              Source and destination must be different
            </div>
          )}
        </div>
      )}

      {step === "review" && (
        <div className="exo-animate-in">
          <div className="exo-review">
            <div className="exo-review-row">
              <span className="exo-review-label">From</span>
              <span className="exo-review-value">{from} wallet</span>
            </div>
            <div className="exo-review-row">
              <span className="exo-review-label">To</span>
              <span className="exo-review-value">{to} wallet</span>
            </div>
            <div className="exo-review-row">
              <span className="exo-review-label">Amount</span>
              <span className="exo-review-value">{Number(amount).toLocaleString(undefined, { maximumFractionDigits: 6 })} {TOKEN_ADDRESSES[token]?.symbol ?? token}</span>
            </div>
            {selectedCategory && (
              <div className="exo-review-row">
                <span className="exo-review-label">Category</span>
                <span className="exo-review-value">{selectedCategory.name}</span>
              </div>
            )}
          </div>
          <div className="exo-actions">
            <button className="btn-exo btn-secondary" onClick={() => setStep("form")}>Back</button>
            <button className="btn-exo btn-primary" onClick={handleSend}>Confirm Transfer</button>
          </div>
        </div>
      )}

      {step === "sending" && (
        <div className="exo-feedback">
          <Spinner />
          <div className="exo-feedback-title">Sending...</div>
        </div>
      )}

      {step === "success" && (
        <div className="exo-feedback exo-animate-in">
          <SuccessCheck size={56} />
          <div className="exo-feedback-title" style={{ opacity: 0, animation: "slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) 0.5s forwards" }}>Transfer Complete</div>
          {txHash && (
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", wordBreak: "break-all", marginTop: 4 }}>
              {txHash}
            </div>
          )}
          <button className="btn-exo btn-primary" style={{ marginTop: 16 }} onClick={resetForm}>New Transfer</button>
        </div>
      )}

      {step === "error" && (
        <div className="exo-feedback exo-animate-in">
          <div className="exo-feedback-icon error">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
          </div>
          <div className="exo-feedback-title">Transfer Failed</div>
          <div className="exo-feedback-sub">{error}</div>
          <button className="btn-exo btn-primary" style={{ marginTop: 16 }} onClick={() => setStep("review")}>Try Again</button>
        </div>
      )}
    </div>
  );
}
