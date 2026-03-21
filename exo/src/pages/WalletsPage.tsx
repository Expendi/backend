import { useState, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { ActionPanel } from "../components/ActionPanel";
import { ApiForm } from "../components/ApiForm";
import { JsonViewer } from "../components/JsonViewer";
import { Spinner } from "../components/Spinner";
import type { Wallet } from "../lib/types";
import { WALLET_TYPES } from "../lib/constants";

export function WalletsPage() {
  const { request } = useApi();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(false);
  const [walletId, setWalletId] = useState("");
  const [signWalletId, setSignWalletId] = useState("");
  const [signMessage, setSignMessage] = useState("");
  const [transferFrom, setTransferFrom] = useState<string>("user");
  const [transferTo, setTransferTo] = useState<string>("server");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferToken, setTransferToken] = useState("usdc");
  const [transferCategoryId, setTransferCategoryId] = useState("");

  const fetchWallets = async () => {
    setLoading(true);
    try {
      const data = await request<Wallet[]>("/wallets");
      setWallets(data);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWallets();
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Wallets</h1>
        <p>Manage wallets, sign messages, inter-wallet transfers</p>
      </div>

      <ActionPanel title="List Wallets" method="GET" path="/api/wallets">
        <button className="btn-exo btn-primary btn-sm" onClick={fetchWallets} disabled={loading}>
          {loading ? <Spinner /> : "Refresh"}
        </button>
        {wallets.length > 0 && (
          <div className="data-list" style={{ marginTop: 12 }}>
            {wallets.map((w) => (
              <div key={w.id} className="data-list-item" onClick={() => setWalletId(w.id)}>
                <div>
                  <span className={`tag-exo status-${w.type === "user" ? "active" : w.type === "server" ? "pending" : "processing"}`} style={{ marginRight: 8 }}>
                    {w.type}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {w.address ? `${w.address.slice(0, 10)}...${w.address.slice(-6)}` : "no address"}
                  </span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                  {w.id.slice(0, 8)}
                </span>
              </div>
            ))}
          </div>
        )}
      </ActionPanel>

      <ActionPanel title="Get Wallet by ID" method="GET" path="/api/wallets/:id">
        <ApiForm
          onSubmit={() => request<Wallet>(`/wallets/${walletId}`)}
          submitLabel="Get Wallet"
        >
          <div className="form-group">
            <label>Wallet ID</label>
            <input className="input-exo" value={walletId} onChange={(e) => setWalletId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Create User Wallet" method="POST" path="/api/wallets/user">
        <ApiForm
          onSubmit={async () => {
            const data = await request("/wallets/user", { method: "POST" });
            fetchWallets();
            return data;
          }}
          submitLabel="Create Wallet"
        >
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Creates a new user-type wallet.
          </p>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Sign Message" method="POST" path="/api/wallets/:id/sign">
        <ApiForm
          onSubmit={() =>
            request(`/wallets/${signWalletId}/sign`, {
              method: "POST",
              body: { message: signMessage },
            })
          }
          submitLabel="Sign"
        >
          <div className="form-group">
            <label>Wallet ID</label>
            <input className="input-exo" value={signWalletId} onChange={(e) => setSignWalletId(e.target.value)} placeholder="uuid" />
          </div>
          <div className="form-group">
            <label>Message</label>
            <textarea className="input-exo" value={signMessage} onChange={(e) => setSignMessage(e.target.value)} placeholder="Hello world" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Inter-Wallet Transfer" method="POST" path="/api/wallets/transfer">
        <ApiForm
          onSubmit={() =>
            request("/wallets/transfer", {
              method: "POST",
              body: {
                from: transferFrom,
                to: transferTo,
                amount: transferAmount,
                token: transferToken || undefined,
                categoryId: transferCategoryId || undefined,
              },
            })
          }
          submitLabel="Transfer"
        >
          <div className="form-row">
            <div className="form-group">
              <label>From</label>
              <select className="input-exo" value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)}>
                {WALLET_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>To</label>
              <select className="input-exo" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                {WALLET_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Amount (raw units, e.g. 1000000 = 1 USDC)</label>
              <input className="input-exo" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} placeholder="1000000" />
            </div>
            <div className="form-group">
              <label>Token (default: usdc)</label>
              <input className="input-exo" value={transferToken} onChange={(e) => setTransferToken(e.target.value)} placeholder="usdc" />
            </div>
          </div>
          <div className="form-group">
            <label>Category ID (optional)</label>
            <input className="input-exo" value={transferCategoryId} onChange={(e) => setTransferCategoryId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>
    </div>
  );
}
