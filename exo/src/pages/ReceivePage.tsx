import { useState } from "react";
import { useDashboard } from "../context/DashboardContext";
import { useToast } from "../components/Toast";
import "../styles/wallet-home.css";

export function ReceivePage() {
  const { walletBalances } = useDashboard();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<"user" | "server" | "agent">("user");

  const wallet = walletBalances.find((w) => w.type === selectedWallet);
  const address = wallet?.address ?? "";

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="wallet-home">
      <div className="wh-section" style={{ paddingTop: 24 }}>
        <div className="wh-section-header">
          <span className="wh-section-title">Receive</span>
        </div>

        {/* Wallet Type Selector */}
        <div className="wh-actions" style={{ justifyContent: "flex-start", gap: 8, padding: "0 0 16px" }}>
          {(["user", "server", "agent"] as const).map((type) => (
            <button
              key={type}
              className={`wh-action-btn ${selectedWallet === type ? "active" : ""}`}
              onClick={() => setSelectedWallet(type)}
              style={{ flex: "0 0 auto", padding: "8px 16px" }}
            >
              <span className="wh-action-label" style={{ fontSize: 13 }}>
                {type === "user" ? "Personal" : type === "server" ? "Custodial" : "Agent"}
              </span>
            </button>
          ))}
        </div>

        {/* Address Display */}
        <div className="wh-wallet-card" style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 16 }}>
            <span className="wh-wallet-label" style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" }}>
              {selectedWallet === "user" ? "Personal" : selectedWallet === "server" ? "Custodial" : "Agent"} Wallet
            </span>
          </div>

          {/* QR-style address display */}
          <div style={{
            background: "var(--bg-primary)",
            borderRadius: "var(--radius)",
            padding: 20,
            margin: "0 auto 16px",
            maxWidth: 280,
            wordBreak: "break-all",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            lineHeight: 1.8,
            color: "var(--text-primary)",
            letterSpacing: 0.5,
          }}>
            {address || "No address available"}
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              className="wh-action-btn"
              onClick={handleCopy}
              style={{ flex: "0 0 auto", padding: "10px 24px" }}
            >
              <span className="wh-action-icon">
                {copied ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </span>
              <span className="wh-action-label">{copied ? "Copied!" : "Copy Address"}</span>
            </button>
          </div>

          <div style={{
            marginTop: 16,
            padding: "10px 16px",
            background: "var(--bg-elevated)",
            borderRadius: "var(--radius)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Base network (Chain ID: 8453). Only send assets on Base to this address.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
