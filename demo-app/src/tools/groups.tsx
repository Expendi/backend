import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow, Address, TokenAmount } from "./components";

// ─── Read-only Group Tools ───────────────────────────────────────────────────

const listGroupsTool: ToolConfig = {
  name: "list_groups",
  description: "List all groups the current user belongs to. Shows group name, member count, and role.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/groups");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const getGroupTool: ToolConfig = {
  name: "get_group",
  description: "Get full details of a group including its members, addresses, and usernames.",
  inputSchema: z.object({ groupId: z.string().describe("Group ID") }),
  async do(input) {
    try {
      const data = await callApi(`/groups/${input.groupId}`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const getGroupBalanceTool: ToolConfig = {
  name: "get_group_balance",
  description: "Get the balance breakdown for a group account, showing each member's contribution and the total.",
  inputSchema: z.object({ groupId: z.string().describe("Group ID") }),
  async do(input) {
    try {
      const data = await callApi(`/groups/${input.groupId}/balance`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── Mutating Group Tools ────────────────────────────────────────────────────

const createGroupTool = defineTool({
  name: "create_group",
  description: "Create a new group account. The creating user becomes the admin.",
  inputSchema: z.object({
    name: z.string().describe("Group name"),
    description: z.string().optional().describe("Group description"),
  }),
  displayPropsSchema: z.object({
    name: z.string(),
    description: z.string().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi("/groups", { method: "POST", body: input });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Create Group" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Name" value={props.name} />
        {props.description && <KVRow label="Description" value={props.description} />}
      </ConfirmDialog>
    );
  },
});

const addGroupMemberTool = defineTool({
  name: "add_group_member",
  description: "Add a member to a group by wallet address or username. Only the group admin can add members.",
  inputSchema: z.object({
    groupId: z.string().describe("Group ID"),
    identifier: z.string().describe("Member wallet address or username"),
  }),
  displayPropsSchema: z.object({
    groupId: z.string(),
    identifier: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi(`/groups/${input.groupId}/members`, { method: "POST", body: { identifier: input.identifier } });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Add Group Member" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Group ID" value={props.groupId} mono />
        <KVRow label="Member" value={props.identifier.startsWith("0x") ? <Address value={props.identifier} /> : props.identifier} />
      </ConfirmDialog>
    );
  },
});

const removeGroupMemberTool = defineTool({
  name: "remove_group_member",
  description: "Remove a member from a group by wallet address or username. Only the group admin can remove members.",
  inputSchema: z.object({
    groupId: z.string().describe("Group ID"),
    identifier: z.string().describe("Member wallet address or username to remove"),
  }),
  displayPropsSchema: z.object({
    groupId: z.string(),
    identifier: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi(`/groups/${input.groupId}/members/${input.identifier}`, { method: "DELETE" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Remove Group Member" variant="danger" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Group ID" value={props.groupId} mono />
        <KVRow label="Member" value={props.identifier.startsWith("0x") ? <Address value={props.identifier} /> : props.identifier} />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>This member will be removed from the group.</p>
      </ConfirmDialog>
    );
  },
});

const groupDepositTool = defineTool({
  name: "group_deposit",
  description: "Deposit tokens into a group account.",
  inputSchema: z.object({
    groupId: z.string().describe("Group ID"),
    amount: z.string().describe("Amount in base units"),
    tokenAddress: z.string().optional().describe("Token contract address (default: USDC)"),
  }),
  displayPropsSchema: z.object({
    groupId: z.string(),
    amount: z.string(),
    tokenAddress: z.string().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi(`/groups/${input.groupId}/deposit`, { method: "POST", body: { amount: input.amount, tokenAddress: input.tokenAddress } });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Group Deposit" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Group ID" value={props.groupId} mono />
        <KVRow label="Amount" value={<TokenAmount amount={props.amount} symbol={props.tokenAddress ? undefined : "USDC"} decimals={props.tokenAddress ? undefined : 6} />} />
        {props.tokenAddress && <KVRow label="Token" value={<Address value={props.tokenAddress} />} />}
      </ConfirmDialog>
    );
  },
});

const groupPayoutTool = defineTool({
  name: "group_payout",
  description: "Admin payout from a group account to a specific address.",
  inputSchema: z.object({
    groupId: z.string().describe("Group ID"),
    to: z.string().describe("Recipient wallet address"),
    amount: z.string().describe("Amount in base units"),
    tokenAddress: z.string().optional().describe("Token contract address (default: USDC)"),
  }),
  displayPropsSchema: z.object({
    groupId: z.string(),
    to: z.string(),
    amount: z.string(),
    tokenAddress: z.string().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi(`/groups/${input.groupId}/pay`, { method: "POST", body: { to: input.to, amount: input.amount, tokenAddress: input.tokenAddress } });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Group Payout" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Group ID" value={props.groupId} mono />
        <KVRow label="To" value={<Address value={props.to} />} />
        <KVRow label="Amount" value={<TokenAmount amount={props.amount} symbol={props.tokenAddress ? undefined : "USDC"} decimals={props.tokenAddress ? undefined : 6} />} />
        {props.tokenAddress && <KVRow label="Token" value={<Address value={props.tokenAddress} />} />}
      </ConfirmDialog>
    );
  },
});

const transferGroupAdminTool = defineTool({
  name: "transfer_group_admin",
  description: "Transfer the admin role of a group to another member by address or username.",
  inputSchema: z.object({
    groupId: z.string().describe("Group ID"),
    newAdmin: z.string().describe("New admin wallet address or username"),
  }),
  displayPropsSchema: z.object({
    groupId: z.string(),
    newAdmin: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi(`/groups/${input.groupId}/transfer-admin`, { method: "POST", body: { newAdmin: input.newAdmin } });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Transfer Admin Role" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Group ID" value={props.groupId} mono />
        <KVRow label="New Admin" value={props.newAdmin.startsWith("0x") ? <Address value={props.newAdmin} /> : props.newAdmin} />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>You will lose admin privileges for this group.</p>
      </ConfirmDialog>
    );
  },
});

// ─── Read-only Split Expense Tools ───────────────────────────────────────────

const listSplitExpensesTool: ToolConfig = {
  name: "list_split_expenses",
  description: "List all split expenses the current user is involved in, showing status, total amount, and share count.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/split-expenses");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const getSplitExpenseTool: ToolConfig = {
  name: "get_split_expense",
  description: "Get full details of a split expense including all shares and payment status for each participant.",
  inputSchema: z.object({ id: z.string().describe("Split expense ID") }),
  async do(input) {
    try {
      const data = await callApi(`/split-expenses/${input.id}`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── Mutating Split Expense Tools ────────────────────────────────────────────

const createSplitExpenseTool = defineTool({
  name: "create_split_expense",
  description: "Create a new split expense within a group. Define the total amount and how it is divided among members.",
  inputSchema: z.object({
    groupId: z.string().describe("Group ID"),
    description: z.string().describe("Expense description"),
    amount: z.string().describe("Total amount in base units"),
    tokenAddress: z.string().optional().describe("Token contract address (default: USDC)"),
    shares: z.array(z.object({
      userId: z.string().describe("User ID of the member"),
      amount: z.string().describe("Share amount in base units"),
    })).describe("How the expense is split among members"),
  }),
  displayPropsSchema: z.object({
    groupId: z.string(),
    description: z.string(),
    amount: z.string(),
    tokenAddress: z.string().optional(),
    shares: z.array(z.object({
      userId: z.string(),
      amount: z.string(),
    })),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi("/split-expenses", { method: "POST", body: input });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Create Split Expense" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Group ID" value={props.groupId} mono />
        <KVRow label="Description" value={props.description} />
        <KVRow label="Total" value={<TokenAmount amount={props.amount} symbol={props.tokenAddress ? undefined : "USDC"} decimals={props.tokenAddress ? undefined : 6} />} />
        {props.tokenAddress && <KVRow label="Token" value={<Address value={props.tokenAddress} />} />}
        <div style={{ marginTop: 8 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Shares ({props.shares.length})</div>
          {props.shares.map((s, i) => (
            <div key={s.userId ?? i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>{s.userId}</span>
              <TokenAmount amount={s.amount} />
            </div>
          ))}
        </div>
      </ConfirmDialog>
    );
  },
});

const paySplitExpenseTool = defineTool({
  name: "pay_split_expense",
  description: "Pay your share of a split expense.",
  inputSchema: z.object({
    id: z.string().describe("Split expense ID"),
  }),
  displayPropsSchema: z.object({
    id: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi(`/split-expenses/${input.id}/pay`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Pay Split Expense" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Expense ID" value={props.id} mono />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>Pay your share of this split expense?</p>
      </ConfirmDialog>
    );
  },
});

const cancelSplitExpenseTool = defineTool({
  name: "cancel_split_expense",
  description: "Cancel a split expense. Only the creator of the expense can cancel it.",
  inputSchema: z.object({
    id: z.string().describe("Split expense ID"),
  }),
  displayPropsSchema: z.object({
    id: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi(`/split-expenses/${input.id}`, { method: "DELETE" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Cancel Split Expense" variant="danger" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Expense ID" value={props.id} mono />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>This will cancel the split expense. This action cannot be undone.</p>
      </ConfirmDialog>
    );
  },
});

// ─── Export ──────────────────────────────────────────────────────────────────

export const groupTools: ToolConfig[] = [
  listGroupsTool,
  getGroupTool,
  getGroupBalanceTool,
  createGroupTool,
  addGroupMemberTool,
  removeGroupMemberTool,
  groupDepositTool,
  groupPayoutTool,
  transferGroupAdminTool,
  listSplitExpensesTool,
  getSplitExpenseTool,
  createSplitExpenseTool,
  paySplitExpenseTool,
  cancelSplitExpenseTool,
];
