import { useState, useEffect, useCallback, useRef } from "react";
import { useApi, ApiRequestError } from "../hooks/useApi";
import { useDashboard } from "../context/DashboardContext";
import { usePreferences } from "../context/PreferencesContext";
import { useApprovalContext } from "../context/ApprovalContext";
import { Spinner } from "../components/Spinner";
import { SuccessCheck } from "../components/SuccessCheck";
import { triggerConfetti } from "../components/Confetti";
import { useToast } from "../components/Toast";
import { MorphingButton } from "../components/MorphingButton";
import "../styles/page-transition.css";
import { OFFRAMP_COUNTRIES, ONRAMP_COUNTRIES, ONRAMP_ASSETS } from "../lib/constants";
import type { OfframpTransaction, OnrampTransaction, FeeEstimate } from "../lib/types";
import "../styles/pages.css";

type Tab = "buy" | "sell" | "history";
type Step = "input" | "review" | "processing" | "success" | "error";

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  MOBILE: "Mobile Money",
  BUY_GOODS: "Buy Goods (Till)",
  PAYBILL: "Paybill",
  BANK_TRANSFER: "Bank Transfer",
};

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
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("buy");

  // Directional tab animation
  const TAB_ORDER: Tab[] = ["buy", "sell", "history"];
  const prevTabIdxRef = useRef(0);
  const [tabSlide, setTabSlide] = useState<"left" | "right" | null>(null);
  const handleTabChange = (newTab: Tab) => {
    const newIdx = TAB_ORDER.indexOf(newTab);
    const prevIdx = prevTabIdxRef.current;
    if (newIdx !== prevIdx) {
      setTabSlide(newIdx > prevIdx ? "right" : "left");
      prevTabIdxRef.current = newIdx;
    }
    setTab(newTab);
  };

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

  // Bank transfer / paybill fields
  const [sellBankAccount, setSellBankAccount] = useState("");
  const [sellBankCode, setSellBankCode] = useState("");
  const [sellBankName, setSellBankName] = useState("");
  const [sellAccountName, setSellAccountName] = useState("");
  const [sellAccountNumber, setSellAccountNumber] = useState("");
  const [banks, setBanks] = useState<{ Code: string; Name: string }[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);

  // Sell fee breakdown
  const [sellFee, setSellFee] = useState<number | null>(null);
  const [sellNetAmount, setSellNetAmount] = useState<number | null>(null);

  // Buy fee breakdown
  const [buyFee, setBuyFee] = useState<number | null>(null);
  const [buyNetAmount, setBuyNetAmount] = useState<number | null>(null);

  // Exchange rate
  const [buyingRate, setBuyingRate] = useState<number | null>(null);
  const [sellingRate, setSellingRate] = useState<number | null>(null);
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
      const data = await request<{ buyingRate: number; sellingRate: number; quotedRate: number }>(`/pretium/exchange-rate/${currency}`);
      setBuyingRate(data.buyingRate);
      setSellingRate(data.sellingRate);
    } catch {
      setBuyingRate(null);
      setSellingRate(null);
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
    // Reset payment-type-specific fields when country changes
    setSellBankAccount("");
    setSellBankCode("");
    setSellBankName("");
    setSellAccountName("");
    setSellAccountNumber("");
    setSellPhone(preferences.phoneNumber ?? "");
  }, [sellCountry, sellCountryObj.networks, sellCountryObj.paymentTypes, preferences.phoneNumber]);

  // Reset payment-type-specific fields when payment type changes
  useEffect(() => {
    setSellBankAccount("");
    setSellBankCode("");
    setSellBankName("");
    setSellAccountName("");
    setSellAccountNumber("");
    if (sellPaymentType !== "MOBILE") {
      setSellPhone("");
    } else {
      setSellPhone(preferences.phoneNumber ?? "");
    }
  }, [sellPaymentType, preferences.phoneNumber]);

  // Fetch banks when BANK_TRANSFER is selected for KE or NG
  useEffect(() => {
    if (sellPaymentType !== "BANK_TRANSFER" || (sellCountry !== "KE" && sellCountry !== "NG")) {
      setBanks([]);
      return;
    }
    let cancelled = false;
    setBanksLoading(true);
    request<{ Code: string; Name: string }[]>(`/pretium/banks/${sellCountry}`)
      .then(data => {
        if (!cancelled) {
          setBanks(data);
          if (data.length > 0) {
            setSellBankCode(data[0].Code);
            setSellBankName(data[0].Name);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setBanks([]);
      })
      .finally(() => {
        if (!cancelled) setBanksLoading(false);
      });
    return () => { cancelled = true; };
  }, [sellPaymentType, sellCountry, request]);

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
  // Buy: user pays fiat, receives USDC. buyingRate = fiat per 1 USD, so USDC out = fiat / buyingRate
  const buyConversion = buyingRate && buyFiatAmount && Number(buyFiatAmount) > 0
    ? (Number(buyFiatAmount) / buyingRate).toFixed(2)
    : null;
  // Sell: user pays USDC, receives fiat. sellingRate = fiat per 1 USD, so fiat out = usdc * sellingRate
  const sellConversion = sellingRate && sellUsdcAmount && Number(sellUsdcAmount) > 0
    ? (Number(sellUsdcAmount) * sellingRate).toFixed(0)
    : null;

  // Fetch buy fee estimate when fiat amount changes
  useEffect(() => {
    if (!buyFiatAmount || Number(buyFiatAmount) <= 0) {
      setBuyFee(null);
      setBuyNetAmount(null);
      return;
    }
    let cancelled = false;
    request<FeeEstimate>(`/pretium/fee-estimate`, { query: { amount: buyFiatAmount } })
      .then(data => {
        if (!cancelled) {
          setBuyFee(data.fee);
          setBuyNetAmount(data.netAmount);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBuyFee(null);
          setBuyNetAmount(null);
        }
      });
    return () => { cancelled = true; };
  }, [buyFiatAmount, request]);

  // Fetch sell fee estimate when conversion amount changes
  useEffect(() => {
    if (!sellConversion || Number(sellConversion) <= 0) {
      setSellFee(null);
      setSellNetAmount(null);
      return;
    }
    let cancelled = false;
    request<FeeEstimate>(`/pretium/fee-estimate`, { query: { amount: sellConversion } })
      .then(data => {
        if (!cancelled) {
          setSellFee(data.fee);
          setSellNetAmount(data.netAmount);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSellFee(null);
          setSellNetAmount(null);
        }
      });
    return () => { cancelled = true; };
  }, [sellConversion, request]);

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
      triggerConfetti();
      toast.info("Transaction submitted");
      refresh();
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : "Transaction failed");
      setBuyStep("error");
      toast.error("Funding failed");
    }
  };

  // Sell form validation
  const isSellValid = (() => {
    if (!sellUsdcAmount || Number(sellUsdcAmount) <= 0) return false;
    switch (sellPaymentType) {
      case "MOBILE":
        return !!sellPhone && !!sellNetwork;
      case "BUY_GOODS":
        return !!sellPhone; // till number goes in phoneNumber
      case "PAYBILL":
        return !!sellPhone && !!sellAccountNumber; // paybill number + account
      case "BANK_TRANSFER":
        if (sellCountry === "NG") {
          return !!sellBankAccount && !!sellBankCode && !!sellAccountName;
        }
        return !!sellBankAccount && !!sellBankCode;
      default:
        return false;
    }
  })();

  // Handle sell submit
  const handleSell = async () => {
    setSellStep("processing");
    setSellError("");
    try {
      const body: Record<string, unknown> = {
        country: sellCountry,
        walletId: userWallet?.walletId ?? "",
        usdcAmount: Number(sellUsdcAmount),
        phoneNumber: sellPhone,
        mobileNetwork: sellNetwork,
        paymentType: sellPaymentType,
      };

      if (sellPaymentType === "BANK_TRANSFER") {
        body.bankAccount = sellBankAccount;
        body.bankCode = sellBankCode;
        body.bankName = sellBankName;
        if (sellCountry === "NG") {
          body.accountName = sellAccountName;
        }
      }

      if (sellPaymentType === "PAYBILL") {
        body.accountNumber = sellAccountNumber;
      }

      const result = await requestWithApproval<OfframpTransaction>("/pretium/offramp", {
        method: "POST",
        body,
      });
      setSellResult(result);
      setSellStep("success");
      triggerConfetti();
      toast.info("Transaction submitted");
      refresh();
    } catch (err) {
      setSellError(err instanceof Error ? err.message : "Transaction failed");
      setSellStep("error");
      toast.error("Withdrawal failed");
    }
  };

  return (
    <div className="exo-page">
      <div className="exo-page-header">
        <h1 className="exo-page-title">Fund &amp; Withdraw</h1>
        <p className="exo-page-subtitle">Add or cash out your crypto</p>
      </div>

      <div className="exo-tabs">
        <button className={`exo-tab ${tab === "buy" ? "active" : ""}`} onClick={() => { handleTabChange("buy"); setBuyStep("input"); }}>Fund</button>
        <button className={`exo-tab ${tab === "sell" ? "active" : ""}`} onClick={() => { handleTabChange("sell"); setSellStep("input"); }}>Withdraw</button>
        <button className={`exo-tab ${tab === "history" ? "active" : ""}`} onClick={() => handleTabChange("history")}>History</button>
      </div>

      <div key={tab} className={`tab-content-slide ${tabSlide === "left" ? "slide-from-left" : tabSlide === "right" ? "slide-from-right" : ""}`}>
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
                {buyFee !== null && buyNetAmount !== null && (
                  <div className="exo-amount-hint" style={{ marginTop: 4 }}>
                    Fee: {buyFee.toLocaleString()} {buyCountryObj.currency} | Net: {buyNetAmount.toLocaleString()} {buyCountryObj.currency}
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

              <MorphingButton
                label="Review Funding"
                className="btn-exo btn-primary"
                style={{ width: "100%", padding: "14px" }}
                disabled={!buyFiatAmount || !buyPhone || Number(buyFiatAmount) <= 0}
                onClick={() => setBuyStep("review")}
              />
            </div>
          )}

          {buyStep === "review" && (
            <div className="exo-animate-in">
              <div className="exo-review">
                <div className="exo-review-row">
                  <span className="exo-review-label">You Pay</span>
                  <span className="exo-review-value">{Number(buyFiatAmount).toLocaleString()} {buyCountryObj.currency}</span>
                </div>
                {buyFee !== null && (
                  <div className="exo-review-row">
                    <span className="exo-review-label">Fee</span>
                    <span className="exo-review-value">{buyFee.toLocaleString()} {buyCountryObj.currency}</span>
                  </div>
                )}
                {buyNetAmount !== null && (
                  <div className="exo-review-row">
                    <span className="exo-review-label">Net Amount</span>
                    <span className="exo-review-value">{buyNetAmount.toLocaleString()} {buyCountryObj.currency}</span>
                  </div>
                )}
                <div className="exo-review-row">
                  <span className="exo-review-label">You Receive</span>
                  <span className="exo-review-value" style={{ color: "var(--exo-lime)" }}>~{buyConversion} {buyAsset}</span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">Rate</span>
                  <span className="exo-review-value">1 USD = {buyingRate} {buyCountryObj.currency}</span>
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
                <MorphingButton label="Add Funding" className="btn-exo btn-primary" onClick={handleBuy} />
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
              <SuccessCheck size={56} />
              <div className="exo-feedback-title" style={{ animationDelay: "0.5s", opacity: 0, animation: "slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) 0.5s forwards" }}>Funding Initiated</div>
              <div className="exo-feedback-sub" style={{ animationDelay: "0.6s", opacity: 0, animation: "slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) 0.6s forwards" }}>
                {buyResult?.fiatAmount} {buyResult?.currency} for {buyAsset}
              </div>
              <div className="tag-exo status-pending" style={{ animationDelay: "0.7s", opacity: 0, animation: "slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) 0.7s forwards" }}>{buyResult?.status}</div>
              <div className="exo-actions" style={{ width: "100%" }}>
                <button className="btn-exo btn-secondary" onClick={() => { setBuyStep("input"); setBuyFiatAmount(""); setBuyPhone(""); }}>
                  New Funding
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
              <div className="exo-feedback-title">Funding Failed</div>
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
                <div className="exo-form-card-title">Country &amp; Payment Method</div>
                <div className="form-group">
                  <label>Country</label>
                  <select className="input-exo" value={sellCountry} onChange={e => setSellCountry(e.target.value)}>
                    {OFFRAMP_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </div>
                {sellCountryObj.paymentTypes.length > 1 && (
                  <div className="form-group">
                    <label>Payment Type</label>
                    <div className="exo-token-pills">
                      {sellCountryObj.paymentTypes.map(t => (
                        <button
                          key={t}
                          className={`exo-token-pill ${sellPaymentType === t ? "active" : ""}`}
                          onClick={() => setSellPaymentType(t)}
                        >
                          {PAYMENT_TYPE_LABELS[t] ?? t}
                        </button>
                      ))}
                    </div>
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
                <div className="exo-amount-hint">USDC amount to withdraw</div>
                {sellConversion && (
                  <div className="exo-amount-conversion">
                    ~ {Number(sellConversion).toLocaleString()} {sellCountryObj.currency}
                  </div>
                )}
                {sellFee !== null && sellNetAmount !== null && (
                  <div className="exo-amount-hint" style={{ marginTop: 4 }}>
                    Fee: {sellFee.toLocaleString()} {sellCountryObj.currency} | You receive: {sellNetAmount.toLocaleString()} {sellCountryObj.currency}
                  </div>
                )}
              </div>

              <div className="exo-form-card">
                <div className="exo-form-card-title">{PAYMENT_TYPE_LABELS[sellPaymentType] ?? sellPaymentType} Details</div>

                {/* MOBILE: Phone + Network */}
                {sellPaymentType === "MOBILE" && (
                  <>
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
                    <div className="form-group">
                      <label>Network</label>
                      <select className="input-exo" value={sellNetwork} onChange={e => setSellNetwork(e.target.value)}>
                        {sellCountryObj.networks.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  </>
                )}

                {/* BUY_GOODS: Till Number */}
                {sellPaymentType === "BUY_GOODS" && (
                  <div className="form-group">
                    <label>Till Number</label>
                    <input
                      className="input-exo"
                      value={sellPhone}
                      onChange={e => setSellPhone(e.target.value)}
                      placeholder="123456"
                      inputMode="numeric"
                    />
                  </div>
                )}

                {/* PAYBILL: Paybill Number + Account Number */}
                {sellPaymentType === "PAYBILL" && (
                  <>
                    <div className="form-group">
                      <label>Paybill Number</label>
                      <input
                        className="input-exo"
                        value={sellPhone}
                        onChange={e => setSellPhone(e.target.value)}
                        placeholder="888880"
                        inputMode="numeric"
                      />
                    </div>
                    <div className="form-group">
                      <label>Account Number</label>
                      <input
                        className="input-exo"
                        value={sellAccountNumber}
                        onChange={e => setSellAccountNumber(e.target.value)}
                        placeholder="Account number"
                      />
                    </div>
                  </>
                )}

                {/* BANK_TRANSFER: Bank selector + account fields */}
                {sellPaymentType === "BANK_TRANSFER" && (
                  <>
                    <div className="form-group">
                      <label>Bank</label>
                      {banksLoading ? (
                        <div className="exo-inline-spinner"><Spinner /></div>
                      ) : (
                        <select
                          className="input-exo"
                          value={sellBankCode}
                          onChange={e => {
                            const selected = banks.find(b => b.Code === e.target.value);
                            setSellBankCode(e.target.value);
                            setSellBankName(selected?.Name ?? "");
                          }}
                        >
                          {banks.length === 0 && <option value="">No banks available</option>}
                          {banks.map(b => (
                            <option key={b.Code} value={b.Code}>{b.Name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    {sellCountry === "NG" && (
                      <div className="form-group">
                        <label>Account Name</label>
                        <input
                          className="input-exo"
                          value={sellAccountName}
                          onChange={e => setSellAccountName(e.target.value)}
                          placeholder="Full name on account"
                        />
                      </div>
                    )}
                    <div className="form-group">
                      <label>Account Number</label>
                      <input
                        className="input-exo"
                        value={sellBankAccount}
                        onChange={e => setSellBankAccount(e.target.value)}
                        placeholder="Bank account number"
                        inputMode="numeric"
                      />
                    </div>
                  </>
                )}
              </div>

              <MorphingButton
                label="Review Withdrawal"
                className="btn-exo btn-primary"
                style={{ width: "100%", padding: "14px" }}
                disabled={!isSellValid}
                onClick={() => setSellStep("review")}
              />
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
                  <span className="exo-review-label">Gross Amount</span>
                  <span className="exo-review-value">~{Number(sellConversion).toLocaleString()} {sellCountryObj.currency}</span>
                </div>
                {sellFee !== null && (
                  <div className="exo-review-row">
                    <span className="exo-review-label">Fee</span>
                    <span className="exo-review-value">{sellFee.toLocaleString()} {sellCountryObj.currency}</span>
                  </div>
                )}
                <div className="exo-review-row">
                  <span className="exo-review-label">You Receive</span>
                  <span className="exo-review-value" style={{ color: "var(--exo-lime)" }}>
                    ~{sellNetAmount !== null ? sellNetAmount.toLocaleString() : Number(sellConversion).toLocaleString()} {sellCountryObj.currency}
                  </span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">Rate</span>
                  <span className="exo-review-value">1 USD = {sellingRate} {sellCountryObj.currency}</span>
                </div>
                <div className="exo-review-row">
                  <span className="exo-review-label">Payment</span>
                  <span className="exo-review-value">{PAYMENT_TYPE_LABELS[sellPaymentType] ?? sellPaymentType}</span>
                </div>

                {/* MOBILE review fields */}
                {sellPaymentType === "MOBILE" && (
                  <>
                    <div className="exo-review-row">
                      <span className="exo-review-label">Phone</span>
                      <span className="exo-review-value">{sellPhone}</span>
                    </div>
                    <div className="exo-review-row">
                      <span className="exo-review-label">Network</span>
                      <span className="exo-review-value">{sellNetwork}</span>
                    </div>
                  </>
                )}

                {/* BUY_GOODS review fields */}
                {sellPaymentType === "BUY_GOODS" && (
                  <div className="exo-review-row">
                    <span className="exo-review-label">Till Number</span>
                    <span className="exo-review-value">{sellPhone}</span>
                  </div>
                )}

                {/* PAYBILL review fields */}
                {sellPaymentType === "PAYBILL" && (
                  <>
                    <div className="exo-review-row">
                      <span className="exo-review-label">Paybill Number</span>
                      <span className="exo-review-value">{sellPhone}</span>
                    </div>
                    <div className="exo-review-row">
                      <span className="exo-review-label">Account Number</span>
                      <span className="exo-review-value">{sellAccountNumber}</span>
                    </div>
                  </>
                )}

                {/* BANK_TRANSFER review fields */}
                {sellPaymentType === "BANK_TRANSFER" && (
                  <>
                    <div className="exo-review-row">
                      <span className="exo-review-label">Bank</span>
                      <span className="exo-review-value">{sellBankName}</span>
                    </div>
                    {sellCountry === "NG" && (
                      <div className="exo-review-row">
                        <span className="exo-review-label">Account Name</span>
                        <span className="exo-review-value">{sellAccountName}</span>
                      </div>
                    )}
                    <div className="exo-review-row">
                      <span className="exo-review-label">Account Number</span>
                      <span className="exo-review-value">{sellBankAccount}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="exo-actions">
                <button className="btn-exo btn-secondary" onClick={() => setSellStep("input")}>Back</button>
                <MorphingButton label="Confirm Withdrawal" className="btn-exo btn-primary" onClick={handleSell} />
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
              <SuccessCheck size={56} />
              <div className="exo-feedback-title" style={{ opacity: 0, animation: "slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) 0.5s forwards" }}>Withdrawal Initiated</div>
              <div className="exo-feedback-sub" style={{ opacity: 0, animation: "slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) 0.6s forwards" }}>
                {sellResult?.usdcAmount} USDC for {sellResult?.fiatAmount} {sellResult?.currency}
              </div>
              <div className="tag-exo status-pending" style={{ opacity: 0, animation: "slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) 0.7s forwards" }}>{sellResult?.status}</div>
              <div className="exo-actions" style={{ width: "100%" }}>
                <button className="btn-exo btn-secondary" onClick={() => {
                  setSellStep("input");
                  setSellUsdcAmount("");
                  setSellPhone("");
                  setSellBankAccount("");
                  setSellBankCode("");
                  setSellBankName("");
                  setSellAccountName("");
                  setSellAccountNumber("");
                }}>
                  New Withdrawal
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
              <div className="exo-feedback-title">Withdrawal Failed</div>
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
                  <div className="exo-empty-hint">Fund or withdraw crypto to see your history here</div>
                </div>
              ) : (
                <>
                  {onrampHistory.length > 0 && (
                    <>
                      <div className="exo-form-card-title" style={{ marginBottom: 8 }}>Funding</div>
                      <div className="exo-list" style={{ marginBottom: 20 }}>
                        {onrampHistory.map(tx => (
                          <div key={tx.id} className="exo-list-item">
                            <div className="exo-list-item-left">
                              <span className="exo-list-item-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span className={`exo-status-dot ${tx.status}`} />
                                Fund {tx.asset}
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
                      <div className="exo-form-card-title" style={{ marginBottom: 8 }}>Withdrawals</div>
                      <div className="exo-list">
                        {offrampHistory.map(tx => (
                          <div key={tx.id} className="exo-list-item">
                            <div className="exo-list-item-left">
                              <span className="exo-list-item-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span className={`exo-status-dot ${tx.status}`} />
                                Withdraw USDC
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
    </div>
  );
}
