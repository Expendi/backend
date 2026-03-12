import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow, WalletBadge, TokenAmount } from "./components";

const listWalletsTool: ToolConfig = {
  name: "list_wallets",
  description: "List all wallets for the current user. Shows user, server, and agent wallets with addresses.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/wallets");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const getWalletTool: ToolConfig = {
  name: "get_wallet",
  description: "Get details of a specific wallet by ID.",
  inputSchema: z.object({ walletId: z.string().describe("Wallet ID") }),
  async do(input) {
    try {
      const data = await callApi(`/wallets/${input.walletId}`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const createUserWalletTool = defineTool({
  name: "create_user_wallet",
  description: "Create a new user wallet.",
  inputSchema: z.object({}),
  displayPropsSchema: z.object({}),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(_input, display) {
    const confirmed = await display.pushAndWait({});
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi("/wallets/user", { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ resolve }) {
    return (
      <ConfirmDialog title="Create Wallet" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <p>Create a new user wallet?</p>
      </ConfirmDialog>
    );
  },
});

const signMessageTool: ToolConfig = {
  name: "sign_message",
  description: "Sign a message with a wallet.",
  inputSchema: z.object({
    walletId: z.string().describe("Wallet ID"),
    message: z.string().describe("Message to sign"),
  }),
  async do(input) {
    try {
      const data = await callApi(`/wallets/${input.walletId}/sign`, { method: "POST", body: { message: input.message } });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const transferTokensTool = defineTool({
  name: "transfer_tokens",
  description: "Transfer tokens between wallets (inter-wallet). Use 'from' and 'to' as wallet types: 'user', 'server', or 'agent'. Amount is in token base units (e.g. 1000000 = 1 USDC).",
  inputSchema: z.object({
    from: z.enum(["user", "server", "agent"]).describe("Source wallet type"),
    to: z.enum(["user", "server", "agent"]).describe("Destination wallet type"),
    amount: z.string().describe("Amount in base units"),
    token: z.string().optional().describe("Token symbol: 'USDC' or 'USDT' (default: USDC). ETH inter-wallet transfers are not supported — use raw_transaction instead."),
  }),
  displayPropsSchema: z.object({
    from: z.string(),
    to: z.string(),
    amount: z.string(),
    token: z.string().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Transfer cancelled." };
    try {
      // Normalize token to lowercase contract registry name (backend expects "usdc" not "USDC")
      const body = { ...input, token: input.token?.toLowerCase() };
      const data = await callApi("/wallets/transfer", { method: "POST", body });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Transfer Tokens" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <WalletBadge type={props.from} />
          <span style={{ color: "var(--text-muted)" }}>&rarr;</span>
          <WalletBadge type={props.to} />
        </div>
        <KVRow label="Amount" value={<TokenAmount amount={props.amount} symbol={props.token?.toUpperCase() ?? "USDC"} decimals={props.token?.toUpperCase() === "USDT" ? 6 : 6} />} />
        {props.token && <KVRow label="Token" value={props.token.toUpperCase()} />}
      </ConfirmDialog>
    );
  },
});

export const walletTools: ToolConfig[] = [listWalletsTool, getWalletTool, createUserWalletTool, signMessageTool, transferTokensTool];
