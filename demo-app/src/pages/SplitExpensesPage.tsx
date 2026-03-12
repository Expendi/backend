import { useState, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { ActionPanel } from "../components/ActionPanel";
import { ApiForm } from "../components/ApiForm";
import { JsonViewer } from "../components/JsonViewer";
import { StatusTag } from "../components/StatusTag";
import { Spinner } from "../components/Spinner";
import type { SplitExpense } from "../lib/types";

export function SplitExpensesPage() {
  const { request } = useApi();
  const [expenses, setExpenses] = useState<SplitExpense[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SplitExpense | null>(null);

  // Create
  const [groupId, setGroupId] = useState("");
  const [description, setDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [tokenAddress, setTokenAddress] = useState("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  const [tokenSymbol, setTokenSymbol] = useState("USDC");
  const [tokenDecimals, setTokenDecimals] = useState("6");

  // Actions
  const [expenseId, setExpenseId] = useState("");

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const data = await request<SplitExpense[]>("/split-expenses");
      setExpenses(data);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpenses();
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Split Expenses</h1>
        <p>Create and manage shared expenses within groups</p>
      </div>

      <ActionPanel title="List Expenses" method="GET" path="/api/split-expenses">
        <button className="btn-exo btn-primary btn-sm" onClick={fetchExpenses} disabled={loading}>
          {loading ? <Spinner /> : "Refresh"}
        </button>
        {expenses.length > 0 && (
          <div className="data-list" style={{ marginTop: 12 }}>
            {expenses.map((e) => (
              <div key={e.id} className="data-list-item" onClick={() => { setSelected(e); setExpenseId(e.id); }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StatusTag status={e.status} />
                  <span style={{ fontSize: 13 }}>{e.description}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" }}>
                    {e.totalAmount} {e.tokenSymbol}
                  </span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>{e.id.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        )}
        {selected && <JsonViewer data={selected} label="Selected Expense" />}
      </ActionPanel>

      <ActionPanel title="Create Split Expense" method="POST" path="/api/split-expenses">
        <ApiForm
          onSubmit={async () => {
            const data = await request("/split-expenses", {
              method: "POST",
              body: {
                groupId,
                description,
                totalAmount,
                tokenAddress,
                tokenSymbol,
                tokenDecimals: Number(tokenDecimals),
              },
            });
            fetchExpenses();
            return data;
          }}
          submitLabel="Create"
        >
          <div className="form-group">
            <label>Group ID</label>
            <input className="input-exo" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="uuid" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Description</label>
              <input className="input-exo" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Dinner at restaurant" />
            </div>
            <div className="form-group">
              <label>Total Amount (raw units)</label>
              <input className="input-exo" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="50000000" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Token Address</label>
              <input className="input-exo" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Token Symbol</label>
              <input className="input-exo" value={tokenSymbol} onChange={(e) => setTokenSymbol(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Token Decimals</label>
            <input className="input-exo" type="number" value={tokenDecimals} onChange={(e) => setTokenDecimals(e.target.value)} />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Get Expense" method="GET" path="/api/split-expenses/:id">
        <ApiForm onSubmit={() => request(`/split-expenses/${expenseId}`)} submitLabel="Get">
          <div className="form-group">
            <label>Expense ID</label>
            <input className="input-exo" value={expenseId} onChange={(e) => setExpenseId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Pay Share" method="POST" path="/api/split-expenses/:id/pay">
        <ApiForm
          onSubmit={async () => {
            const data = await request(`/split-expenses/${expenseId}/pay`, { method: "POST" });
            fetchExpenses();
            return data;
          }}
          submitLabel="Pay My Share"
        >
          <div className="form-group">
            <label>Expense ID</label>
            <input className="input-exo" value={expenseId} onChange={(e) => setExpenseId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Cancel Expense" method="POST" path="/api/split-expenses/:id/cancel">
        <ApiForm
          onSubmit={async () => {
            const data = await request(`/split-expenses/${expenseId}/cancel`, { method: "POST" });
            fetchExpenses();
            return data;
          }}
          submitLabel="Cancel"
          submitVariant="danger"
        >
          <div className="form-group">
            <label>Expense ID</label>
            <input className="input-exo" value={expenseId} onChange={(e) => setExpenseId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>
    </div>
  );
}
