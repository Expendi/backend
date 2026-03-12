import { useState, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { ActionPanel } from "../components/ActionPanel";
import { ApiForm } from "../components/ApiForm";
import { JsonViewer } from "../components/JsonViewer";
import { StatusTag } from "../components/StatusTag";
import { Spinner } from "../components/Spinner";
import type { RecurringPayment } from "../lib/types";
import { WALLET_TYPES, PAYMENT_TYPES, FREQUENCY_OPTIONS } from "../lib/constants";

export function RecurringPage() {
  const { request } = useApi();
  const [schedules, setSchedules] = useState<RecurringPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<RecurringPayment | null>(null);

  // Create form
  const [walletType, setWalletType] = useState("server");
  const [recipient, setRecipient] = useState("");
  const [paymentType, setPaymentType] = useState("erc20_transfer");
  const [amount, setAmount] = useState("");
  const [tokenName, setTokenName] = useState("USDC");
  const [frequency, setFrequency] = useState("30d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [executeImm, setExecuteImm] = useState(false);
  const [maxRetries, setMaxRetries] = useState("3");

  // Contract call fields
  const [contractName, setContractName] = useState("");
  const [contractMethod, setContractMethod] = useState("");
  const [contractArgs, setContractArgs] = useState("[]");

  // Action form
  const [actionId, setActionId] = useState("");
  const [execLimit, setExecLimit] = useState("50");

  const fetchSchedules = async () => {
    setLoading(true);
    try {
      const data = await request<RecurringPayment[]>("/recurring-payments");
      setSchedules(data);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Recurring Payments</h1>
        <p>Create, manage, and monitor scheduled payments</p>
      </div>

      <ActionPanel title="List Schedules" method="GET" path="/api/recurring-payments">
        <button className="btn-exo btn-primary btn-sm" onClick={fetchSchedules} disabled={loading}>
          {loading ? <Spinner /> : "Refresh"}
        </button>
        {schedules.length > 0 && (
          <div className="data-list" style={{ marginTop: 12 }}>
            {schedules.map((s) => (
              <div key={s.id} className="data-list-item" onClick={() => { setSelected(s); setActionId(s.id); }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StatusTag status={s.status} />
                  <span style={{ fontSize: 13 }}>{s.paymentType}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" }}>
                    {s.amount} every {s.frequency}
                  </span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                  {s.totalExecutions} exec
                </span>
              </div>
            ))}
          </div>
        )}
        {selected && <JsonViewer data={selected} label="Selected Schedule" />}
      </ActionPanel>

      <ActionPanel title="Create Schedule" method="POST" path="/api/recurring-payments">
        <ApiForm
          onSubmit={async () => {
            const body: Record<string, unknown> = {
              walletType,
              recipientAddress: recipient,
              paymentType,
              amount,
              frequency,
              executeImmediately: executeImm,
              maxRetries: Number(maxRetries),
            };
            if (paymentType === "erc20_transfer") body.tokenContractName = tokenName;
            if (paymentType === "contract_call") {
              body.contractName = contractName;
              body.contractMethod = contractMethod;
              body.contractArgs = JSON.parse(contractArgs);
            }
            if (startDate) body.startDate = new Date(startDate).toISOString();
            if (endDate) body.endDate = new Date(endDate).toISOString();
            const data = await request("/recurring-payments", { method: "POST", body });
            fetchSchedules();
            return data;
          }}
          submitLabel="Create"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Wallet Type</label>
              <select className="input-exo" value={walletType} onChange={(e) => setWalletType(e.target.value)}>
                {WALLET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Payment Type</label>
              <select className="input-exo" value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
                {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Recipient Address</label>
              <input className="input-exo" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..." />
            </div>
            <div className="form-group">
              <label>Amount (raw units)</label>
              <input className="input-exo" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000000" />
            </div>
          </div>
          {paymentType === "erc20_transfer" && (
            <div className="form-group">
              <label>Token Contract Name</label>
              <input className="input-exo" value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder="USDC" />
            </div>
          )}
          {paymentType === "contract_call" && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>Contract Name</label>
                  <input className="input-exo" value={contractName} onChange={(e) => setContractName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Contract Method</label>
                  <input className="input-exo" value={contractMethod} onChange={(e) => setContractMethod(e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label>Contract Args (JSON)</label>
                <textarea className="input-exo" value={contractArgs} onChange={(e) => setContractArgs(e.target.value)} />
              </div>
            </>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>Frequency</label>
              <select className="input-exo" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                {FREQUENCY_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Max Retries</label>
              <input className="input-exo" type="number" value={maxRetries} onChange={(e) => setMaxRetries(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Start Date (optional)</label>
              <input className="input-exo" type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>End Date (optional)</label>
              <input className="input-exo" type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={executeImm} onChange={(e) => setExecuteImm(e.target.checked)} />
              Execute Immediately
            </label>
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Pause / Resume / Cancel" method="POST" path="/api/recurring-payments/:id/...">
        <div className="form-group">
          <label>Schedule ID</label>
          <input className="input-exo" value={actionId} onChange={(e) => setActionId(e.target.value)} placeholder="uuid" />
        </div>
        <div className="form-actions">
          <ApiForm
            onSubmit={async () => {
              const data = await request(`/recurring-payments/${actionId}/pause`, { method: "POST" });
              fetchSchedules();
              return data;
            }}
            submitLabel="Pause"
            submitVariant="secondary"
          ><span /></ApiForm>
          <ApiForm
            onSubmit={async () => {
              const data = await request(`/recurring-payments/${actionId}/resume`, { method: "POST" });
              fetchSchedules();
              return data;
            }}
            submitLabel="Resume"
          ><span /></ApiForm>
          <ApiForm
            onSubmit={async () => {
              const data = await request(`/recurring-payments/${actionId}/cancel`, { method: "POST" });
              fetchSchedules();
              return data;
            }}
            submitLabel="Cancel"
            submitVariant="danger"
          ><span /></ApiForm>
        </div>
      </ActionPanel>

      <ActionPanel title="Execution History" method="GET" path="/api/recurring-payments/:id/executions">
        <ApiForm
          onSubmit={() =>
            request(`/recurring-payments/${actionId}/executions`, {
              query: { limit: execLimit },
            })
          }
          submitLabel="Get History"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Schedule ID</label>
              <input className="input-exo" value={actionId} onChange={(e) => setActionId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="form-group">
              <label>Limit</label>
              <input className="input-exo" type="number" value={execLimit} onChange={(e) => setExecLimit(e.target.value)} />
            </div>
          </div>
        </ApiForm>
      </ActionPanel>
    </div>
  );
}
