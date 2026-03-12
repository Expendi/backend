import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow, TokenAmount } from "./components";

interface SavingsGoal {
  id: string;
  name: string;
  status: string;
  currentAmount: string;
  targetAmount: string;
  currency: string;
  targetDate: string | null;
  autoDeposit: boolean;
  autoDepositAmount: string | null;
  autoDepositFrequency: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Deposit {
  id: string;
  goalId: string;
  amount: string;
  source: string;
  createdAt: string;
}

const listSavingsGoalsTool: ToolConfig = {
  name: "list_savings_goals",
  description: "List all savings goals for the current user. Shows goal name, status, progress, and target date.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/goal-savings");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const getSavingsGoalTool: ToolConfig = {
  name: "get_savings_goal",
  description: "Get full details of a specific savings goal by ID, including progress and auto-deposit settings.",
  inputSchema: z.object({ id: z.string().describe("Savings goal ID") }),
  async do(input) {
    try {
      const data = await callApi(`/goal-savings/${input.id}`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const getSavingsDepositsTool: ToolConfig = {
  name: "get_savings_deposits",
  description: "List all deposits for a specific savings goal.",
  inputSchema: z.object({ id: z.string().describe("Savings goal ID") }),
  async do(input) {
    try {
      const data = await callApi(`/goal-savings/${input.id}/deposits`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const createSavingsGoalTool = defineTool({
  name: "create_savings_goal",
  description: "Create a new savings goal with a target amount, currency, and optional auto-deposit schedule.",
  inputSchema: z.object({
    name: z.string().describe("Goal name"),
    targetAmount: z.string().describe("Target amount to save"),
    currency: z.string().describe("Currency (e.g. USDC)"),
    targetDate: z.string().optional().describe("Target date in ISO format"),
    autoDeposit: z.boolean().optional().describe("Enable auto deposits"),
    autoDepositAmount: z.string().optional().describe("Auto deposit amount per interval"),
    autoDepositFrequency: z.string().optional().describe("Auto deposit frequency (e.g. 7d, 30d)"),
  }),
  displayPropsSchema: z.object({
    name: z.string(),
    targetAmount: z.string(),
    currency: z.string(),
    targetDate: z.string().optional(),
    autoDeposit: z.boolean().optional(),
    autoDepositAmount: z.string().optional(),
    autoDepositFrequency: z.string().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Goal creation cancelled." };
    try {
      const data = await callApi("/goal-savings", { method: "POST", body: input });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Create Savings Goal" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Name" value={props.name} />
        <KVRow label="Target" value={<TokenAmount amount={props.targetAmount} symbol={props.currency} />} />
        <KVRow label="Currency" value={props.currency} />
        {props.targetDate && <KVRow label="Target Date" value={new Date(props.targetDate).toLocaleDateString()} />}
        {props.autoDeposit && <KVRow label="Auto Deposit" value="Enabled" />}
        {props.autoDeposit && props.autoDepositAmount && (
          <KVRow label="Auto Amount" value={<TokenAmount amount={props.autoDepositAmount} symbol={props.currency} />} />
        )}
        {props.autoDeposit && props.autoDepositFrequency && (
          <KVRow label="Frequency" value={props.autoDepositFrequency} />
        )}
      </ConfirmDialog>
    );
  },
});

const depositToGoalTool = defineTool({
  name: "deposit_to_goal",
  description: "Make a manual deposit to a savings goal.",
  inputSchema: z.object({
    id: z.string().describe("Savings goal ID"),
    amount: z.string().describe("Amount to deposit"),
  }),
  displayPropsSchema: z.object({
    id: z.string(),
    amount: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Deposit cancelled." };
    try {
      const data = await callApi(`/goal-savings/${input.id}/deposit`, { method: "POST", body: { amount: input.amount } });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Deposit to Goal" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Goal ID" value={props.id} mono />
        <KVRow label="Amount" value={<TokenAmount amount={props.amount} />} />
      </ConfirmDialog>
    );
  },
});

const updateSavingsGoalTool = defineTool({
  name: "update_savings_goal",
  description: "Update a savings goal's name, target amount, or target date.",
  inputSchema: z.object({
    id: z.string().describe("Savings goal ID"),
    name: z.string().optional().describe("New goal name"),
    targetAmount: z.string().optional().describe("New target amount"),
    targetDate: z.string().optional().describe("New target date in ISO format"),
  }),
  displayPropsSchema: z.object({
    id: z.string(),
    name: z.string().optional(),
    targetAmount: z.string().optional(),
    targetDate: z.string().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Update cancelled." };
    try {
      const { id, ...body } = input;
      const data = await callApi(`/goal-savings/${id}`, { method: "PATCH", body });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Update Savings Goal" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Goal ID" value={props.id} mono />
        {props.name !== undefined && <KVRow label="New Name" value={props.name} />}
        {props.targetAmount !== undefined && <KVRow label="New Target" value={<TokenAmount amount={props.targetAmount} />} />}
        {props.targetDate !== undefined && <KVRow label="New Target Date" value={new Date(props.targetDate).toLocaleDateString()} />}
      </ConfirmDialog>
    );
  },
});

const pauseSavingsGoalTool = defineTool({
  name: "pause_savings_goal",
  description: "Pause an active savings goal. Auto-deposits will be suspended.",
  inputSchema: z.object({
    id: z.string().describe("Savings goal ID"),
  }),
  displayPropsSchema: z.object({
    id: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Pause cancelled." };
    try {
      const data = await callApi(`/goal-savings/${input.id}/pause`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Pause Savings Goal" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Goal ID" value={props.id} mono />
        <p style={{ color: "var(--text-secondary)", fontSize: 12, margin: "8px 0 0" }}>
          Auto-deposits will be suspended until the goal is resumed.
        </p>
      </ConfirmDialog>
    );
  },
});

const resumeSavingsGoalTool = defineTool({
  name: "resume_savings_goal",
  description: "Resume a paused savings goal. Auto-deposits will restart.",
  inputSchema: z.object({
    id: z.string().describe("Savings goal ID"),
  }),
  displayPropsSchema: z.object({
    id: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Resume cancelled." };
    try {
      const data = await callApi(`/goal-savings/${input.id}/resume`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Resume Savings Goal" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Goal ID" value={props.id} mono />
        <p style={{ color: "var(--text-secondary)", fontSize: 12, margin: "8px 0 0" }}>
          Auto-deposits will restart on the next scheduled interval.
        </p>
      </ConfirmDialog>
    );
  },
});

const cancelSavingsGoalTool = defineTool({
  name: "cancel_savings_goal",
  description: "Cancel a savings goal permanently. This action cannot be undone.",
  inputSchema: z.object({
    id: z.string().describe("Savings goal ID"),
  }),
  displayPropsSchema: z.object({
    id: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancellation aborted." };
    try {
      const data = await callApi(`/goal-savings/${input.id}/cancel`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Cancel Savings Goal" variant="danger" onConfirm={() => resolve(true)} onCancel={() => resolve(false)} confirmLabel="Cancel Goal">
        <KVRow label="Goal ID" value={props.id} mono />
        <p style={{ color: "var(--text-secondary)", fontSize: 12, margin: "8px 0 0" }}>
          This will permanently cancel the goal. Any deposited funds will need to be withdrawn separately.
        </p>
      </ConfirmDialog>
    );
  },
});

export const savingsTools: ToolConfig[] = [
  listSavingsGoalsTool,
  getSavingsGoalTool,
  getSavingsDepositsTool,
  createSavingsGoalTool,
  depositToGoalTool,
  updateSavingsGoalTool,
  pauseSavingsGoalTool,
  resumeSavingsGoalTool,
  cancelSavingsGoalTool,
];
