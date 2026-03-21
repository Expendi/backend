import { useState, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { ActionPanel } from "../components/ActionPanel";
import { ApiForm } from "../components/ApiForm";
import { JsonViewer } from "../components/JsonViewer";
import { StatusTag } from "../components/StatusTag";
import { Spinner } from "../components/Spinner";
import type { Transaction } from "../lib/types";
import { WALLET_TYPES } from "../lib/constants";

export function TransactionsPage() {
  const { request } = useApi();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [txId, setTxId] = useState("");
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // Contract TX form
  const [ctxWalletType, setCtxWalletType] = useState("user");
  const [ctxContractName, setCtxContractName] = useState("");
  const [ctxMethod, setCtxMethod] = useState("");
  const [ctxArgs, setCtxArgs] = useState("[]");
  const [ctxValue, setCtxValue] = useState("");
  const [ctxCategoryId, setCtxCategoryId] = useState("");

  // Raw TX form
  const [rawWalletType, setRawWalletType] = useState("user");
  const [rawTo, setRawTo] = useState("");
  const [rawData, setRawData] = useState("");
  const [rawValue, setRawValue] = useState("");
  const [rawSponsor, setRawSponsor] = useState(true);
  const [rawCategoryId, setRawCategoryId] = useState("");

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const data = await request<Transaction[]>("/transactions");
      setTransactions(data);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Transactions</h1>
        <p>List, inspect, submit contract and raw transactions</p>
      </div>

      <ActionPanel title="List Transactions" method="GET" path="/api/transactions">
        <button className="btn-exo btn-primary btn-sm" onClick={fetchTransactions} disabled={loading}>
          {loading ? <Spinner /> : "Refresh"}
        </button>
        {transactions.length > 0 && (
          <div className="data-list" style={{ marginTop: 12 }}>
            {transactions.map((tx) => (
              <div key={tx.id} className="data-list-item" onClick={() => { setSelectedTx(tx); setTxId(tx.id); }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StatusTag status={tx.status} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {tx.method || "raw"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                    {tx.txHash ? `${tx.txHash.slice(0, 10)}...` : tx.id.slice(0, 8)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {selectedTx && <JsonViewer data={selectedTx} label="Selected Transaction" />}
      </ActionPanel>

      <ActionPanel title="Get Transaction by ID" method="GET" path="/api/transactions/:id">
        <ApiForm
          onSubmit={() => request<Transaction>(`/transactions/${txId}`)}
          submitLabel="Get Transaction"
        >
          <div className="form-group">
            <label>Transaction ID</label>
            <input className="input-exo" value={txId} onChange={(e) => setTxId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Submit Contract Transaction" method="POST" path="/api/transactions/contract">
        <ApiForm
          onSubmit={() =>
            request("/transactions/contract", {
              method: "POST",
              body: {
                walletType: ctxWalletType,
                contractName: ctxContractName,
                method: ctxMethod,
                args: JSON.parse(ctxArgs),
                value: ctxValue || undefined,
                categoryId: ctxCategoryId || undefined,
              },
            })
          }
          submitLabel="Submit"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Wallet Type</label>
              <select className="input-exo" value={ctxWalletType} onChange={(e) => setCtxWalletType(e.target.value)}>
                {WALLET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Contract Name</label>
              <input className="input-exo" value={ctxContractName} onChange={(e) => setCtxContractName(e.target.value)} placeholder="USDC" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Method</label>
              <input className="input-exo" value={ctxMethod} onChange={(e) => setCtxMethod(e.target.value)} placeholder="transfer" />
            </div>
            <div className="form-group">
              <label>Value (wei, optional)</label>
              <input className="input-exo" value={ctxValue} onChange={(e) => setCtxValue(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="form-group">
            <label>Args (JSON array)</label>
            <textarea className="input-exo" value={ctxArgs} onChange={(e) => setCtxArgs(e.target.value)} placeholder='["0x...", "1000000"]' />
          </div>
          <div className="form-group">
            <label>Category ID (optional)</label>
            <input className="input-exo" value={ctxCategoryId} onChange={(e) => setCtxCategoryId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Submit Raw Transaction" method="POST" path="/api/transactions/raw">
        <ApiForm
          onSubmit={() =>
            request("/transactions/raw", {
              method: "POST",
              body: {
                walletType: rawWalletType,
                to: rawTo,
                data: rawData || undefined,
                value: rawValue || undefined,
                sponsor: rawSponsor,
                categoryId: rawCategoryId || undefined,
              },
            })
          }
          submitLabel="Submit"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Wallet Type</label>
              <select className="input-exo" value={rawWalletType} onChange={(e) => setRawWalletType(e.target.value)}>
                {WALLET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>To Address</label>
              <input className="input-exo" value={rawTo} onChange={(e) => setRawTo(e.target.value)} placeholder="0x..." />
            </div>
          </div>
          <div className="form-group">
            <label>Calldata (hex, optional)</label>
            <textarea className="input-exo" value={rawData} onChange={(e) => setRawData(e.target.value)} placeholder="0x..." />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Value (wei, optional)</label>
              <input className="input-exo" value={rawValue} onChange={(e) => setRawValue(e.target.value)} placeholder="0" />
            </div>
            <div className="form-group">
              <label>Category ID (optional)</label>
              <input className="input-exo" value={rawCategoryId} onChange={(e) => setRawCategoryId(e.target.value)} placeholder="uuid" />
            </div>
          </div>
          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={rawSponsor} onChange={(e) => setRawSponsor(e.target.checked)} />
              Gas Sponsorship
            </label>
          </div>
        </ApiForm>
      </ActionPanel>
    </div>
  );
}
