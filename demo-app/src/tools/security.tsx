import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow } from "./components";

// ─── get_approval_settings ──────────────────────────────────────────────────

const getApprovalSettingsTool: ToolConfig = {
  name: "get_approval_settings",
  description: "Get the current transaction approval security settings, including whether approval is enabled, the method used, and passkey count.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/security/approval");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── list_passkeys ──────────────────────────────────────────────────────────

const listPasskeysTool: ToolConfig = {
  name: "list_passkeys",
  description: "List all registered passkeys for transaction approval.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/security/approval/passkeys");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── setup_pin ──────────────────────────────────────────────────────────────

const setupPinTool = defineTool({
  name: "setup_pin",
  description: "Set up a PIN for transaction approval. The PIN will be required to approve transactions.",
  inputSchema: z.object({
    pin: z.string().describe("The PIN to set for transaction approval"),
  }),
  displayPropsSchema: z.object({}),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait({});
    if (!confirmed) return { status: "success", data: "PIN setup cancelled." };
    try {
      const data = await callApi("/security/approval/pin/setup", { method: "POST", body: { pin: input.pin } });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ resolve }) {
    return (
      <ConfirmDialog title="Set Up Transaction PIN" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="PIN" value="****" />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>Set up a PIN for approving transactions. You will need this PIN to authorize future transactions.</p>
      </ConfirmDialog>
    );
  },
});

// ─── change_pin ─────────────────────────────────────────────────────────────

const changePinTool = defineTool({
  name: "change_pin",
  description: "Change the existing transaction approval PIN.",
  inputSchema: z.object({
    currentPin: z.string().describe("The current PIN"),
    newPin: z.string().describe("The new PIN to set"),
  }),
  displayPropsSchema: z.object({}),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait({});
    if (!confirmed) return { status: "success", data: "PIN change cancelled." };
    try {
      const data = await callApi("/security/approval/pin/change", { method: "POST", body: { currentPin: input.currentPin, newPin: input.newPin } });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ resolve }) {
    return (
      <ConfirmDialog title="Change Transaction PIN" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Current PIN" value="****" />
        <KVRow label="New PIN" value="****" />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>Change your transaction approval PIN.</p>
      </ConfirmDialog>
    );
  },
});

// ─── remove_pin ─────────────────────────────────────────────────────────────

const removePinTool = defineTool({
  name: "remove_pin",
  description: "Remove the transaction approval PIN. Requires the current PIN to confirm.",
  inputSchema: z.object({
    pin: z.string().describe("The current PIN to confirm removal"),
  }),
  displayPropsSchema: z.object({}),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait({});
    if (!confirmed) return { status: "success", data: "PIN removal cancelled." };
    try {
      const data = await callApi("/security/approval/pin", { method: "DELETE", body: { pin: input.pin } });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ resolve }) {
    return (
      <ConfirmDialog title="Remove Transaction PIN" variant="danger" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="PIN" value="****" />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>This will remove your transaction approval PIN. You will no longer need a PIN to approve transactions.</p>
      </ConfirmDialog>
    );
  },
});

// ─── register_passkey ───────────────────────────────────────────────────────

const registerPasskeyTool: ToolConfig = {
  name: "register_passkey",
  description: "Get WebAuthn registration options to register a new passkey for transaction approval. The frontend handles the WebAuthn ceremony.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/security/approval/passkey/register", { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── verify_passkey_registration ────────────────────────────────────────────

const verifyPasskeyRegistrationTool: ToolConfig = {
  name: "verify_passkey_registration",
  description: "Complete passkey registration by verifying the WebAuthn credential response.",
  inputSchema: z.object({
    credential: z.any().describe("The WebAuthn credential response from the browser"),
  }),
  async do(input) {
    try {
      const data = await callApi("/security/approval/passkey/register/verify", { method: "POST", body: { credential: input.credential } });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── remove_passkey ─────────────────────────────────────────────────────────

const removePasskeyTool = defineTool({
  name: "remove_passkey",
  description: "Remove a registered passkey by its ID.",
  inputSchema: z.object({
    id: z.string().describe("The passkey ID to remove"),
  }),
  displayPropsSchema: z.object({
    id: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait({ id: input.id });
    if (!confirmed) return { status: "success", data: "Passkey removal cancelled." };
    try {
      const data = await callApi(`/security/approval/passkeys/${input.id}`, { method: "DELETE" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Remove Passkey" variant="danger" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Passkey ID" value={props.id} mono />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>This will permanently remove this passkey. This action cannot be undone.</p>
      </ConfirmDialog>
    );
  },
});

// ─── verify_approval ────────────────────────────────────────────────────────

const verifyApprovalTool: ToolConfig = {
  name: "verify_approval",
  description: "Verify the user's identity and get an approval token for authorizing transactions. Use method 'pin' with a PIN, or method 'passkey' with a credential.",
  inputSchema: z.object({
    method: z.enum(["pin", "passkey"]).describe("Approval method: 'pin' or 'passkey'"),
    pin: z.string().optional().describe("The PIN, required when method is 'pin'"),
  }),
  async do(input) {
    try {
      const body: { method: string; pin?: string } = { method: input.method };
      if (input.method === "pin" && input.pin) {
        body.pin = input.pin;
      }
      const data = await callApi("/security/approval/verify", { method: "POST", body });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── disable_approval ───────────────────────────────────────────────────────

const disableApprovalTool = defineTool({
  name: "disable_approval",
  description: "Disable transaction approval entirely. Requires current PIN or passkey credential for confirmation.",
  inputSchema: z.object({
    pin: z.string().optional().describe("The current PIN, if using PIN-based approval"),
  }),
  displayPropsSchema: z.object({
    hasPin: z.boolean(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait({ hasPin: !!input.pin });
    if (!confirmed) return { status: "success", data: "Disable approval cancelled." };
    try {
      const body: { pin?: string } = {};
      if (input.pin) {
        body.pin = input.pin;
      }
      const data = await callApi("/security/approval", { method: "DELETE", body });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ resolve }) {
    return (
      <ConfirmDialog title="Disable Transaction Approval" variant="danger" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          This will disable transaction approval security. Transactions will no longer require PIN or passkey verification.
        </p>
        <p style={{ color: "var(--exo-red, #ef4444)", fontSize: 13, marginTop: 8, fontWeight: 700 }}>
          This reduces the security of your account. Are you sure?
        </p>
      </ConfirmDialog>
    );
  },
});

// ─── Export ──────────────────────────────────────────────────────────────────

export const securityTools: ToolConfig[] = [
  getApprovalSettingsTool,
  listPasskeysTool,
  setupPinTool,
  changePinTool,
  removePinTool,
  registerPasskeyTool,
  verifyPasskeyRegistrationTool,
  removePasskeyTool,
  verifyApprovalTool,
  disableApprovalTool,
];
