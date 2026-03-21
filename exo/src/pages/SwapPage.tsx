import { useState, useCallback, useRef, useMemo } from "react";
import { Drawer } from "vaul";
import { useApi, ApiRequestError } from "../hooks/useApi";
import { useDashboard } from "../context/DashboardContext";
import { useApprovalContext } from "../context/ApprovalContext";
import { useTokenPrices } from "../hooks/useTokenPrices";
import { Spinner } from "../components/Spinner";
import { SuccessCheck } from "../components/SuccessCheck";
import { triggerConfetti } from "../components/Confetti";
import { useToast } from "../components/Toast";
import { MorphingButton } from "../components/MorphingButton";
import { TOKEN_ADDRESSES } from "../lib/constants";
import type { SwapQuote, SwapResult } from "../lib/types";
import "../styles/pages.css";

type Step = "input" | "quoting" | "review" | "swapping" | "success" | "error";

// Hide WETH from picker — users interact with ETH; Uniswap wraps internally
const TOKEN_LIST = Object.entries(TOKEN_ADDRESSES).filter(([name]) => name !== "WETH");

function formatTokenAmount(raw: string, decimals: number): string {
  const num = Number(raw) / 10 ** decimals;
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/** Token logo with React state-based color circle fallback */
function TokenIcon({ name, size = 24 }: { name: string; size?: number }) {
  const meta = TOKEN_ADDRESSES[name];
  const [imgError, setImgError] = useState(false);
  if (!meta) return null;
  if (imgError) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          borderRadius: "50%",
          background: meta.color,
          color: "#fff",
          fontSize: size * 0.5,
          fontWeight: 900,
          flexShrink: 0,
        }}
      >
        {meta.symbol.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={meta.icon}
      alt={meta.symbol}
      width={size}
      height={size}
      style={{
        borderRadius: "50%",
        background: meta.color,
        objectFit: "cover",
        flexShrink: 0,
      }}
      onError={() => setImgError(true)}
    />
  );
}

