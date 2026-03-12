import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { ActionPanel } from "../components/ActionPanel";
import { ApiForm } from "../components/ApiForm";
import { JsonViewer } from "../components/JsonViewer";
import { StatusTag } from "../components/StatusTag";
import { OFFRAMP_COUNTRIES, ONRAMP_COUNTRIES, ONRAMP_ASSETS } from "../lib/constants";

export function PretiumPage() {
  const { request } = useApi();
  const [tab, setTab] = useState<"info" | "offramp" | "onramp" | "history">("info");

  // Info
  const [countryCode, setCountryCode] = useState("KE");
  const [rateCurrency, setRateCurrency] = useState("KES");
  const [usdcAmt, setUsdcAmt] = useState("");
  const [fiatAmt, setFiatAmt] = useState("");
  const [convCurrency, setConvCurrency] = useState("KES");

  // Validation
  const [valCountry, setValCountry] = useState("KE");
  const [valPhone, setValPhone] = useState("");
  const [valNetwork, setValNetwork] = useState("safaricom");
  const [bankCountry, setBankCountry] = useState("NG");
  const [bankAccount, setBankAccount] = useState("");
  const [bankCode, setBankCode] = useState("");

  // Offramp
  const [offCountry, setOffCountry] = useState("KE");
  const [offWalletId, setOffWalletId] = useState("");
  const [offUsdcAmount, setOffUsdcAmount] = useState("");
  const [offPhone, setOffPhone] = useState("");
  const [offNetwork, setOffNetwork] = useState("safaricom");
  const [offPaymentType, setOffPaymentType] = useState("MOBILE");
  const [offAccountNumber, setOffAccountNumber] = useState("");

  // Onramp
  const [onCountry, setOnCountry] = useState("KE");
  const [onWalletId, setOnWalletId] = useState("");
  const [onFiatAmount, setOnFiatAmount] = useState("");
  const [onPhone, setOnPhone] = useState("");
  const [onNetwork, setOnNetwork] = useState("safaricom");
  const [onAsset, setOnAsset] = useState("USDC");
  const [onAddress, setOnAddress] = useState("");

  // History
  const [offHistoryId, setOffHistoryId] = useState("");
  const [onHistoryId, setOnHistoryId] = useState("");

  const selectedOfframpCountry = OFFRAMP_COUNTRIES.find((c) => c.code === offCountry);
  const selectedOnrampCountry = ONRAMP_COUNTRIES.find((c) => c.code === onCountry);

  return (
    <div>
      <div className="page-header">
        <h1>Pretium (Fiat Ramps)</h1>
        <p>African mobile money offramp and onramp</p>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "info" ? "active" : ""}`} onClick={() => setTab("info")}>Info / Rates</button>
        <button className={`tab ${tab === "offramp" ? "active" : ""}`} onClick={() => setTab("offramp")}>Offramp</button>
        <button className={`tab ${tab === "onramp" ? "active" : ""}`} onClick={() => setTab("onramp")}>Onramp</button>
        <button className={`tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>History</button>
      </div>

      {tab === "info" && (
        <>
          <ActionPanel title="Supported Countries" method="GET" path="/api/pretium/countries">
            <ApiForm onSubmit={() => request("/pretium/countries")} submitLabel="Get Countries">
              <span />
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="Country Details" method="GET" path="/api/pretium/countries/:code">
            <ApiForm onSubmit={() => request(`/pretium/countries/${countryCode}`)} submitLabel="Get Country">
              <div className="form-group">
                <label>Country Code</label>
                <select className="input-exo" value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                  {OFFRAMP_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
                </select>
              </div>
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="Exchange Rate" method="GET" path="/api/pretium/exchange-rate/:currency">
            <ApiForm onSubmit={() => request(`/pretium/exchange-rate/${rateCurrency}`)} submitLabel="Get Rate">
              <div className="form-group">
                <label>Currency</label>
                <input className="input-exo" value={rateCurrency} onChange={(e) => setRateCurrency(e.target.value)} placeholder="KES" />
              </div>
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="USDC to Fiat" method="POST" path="/api/pretium/convert/usdc-to-fiat">
            <ApiForm
              onSubmit={() => request("/pretium/convert/usdc-to-fiat", {
                method: "POST",
                body: { usdcAmount: Number(usdcAmt), currency: convCurrency },
              })}
              submitLabel="Convert"
            >
              <div className="form-row">
                <div className="form-group">
                  <label>USDC Amount</label>
                  <input className="input-exo" value={usdcAmt} onChange={(e) => setUsdcAmt(e.target.value)} placeholder="10" />
                </div>
                <div className="form-group">
                  <label>Currency</label>
                  <input className="input-exo" value={convCurrency} onChange={(e) => setConvCurrency(e.target.value)} placeholder="KES" />
                </div>
              </div>
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="Fiat to USDC" method="POST" path="/api/pretium/convert/fiat-to-usdc">
            <ApiForm
              onSubmit={() => request("/pretium/convert/fiat-to-usdc", {
                method: "POST",
                body: { fiatAmount: Number(fiatAmt), currency: convCurrency },
              })}
              submitLabel="Convert"
            >
              <div className="form-row">
                <div className="form-group">
                  <label>Fiat Amount</label>
                  <input className="input-exo" value={fiatAmt} onChange={(e) => setFiatAmt(e.target.value)} placeholder="5000" />
                </div>
                <div className="form-group">
                  <label>Currency</label>
                  <input className="input-exo" value={convCurrency} onChange={(e) => setConvCurrency(e.target.value)} placeholder="KES" />
                </div>
              </div>
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="Validate Phone" method="POST" path="/api/pretium/validate/phone">
            <ApiForm
              onSubmit={() => request("/pretium/validate/phone", {
                method: "POST",
                body: { country: valCountry, phoneNumber: valPhone, network: valNetwork },
              })}
              submitLabel="Validate"
            >
              <div className="form-row">
                <div className="form-group">
                  <label>Country</label>
                  <input className="input-exo" value={valCountry} onChange={(e) => setValCountry(e.target.value)} placeholder="KE" />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input className="input-exo" value={valPhone} onChange={(e) => setValPhone(e.target.value)} placeholder="0712345678" />
                </div>
              </div>
              <div className="form-group">
                <label>Network</label>
                <input className="input-exo" value={valNetwork} onChange={(e) => setValNetwork(e.target.value)} placeholder="safaricom" />
              </div>
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="Validate Bank Account" method="POST" path="/api/pretium/validate/bank-account">
            <ApiForm
              onSubmit={() => request("/pretium/validate/bank-account", {
                method: "POST",
                body: { country: bankCountry, accountNumber: bankAccount, bankCode },
              })}
              submitLabel="Validate"
            >
              <div className="form-row">
                <div className="form-group">
                  <label>Country</label>
                  <input className="input-exo" value={bankCountry} onChange={(e) => setBankCountry(e.target.value)} placeholder="NG" />
                </div>
                <div className="form-group">
                  <label>Account Number</label>
                  <input className="input-exo" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label>Bank Code</label>
                <input className="input-exo" value={bankCode} onChange={(e) => setBankCode(e.target.value)} />
              </div>
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="Banks" method="GET" path="/api/pretium/banks/:country">
            <ApiForm onSubmit={() => request(`/pretium/banks/${bankCountry}`)} submitLabel="Get Banks">
              <div className="form-group">
                <label>Country (NG or KE)</label>
                <input className="input-exo" value={bankCountry} onChange={(e) => setBankCountry(e.target.value)} placeholder="NG" />
              </div>
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="Settlement Address" method="GET" path="/api/pretium/settlement-address">
            <ApiForm onSubmit={() => request("/pretium/settlement-address")} submitLabel="Get Address">
              <span />
            </ApiForm>
          </ActionPanel>
        </>
      )}

      {tab === "offramp" && (
        <>
          <ActionPanel title="Initiate Offramp" method="POST" path="/api/pretium/offramp">
            <ApiForm
              onSubmit={() => {
                const body: Record<string, unknown> = {
                  country: offCountry,
                  walletId: offWalletId,
                  usdcAmount: Number(offUsdcAmount),
                  phoneNumber: offPhone,
                  mobileNetwork: offNetwork,
                  paymentType: offPaymentType,
                };
                if (offAccountNumber) body.accountNumber = offAccountNumber;
                return request("/pretium/offramp", { method: "POST", body });
              }}
              submitLabel="Offramp"
            >
              <div className="form-row">
                <div className="form-group">
                  <label>Country</label>
                  <select className="input-exo" value={offCountry} onChange={(e) => setOffCountry(e.target.value)}>
                    {OFFRAMP_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Wallet ID</label>
                  <input className="input-exo" value={offWalletId} onChange={(e) => setOffWalletId(e.target.value)} placeholder="uuid" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>USDC Amount</label>
                  <input className="input-exo" value={offUsdcAmount} onChange={(e) => setOffUsdcAmount(e.target.value)} placeholder="10" />
                </div>
                <div className="form-group">
                  <label>Phone Number</label>
                  <input className="input-exo" value={offPhone} onChange={(e) => setOffPhone(e.target.value)} placeholder="0712345678" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Mobile Network</label>
                  <select className="input-exo" value={offNetwork} onChange={(e) => setOffNetwork(e.target.value)}>
                    {(selectedOfframpCountry?.networks || []).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Payment Type</label>
                  <select className="input-exo" value={offPaymentType} onChange={(e) => setOffPaymentType(e.target.value)}>
                    {(selectedOfframpCountry?.paymentTypes || []).map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {offPaymentType === "PAYBILL" && (
                <div className="form-group">
                  <label>Account Number (for PAYBILL)</label>
                  <input className="input-exo" value={offAccountNumber} onChange={(e) => setOffAccountNumber(e.target.value)} />
                </div>
              )}
            </ApiForm>
          </ActionPanel>
        </>
      )}

      {tab === "onramp" && (
        <>
          <ActionPanel title="Onramp Countries" method="GET" path="/api/pretium/onramp/countries">
            <ApiForm onSubmit={() => request("/pretium/onramp/countries")} submitLabel="Get Countries">
              <span />
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="Initiate Onramp" method="POST" path="/api/pretium/onramp">
            <ApiForm
              onSubmit={() =>
                request("/pretium/onramp", {
                  method: "POST",
                  body: {
                    country: onCountry,
                    walletId: onWalletId,
                    fiatAmount: Number(onFiatAmount),
                    phoneNumber: onPhone,
                    mobileNetwork: onNetwork,
                    asset: onAsset,
                    address: onAddress,
                  },
                })
              }
              submitLabel="Onramp"
            >
              <div className="form-row">
                <div className="form-group">
                  <label>Country</label>
                  <select className="input-exo" value={onCountry} onChange={(e) => setOnCountry(e.target.value)}>
                    {ONRAMP_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Wallet ID</label>
                  <input className="input-exo" value={onWalletId} onChange={(e) => setOnWalletId(e.target.value)} placeholder="uuid" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Fiat Amount</label>
                  <input className="input-exo" value={onFiatAmount} onChange={(e) => setOnFiatAmount(e.target.value)} placeholder="5000" />
                </div>
                <div className="form-group">
                  <label>Asset</label>
                  <select className="input-exo" value={onAsset} onChange={(e) => setOnAsset(e.target.value)}>
                    {ONRAMP_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Phone Number</label>
                  <input className="input-exo" value={onPhone} onChange={(e) => setOnPhone(e.target.value)} placeholder="0712345678" />
                </div>
                <div className="form-group">
                  <label>Mobile Network</label>
                  <select className="input-exo" value={onNetwork} onChange={(e) => setOnNetwork(e.target.value)}>
                    {(selectedOnrampCountry?.networks || []).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Receive Address (Base chain)</label>
                <input className="input-exo" value={onAddress} onChange={(e) => setOnAddress(e.target.value)} placeholder="0x..." />
              </div>
            </ApiForm>
          </ActionPanel>
        </>
      )}

      {tab === "history" && (
        <>
          <ActionPanel title="Offramp History" method="GET" path="/api/pretium/offramp">
            <ApiForm
              onSubmit={() => request("/pretium/offramp", { query: { limit: "50", offset: "0" } })}
              submitLabel="Get Offramp History"
            >
              <span />
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="Offramp Detail / Refresh" method="GET/POST" path="/api/pretium/offramp/:id">
            <ApiForm
              onSubmit={() => request(`/pretium/offramp/${offHistoryId}`)}
              submitLabel="Get Detail"
              extraButtons={
                <button
                  type="button"
                  className="btn-exo btn-secondary"
                  onClick={async () => {
                    const data = await request(`/pretium/offramp/${offHistoryId}/refresh`, { method: "POST" });
                    alert(JSON.stringify(data, null, 2));
                  }}
                >
                  Refresh Status
                </button>
              }
            >
              <div className="form-group">
                <label>Offramp Transaction ID</label>
                <input className="input-exo" value={offHistoryId} onChange={(e) => setOffHistoryId(e.target.value)} placeholder="uuid" />
              </div>
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="Onramp History" method="GET" path="/api/pretium/onramp">
            <ApiForm
              onSubmit={() => request("/pretium/onramp", { query: { limit: "50", offset: "0" } })}
              submitLabel="Get Onramp History"
            >
              <span />
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="Onramp Detail / Refresh" method="GET/POST" path="/api/pretium/onramp/:id">
            <ApiForm
              onSubmit={() => request(`/pretium/onramp/${onHistoryId}`)}
              submitLabel="Get Detail"
              extraButtons={
                <button
                  type="button"
                  className="btn-exo btn-secondary"
                  onClick={async () => {
                    const data = await request(`/pretium/onramp/${onHistoryId}/refresh`, { method: "POST" });
                    alert(JSON.stringify(data, null, 2));
                  }}
                >
                  Refresh Status
                </button>
              }
            >
              <div className="form-group">
                <label>Onramp Transaction ID</label>
                <input className="input-exo" value={onHistoryId} onChange={(e) => setOnHistoryId(e.target.value)} placeholder="uuid" />
              </div>
            </ApiForm>
          </ActionPanel>
        </>
      )}
    </div>
  );
}
