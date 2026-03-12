import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow, StatusBadge, TokenAmount } from "./components";

// ─── list_yield_vaults ──────────────────────────────────────────────────────

const listYieldVaultsTool: ToolConfig = {
  name: "list_yield_vaults",
  description: "List all active yield/DeFi vaults. Shows vault name, APY, accepted token, and total value locked.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/yield/vaults");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── get_yield_vault ────────────────────────────────────────────────────────

const getYieldVaultTool: ToolConfig = {
  name: "get_yield_vault",
  description: "Get detailed information about a specific yield vault by ID.",
  inputSchema: z.object({
    id: z.string().describe("Vault ID"),
  }),
  async do(input) {
    try {
      const data = await callApi(`/api/yield/vaults/${input.id}`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── list_yield_positions ───────────────────────────────────────────────────

const listYieldPositionsTool: ToolConfig = {
  name: "list_yield_positions",
  description: "List all yield positions for the current user. Shows status, vault name, deposited amount, and maturity progress.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/yield/positions");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── get_yield_position ─────────────────────────────────────────────────────

const getYieldPositionTool: ToolConfig = {
  name: "get_yield_position",
  description: "Get detailed information about a specific yield position by ID.",
  inputSchema: z.object({
    id: z.string().describe("Position ID"),
  }),
  async do(input) {
    try {
      const data = await callApi(`/api/yield/positions/${input.id}`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── get_yield_history ──────────────────────────────────────────────────────

const getYieldHistoryTool: ToolConfig = {
  name: "get_yield_history",
  description: "Get yield snapshot history for a specific position. Shows value over time.",
  inputSchema: z.object({
    id: z.string().describe("Position ID"),
  }),
  async do(input) {
    try {
      const data = await callApi(`/api/yield/positions/${input.id}/history`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── get_yield_portfolio ────────────────────────────────────────────────────

const getYieldPortfolioTool: ToolConfig = {
  name: "get_yield_portfolio",
  description: "Get a summary of the user's yield portfolio including total deposited, total earned, and active positions count.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/yield/portfolio");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── create_yield_position ──────────────────────────────────────────────────

const createYieldPositionTool = defineTool({
  name: "create_yield_position",
  description: "Create a new yield position by depositing into a vault. Locks funds for the vault's lock period.",
  inputSchema: z.object({
    vaultId: z.string().describe("Vault ID to deposit into"),
    amount: z.string().describe("Amount to deposit in base units"),
    walletType: z.enum(["user", "server", "agent"]).describe("Wallet to fund the deposit from"),
  }),
  displayPropsSchema: z.object({
    vaultId: z.string(),
    vaultName: z.string().optional(),
    amount: z.string(),
    walletType: z.string(),
    token: z.string().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    let vaultName: string | undefined;
    let token: string | undefined;
    try {
      const vault = await callApi<{ name?: string; token?: string }>(`/api/yield/vaults/${input.vaultId}`);
      vaultName = vault.name;
      token = vault.token;
    } catch {
      // Vault lookup failed; proceed with vault ID displayed instead of name
    }
    const confirmed = await display.pushAndWait({
      vaultId: input.vaultId,
      vaultName,
      amount: input.amount,
      walletType: input.walletType,
      token,
    });
    if (!confirmed) return { status: "success", data: "Deposit cancelled." };
    try {
      const data = await callApi("/yield/positions", { method: "POST", body: input });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Create Yield Position" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Vault" value={props.vaultName ?? props.vaultId} />
        <KVRow label="Amount" value={<TokenAmount amount={props.amount} symbol={props.token} />} />
        <KVRow label="Wallet" value={props.walletType} />
      </ConfirmDialog>
    );
  },
});

// ─── withdraw_yield_position ────────────────────────────────────────────────

const withdrawYieldPositionTool = defineTool({
  name: "withdraw_yield_position",
  description: "Withdraw a matured yield position. Returns deposited funds plus earned yield to the original wallet.",
  inputSchema: z.object({
    id: z.string().describe("Position ID to withdraw"),
  }),
  displayPropsSchema: z.object({
    id: z.string(),
    vaultName: z.string().optional(),
    depositedAmount: z.string().optional(),
    earnedYield: z.string().optional(),
    token: z.string().optional(),
    status: z.string().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    let positionInfo: {
      vaultName?: string;
      depositedAmount?: string;
      earnedYield?: string;
      token?: string;
      status?: string;
    } = {};
    try {
      const position = await callApi<Record<string, unknown>>(`/api/yield/positions/${input.id}`);
      positionInfo = {
        vaultName: position.vaultName as string | undefined,
        depositedAmount: position.depositedAmount as string | undefined,
        earnedYield: position.earnedYield as string | undefined,
        token: position.token as string | undefined,
        status: position.status as string | undefined,
      };
    } catch {
      // Position lookup failed; proceed with ID only in the confirmation dialog
    }
    const confirmed = await display.pushAndWait({
      id: input.id,
      ...positionInfo,
    });
    if (!confirmed) return { status: "success", data: "Withdrawal cancelled." };
    try {
      const data = await callApi(`/api/yield/positions/${input.id}/withdraw`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Withdraw Yield Position" onConfirm={() => resolve(true)} onCancel={() => resolve(false)} variant="danger">
        <KVRow label="Position ID" value={props.id} mono />
        {props.vaultName && <KVRow label="Vault" value={props.vaultName} />}
        {props.status && <KVRow label="Status" value={<StatusBadge status={props.status} />} />}
        {props.depositedAmount && <KVRow label="Deposited" value={<TokenAmount amount={props.depositedAmount} symbol={props.token} />} />}
        {props.earnedYield && <KVRow label="Earned Yield" value={<TokenAmount amount={props.earnedYield} symbol={props.token} />} />}
      </ConfirmDialog>
    );
  },
});

// ─── Export ──────────────────────────────────────────────────────────────────

export const yieldTools: ToolConfig[] = [
  listYieldVaultsTool,
  getYieldVaultTool,
  listYieldPositionsTool,
  getYieldPositionTool,
  getYieldHistoryTool,
  getYieldPortfolioTool,
  createYieldPositionTool,
  withdrawYieldPositionTool,
];
