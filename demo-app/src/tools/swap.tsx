import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow, TokenAmount, Address, WalletBadge } from "./components";

// ─── check_swap_approval ─────────────────────────────────────────────────────

const checkSwapApprovalTool: ToolConfig = {
  name: "check_swap_approval",
  description: "Check if a token approval is needed before performing a Uniswap swap.",
  inputSchema: z.object({
    tokenAddress: z.string().describe("Token contract address to check approval for"),
    walletType: z.enum(["user", "server", "agent"]).describe("Which wallet to check approval for"),
  }),
  async do(input) {
    try {
      const data = await callApi("/uniswap/check-approval", { method: "POST", body: input });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── get_swap_quote ──────────────────────────────────────────────────────────

const getSwapQuoteTool: ToolConfig = {
  name: "get_swap_quote",
  description: "Get a Uniswap swap quote showing expected output amount, price impact, and gas estimate.",
  inputSchema: z.object({
    tokenIn: z.string().describe("Input token contract address"),
    tokenOut: z.string().describe("Output token contract address"),
    amountIn: z.string().describe("Input amount in base units"),
    walletType: z.enum(["user", "server", "agent"]).describe("Which wallet to use for the swap"),
  }),
  async do(input) {
    try {
      const data = await callApi("/uniswap/quote", { method: "POST", body: input });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── execute_swap ────────────────────────────────────────────────────────────

const executeSwapTool = defineTool({
  name: "execute_swap",
  description: "Execute a token swap on Uniswap. Requires user confirmation before execution.",
  inputSchema: z.object({
    tokenIn: z.string().describe("Input token contract address"),
    tokenOut: z.string().describe("Output token contract address"),
    amountIn: z.string().describe("Input amount in base units"),
    slippage: z.number().optional().describe("Slippage tolerance percentage (e.g. 0.5 for 0.5%)"),
    walletType: z.enum(["user", "server", "agent"]).describe("Which wallet to use"),
  }),
  displayPropsSchema: z.object({
    tokenIn: z.string(),
    tokenOut: z.string(),
    amountIn: z.string(),
    slippage: z.number().optional(),
    walletType: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Swap cancelled." };
    try {
      const data = await callApi("/uniswap/swap", { method: "POST", body: input });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Execute Swap" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Token In" value={<Address value={props.tokenIn} />} />
        <KVRow label="Token Out" value={<Address value={props.tokenOut} />} />
        <KVRow label="Amount" value={<TokenAmount amount={props.amountIn} />} />
        <KVRow label="Slippage" value={props.slippage !== undefined ? `${props.slippage}%` : "default"} />
        <KVRow label="Wallet" value={<WalletBadge type={props.walletType} />} />
      </ConfirmDialog>
    );
  },
});

// ─── list_swap_automations ───────────────────────────────────────────────────

const listSwapAutomationsTool: ToolConfig = {
  name: "list_swap_automations",
  description: "List all swap automations for the current user.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/swap-automations");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── get_swap_automation ─────────────────────────────────────────────────────

const getSwapAutomationTool: ToolConfig = {
  name: "get_swap_automation",
  description: "Get full details of a specific swap automation by ID.",
  inputSchema: z.object({
    id: z.string().describe("Swap automation ID"),
  }),
  async do(input) {
    try {
      const data = await callApi(`/swap-automations/${input.id}`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── get_swap_automation_executions ──────────────────────────────────────────

const getSwapAutomationExecutionsTool: ToolConfig = {
  name: "get_swap_automation_executions",
  description: "Get the execution history for a specific swap automation.",
  inputSchema: z.object({
    id: z.string().describe("Swap automation ID"),
  }),
  async do(input) {
    try {
      const data = await callApi(`/swap-automations/${input.id}/executions`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── create_swap_automation ──────────────────────────────────────────────────

const createSwapAutomationTool = defineTool({
  name: "create_swap_automation",
  description: "Create a recurring swap automation that executes token swaps on a schedule.",
  inputSchema: z.object({
    tokenIn: z.string().describe("Input token contract address"),
    tokenOut: z.string().describe("Output token contract address"),
    amountIn: z.string().describe("Input amount in base units per execution"),
    frequency: z.string().describe("Execution frequency (e.g. 'daily', 'weekly', 'hourly')"),
    walletType: z.enum(["user", "server", "agent"]).describe("Which wallet to use"),
    label: z.string().optional().describe("Human-readable label for this automation"),
    conditions: z
      .array(
        z.object({
          type: z.string().describe("Condition type (e.g. 'price_above', 'price_below', 'gas_below')"),
          value: z.string().describe("Condition threshold value"),
        }),
      )
      .optional()
      .describe("Optional conditions that must be met before each execution"),
  }),
  displayPropsSchema: z.object({
    tokenIn: z.string(),
    tokenOut: z.string(),
    amountIn: z.string(),
    frequency: z.string(),
    walletType: z.string(),
    label: z.string().optional(),
    conditions: z
      .array(
        z.object({
          type: z.string(),
          value: z.string(),
        }),
      )
      .optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Automation creation cancelled." };
    try {
      const data = await callApi("/swap-automations", { method: "POST", body: input });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Create Swap Automation" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        {props.label && <KVRow label="Label" value={props.label} />}
        <KVRow label="Token In" value={<Address value={props.tokenIn} />} />
        <KVRow label="Token Out" value={<Address value={props.tokenOut} />} />
        <KVRow label="Amount" value={<TokenAmount amount={props.amountIn} />} />
        <KVRow label="Frequency" value={props.frequency} />
        <KVRow label="Wallet" value={<WalletBadge type={props.walletType} />} />
        {Array.isArray(props.conditions) && props.conditions.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>Conditions</div>
            {props.conditions.map((c, i) => (
              <KVRow key={i} label={c.type} value={c.value} mono />
            ))}
          </div>
        )}
      </ConfirmDialog>
    );
  },
});

// ─── pause_swap_automation ───────────────────────────────────────────────────

const pauseSwapAutomationTool = defineTool({
  name: "pause_swap_automation",
  description: "Pause a running swap automation. It can be resumed later.",
  inputSchema: z.object({
    id: z.string().describe("Swap automation ID to pause"),
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
      const data = await callApi(`/swap-automations/${input.id}/pause`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Pause Automation" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Automation ID" value={props.id} mono />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>
          This will pause the automation. No further executions will occur until it is resumed.
        </p>
      </ConfirmDialog>
    );
  },
});

// ─── resume_swap_automation ──────────────────────────────────────────────────

const resumeSwapAutomationTool = defineTool({
  name: "resume_swap_automation",
  description: "Resume a paused swap automation.",
  inputSchema: z.object({
    id: z.string().describe("Swap automation ID to resume"),
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
      const data = await callApi(`/swap-automations/${input.id}/resume`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Resume Automation" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Automation ID" value={props.id} mono />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>
          This will resume the automation and schedule the next execution.
        </p>
      </ConfirmDialog>
    );
  },
});

// ─── cancel_swap_automation ──────────────────────────────────────────────────

const cancelSwapAutomationTool = defineTool({
  name: "cancel_swap_automation",
  description: "Permanently cancel a swap automation. This action cannot be undone.",
  inputSchema: z.object({
    id: z.string().describe("Swap automation ID to cancel"),
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
      const data = await callApi(`/swap-automations/${input.id}/cancel`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog
        title="Cancel Automation"
        variant="danger"
        confirmLabel="Cancel Automation"
        onConfirm={() => resolve(true)}
        onCancel={() => resolve(false)}
      >
        <KVRow label="Automation ID" value={props.id} mono />
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>
          This will permanently cancel the automation. This action cannot be undone.
        </p>
      </ConfirmDialog>
    );
  },
});

// ─── Export ──────────────────────────────────────────────────────────────────

export const swapTools: ToolConfig[] = [
  checkSwapApprovalTool,
  getSwapQuoteTool,
  executeSwapTool,
  listSwapAutomationsTool,
  getSwapAutomationTool,
  getSwapAutomationExecutionsTool,
  createSwapAutomationTool,
  pauseSwapAutomationTool,
  resumeSwapAutomationTool,
  cancelSwapAutomationTool,
];
