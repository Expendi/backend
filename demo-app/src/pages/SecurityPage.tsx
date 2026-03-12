import { useState, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { ActionPanel } from "../components/ActionPanel";
import { ApiForm } from "../components/ApiForm";
import { JsonViewer } from "../components/JsonViewer";
import { Spinner } from "../components/Spinner";
import type { ApprovalSettings, Passkey } from "../lib/types";

export function SecurityPage() {
  const { request } = useApi();
  const [settings, setSettings] = useState<ApprovalSettings | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(false);

  // PIN
  const [setupPin, setSetupPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [removePin, setRemovePin] = useState("");

  // Verify
  const [verifyMethod, setVerifyMethod] = useState<"pin" | "passkey">("pin");
  const [verifyPin, setVerifyPin] = useState("");

  // Disable
  const [disablePin, setDisablePin] = useState("");

  // Passkey
  const [passkeyLabel, setPasskeyLabel] = useState("");
  const [removePasskeyId, setRemovePasskeyId] = useState("");

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const s = await request<ApprovalSettings>("/security/approval");
      setSettings(s);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  const fetchPasskeys = async () => {
    try {
      const p = await request<Passkey[]>("/security/approval/passkeys");
      setPasskeys(p);
    } catch {
      // handled
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchPasskeys();
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Security / Transaction Approval</h1>
        <p>Configure PIN or passkey verification for financial operations</p>
      </div>

      <ActionPanel title="Approval Settings" method="GET" path="/api/security/approval">
        <button className="btn-exo btn-primary btn-sm" onClick={fetchSettings} disabled={loading}>
          {loading ? <Spinner /> : "Refresh"}
        </button>
        {settings && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span className={`tag-exo ${settings.enabled ? "status-active" : "status-cancelled"}`}>
                {settings.enabled ? "Enabled" : "Disabled"}
              </span>
              {settings.method && <span className="tag-exo">{settings.method}</span>}
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {settings.passkeyCount} passkey(s)
              </span>
            </div>
          </div>
        )}
      </ActionPanel>

      <ActionPanel title="Setup PIN" method="POST" path="/api/security/approval/pin/setup">
        <ApiForm
          onSubmit={async () => {
            const data = await request("/security/approval/pin/setup", {
              method: "POST",
              body: { pin: setupPin },
            });
            fetchSettings();
            return data;
          }}
          submitLabel="Setup PIN"
        >
          <div className="form-group">
            <label>PIN (4-6 digits)</label>
            <input
              className="input-exo"
              type="password"
              value={setupPin}
              onChange={(e) => setSetupPin(e.target.value)}
              placeholder="1234"
              maxLength={6}
            />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Change PIN" method="POST" path="/api/security/approval/pin/change">
        <ApiForm
          onSubmit={async () => {
            const data = await request("/security/approval/pin/change", {
              method: "POST",
              body: { currentPin, newPin },
            });
            return data;
          }}
          submitLabel="Change PIN"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Current PIN</label>
              <input className="input-exo" type="password" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} placeholder="1234" maxLength={6} />
            </div>
            <div className="form-group">
              <label>New PIN</label>
              <input className="input-exo" type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="5678" maxLength={6} />
            </div>
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Remove PIN" method="DELETE" path="/api/security/approval/pin">
        <ApiForm
          onSubmit={async () => {
            const data = await request("/security/approval/pin", {
              method: "DELETE",
              body: { pin: removePin },
            });
            fetchSettings();
            return data;
          }}
          submitLabel="Remove PIN"
          submitVariant="danger"
        >
          <div className="form-group">
            <label>Current PIN (to confirm)</label>
            <input className="input-exo" type="password" value={removePin} onChange={(e) => setRemovePin(e.target.value)} placeholder="1234" maxLength={6} />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Verify (Get Approval Token)" method="POST" path="/api/security/approval/verify">
        <ApiForm
          onSubmit={() =>
            request<{ token: string }>("/security/approval/verify", {
              method: "POST",
              body: {
                method: verifyMethod,
                ...(verifyMethod === "pin" ? { pin: verifyPin } : {}),
              },
            })
          }
          submitLabel="Verify"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Method</label>
              <select className="input-exo" value={verifyMethod} onChange={(e) => setVerifyMethod(e.target.value as "pin" | "passkey")}>
                <option value="pin">PIN</option>
                <option value="passkey">Passkey</option>
              </select>
            </div>
            {verifyMethod === "pin" && (
              <div className="form-group">
                <label>PIN</label>
                <input className="input-exo" type="password" value={verifyPin} onChange={(e) => setVerifyPin(e.target.value)} placeholder="1234" maxLength={6} />
              </div>
            )}
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            Returns a token valid for 5 minutes. Use as X-Approval-Token header.
          </p>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Registered Passkeys" method="GET" path="/api/security/approval/passkeys">
        <button className="btn-exo btn-primary btn-sm" onClick={fetchPasskeys}>Refresh</button>
        {passkeys.length > 0 ? (
          <div className="data-list" style={{ marginTop: 12 }}>
            {passkeys.map((pk) => (
              <div key={pk.id} className="data-list-item" onClick={() => setRemovePasskeyId(pk.id)}>
                <div>
                  <strong>{pk.label || "Unnamed passkey"}</strong>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                    {new Date(pk.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>{pk.id.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>No passkeys registered.</p>
        )}
      </ActionPanel>

      <ActionPanel title="Register Passkey" method="POST" path="/api/security/approval/passkey/register">
        <ApiForm
          onSubmit={async () => {
            // Step 1: Get registration options
            const options = await request("/security/approval/passkey/register", { method: "POST" });
            return { step: "registration_options", options, note: "In a full implementation, pass these options to navigator.credentials.create() and then POST the credential to /passkey/register/verify" };
          }}
          submitLabel="Start Registration"
        >
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Initiates WebAuthn passkey registration. Returns options for navigator.credentials.create().
          </p>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Remove Passkey" method="DELETE" path="/api/security/approval/passkeys/:id">
        <ApiForm
          onSubmit={async () => {
            const data = await request(`/security/approval/passkeys/${removePasskeyId}`, { method: "DELETE" });
            fetchPasskeys();
            return data;
          }}
          submitLabel="Remove Passkey"
          submitVariant="danger"
        >
          <div className="form-group">
            <label>Passkey ID</label>
            <input className="input-exo" value={removePasskeyId} onChange={(e) => setRemovePasskeyId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Disable Transaction Approval" method="DELETE" path="/api/security/approval">
        <ApiForm
          onSubmit={async () => {
            const body: Record<string, string> = {};
            if (disablePin) body.pin = disablePin;
            const data = await request("/security/approval", { method: "DELETE", body });
            fetchSettings();
            return data;
          }}
          submitLabel="Disable Approval"
          submitVariant="danger"
        >
          <div className="form-group">
            <label>PIN (if PIN method is active)</label>
            <input className="input-exo" type="password" value={disablePin} onChange={(e) => setDisablePin(e.target.value)} placeholder="1234" maxLength={6} />
          </div>
          <p style={{ fontSize: 12, color: "var(--exo-coral)" }}>
            This disables transaction approval entirely.
          </p>
        </ApiForm>
      </ActionPanel>
    </div>
  );
}
