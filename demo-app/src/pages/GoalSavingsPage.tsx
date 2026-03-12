import { useState, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { ActionPanel } from "../components/ActionPanel";
import { ApiForm } from "../components/ApiForm";
import { JsonViewer } from "../components/JsonViewer";
import { StatusTag } from "../components/StatusTag";
import { Spinner } from "../components/Spinner";
import type { GoalSaving } from "../lib/types";
import { FREQUENCY_OPTIONS, WALLET_TYPES } from "../lib/constants";

export function GoalSavingsPage() {
  const { request } = useApi();
  const [goals, setGoals] = useState<GoalSaving[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<GoalSaving | null>(null);

  // Create
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [tokenAddress, setTokenAddress] = useState("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  const [tokenSymbol, setTokenSymbol] = useState("USDC");
  const [tokenDecimals, setTokenDecimals] = useState("6");
  const [walletType, setWalletType] = useState("server");
  const [vaultId, setVaultId] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [unlockOffset, setUnlockOffset] = useState("2592000");
  const [frequency, setFrequency] = useState("7d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Actions
  const [goalId, setGoalId] = useState("");

  // Manual deposit
  const [manualAmount, setManualAmount] = useState("");
  const [manualWalletType, setManualWalletType] = useState("server");
  const [manualVaultId, setManualVaultId] = useState("");

  // Update
  const [updateName, setUpdateName] = useState("");
  const [updateDesc, setUpdateDesc] = useState("");
  const [updateDepositAmt, setUpdateDepositAmt] = useState("");
  const [updateFreq, setUpdateFreq] = useState("");

  const fetchGoals = async () => {
    setLoading(true);
    try {
      const data = await request<GoalSaving[]>("/goal-savings");
      setGoals(data);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGoals();
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Goal Savings</h1>
        <p>Savings goals with optional automated deposits into yield pools</p>
      </div>

      <ActionPanel title="List Goals" method="GET" path="/api/goal-savings">
        <button className="btn-exo btn-primary btn-sm" onClick={fetchGoals} disabled={loading}>
          {loading ? <Spinner /> : "Refresh"}
        </button>
        {goals.length > 0 && (
          <div className="data-list" style={{ marginTop: 12 }}>
            {goals.map((g) => (
              <div key={g.id} className="data-list-item" onClick={() => { setSelected(g); setGoalId(g.id); }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StatusTag status={g.status} />
                  <strong>{g.name}</strong>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" }}>
                    {g.accumulatedAmount}/{g.targetAmount} {g.tokenSymbol}
                  </span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>{g.id.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        )}
        {selected && (
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 8, background: "var(--bg-elevated)", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
              <div
                style={{
                  height: "100%",
                  background: "var(--exo-lime)",
                  width: `${Math.min(100, (Number(selected.accumulatedAmount) / Number(selected.targetAmount)) * 100)}%`,
                  transition: "width 0.5s ease",
                }}
              />
            </div>
            <JsonViewer data={selected} label="Selected Goal" />
          </div>
        )}
      </ActionPanel>

      <ActionPanel title="Create Goal" method="POST" path="/api/goal-savings">
        <ApiForm
          onSubmit={async () => {
            const body: Record<string, unknown> = {
              name,
              targetAmount,
              tokenAddress,
              tokenSymbol,
              tokenDecimals: Number(tokenDecimals),
            };
            if (desc) body.description = desc;
            if (walletType) body.walletType = walletType;
            if (vaultId) body.vaultId = vaultId;
            if (depositAmount) body.depositAmount = depositAmount;
            if (unlockOffset) body.unlockTimeOffsetSeconds = Number(unlockOffset);
            if (frequency) body.frequency = frequency;
            if (startDate) body.startDate = new Date(startDate).toISOString();
            if (endDate) body.endDate = new Date(endDate).toISOString();
            const data = await request("/goal-savings", { method: "POST", body });
            fetchGoals();
            return data;
          }}
          submitLabel="Create Goal"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input className="input-exo" value={name} onChange={(e) => setName(e.target.value)} placeholder="House Fund" />
            </div>
            <div className="form-group">
              <label>Description (optional)</label>
              <input className="input-exo" value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Target Amount (raw units)</label>
              <input className="input-exo" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="1000000000" />
            </div>
            <div className="form-group">
              <label>Token Symbol</label>
              <input className="input-exo" value={tokenSymbol} onChange={(e) => setTokenSymbol(e.target.value)} placeholder="USDC" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Token Address</label>
              <input className="input-exo" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Token Decimals</label>
              <input className="input-exo" type="number" value={tokenDecimals} onChange={(e) => setTokenDecimals(e.target.value)} />
            </div>
          </div>

          <div style={{ margin: "12px 0", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
            Automation Settings (optional)
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Wallet Type</label>
              <select className="input-exo" value={walletType} onChange={(e) => setWalletType(e.target.value)}>
                <option value="">None</option>
                {WALLET_TYPES.filter((t) => t !== "user").map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Vault ID</label>
              <input className="input-exo" value={vaultId} onChange={(e) => setVaultId(e.target.value)} placeholder="uuid" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Deposit Amount (per cycle)</label>
              <input className="input-exo" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="50000000" />
            </div>
            <div className="form-group">
              <label>Frequency</label>
              <select className="input-exo" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                <option value="">Manual only</option>
                {FREQUENCY_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Unlock Offset (seconds)</label>
              <input className="input-exo" type="number" value={unlockOffset} onChange={(e) => setUnlockOffset(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Start Date (optional)</label>
              <input className="input-exo" type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>End Date (optional)</label>
            <input className="input-exo" type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Get Goal" method="GET" path="/api/goal-savings/:id">
        <ApiForm onSubmit={() => request(`/goal-savings/${goalId}`)} submitLabel="Get">
          <div className="form-group">
            <label>Goal ID</label>
            <input className="input-exo" value={goalId} onChange={(e) => setGoalId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Update Goal" method="PATCH" path="/api/goal-savings/:id">
        <ApiForm
          onSubmit={async () => {
            const body: Record<string, unknown> = {};
            if (updateName) body.name = updateName;
            if (updateDesc) body.description = updateDesc;
            if (updateDepositAmt) body.depositAmount = updateDepositAmt;
            if (updateFreq) body.frequency = updateFreq;
            const data = await request(`/goal-savings/${goalId}`, { method: "PATCH", body });
            fetchGoals();
            return data;
          }}
          submitLabel="Update"
        >
          <div className="form-group">
            <label>Goal ID</label>
            <input className="input-exo" value={goalId} onChange={(e) => setGoalId(e.target.value)} placeholder="uuid" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input className="input-exo" value={updateName} onChange={(e) => setUpdateName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input className="input-exo" value={updateDesc} onChange={(e) => setUpdateDesc(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Deposit Amount</label>
              <input className="input-exo" value={updateDepositAmt} onChange={(e) => setUpdateDepositAmt(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Frequency</label>
              <select className="input-exo" value={updateFreq} onChange={(e) => setUpdateFreq(e.target.value)}>
                <option value="">No change</option>
                {FREQUENCY_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Manual Deposit" method="POST" path="/api/goal-savings/:id/deposit">
        <ApiForm
          onSubmit={async () => {
            const body: Record<string, unknown> = { amount: manualAmount };
            if (manualWalletType) body.walletType = manualWalletType;
            if (manualVaultId) body.vaultId = manualVaultId;
            const data = await request(`/goal-savings/${goalId}/deposit`, { method: "POST", body });
            fetchGoals();
            return data;
          }}
          submitLabel="Deposit"
        >
          <div className="form-group">
            <label>Goal ID</label>
            <input className="input-exo" value={goalId} onChange={(e) => setGoalId(e.target.value)} placeholder="uuid" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Amount</label>
              <input className="input-exo" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder="100000000" />
            </div>
            <div className="form-group">
              <label>Wallet Type</label>
              <select className="input-exo" value={manualWalletType} onChange={(e) => setManualWalletType(e.target.value)}>
                {WALLET_TYPES.filter((t) => t !== "user").map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Vault ID (optional, falls back to goal's vault)</label>
            <input className="input-exo" value={manualVaultId} onChange={(e) => setManualVaultId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Deposit History" method="GET" path="/api/goal-savings/:id/deposits">
        <ApiForm
          onSubmit={() => request(`/goal-savings/${goalId}/deposits`, { query: { limit: "50" } })}
          submitLabel="Get Deposits"
        >
          <div className="form-group">
            <label>Goal ID</label>
            <input className="input-exo" value={goalId} onChange={(e) => setGoalId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Pause / Resume / Cancel" method="POST" path="/api/goal-savings/:id/...">
        <div className="form-group">
          <label>Goal ID</label>
          <input className="input-exo" value={goalId} onChange={(e) => setGoalId(e.target.value)} placeholder="uuid" />
        </div>
        <div className="form-actions">
          <ApiForm onSubmit={async () => { const d = await request(`/goal-savings/${goalId}/pause`, { method: "POST" }); fetchGoals(); return d; }} submitLabel="Pause" submitVariant="secondary"><span /></ApiForm>
          <ApiForm onSubmit={async () => { const d = await request(`/goal-savings/${goalId}/resume`, { method: "POST" }); fetchGoals(); return d; }} submitLabel="Resume"><span /></ApiForm>
          <ApiForm onSubmit={async () => { const d = await request(`/goal-savings/${goalId}/cancel`, { method: "POST" }); fetchGoals(); return d; }} submitLabel="Cancel" submitVariant="danger"><span /></ApiForm>
        </div>
      </ActionPanel>
    </div>
  );
}
