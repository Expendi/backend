import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { ActionPanel } from "../components/ActionPanel";
import { ApiForm } from "../components/ApiForm";
import { TOKEN_ADDRESSES } from "../lib/constants";

export function UniswapPage() {
  const { request } = useApi();

  const [walletId, setWalletId] = useState("");
  const [tokenIn, setTokenIn] = useState(TOKEN_ADDRESSES.USDC.address);
  const [tokenOut, setTokenOut] = useState(TOKEN_ADDRESSES.WETH.address);
  const [amount, setAmount] = useState("");
  const [swapType, setSwapType] = useState("EXACT_INPUT");
  const [slippage, setSlippage] = useState("0.5");

  // Check approval
  const [approvalWalletId, setApprovalWalletId] = useState("");
  const [approvalToken, setApprovalToken] = useState(TOKEN_ADDRESSES.USDC.address);
  const [approvalAmount, setApprovalAmount] = useState("");

  const tokenOptions = Object.entries(TOKEN_ADDRESSES);

  return (
    <div>
      <div className="page-header">
        <h1>Uniswap</h1>
        <p>Token swaps on Base via Uniswap V3</p>
      </div>

      <ActionPanel title="Check Approval" method="POST" path="/api/uniswap/check-approval">
        <ApiForm
          onSubmit={() =>
            request("/uniswap/check-approval", {
              method: "POST",
              body: {
                walletId: approvalWalletId,
                tokenIn: approvalToken,
                amount: approvalAmount,
              },
            })
          }
          submitLabel="Check"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Wallet ID</label>
              <input className="input-exo" value={approvalWalletId} onChange={(e) => setApprovalWalletId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="form-group">
              <label>Token</label>
              <select className="input-exo" value={approvalToken} onChange={(e) => setApprovalToken(e.target.value)}>
                {tokenOptions.map(([name, t]) => <option key={name} value={t.address}>{name} ({t.address.slice(0, 10)}...)</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Amount (smallest unit)</label>
            <input className="input-exo" value={approvalAmount} onChange={(e) => setApprovalAmount(e.target.value)} placeholder="1000000" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Get Quote" method="POST" path="/api/uniswap/quote">
        <ApiForm
          onSubmit={() =>
            request("/uniswap/quote", {
              method: "POST",
              body: {
                walletId,
                tokenIn,
                tokenOut,
                amount,
                type: swapType,
                slippageTolerance: Number(slippage),
              },
            })
          }
          submitLabel="Get Quote"
        >
          <div className="form-group">
            <label>Wallet ID</label>
            <input className="input-exo" value={walletId} onChange={(e) => setWalletId(e.target.value)} placeholder="uuid" />
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
              <label>Type</label>
              <select className="input-exo" value={swapType} onChange={(e) => setSwapType(e.target.value)}>
                <option value="EXACT_INPUT">EXACT_INPUT</option>
                <option value="EXACT_OUTPUT">EXACT_OUTPUT</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Slippage Tolerance (%)</label>
            <input className="input-exo" value={slippage} onChange={(e) => setSlippage(e.target.value)} placeholder="0.5" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Execute Swap" method="POST" path="/api/uniswap/swap">
        <ApiForm
          onSubmit={() =>
            request("/uniswap/swap", {
              method: "POST",
              body: {
                walletId,
                tokenIn,
                tokenOut,
                amount,
                type: swapType,
                slippageTolerance: Number(slippage),
              },
            })
          }
          submitLabel="Execute Swap"
          submitVariant="primary"
        >
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
            Uses the same parameters as the quote above. The backend handles approval, quoting, and execution in one call.
          </p>
          <div style={{ padding: 12, background: "var(--bg-secondary)", borderRadius: "var(--radius)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
            Wallet: {walletId || "---"} | {tokenIn.slice(0, 10)}... -{">"} {tokenOut.slice(0, 10)}... | Amt: {amount || "---"} | Slippage: {slippage}%
          </div>
        </ApiForm>
      </ActionPanel>

      <div className="card-exo" style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
          Token Reference (Base Chain)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          {tokenOptions.map(([name, t]) => (
            <div key={name} style={{ padding: 8, background: "var(--bg-secondary)", borderRadius: "var(--radius)", fontSize: 12 }}>
              <div style={{ fontWeight: 700 }}>{name}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-secondary)", wordBreak: "break-all" }}>
                {t.address}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{t.decimals} decimals</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
