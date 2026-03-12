import { useState, useCallback } from "react";
import { useApi, ApiRequestError } from "../hooks/useApi";
import { useDashboard } from "../context/DashboardContext";
import { useApprovalContext } from "../context/ApprovalContext";
import { Spinner } from "../components/Spinner";
import { TOKEN_ADDRESSES } from "../lib/constants";
import type { SwapQuote, SwapResult } from "../lib/types";
import "../styles/pages.css";

type Step = "input" | "quoting" | "review" | "swapping" | "success" | "error";

const TOKEN_LIST = Object.entries(TOKEN_ADDRESSES).filter(([name]) => name !== "USDbC");

function formatTokenAmount(raw: string, decimals: number): string {
  const num = Number(raw) / 10 ** decimals;
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function SwapPage() {
  const { request } = useApi();
  const { walletBalances, refresh } = useDashboard();
  const approvalCtx = useApprovalContext();

  const [tokenIn, setTokenIn] = useState("USDC");
  const [tokenOut, setTokenOut] = useState("ETH");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [step, setStep] = useState<Step>("input");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [result, setResult] = useState<SwapResult | null>(null);
  const [error, setError] = useState("");

  const userWallet = walletBalances.find(w => w.type === "user");
  const walletId = userWallet?.walletId ?? "";

  const tokenInInfo = TOKEN_ADDRESSES[tokenIn];
  const tokenOutInfo = TOKEN_ADDRESSES[tokenOut];

  // Get balance for selected token
  const getBalance = (tokenName: string): string => {
    if (!userWallet) return "0";
    return userWallet.balances[tokenName] ?? "0";
  };

  const inBalance = getBalance(tokenIn);
  const displayInBalance = formatTokenAmount(inBalance, tokenInInfo.decimals);

  // Parse amount to base units
  const parseAmount = (amt: string, decimals: number): string => {
    if (!amt || isNaN(Number(amt))) return "0";
    const parts = amt.split(".");
    const whole = parts[0] || "0";
    const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
    return (whole + frac).replace(/^0+/, "") || "0";
  };

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

  // Flip tokens
  const handleFlip = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmount("");
    setQuote(null);
  };

  // Get quote
  const handleQuote = async () => {
    setStep("quoting");
    setError("");
    try {
      const data = await request<SwapQuote>("/uniswap/quote", {
        method: "POST",
        body: {
          walletId,
          tokenIn: tokenInInfo.address,
          tokenOut: tokenOutInfo.address,
          amount: parseAmount(amount, tokenInInfo.decimals),
          type: "EXACT_INPUT",
          slippageTolerance: Number(slippage),
        },
      });
      setQuote(data);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get quote");
      setStep("error");
    }
  };

  // Execute swap
  const handleSwap = async () => {
    setStep("swapping");
    setError("");
    try {
      const data = await requestWithApproval<SwapResult>("/uniswap/swap", {
        method: "POST",
        body: {
          walletId,
          tokenIn: tokenInInfo.address,
          tokenOut: tokenOutInfo.address,
          amount: parseAmount(amount, tokenInInfo.decimals),
          type: "EXACT_INPUT",
          slippageTolerance: Number(slippage),
        },
      });
      setResult(data);
      setStep("success");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Swap failed");
      setStep("error");
    }
  };

  const canQuote = amount && Number(amount) > 0 && tokenIn !== tokenOut && walletId;

  return (
    <div className="exo-page">
      <div className="exo-page-header">
        <h1 className="exo-page-title">Convert</h1>
        <p className="exo-page-subtitle">Trade between tokens instantly</p>
      </div>

      {step === "input" && (
        <div className="exo-animate-in">
          {/* Token In */}
          <div className="swap-pair">
            <div className="swap-token-box">
              <div className="swap-token-box-label">You Pay</div>
              <div className="swap-token-box-row">
                <select
                  className="swap-token-select"
                  value={tokenIn}
                  onChange={e => { setTokenIn(e.target.value); setQuote(null); }}
                >
                  {TOKEN_LIST.map(([name]) => (
                    <option key={name} value={name} disabled={name === tokenOut}>{name}</option>
                  ))}
                </select>
                <input
                  className="swap-token-amount"
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={amount}
                  onChange={e => {
                    const val = e.target.value;
                    if (Number(val) < 0) return;
                    setAmount(val);
                    setQuote(null);
                  }}
                />
              </div>
              <div className="swap-token-balance">
                Balance: {displayInBalance} {tokenIn}
              </div>
            </div>

            {/* Flip button */}
            <div className="swap-pair-divider">
              <button className="swap-pair-arrow" onClick={handleFlip} title="Swap direction">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <polyline points="19 12 12 19 5 12" />
                </svg>
              </button>
            </div>

            {/* Token Out */}
            <div className="swap-token-box">
              <div className="swap-token-box-label">You Receive</div>
              <div className="swap-token-box-row">
                <select
                  className="swap-token-select"
                  value={tokenOut}
                  onChange={e => { setTokenOut(e.target.value); setQuote(null); }}
                >
                  {TOKEN_LIST.map(([name]) => (
                    <option key={name} value={name} disabled={name === tokenIn}>{name}</option>
                  ))}
                </select>
                <input
                  className="swap-token-amount"
                  type="number"
                  placeholder="0"
                  value={quote ? formatTokenAmount(quote.quote.output.amount, tokenOutInfo.decimals) : ""}
                  readOnly
                  style={{ color: quote ? "var(--exo-lime)" : "var(--text-muted)" }}
                />
              </div>
              <div className="swap-token-balance">
                Balance: {formatTokenAmount(getBalance(tokenOut), tokenOutInfo.decimals)} {tokenOut}
              </div>
            </div>
          </div>

          {/* Slippage */}
          <div className="exo-form-card">
            <div className="exo-form-card-title">Settings</div>
            <div className="form-group">
              <label>Price flexibility</label>
              <div className="exo-token-pills">
                {["0.1", "0.5", "1.0"].map(s => (
                  <button key={s} className={`exo-token-pill ${slippage === s ? "active" : ""}`} onClick={() => setSlippage(s)}>
                    {s}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            className="btn-exo btn-primary"
            style={{ width: "100%", padding: "14px" }}
            disabled={!canQuote}
            onClick={handleQuote}
          >
            Get Price
          </button>
        </div>
      )}

      {step === "quoting" && (
        <div className="exo-feedback">
          <Spinner />
          <div className="exo-feedback-title">Getting price...</div>
        </div>
      )}

      {step === "review" && quote && (
        <div className="exo-animate-in">
          <div className="exo-review">
            <div className="exo-review-row">
              <span className="exo-review-label">You Pay</span>
              <span className="exo-review-value">{amount} {tokenIn}</span>
            </div>
            <div className="exo-review-row">
              <span className="exo-review-label">You Receive</span>
              <span className="exo-review-value" style={{ color: "var(--exo-lime)" }}>
                {formatTokenAmount(quote.quote.output.amount, tokenOutInfo.decimals)} {tokenOut}
              </span>
            </div>
            <div className="exo-review-row">
              <span className="exo-review-label">Route</span>
              <span className="exo-review-value">{quote.routing}</span>
            </div>
            <div className="exo-review-row">
              <span className="exo-review-label">Gas Fee</span>
              <span className="exo-review-value">${quote.quote.gasFeeUSD}</span>
            </div>
            <div className="exo-review-row">
              <span className="exo-review-label">Price Flex</span>
              <span className="exo-review-value">{slippage}%</span>
            </div>
          </div>

          <div className="exo-actions">
            <button className="btn-exo btn-secondary" onClick={() => setStep("input")}>Back</button>
            <button className="btn-exo btn-primary" onClick={handleSwap}>Convert</button>
          </div>
        </div>
      )}

      {step === "swapping" && (
        <div className="exo-feedback">
          <Spinner />
          <div className="exo-feedback-title">Converting...</div>
          <div className="exo-feedback-sub">This may take a moment</div>
        </div>
      )}

      {step === "success" && result && (
        <div className="exo-feedback exo-animate-in">
          <div className="exo-feedback-icon success">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="exo-feedback-title">Conversion Complete</div>
          <div className="exo-feedback-sub">
            {amount} {tokenIn} for {result.quote ? formatTokenAmount(result.quote.output?.amount ?? "0", tokenOutInfo.decimals) : "?"} {tokenOut}
          </div>
          {result.swapTxHash && (
            <a
              href={`https://basescan.org/tx/${result.swapTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)" }}
            >
              View on BaseScan
            </a>
          )}
          <button className="btn-exo btn-primary" style={{ marginTop: 8 }} onClick={() => { setStep("input"); setAmount(""); setQuote(null); }}>
            Convert More
          </button>
        </div>
      )}

      {step === "error" && (
        <div className="exo-feedback exo-animate-in">
          <div className="exo-feedback-icon error">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <div className="exo-feedback-title">Conversion Failed</div>
          <div className="exo-feedback-sub">{error}</div>
          <div className="exo-actions">
            <button className="btn-exo btn-secondary" onClick={() => setStep("input")}>Back</button>
            <button className="btn-exo btn-primary" onClick={quote ? handleSwap : handleQuote}>Retry</button>
          </div>
        </div>
      )}
    </div>
  );
}
