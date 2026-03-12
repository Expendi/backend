import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow, Address, WalletBadge } from "./components";

const listTransactionsTool: ToolConfig = {
  name: "list_transactions",
  description: "List recent transactions. Supports filtering by status, wallet type, and pagination.",
  inputSchema: z.object({
    limit: z.number().optional().describe("Max results (default 20)"),
    offset: z.number().optional().describe("Pagination offset"),
    status: z.string().optional().describe("Filter: pending, submitted, confirmed, failed"),
    walletType: z.string().optional().describe("Filter: user, server, agent"),
  }),
  async do(input) {
    try {
      const data = await callApi("/transactions", { query: input as Record<string, string | number | undefined> });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const contractCallTool = defineTool({
  name: "contract_call",
  description: "Execute a smart contract call (ERC20 transfer, approve, etc.).",
  inputSchema: z.object({
    walletType: z.enum(["user", "server", "agent"]).describe("Which wallet to use"),
    contractName: z.string().describe("Contract: 'ERC20', 'ERC721', etc."),
    method: z.string().describe("Method: 'transfer', 'approve', etc."),
    args: z.array(z.any()).describe("Method arguments"),
    value: z.string().optional().describe("ETH value in wei"),
  }),
  displayPropsSchema: z.object({
    walletType: z.string(),
    contractName: z.string(),
    method: z.string(),
    args: z.array(z.any()),
    value: z.string().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Contract call cancelled." };
    try {
      const data = await callApi("/transactions/contract", { method: "POST", body: input });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Contract Call" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Contract" value={props.contractName} />
        <KVRow label="Method" value={<span style={{ fontFamily: "var(--font-mono)", color: "var(--exo-sky)" }}>{props.method}()</span>} />
        <KVRow label="Wallet" value={<WalletBadge type={props.walletType} />} />
        <div style={{ marginTop: 8, padding: 8, background: "var(--bg-elevated)", borderRadius: "var(--radius)", fontFamily: "var(--font-mono)", fontSize: 11, maxHeight: 100, overflow: "auto" }}>
          {JSON.stringify(props.args, null, 2)}
        </div>
        {props.value && <KVRow label="ETH Value" value={`${props.value} wei`} />}
      </ConfirmDialog>
    );
  },
});

const rawTransactionTool = defineTool({
  name: "raw_transaction",
  description: "Send a raw blockchain transaction.",
  inputSchema: z.object({
    walletType: z.enum(["user", "server", "agent"]).describe("Which wallet"),
    to: z.string().describe("Destination address"),
    data: z.string().optional().describe("Calldata hex"),
    value: z.string().optional().describe("ETH value in wei"),
    sponsor: z.boolean().optional().describe("Sponsor gas"),
  }),
  displayPropsSchema: z.object({
    walletType: z.string(),
    to: z.string(),
    data: z.string().optional(),
    value: z.string().optional(),
    sponsor: z.boolean().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Transaction cancelled." };
    try {
      const data = await callApi("/transactions/raw", { method: "POST", body: input });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Raw Transaction" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="To" value={<Address value={props.to} />} />
        <KVRow label="Wallet" value={<WalletBadge type={props.walletType} />} />
        {props.value && <KVRow label="Value" value={`${props.value} wei`} />}
        {props.sponsor && <KVRow label="Gas" value={<span className="tag-exo status-active">sponsored</span>} />}
        {props.data && <div style={{ marginTop: 8, padding: 8, background: "var(--bg-elevated)", borderRadius: "var(--radius)", fontFamily: "var(--font-mono)", fontSize: 10, wordBreak: "break-all", maxHeight: 60, overflow: "auto" }}>{props.data}</div>}
      </ConfirmDialog>
    );
  },
});

export const transactionTools: ToolConfig[] = [listTransactionsTool, contractCallTool, rawTransactionTool];