export function SwapPage() {
  const { request } = useApi();
  const { walletBalances, refresh } = useDashboard();
  const toast = useToast();
  const approvalCtx = useApprovalContext();
  const { prices } = useTokenPrices();

  const [tokenIn, setTokenIn] = useState("USDC");
  const [tokenOut, setTokenOut] = useState("ETH");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [step, setStep] = useState<Step>("input");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [result, setResult] = useState<SwapResult | null>(null);
  const [error, setError] = useState("");
  const [pickerFor, setPickerFor] = useState<"in" | "out" | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const amountRef = useRef<HTMLInputElement>(null);

  const userWallet = walletBalances.find(w => w.type === "user");
  const walletId = userWallet?.walletId ?? "";

  const tokenInInfo = TOKEN_ADDRESSES[tokenIn];
  const tokenOutInfo = TOKEN_ADDRESSES[tokenOut];

  const getBalance = (tokenName: string): string => {
    if (!userWallet) return "0";
    return userWallet.balances[tokenName] ?? "0";
  };

  const inBalance = getBalance(tokenIn);
  const displayInBalance = formatTokenAmount(inBalance, tokenInInfo.decimals);

  const maxAmount = (() => {
    const num = Number(inBalance) / 10 ** tokenInInfo.decimals;
    if (num === 0) return "0";
    if (tokenInInfo.decimals <= 6) return num.toFixed(6).replace(/\.?0+$/, "");
    return num.toFixed(8).replace(/\.?0+$/, "");
  })();

  const parseAmount = (amt: string, decimals: number): string => {
    if (!amt || isNaN(Number(amt))) return "0";
    const parts = amt.split(".");
    const whole = parts[0] || "0";
    const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
    return (whole + frac).replace(/^0+/, "") || "0";
  };

  // Instant preview using cached prices
  const estimatedOutput = useMemo(() => {
    if (!amount || Number(amount) === 0) return "";
    const inPrice = prices[tokenIn]?.usd;
    const outPrice = prices[tokenOut]?.usd;
    if (!inPrice || !outPrice || outPrice === 0) return "";
    const outputAmount = (Number(amount) * inPrice) / outPrice;
    return outputAmount.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }, [amount, tokenIn, tokenOut, prices]);

  const inputUsdValue = useMemo(() => {
    if (!amount || Number(amount) === 0) return "";
    const inPrice = prices[tokenIn]?.usd;
    if (!inPrice) return "";
    const usd = Number(amount) * inPrice;
    return `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, [amount, tokenIn, prices]);

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

  const handleFlip = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmount("");
    setQuote(null);
  };

  const handleAmountChange = (val: string) => {
    if (val === "") { setAmount(""); setQuote(null); return; }
    if (val === ".") { setAmount("0."); setQuote(null); return; }
    if (!/^\d*\.?\d*$/.test(val)) return;
    const parts = val.split(".");
    if (parts[1] && parts[1].length > tokenInInfo.decimals) return;
    if (parts[0].length > 1 && parts[0].startsWith("0") && !val.startsWith("0.")) {
      val = val.replace(/^0+/, "");
    }
    setAmount(val);
    setQuote(null);
  };

  const selectToken = (name: string) => {
    if (pickerFor === "in") {
      if (name === tokenOut) setTokenOut(tokenIn);
      setTokenIn(name);
    } else if (pickerFor === "out") {
      if (name === tokenIn) setTokenIn(tokenOut);
      setTokenOut(name);
    }
    setQuote(null);
    setPickerFor(null);
  };

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
      setReviewOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get quote");
      setStep("error");
    }
  };

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
      setReviewOpen(false);
      triggerConfetti();
      toast.info("Transaction submitted");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Swap failed");
      setStep("error");
      setReviewOpen(false);
      toast.error("Swap failed");
    }
  };

  const amountExceedsBalance =
    amount !== "" &&
    Number(amount) > 0 &&
    Number(amount) > Number(inBalance) / 10 ** tokenInInfo.decimals;

  const canQuote =
    amount && Number(amount) > 0 && !amountExceedsBalance && tokenIn !== tokenOut && walletId;

  const handleReviewClose = (open: boolean) => {
    if (!open) {
      setReviewOpen(false);
      if (step === "review") {
        setStep("input");
      }
    }
  };

  return (
    <div className="exo-page">
      <div className="exo-page-header">
        <h1 className="exo-page-title">Convert</h1>
        <p className="exo-page-subtitle">Trade between tokens instantly</p>
      </div>

      {/* Token Picker Drawer */}
      <Drawer.Root open={!!pickerFor} onOpenChange={(o) => { if (!o) setPickerFor(null); }}>
        <Drawer.Portal>
          <Drawer.Overlay style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000 }} />
          <Drawer.Content
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              background: "var(--bg-card)",
              borderRadius: "20px 20px 0 0",
              zIndex: 1001,
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ width: 32, height: 4, borderRadius: 2, background: "var(--border)", margin: "10px auto 8px" }} />
            <Drawer.Title style={{ padding: "0 20px 12px", fontWeight: 700, fontFamily: "var(--font-display)", fontSize: 16, color: "var(--text-primary)" }}>
              Select Token
            </Drawer.Title>
            <div style={{ overflow: "auto", padding: "0 8px 20px" }}>
              {TOKEN_LIST.map(([name, info]) => {
                const bal = getBalance(name);
                const displayBal = formatTokenAmount(bal, info.decimals);
                const isSelected = pickerFor === "in" ? name === tokenIn : name === tokenOut;
                const price = prices[name];
                return (
                  <button
                    key={name}
                    className={`swap-picker-item${isSelected ? " selected" : ""}`}
                    onClick={() => selectToken(name)}
                  >
                    <TokenIcon name={name} size={32} />
                    <div className="swap-picker-item-info">
                      <span className="swap-picker-item-name">{info.symbol}</span>
                      <span className="swap-picker-item-full">{info.name}</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span className="swap-picker-item-bal">{displayBal}</span>
                      {price && (
                        <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                          ${price.usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Review / Quoting / Swapping Drawer */}
      <Drawer.Root open={reviewOpen} onOpenChange={handleReviewClose}>
        <Drawer.Portal>
          <Drawer.Overlay style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000 }} />
          <Drawer.Content
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              background: "var(--bg-card)",
              borderRadius: "20px 20px 0 0",
              zIndex: 1001,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ width: 32, height: 4, borderRadius: 2, background: "var(--border)", margin: "10px auto 8px" }} />
            <Drawer.Title style={{ padding: "0 20px 12px", fontWeight: 700, fontFamily: "var(--font-display)", fontSize: 16, color: "var(--text-primary)" }}>
              {step === "quoting" ? "Getting Price..." : step === "swapping" ? "Converting..." : "Review Conversion"}
            </Drawer.Title>
            <div style={{ overflow: "auto", padding: "0 20px 20px" }}>
              {step === "quoting" && (
                <div className="exo-feedback" style={{ padding: "24px 0" }}>
                  <Spinner />
                  <div className="exo-feedback-title">Getting price...</div>
                </div>
              )}

              {step === "review" && quote && (
                <div>
                  <div className="exo-review">
                    <div className="exo-review-row">
                      <span className="exo-review-label">You Pay</span>
                      <span className="exo-review-value" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <TokenIcon name={tokenIn} size={20} />
                        {amount} {tokenIn}
                      </span>
                    </div>
                    <div className="exo-review-row">
                      <span className="exo-review-label">You Receive</span>
                      <span className="exo-review-value" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--exo-lime)" }}>
                        <TokenIcon name={tokenOut} size={20} />
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

                  <div className="exo-actions" style={{ marginTop: 16 }}>
                    <button className="btn-exo btn-secondary" onClick={() => { setReviewOpen(false); setStep("input"); }}>Back</button>
                    <MorphingButton label="Convert" className="btn-exo btn-primary" onClick={handleSwap} />
                  </div>
                </div>
              )}

              {step === "swapping" && (
                <div className="exo-feedback" style={{ padding: "24px 0" }}>
                  <Spinner />
                  <div className="exo-feedback-title">Converting...</div>
                  <div className="exo-feedback-sub">This may take a moment</div>
                </div>
              )}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Main input form — always visible behind drawers */}
      {(step === "input" || step === "quoting" || step === "review" || step === "swapping") && (
        <div className="exo-animate-in">
          {/* Token In */}
          <div className="swap-pair">
            <div className="swap-token-box">
              <div className="swap-token-box-header">
                <span className="swap-token-box-label">You Pay</span>
                <span className="swap-token-balance">
                  {displayInBalance} {tokenIn}
                  <button
                    className="swap-max-btn"
                    onClick={() => { setAmount(maxAmount); setQuote(null); }}
                  >
                    MAX
                  </button>
                </span>
              </div>
              <div className="swap-token-box-row">
                <button
                  className="swap-token-chooser"
                  onClick={() => setPickerFor("in")}
                >
                  <TokenIcon name={tokenIn} size={24} />
                  <span className="swap-token-chooser-name">{tokenIn}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <div style={{ flex: 1, textAlign: "right" }}>
                  <input
                    ref={amountRef}
                    className="swap-token-amount"
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={amount}
                    onChange={e => handleAmountChange(e.target.value)}
                    autoComplete="off"
                    style={amountExceedsBalance ? { color: "#ef4444" } : undefined}
                  />
                  <div style={{ fontSize: 12, marginTop: 2, minHeight: 16 }}>
                    {amountExceedsBalance ? (
                      <span style={{ color: "#ef4444", fontWeight: 600 }}>Exceeds balance</span>
                    ) : inputUsdValue ? (
                      <span style={{ color: "var(--text-muted)" }}>{"\u2248 "}{inputUsdValue}</span>
                    ) : null}
                  </div>
                </div>
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
              <div className="swap-token-box-header">
                <span className="swap-token-box-label">You Receive</span>
                <span className="swap-token-balance">
                  {formatTokenAmount(getBalance(tokenOut), tokenOutInfo.decimals)} {tokenOut}
                </span>
              </div>
              <div className="swap-token-box-row">
                <button
                  className="swap-token-chooser"
                  onClick={() => setPickerFor("out")}
                >
                  <TokenIcon name={tokenOut} size={24} />
                  <span className="swap-token-chooser-name">{tokenOut}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <div style={{ flex: 1, textAlign: "right" }}>
                  <input
                    className="swap-token-amount"
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={
                      quote
                        ? formatTokenAmount(quote.quote.output.amount, tokenOutInfo.decimals)
                        : estimatedOutput
                    }
                    readOnly
                    tabIndex={-1}
                    style={{
                      color: quote
                        ? "var(--exo-lime)"
                        : estimatedOutput
                          ? "var(--text-muted)"
                          : "var(--text-muted)",
                    }}
                  />
                  {estimatedOutput && !quote && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, opacity: 0.7 }}>
                      {"\u2248"} estimate
                    </div>
                  )}
                </div>
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

          <MorphingButton
            label={amountExceedsBalance ? "Insufficient Balance" : "Get Price"}
            className="btn-exo btn-primary"
            style={{ width: "100%", padding: "14px" }}
            disabled={!canQuote}
            onClick={handleQuote}
          />
        </div>
      )}

      {step === "success" && result && (
        <div className="exo-feedback exo-animate-in">
          <SuccessCheck size={56} />
          <div className="exo-feedback-title" style={{ opacity: 0, animation: "slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) 0.5s forwards" }}>Conversion Complete</div>
          <div className="exo-feedback-sub" style={{ opacity: 0, animation: "slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) 0.6s forwards" }}>
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
          <button className="btn-exo btn-primary" style={{ marginTop: 8 }} onClick={() => { setStep("input"); setAmount(""); setQuote(null); setResult(null); }}>
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
