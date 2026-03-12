import { useState, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { ActionPanel } from "../components/ActionPanel";
import { ApiForm } from "../components/ApiForm";
import { JsonViewer } from "../components/JsonViewer";
import { StatusTag } from "../components/StatusTag";
import { Spinner } from "../components/Spinner";
import type { SwapAutomation } from "../lib/types";
import { WALLET_TYPES, INDICATOR_TYPES, TOKEN_ADDRESSES } from "../lib/constants";

export function SwapAutomationsPage() {
  const { request } = useApi();
  const [automations, setAutomations] = useState<SwapAutomation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SwapAutomation | null>(null);

  // Create
  const [walletId, setWalletId] = useState("");
  const [walletType, setWalletType] = useState("user");
  const [tokenIn, setTokenIn] = useState(TOKEN_ADDRESSES.USDC.address);
  const [tokenOut, setTokenOut] = useState(TOKEN_ADDRESSES.WETH.address);
  const [amount, setAmount] = useState("");
  const [indicatorType, setIndicatorType] = useState("price_below");
  const [indicatorToken, setIndicatorToken] = useState("ETH");
  const [threshold, setThreshold] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [maxExec, setMaxExec] = useState("1");
  const [cooldown, setCooldown] = useState("60");
  const [maxRetries, setMaxRetries] = useState("3");
  const [maxPerDay, setMaxPerDay] = useState("");

  // Action
  const [actionId, setActionId] = useState("");

  const fetchAutomations = async () => {
    setLoading(true);
    try {
      const data = await request<SwapAutomation[]>("/swap-automations");
      setAutomations(data);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAutomations();
  }, []);

  const tokenOptions = Object.entries(TOKEN_ADDRESSES);

  return (
    <div>
      <div className="page-header">
        <h1>Swap Automations</h1>
        <p>Indicator-based conditional swaps on Base</p>
      </div>

      <ActionPanel title="List Automations" method="GET" path="/api/swap-automations">
        <button className="btn-exo btn-primary btn-sm" onClick={fetchAutomations} disabled={loading}>
          {loading ? <Spinner /> : "Refresh"}
        </button>
        {automations.length > 0 && (
          <div className="data-list" style={{ marginTop: 12 }}>
            {automations.map((a) => (
              <div key={a.id} className="data-list-item" onClick={() => { setSelected(a); setActionId(a.id); }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StatusTag status={a.status} />
                  <span style={{ fontSize: 13 }}>{a.indicatorType}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" }}>
                    {a.indicatorToken} @ {a.thresholdValue}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {a.executionCount}/{a.maxExecutions}
                </span>
              </div>
            ))}
          </div>
        )}
        {selected && <JsonViewer data={selected} label="Selected Automation" />}
      </ActionPanel>

      <ActionPanel title="Create Automation" method="POST" path="/api/swap-automations">
        <ApiForm
          onSubmit={async () => {
            const body: Record<string, unknown> = {
              walletId,
              walletType,
              tokenIn,
              tokenOut,
              amount,
              indicatorType,
              indicatorToken,
              thresholdValue: Number(threshold),
              slippageTolerance: Number(slippage),
              maxExecutions: Number(maxExec),
              cooldownSeconds: Number(cooldown),
              maxRetries: Number(maxRetries),
            };
            if (maxPerDay) body.maxExecutionsPerDay = Number(maxPerDay);
            const data = await request("/swap-automations", { method: "POST", body });
            fetchAutomations();
            return data;
          }}
          submitLabel="Create"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Wallet ID</label>
              <input className="input-exo" value={walletId} onChange={(e) => setWalletId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="form-group">
              <label>Wallet Type</label>
              <select className="input-exo" value={walletType} onChange={(e) => setWalletType(e.target.value)}>
                {WALLET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Token In</label>
              <select className="input-exo" value={tokenIn} onChange={(e) => setTokenIn(e.target.value)}>
                {tokenOptions.map(([name, t]) => <option key={name} value={t.address}>{name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Token Out</label>
              <select className="input-exo" value={tokenOut} onChange={(e) => setTokenOut(e.target.value)}>
                {tokenOptions.map(([name, t]) => <option key={name} value={t.address}>{name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Amount (smallest unit)</label>
              <input className="input-exo" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000000" />
            </div>
            <div className="form-group">
              <label>Indicator Type</label>
              <select className="input-exo" value={indicatorType} onChange={(e) => setIndicatorType(e.target.value)}>
                {INDICATOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Indicator Token</label>
              <input className="input-exo" value={indicatorToken} onChange={(e) => setIndicatorToken(e.target.value)} placeholder="ETH" />
            </div>
            <div className="form-group">
              <label>Threshold Value</label>
              <input className="input-exo" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="2000" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Slippage (%)</label>
              <input className="input-exo" value={slippage} onChange={(e) => setSlippage(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Max Executions</label>
              <input className="input-exo" type="number" value={maxExec} onChange={(e) => setMaxExec(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Cooldown (seconds)</label>
              <input className="input-exo" type="number" value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Max Per Day (optional)</label>
              <input className="input-exo" type="number" value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} />
            </div>
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Pause / Resume / Cancel" method="POST" path="/api/swap-automations/:id/...">
        <div className="form-group">
          <label>Automation ID</label>
          <input className="input-exo" value={actionId} onChange={(e) => setActionId(e.target.value)} placeholder="uuid" />
        </div>
        <div className="form-actions">
          <ApiForm onSubmit={async () => { const d = await request(`/swap-automations/${actionId}/pause`, { method: "POST" }); fetchAutomations(); return d; }} submitLabel="Pause" submitVariant="secondary"><span /></ApiForm>
          <ApiForm onSubmit={async () => { const d = await request(`/swap-automations/${actionId}/resume`, { method: "POST" }); fetchAutomations(); return d; }} submitLabel="Resume"><span /></ApiForm>
          <ApiForm onSubmit={async () => { const d = await request(`/swap-automations/${actionId}/cancel`, { method: "POST" }); fetchAutomations(); return d; }} submitLabel="Cancel" submitVariant="danger"><span /></ApiForm>
        </div>
      </ActionPanel>

      <ActionPanel title="Execution History" method="GET" path="/api/swap-automations/:id/executions">
        <ApiForm
          onSubmit={() => request(`/swap-automations/${actionId}/executions`, { query: { limit: "50" } })}
          submitLabel="Get History"
        >
          <div className="form-group">
            <label>Automation ID</label>
            <input className="input-exo" value={actionId} onChange={(e) => setActionId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>
    </div>
  );
}
