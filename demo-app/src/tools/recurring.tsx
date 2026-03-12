import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow, Address, TokenAmount, WalletBadge } from "./components";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RecurringSchedule {
  id: string;
  status: string;
  label: string | null;
  walletType: string;
  to: string;
  amount: string;
  tokenAddress: string;
  frequency: string;
  categoryId: string | null;
  nextExecutionAt: string | null;
  createdAt: string;
}

interface RecurringExecution {
  id: string;
  scheduleId: string;
  status: string;
  txHash: string | null;
  executedAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatFrequency(freq: string): string {
  const match = freq.match(/^(\d+)([dhwm])$/);
  if (!match) return freq;
  const [, count, unit] = match;
  const labels: Record<string, string> = { d: "day", h: "hour", w: "week", m: "month" };
  const label = labels[unit] ?? unit;
  return Number(count) === 1 ? `Every ${label}` : `Every ${count} ${label}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Read Tools ─────────────────────────────────────────────────────────────

const listRecurringPaymentsTool: ToolConfig = {
  name: "list_recurring_payments",
  description: "List the user's recurring payment schedules. Shows status, label, frequency, and next execution date.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/recurring-payments");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const getRecurringPaymentTool: ToolConfig = {
  name: "get_recurring_payment",
  description: "Get details of a specific recurring payment schedule by ID.",
  inputSchema: z.object({ id: z.string().describe("Recurring payment schedule ID") }),
  async do(input) {
    try {
      const data = await callApi(`/recurring-payments/${input.id}`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const getRecurringExecutionsTool: ToolConfig = {
  name: "get_recurring_executions",
  description: "Get the execution history for a specific recurring payment schedule.",
  inputSchema: z.object({ id: z.string().describe("Recurring payment schedule ID") }),
  async do(input) {
    try {
      const data = await callApi(`/recurring-payments/${input.id}/executions`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── Mutating Tools ─────────────────────────────────────────────────────────

const createRecurringPaymentTool = defineTool({
  name: "create_recurring_payment",
  description: "Create a new recurring payment schedule. Frequency uses shorthand: '1d' (daily), '7d' (weekly), '30d' (monthly).",
  inputSchema: z.object({
    walletType: z.enum(["user", "server", "agent"]).describe("Which wallet to send from"),
    to: z.string().describe("Recipient address"),
    amount: z.string().describe("Amount in token base units"),
    tokenAddress: z.string().describe("Token contract address"),
    frequency: z.string().describe("Frequency shorthand: '1d', '7d', '30d', etc."),
    label: z.string().optional().describe("Human-readable label for this schedule"),
    categoryId: z.string().optional().describe("Category ID for tracking"),
  }),
  displayPropsSchema: z.object({
    walletType: z.string(),
    to: z.string(),
    amount: z.string(),
    tokenAddress: z.string(),
    frequency: z.string(),
    label: z.string().optional(),
    categoryId: z.string().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi("/recurring-payments", { method: "POST", body: input });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Create Recurring Payment" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        {props.label && <KVRow label="Label" value={props.label} />}
        <KVRow label="Recipient" value={<Address value={props.to} />} />
        <KVRow label="Amount" value={<TokenAmount amount={props.amount} />} />
        <KVRow label="Token" value={<Address value={props.tokenAddress} />} />
        <KVRow label="Frequency" value={formatFrequency(props.frequency)} />
        <KVRow label="Wallet" value={<WalletBadge type={props.walletType} />} />
        {props.categoryId && <KVRow label="Category" value={props.categoryId} />}
      </ConfirmDialog>
    );
  },
});

const pauseRecurringPaymentTool = defineTool({
  name: "pause_recurring_payment",
  description: "Pause an active recurring payment schedule.",
  inputSchema: z.object({ id: z.string().describe("Recurring payment schedule ID") }),
  displayPropsSchema: z.object({ id: z.string() }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi(`/recurring-payments/${input.id}/pause`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Pause Recurring Payment" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Schedule ID" value={props.id} mono />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "8px 0 0" }}>This will pause all future executions until resumed.</p>
      </ConfirmDialog>
    );
  },
});

const resumeRecurringPaymentTool = defineTool({
  name: "resume_recurring_payment",
  description: "Resume a paused recurring payment schedule.",
  inputSchema: z.object({ id: z.string().describe("Recurring payment schedule ID") }),
  displayPropsSchema: z.object({ id: z.string() }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi(`/recurring-payments/${input.id}/resume`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Resume Recurring Payment" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Schedule ID" value={props.id} mono />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "8px 0 0" }}>This will resume scheduled executions.</p>
      </ConfirmDialog>
    );
  },
});

const cancelRecurringPaymentTool = defineTool({
  name: "cancel_recurring_payment",
  description: "Permanently cancel a recurring payment schedule. This cannot be undone.",
  inputSchema: z.object({ id: z.string().describe("Recurring payment schedule ID") }),
  displayPropsSchema: z.object({ id: z.string() }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi(`/recurring-payments/${input.id}/cancel`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Cancel Recurring Payment" variant="danger" confirmLabel="Cancel Payment" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Schedule ID" value={props.id} mono />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "8px 0 0" }}>This will permanently cancel this recurring payment. This action cannot be undone.</p>
      </ConfirmDialog>
    );
  },
});

// ─── Export ──────────────────────────────────────────────────────────────────

export const recurringTools: ToolConfig[] = [
  listRecurringPaymentsTool,
  getRecurringPaymentTool,
  getRecurringExecutionsTool,
  createRecurringPaymentTool,
  pauseRecurringPaymentTool,
  resumeRecurringPaymentTool,
  cancelRecurringPaymentTool,
];
