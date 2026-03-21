import { useState, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { ActionPanel } from "../components/ActionPanel";
import { ApiForm } from "../components/ApiForm";
import { JsonViewer } from "../components/JsonViewer";
import { StatusTag } from "../components/StatusTag";
import { Spinner } from "../components/Spinner";
import type { YieldVault, YieldPosition, YieldPortfolio } from "../lib/types";
import { WALLET_TYPES } from "../lib/constants";

export function YieldPage() {
  const { request } = useApi();
  const [vaults, setVaults] = useState<YieldVault[]>([]);
  const [positions, setPositions] = useState<YieldPosition[]>([]);
  const [portfolio, setPortfolio] = useState<YieldPortfolio | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"vaults" | "positions" | "portfolio">("vaults");

  // Create position
  const [posWalletType, setPosWalletType] = useState("user");
  const [posVaultId, setPosVaultId] = useState("");
  const [posAmount, setPosAmount] = useState("");
  const [posUnlockTime, setPosUnlockTime] = useState("");
  const [posLabel, setPosLabel] = useState("");

  // Withdraw
  const [withdrawPosId, setWithdrawPosId] = useState("");
  const [withdrawWalletType, setWithdrawWalletType] = useState("user");

  // History
  const [historyPosId, setHistoryPosId] = useState("");

  const fetchVaults = async () => {
    setLoading(true);
    try {
      const data = await request<YieldVault[]>("/yield/vaults", { query: { chainId: "8453" } });
      setVaults(data);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  const fetchPositions = async () => {
    setLoading(true);
    try {
      const data = await request<YieldPosition[]>("/yield/positions");
      setPositions(data);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  const fetchPortfolio = async () => {
    setLoading(true);
    try {
      const data = await request<YieldPortfolio>("/yield/portfolio");
      setPortfolio(data);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVaults();
    fetchPositions();
    fetchPortfolio();
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Yield</h1>
        <p>Explore vaults, manage positions, track portfolio</p>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "vaults" ? "active" : ""}`} onClick={() => setTab("vaults")}>Vaults</button>
        <button className={`tab ${tab === "positions" ? "active" : ""}`} onClick={() => setTab("positions")}>Positions</button>
        <button className={`tab ${tab === "portfolio" ? "active" : ""}`} onClick={() => setTab("portfolio")}>Portfolio</button>
      </div>

      {tab === "vaults" && (
        <>
          <ActionPanel title="List Vaults" method="GET" path="/api/yield/vaults">
            <button className="btn-exo btn-primary btn-sm" onClick={fetchVaults} disabled={loading}>
              {loading ? <Spinner /> : "Refresh"}
            </button>
            {vaults.length > 0 && (
              <div className="data-list" style={{ marginTop: 12 }}>
                {vaults.map((v) => (
                  <div key={v.id} className="data-list-item" onClick={() => setPosVaultId(v.id)}>
                    <div>
                      <strong>{v.name}</strong>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }}>
                        {v.underlyingSymbol} | APY: {v.apy ?? "N/A"}
                      </span>
                    </div>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>{v.id.slice(0, 8)}</span>
                  </div>
                ))}
              </div>
            )}
          </ActionPanel>

          <ActionPanel title="Get Vault" method="GET" path="/api/yield/vaults/:id">
            <ApiForm
              onSubmit={() => request(`/yield/vaults/${posVaultId}`)}
              submitLabel="Get Vault"
            >
              <div className="form-group">
                <label>Vault ID</label>
                <input className="input-exo" value={posVaultId} onChange={(e) => setPosVaultId(e.target.value)} placeholder="uuid" />
              </div>
            </ApiForm>
          </ActionPanel>
        </>
      )}

      {tab === "positions" && (
        <>
          <ActionPanel title="List Positions" method="GET" path="/api/yield/positions">
            <button className="btn-exo btn-primary btn-sm" onClick={fetchPositions} disabled={loading}>
              {loading ? <Spinner /> : "Refresh"}
            </button>
            {positions.length > 0 && (
              <div className="data-list" style={{ marginTop: 12 }}>
                {positions.map((p) => (
                  <div key={p.id} className="data-list-item" onClick={() => { setWithdrawPosId(p.id); setHistoryPosId(p.id); }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <StatusTag status={p.status} />
                      <span style={{ fontSize: 13 }}>{p.label || "Unlabeled"}</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" }}>
                        {p.depositAmount}
                      </span>
                    </div>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>{p.id.slice(0, 8)}</span>
                  </div>
                ))}
              </div>
            )}
          </ActionPanel>

          <ActionPanel title="Create Position" method="POST" path="/api/yield/positions">
            <ApiForm
              onSubmit={async () => {
                const body: Record<string, unknown> = {
                  walletType: posWalletType,
                  vaultId: posVaultId,
                  amount: posAmount,
                  unlockTime: posUnlockTime ? Math.floor(new Date(posUnlockTime).getTime() / 1000) : Math.floor(Date.now() / 1000) + 86400,
                };
                if (posLabel) body.label = posLabel;
                const data = await request("/yield/positions", { method: "POST", body });
                fetchPositions();
                return data;
              }}
              submitLabel="Deposit"
            >
              <div className="form-row">
                <div className="form-group">
                  <label>Wallet Type</label>
                  <select className="input-exo" value={posWalletType} onChange={(e) => setPosWalletType(e.target.value)}>
                    {WALLET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Vault ID</label>
                  <input className="input-exo" value={posVaultId} onChange={(e) => setPosVaultId(e.target.value)} placeholder="uuid" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Amount (raw units)</label>
                  <input className="input-exo" value={posAmount} onChange={(e) => setPosAmount(e.target.value)} placeholder="1000000" />
                </div>
                <div className="form-group">
                  <label>Unlock Time</label>
                  <input className="input-exo" type="datetime-local" value={posUnlockTime} onChange={(e) => setPosUnlockTime(e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label>Label (optional)</label>
                <input className="input-exo" value={posLabel} onChange={(e) => setPosLabel(e.target.value)} placeholder="My savings" />
              </div>
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="Withdraw Position" method="POST" path="/api/yield/positions/:id/withdraw">
            <ApiForm
              onSubmit={async () => {
                const data = await request(`/yield/positions/${withdrawPosId}/withdraw`, {
                  method: "POST",
                  body: { walletType: withdrawWalletType },
                });
                fetchPositions();
                return data;
              }}
              submitLabel="Withdraw"
              submitVariant="danger"
            >
              <div className="form-row">
                <div className="form-group">
                  <label>Position ID</label>
                  <input className="input-exo" value={withdrawPosId} onChange={(e) => setWithdrawPosId(e.target.value)} placeholder="uuid" />
                </div>
                <div className="form-group">
                  <label>Wallet Type</label>
                  <select className="input-exo" value={withdrawWalletType} onChange={(e) => setWithdrawWalletType(e.target.value)}>
                    {WALLET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </ApiForm>
          </ActionPanel>

          <ActionPanel title="Position History" method="GET" path="/api/yield/positions/:id/history">
            <ApiForm
              onSubmit={() => request(`/yield/positions/${historyPosId}/history`, { query: { limit: "50" } })}
              submitLabel="Get History"
            >
              <div className="form-group">
                <label>Position ID</label>
                <input className="input-exo" value={historyPosId} onChange={(e) => setHistoryPosId(e.target.value)} placeholder="uuid" />
              </div>
            </ApiForm>
          </ActionPanel>
        </>
      )}

      {tab === "portfolio" && (
        <ActionPanel title="Portfolio Summary" method="GET" path="/api/yield/portfolio">
          <button className="btn-exo btn-primary btn-sm" onClick={fetchPortfolio} disabled={loading}>
            {loading ? <Spinner /> : "Refresh"}
          </button>
          {portfolio && (
            <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              <div className="card-exo">
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 1 }}>Deposited</div>
                <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "var(--font-display)" }}>{portfolio.totalDeposited}</div>
              </div>
              <div className="card-exo">
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 1 }}>Current Value</div>
                <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "var(--font-display)" }}>{portfolio.totalCurrentValue}</div>
              </div>
              <div className="card-exo">
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 1 }}>Yield Earned</div>
                <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "var(--font-display)", color: "var(--exo-lime)" }}>{portfolio.totalYieldEarned}</div>
              </div>
              <div className="card-exo">
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 1 }}>Weighted APY</div>
                <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "var(--font-display)" }}>{portfolio.weightedApy}</div>
              </div>
              <div className="card-exo">
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 1 }}>Positions</div>
                <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "var(--font-display)" }}>{portfolio.positionCount}</div>
              </div>
            </div>
          )}
        </ActionPanel>
      )}
    </div>
  );
}
