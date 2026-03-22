import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useApi } from "../hooks/useApi";
import {
  useApprovalSettingsQuery,
  usePasskeysQuery,
  useSetupPinMutation,
  useChangePinMutation,
  useRemovePinMutation,
  useRemovePasskeyMutation,
  useDisableApprovalMutation,
} from "../hooks/queries";
import { ActionPanel } from "../components/ActionPanel";
import { ApiForm } from "../components/ApiForm";
import { JsonViewer } from "../components/JsonViewer";
import { Spinner } from "../components/Spinner";
import { setupPinSchema, changePinSchema, type SetupPinFormData, type ChangePinFormData } from "../lib/schemas";

export function SecurityPage() {
  const { request } = useApi();
  const { data: settings, isLoading, refetch: refetchSettings } = useApprovalSettingsQuery();
  const { data: passkeys = [], refetch: refetchPasskeys } = usePasskeysQuery();

  const setupPinMutation = useSetupPinMutation();
  const changePinMutation = useChangePinMutation();
  const removePinMutation = useRemovePinMutation();
  const removePasskeyMutation = useRemovePasskeyMutation();
  const disableApprovalMutation = useDisableApprovalMutation();

  // Setup PIN form
  const setupForm = useForm<SetupPinFormData>({
    resolver: zodResolver(setupPinSchema),
    defaultValues: { pin: "" },
  });

  // Change PIN form
  const changeForm = useForm<ChangePinFormData>({
    resolver: zodResolver(changePinSchema),
    defaultValues: { currentPin: "", newPin: "" },
  });

  // Simple state for non-form fields
  const [removePin, setRemovePin] = useState("");
  const [verifyMethod, setVerifyMethod] = useState<"pin" | "passkey">("pin");
  const [verifyPin, setVerifyPin] = useState("");
  const [disablePin, setDisablePin] = useState("");
  const [removePasskeyId, setRemovePasskeyId] = useState("");

  const onSetupPin = async (data: SetupPinFormData) => {
    await setupPinMutation.mutateAsync(data.pin);
    setupForm.reset();
  };

  const onChangePin = async (data: ChangePinFormData) => {
    await changePinMutation.mutateAsync(data);
    changeForm.reset();
  };

  return (
    <div>
      <div className="page-header">
        <h1>Security / Transaction Approval</h1>
        <p>Configure PIN or passkey verification for financial operations</p>
      </div>

      <ActionPanel title="Approval Settings" method="GET" path="/api/security/approval">
        <button className="btn-exo btn-primary btn-sm" onClick={() => refetchSettings()} disabled={isLoading}>
          {isLoading ? <Spinner /> : "Refresh"}
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
        <form onSubmit={setupForm.handleSubmit(onSetupPin)}>
          <div className="form-group">
            <label>PIN (4-6 digits)</label>
            <input className="input-exo" type="password" {...setupForm.register("pin")} placeholder="1234" maxLength={6} />
            {setupForm.formState.errors.pin && <span className="msg-error">{setupForm.formState.errors.pin.message}</span>}
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-exo btn-primary" disabled={setupPinMutation.isPending}>
              {setupPinMutation.isPending ? <Spinner /> : "Setup PIN"}
            </button>
          </div>
          {setupPinMutation.error && <div className="msg-error">{setupPinMutation.error instanceof Error ? setupPinMutation.error.message : "Failed"}</div>}
          {setupPinMutation.isSuccess && <div className="msg-success">PIN set up successfully</div>}
        </form>
      </ActionPanel>

      <ActionPanel title="Change PIN" method="POST" path="/api/security/approval/pin/change">
        <form onSubmit={changeForm.handleSubmit(onChangePin)}>
          <div className="form-row">
            <div className="form-group">
              <label>Current PIN</label>
              <input className="input-exo" type="password" {...changeForm.register("currentPin")} placeholder="1234" maxLength={6} />
              {changeForm.formState.errors.currentPin && <span className="msg-error">{changeForm.formState.errors.currentPin.message}</span>}
            </div>
            <div className="form-group">
              <label>New PIN</label>
              <input className="input-exo" type="password" {...changeForm.register("newPin")} placeholder="5678" maxLength={6} />
              {changeForm.formState.errors.newPin && <span className="msg-error">{changeForm.formState.errors.newPin.message}</span>}
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-exo btn-primary" disabled={changePinMutation.isPending}>
              {changePinMutation.isPending ? <Spinner /> : "Change PIN"}
            </button>
          </div>
          {changePinMutation.error && <div className="msg-error">{changePinMutation.error instanceof Error ? changePinMutation.error.message : "Failed"}</div>}
          {changePinMutation.isSuccess && <div className="msg-success">PIN changed successfully</div>}
        </form>
      </ActionPanel>

      <ActionPanel title="Remove PIN" method="DELETE" path="/api/security/approval/pin">
        <ApiForm
          onSubmit={async () => {
            const data = await removePinMutation.mutateAsync(removePin);
            setRemovePin("");
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
        <button className="btn-exo btn-primary btn-sm" onClick={() => refetchPasskeys()}>Refresh</button>
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
            const data = await removePasskeyMutation.mutateAsync(removePasskeyId);
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
            const data = await disableApprovalMutation.mutateAsync(disablePin || undefined);
            setDisablePin("");
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
