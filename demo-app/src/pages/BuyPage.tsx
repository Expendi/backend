import { useState, useEffect, useCallback } from "react";
import { useApi, ApiRequestError } from "../hooks/useApi";
import { useDashboard } from "../context/DashboardContext";
import { usePreferences } from "../context/PreferencesContext";
import { useApprovalContext } from "../context/ApprovalContext";
import { Spinner } from "../components/Spinner";
import { OFFRAMP_COUNTRIES, ONRAMP_COUNTRIES, ONRAMP_ASSETS } from "../lib/constants";
import type { OfframpTransaction, OnrampTransaction } from "../lib/types";
import "../styles/pages.css";

type Tab = "buy" | "sell" | "history";
type Step = "input" | "review" | "processing" | "success" | "error";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function BuyPage() {
  const { request } = useApi();
  const { walletBalances, refresh } = useDashboard();
  const { preferences } = usePreferences();
  const approvalCtx = useApprovalContext();

  const [tab, setTab] = useState<Tab>("buy");

  // Derive defaults from preferences
  const defaultCountryBuy = ONRAMP_COUNTRIES.find(c => c.code === preferences.country) ?? ONRAMP_COUNTRIES[0];
  const defaultCountrySell = OFFRAMP_COUNTRIES.find(c => c.code === preferences.country) ?? OFFRAMP_COUNTRIES[0];

  // Buy state
  const [buyCountry, setBuyCountry] = useState<string>(defaultCountryBuy.code);
  const [buyFiatAmount, setBuyFiatAmount] = useState("");
  const [buyPhone, setBuyPhone] = useState(preferences.phoneNumber ?? "");
  const [buyNetwork, setBuyNetwork] = useState<string>(preferences.mobileNetwork ?? defaultCountryBuy.networks[0] ?? "");
  const [buyAsset, setBuyAsset] = useState<string>("USDC");
  const [buyStep, setBuyStep] = useState<Step>("input");
  const [buyError, setBuyError] = useState("");
  const [buyResult, setBuyResult] = useState<OnrampTransaction | null>(null);

  // Sell state
  const [sellCountry, setSellCountry] = useState<string>(defaultCountrySell.code);
  const [sellUsdcAmount, setSellUsdcAmount] = useState("");
  const [sellPhone, setSellPhone] = useState(preferences.phoneNumber ?? "");
  const [sellNetwork, setSellNetwork] = useState<string>(preferences.mobileNetwork ?? defaultCountrySell.networks[0] ?? "");
  const [sellPaymentType, setSellPaymentType] = useState<string>(defaultCountrySell.paymentTypes[0] ?? "MOBILE");
  const [sellStep, setSellStep] = useState<Step>("input");
  const [sellError, setSellError] = useState("");
  const [sellResult, setSellResult] = useState<OfframpTransaction | null>(null);

  // Exchange rate
  const [rate, setRate] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  // History
  const [onrampHistory, setOnrampHistory] = useState<OnrampTransaction[]>([]);
  const [offrampHistory, setOfframpHistory] = useState<OfframpTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Get current buy/sell country objects
  const buyCountryObj = ONRAMP_COUNTRIES.find(c => c.code === buyCountry) ?? ONRAMP_COUNTRIES[0];
  const sellCountryObj = OFFRAMP_COUNTRIES.find(c => c.code === sellCountry) ?? OFFRAMP_COUNTRIES[0];

  // Fetch exchange rate when country changes
  const fetchRate = useCallback(async (currency: string) => {
    setRateLoading(true);
    try {
      const data = await request<{ rate: string }>(`/pretium/exchange-rate/${currency}`);
      setRate(data.rate);
    } catch {
      setRate(null);
    } finally {
      setRateLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const currency = tab === "buy" ? buyCountryObj.currency : sellCountryObj.currency;
    fetchRate(currency);
  }, [tab, buyCountry, sellCountry, fetchRate, buyCountryObj.currency, sellCountryObj.currency]);

  // Update network when country changes
  useEffect(() => {
    setBuyNetwork(buyCountryObj.networks[0] ?? "");
  }, [buyCountry, buyCountryObj.networks]);

  useEffect(() => {
    setSellNetwork(sellCountryObj.networks[0] ?? "");
    setSellPaymentType(sellCountryObj.paymentTypes[0] ?? "MOBILE");
  }, [sellCountry, sellCountryObj.networks, sellCountryObj.paymentTypes]);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const [on, off] = await Promise.all([
        request<OnrampTransaction[]>("/pretium/onramp", { query: { limit: "20", offset: "0" } }).catch(() => []),
        request<OfframpTransaction[]>("/pretium/offramp", { query: { limit: "20", offset: "0" } }).catch(() => []),
      ]);
      setOnrampHistory(on);
      setOfframpHistory(off);
    } finally {
      setHistoryLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (tab === "history") fetchHistory();
  }, [tab, fetchHistory]);

  // Request with approval support
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

  // Get user wallet for onramp destination
  const userWallet = walletBalances.find(w => w.type === "user");

  // Computed conversions
  const buyConversion = rate && buyFiatAmount
    ? (Number(buyFiatAmount) / Number(rate)).toFixed(2)
    : null;
  const sellConversion = rate && sellUsdcAmount
    ? (Number(sellUsdcAmount) * Number(rate)).toFixed(0)
    : null;

  // Handle buy submit
  const handleBuy = async () => {
    setBuyStep("processing");
    setBuyError("");
    try {
      const result = await requestWithApproval<OnrampTransaction>("/pretium/onramp", {
        method: "POST",
        body: {
          country: buyCountry,
          walletId: userWallet?.walletId ?? "",
          fiatAmount: Number(buyFiatAmount),
          phoneNumber: buyPhone,
          mobileNetwork: buyNetwork,
          asset: buyAsset,
          address: userWallet?.address ?? "",
        },
      });
      setBuyResult(result);
      setBuyStep("success");
      refresh();
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : "Transaction failed");
      setBuyStep("error");
    }
  };

  // Handle sell submit
  const handleSell = async () => {
    setSellStep("processing");
    setSellError("");
    try {
      const result = await requestWithApproval<OfframpTransaction>("/pretium/offramp", {
        method: "POST",
        body: {
          country: sellCountry,
          walletId: userWallet?.walletId ?? "",
          usdcAmount: Number(sellUsdcAmount),
          phoneNumber: sellPhone,
          mobileNetwork: sellNetwork,
          paymentType: sellPaymentType,
        },
      });
      setSellResult(result);
      setSellStep("success");
      refresh();
    } catch (err) {
      setSellError(err instanceof Error ? err.message : "Transaction failed");
      setSellStep("error");
    }
  };

  return (
    <div className="exo-page">
      <div className="exo-page-header">
        <h1 className="exo-page-title">Buy &amp; Sell</h1>
        <p className="exo-page-subtitle">Convert between crypto and mobile money</p>
      </div>

      <div className="exo-tabs">
        <button className={`exo-tab ${tab === "buy" ? "active" : ""}`} onClick={() => { setTab("buy"); setBuyStep("input"); }}>Buy</button>
        <button className={`exo-tab ${tab === "sell" ? "active" : ""}`} onClick={() => { setTab("sell"); setSellStep("input"); }}>Sell</button>
        <button className={`exo-tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>History</button>
      </div>

      {/* ─── BUY TAB ─── */}
      {tab === "buy" && (
        <>
          {buyStep === "input" && (
            <div className="exo-animate-in">
              <div className="exo-form-card">
                <div className="exo-form-card-title">Country &amp; Network</div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Country</label>
                    <select className="input-exo" value={buyCountry} onChange={e => setBuyCountry(e.target.value)}>
                      {ONRAMP_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Network</label>
                    <select className="input-exo" value={buyNetwork} onChange={e => setBuyNetwork(e.target.value)}>
                      {buyCountryObj.networks.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="exo-amount-input-wrap">
                <input
                  className="exo-amount-input"
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={buyFiatAmount}
                  onChange={e => setBuyFiatAmount(e.target.value)}
                />
                <div className="exo-amount-hint">{buyCountryObj.currency} amount to spend</div>
                {buyConversion && (
                  <div className="exo-amount-conversion">
                    ~ {buyConversion} {buyAsset}
                  </div>
                )}
                {rateLoading && <div className="exo-amount-hint">Loading rate...</div>}
              </div>

              <div className="exo-form-card">
                <div className="form-group">
                  <label>Phone Number</label>
                  <input
                    className="input-exo"
                    value={buyPhone}
                    onChange={e => setBuyPhone(e.target.value)}
                    placeholder="0712345678"
                    inputMode="tel"
                  />
                </div>
                <div className="form-group">
                  <label>Receive Asset</label>
                  <div className="exo-token-pills">
                    {ONRAMP_ASSETS.map(a => (
                      <button key={a} className={`exo-token-pill ${buyAsset === a ? "active" : ""}`} onClick={() => setBuyAsset(a)}>{a}</button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                className="btn-exo btn-primary"
                style={{ width: "100%", padding: "14px" }}
                disabled={!buyFiatAmount || !buyPhone || Number(buyFiatAmount) <= 0}
                onClick={() => setBuyStep("review")}
              >
                Review Purchase
              </button>
            </div>
          )}

          {buyStep === "review" && (
            <div className="exo-animate-in">
              <div className="exo-review">
                <div className="exo-review-row">
                  <span className="exo-review-label">You Pay</span>
                  <span className="exo-review-value">{Number(buyFiatAmount).toLocaleString()} {buyCountryObj.currency}</span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">You Receive</span>
                  <span className="exo-review-value" style={{ color: "var(--exo-lime)" }}>~{buyConversion} {buyAsset}</span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">Rate</span>
                  <span className="exo-review-value">1 USD = {rate} {buyCountryObj.currency}</span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">Phone</span>
                  <span className="exo-review-value">{buyPhone}</span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">Network</span>
                  <span className="exo-review-value">{buyNetwork}</span>
                </div>
              </div>
              <div className="exo-actions">
                <button className="btn-exo btn-secondary" onClick={() => setBuyStep("input")}>Back</button>
                <button className="btn-exo btn-primary" onClick={handleBuy}>Confirm Purchase</button>
              </div>
            </div>
          )}

          {buyStep === "processing" && (
            <div className="exo-feedback">
              <Spinner />
              <div className="exo-feedback-title">Processing...</div>
              <div className="exo-feedback-sub">Check your phone for the payment prompt</div>
            </div>
          )}

          {buyStep === "success" && (
            <div className="exo-feedback exo-animate-in">
              <div className="exo-feedback-icon success">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="exo-feedback-title">Purchase Initiated</div>
              <div className="exo-feedback-sub">
                {buyResult?.fiatAmount} {buyResult?.currency} for {buyAsset}
              </div>
              <div className="tag-exo status-pending">{buyResult?.status}</div>
              <div className="exo-actions" style={{ width: "100%" }}>
                <button className="btn-exo btn-secondary" onClick={() => { setBuyStep("input"); setBuyFiatAmount(""); setBuyPhone(""); }}>
                  New Purchase
                </button>
                <button className="btn-exo btn-primary" onClick={() => setTab("history")}>View History</button>
              </div>
            </div>
          )}

          {buyStep === "error" && (
            <div className="exo-feedback exo-animate-in">
              <div className="exo-feedback-icon error">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <div className="exo-feedback-title">Purchase Failed</div>
              <div className="exo-feedback-sub">{buyError}</div>
              <button className="btn-exo btn-primary" onClick={() => setBuyStep("review")}>Try Again</button>
            </div>
          )}
        </>
      )}

      {/* ─── SELL TAB ─── */}
      {tab === "sell" && (
        <>
          {sellStep === "input" && (
            <div className="exo-animate-in">
              <div className="exo-form-card">
                <div className="exo-form-card-title">Country &amp; Network</div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Country</label>
                    <select className="input-exo" value={sellCountry} onChange={e => setSellCountry(e.target.value)}>
                      {OFFRAMP_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Network</label>
                    <select className="input-exo" value={sellNetwork} onChange={e => setSellNetwork(e.target.value)}>
                      {sellCountryObj.networks.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>
                {sellCountryObj.paymentTypes.length > 1 && (
                  <div className="form-group">
                    <label>Payment Type</label>
                    <select className="input-exo" value={sellPaymentType} onChange={e => setSellPaymentType(e.target.value)}>
                      {sellCountryObj.paymentTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div className="exo-amount-input-wrap">
                <input
                  className="exo-amount-input"
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={sellUsdcAmount}
                  onChange={e => setSellUsdcAmount(e.target.value)}
                />
                <div className="exo-amount-hint">USDC amount to sell</div>
                {sellConversion && (
                  <div className="exo-amount-conversion">
                    ~ {Number(sellConversion).toLocaleString()} {sellCountryObj.currency}
                  </div>
                )}
              </div>

              <div className="exo-form-card">
                <div className="form-group">
                  <label>Phone Number</label>
                  <input
                    className="input-exo"
                    value={sellPhone}
                    onChange={e => setSellPhone(e.target.value)}
                    placeholder="0712345678"
                    inputMode="tel"
                  />
                </div>
              </div>

              <button
                className="btn-exo btn-primary"
                style={{ width: "100%", padding: "14px" }}
                disabled={!sellUsdcAmount || !sellPhone || Number(sellUsdcAmount) <= 0}
                onClick={() => setSellStep("review")}
              >
                Review Sale
              </button>
            </div>
          )}

          {sellStep === "review" && (
            <div className="exo-animate-in">
              <div className="exo-review">
                <div className="exo-review-row">
                  <span className="exo-review-label">You Sell</span>
                  <span className="exo-review-value">{sellUsdcAmount} USDC</span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">You Receive</span>
                  <span className="exo-review-value" style={{ color: "var(--exo-lime)" }}>~{Number(sellConversion).toLocaleString()} {sellCountryObj.currency}</span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">Rate</span>
                  <span className="exo-review-value">1 USD = {rate} {sellCountryObj.currency}</span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">Phone</span>
                  <span className="exo-review-value">{sellPhone}</span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">Payment</span>
                  <span className="exo-review-value">{sellPaymentType}</span>
                </div>
              </div>
              <div className="exo-actions">
                <button className="btn-exo btn-secondary" onClick={() => setSellStep("input")}>Back</button>
                <button className="btn-exo btn-primary" onClick={handleSell}>Confirm Sale</button>
              </div>
            </div>
          )}

          {sellStep === "processing" && (
            <div className="exo-feedback">
              <Spinner />
              <div className="exo-feedback-title">Processing...</div>
              <div className="exo-feedback-sub">Sending USDC and initiating payout</div>
            </div>
          )}

          {sellStep === "success" && (
            <div className="exo-feedback exo-animate-in">
              <div className="exo-feedback-icon success">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="exo-feedback-title">Sale Initiated</div>
              <div className="exo-feedback-sub">
                {sellResult?.usdcAmount} USDC for {sellResult?.fiatAmount} {sellResult?.currency}
              </div>
              <div className="tag-exo status-pending">{sellResult?.status}</div>
              <div className="exo-actions" style={{ width: "100%" }}>
                <button className="btn-exo btn-secondary" onClick={() => { setSellStep("input"); setSellUsdcAmount(""); setSellPhone(""); }}>
                  New Sale
                </button>
                <button className="btn-exo btn-primary" onClick={() => setTab("history")}>View History</button>
              </div>
            </div>
          )}

          {sellStep === "error" && (
            <div className="exo-feedback exo-animate-in">
              <div className="exo-feedback-icon error">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <div className="exo-feedback-title">Sale Failed</div>
              <div className="exo-feedback-sub">{sellError}</div>
              <button className="btn-exo btn-primary" onClick={() => setSellStep("review")}>Try Again</button>
            </div>
          )}
        </>
      )}

      {/* ─── HISTORY TAB ─── */}
      {tab === "history" && (
        <div className="exo-animate-in">
          {historyLoading ? (
            <div className="exo-inline-spinner"><Spinner /></div>
          ) : (
            <>
              {onrampHistory.length === 0 && offrampHistory.length === 0 ? (
                <div className="exo-empty">
                  <div className="exo-empty-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
                    </svg>
                  </div>
                  <div className="exo-empty-text">No transactions yet</div>
                  <div className="exo-empty-hint">Buy or sell crypto to see your history here</div>
                </div>
              ) : (
                <>
                  {onrampHistory.length > 0 && (
                    <>
                      <div className="exo-form-card-title" style={{ marginBottom: 8 }}>Purchases</div>
                      <div className="exo-list" style={{ marginBottom: 20 }}>
                        {onrampHistory.map(tx => (
                          <div key={tx.id} className="exo-list-item">
                            <div className="exo-list-item-left">
                              <span className="exo-list-item-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span className={`exo-status-dot ${tx.status}`} />
                                Buy {tx.asset}
                              </span>
                              <span className="exo-list-item-sub">{formatDate(tx.createdAt)}</span>
                            </div>
                            <div className="exo-list-item-right">
                              <span className="exo-list-item-value">{tx.fiatAmount} {tx.currency}</span>
                              <span className="exo-list-item-meta">{tx.status}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {offrampHistory.length > 0 && (
                    <>
                      <div className="exo-form-card-title" style={{ marginBottom: 8 }}>Cash Outs</div>
                      <div className="exo-list">
                        {offrampHistory.map(tx => (
                          <div key={tx.id} className="exo-list-item">
                            <div className="exo-list-item-left">
                              <span className="exo-list-item-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span className={`exo-status-dot ${tx.status}`} />
                                Sell USDC
                              </span>
                              <span className="exo-list-item-sub">{formatDate(tx.createdAt)}</span>
                            </div>
                            <div className="exo-list-item-right">
                              <span className="exo-list-item-value">{tx.usdcAmount} USDC</span>
                              <span className="exo-list-item-meta">{tx.fiatAmount} {tx.currency}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
              <button className="btn-exo btn-secondary" style={{ width: "100%", marginTop: 16 }} onClick={fetchHistory}>
                Refresh History
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
