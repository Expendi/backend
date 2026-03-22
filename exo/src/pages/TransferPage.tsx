import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ApiRequestError } from "../hooks/useApi";
import { useApprovalContext } from "../context/ApprovalContext";
import { useDashboard } from "../context/DashboardContext";
import { useCategoriesQuery, useTransferMutation } from "../hooks/queries";
import { Spinner } from "../components/Spinner";
import { SuccessCheck } from "../components/SuccessCheck";
import { triggerConfetti } from "../components/Confetti";
import { useToast } from "../components/Toast";
import { TokenAmountInput } from "../components/TokenAmountInput";
import { TOKEN_ADDRESSES } from "../lib/constants";
import { transferSchema, type TransferFormData } from "../lib/schemas";
import "../styles/pages.css";

type Step = "form" | "review" | "sending" | "success" | "error";

const WALLET_TYPES = ["user", "server", "agent"] as const;

export function TransferPage() {
  const approvalCtx = useApprovalContext();
  const { walletBalances, refresh } = useDashboard();
  const toast = useToast();
  const { data: categories = [] } = useCategoriesQuery();
  const transferMutation = useTransferMutation();

  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  const form = useForm<TransferFormData>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      from: "user",
      to: "server",
      amount: "",
      token: "USDC",
      categoryId: "",
    },
  });

  const { register, handleSubmit, watch, setValue, formState: { errors }, reset } = form;
  const from = watch("from");
  const to = watch("to");
  const amount = watch("amount");
  const token = watch("token");
  const categoryId = watch("categoryId");

  const fromBalance = walletBalances?.find((w) => w.type === from);
  const selectedCategory = categoryId ? categories.find((c) => c.id === categoryId) : null;

  const handleTransfer = useCallback(async () => {
    setStep("sending");
    setError("");
    try {
      const result = await transferMutation.mutateAsync({
        from,
        to,
        amount,
        token: token.toLowerCase() || undefined,
        categoryId: categoryId || undefined,
      });
      setTxHash(result?.txHash ?? "");
      setStep("success");
      triggerConfetti();
      toast.info("Transaction submitted");
      refresh();
    } catch (err) {
      if (err instanceof ApiRequestError && err._tag === "TransactionApprovalRequired" && approvalCtx) {
        const approvalToken = await approvalCtx.requestApproval(err.method ?? "pin");
        if (!approvalToken) {
          setStep("review");
          return;
        }
        try {
          const result = await transferMutation.mutateAsync({
            from,
            to,
            amount,
            token: token.toLowerCase() || undefined,
            categoryId: categoryId || undefined,
            approvalToken,
          });
          setTxHash(result?.txHash ?? "");
          setStep("success");
          triggerConfetti();
          toast.info("Transaction submitted");
          refresh();
          return;
        } catch (retryErr) {
          setError(retryErr instanceof Error ? retryErr.message : "Transfer failed");
          setStep("error");
          toast.error("Transfer failed");
          return;
        }
      }
      setError(err instanceof Error ? err.message : "Transfer failed");
      setStep("error");
      toast.error("Transfer failed");
    }
  }, [from, to, amount, token, categoryId, transferMutation, approvalCtx, toast, refresh]);

  const resetForm = () => {
    setStep("form");
    reset();
    setError("");
    setTxHash("");
  };

  const onReview = () => {
    setStep("review");
  };

  return (
    <div className="exo-page">
      <div className="exo-page-header">
        <h1 className="exo-page-title">Transfer</h1>
        <p className="exo-page-subtitle">Move funds between your wallets</p>
      </div>

      {step === "form" && (
        <form className="exo-animate-in" onSubmit={handleSubmit(onReview)}>
          <div className="exo-form-card">
            <div className="exo-form-card-title">Send Tokens</div>

            <div className="form-row">
              <div className="form-group">
                <label>From</label>
                <select className="input-exo" {...register("from")}>
                  {WALLET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t} wallet
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>To</label>
                <select className="input-exo" {...register("to")}>
                  {WALLET_TYPES.filter((t) => t !== from).map((t) => (
                    <option key={t} value={t}>
                      {t} wallet
                    </option>
                  ))}
                </select>
                {errors.to && (
                  <span style={{ fontSize: 12, color: "var(--exo-error)" }}>
                    {errors.to.message}
                  </span>
                )}
              </div>
            </div>

            <TokenAmountInput
              token={token}
              onTokenChange={(t) => setValue("token", t)}
              amount={amount}
              onAmountChange={(a) => setValue("amount", a)}
              balance={fromBalance?.balances?.[token]}
              label="Amount"
              placeholder="10.00"
              tokens={["USDC", "ETH"]}
              showMax
            />
            {errors.amount && (
              <span style={{ fontSize: 12, color: "var(--exo-error)" }}>
                {errors.amount.message}
              </span>
            )}

            <div className="form-group">
              <label>Category (optional)</label>
              <select className="input-exo" {...register("categoryId")}>
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isGlobal ? " (global)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="btn-exo btn-primary"
            style={{ width: "100%", padding: "14px" }}
          >
            Review Transfer
          </button>
        </form>
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
              <span className="exo-review-value">
                {Number(amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
                {TOKEN_ADDRESSES[token]?.symbol ?? token}
              </span>
            </div>
            {selectedCategory && (
              <div className="exo-review-row">
                <span className="exo-review-label">Category</span>
                <span className="exo-review-value">{selectedCategory.name}</span>
              </div>
            )}
          </div>
          <div className="exo-actions">
            <button className="btn-exo btn-secondary" onClick={() => setStep("form")}>
              Back
            </button>
            <button className="btn-exo btn-primary" onClick={handleTransfer}>
              Confirm Transfer
            </button>
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
          <div
            className="exo-feedback-title"
            style={{
              opacity: 0,
              animation: "slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) 0.5s forwards",
            }}
          >
            Transfer Complete
          </div>
          {txHash && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-muted)",
                wordBreak: "break-all",
                marginTop: 4,
              }}
            >
              {txHash}
            </div>
          )}
          <button className="btn-exo btn-primary" style={{ marginTop: 16 }} onClick={resetForm}>
            New Transfer
          </button>
        </div>
      )}

      {step === "error" && (
        <div className="exo-feedback exo-animate-in">
          <div className="exo-feedback-icon error">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <div className="exo-feedback-title">Transfer Failed</div>
          <div className="exo-feedback-sub">{error}</div>
          <button className="btn-exo btn-primary" style={{ marginTop: 16 }} onClick={() => setStep("review")}>
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
