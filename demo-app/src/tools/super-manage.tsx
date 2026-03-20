import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow } from "./components";
import {
  TOKEN_MAP,
  toBaseUnits,
  fromBaseUnits,
  formatNumber,
  resolveRecipient,
  fetchBalances,
  getUserWallet,
  getTokenBalance,
} from "./helpers";

// ── Domain labels for display ───────────────────────────────────────────────

const DOMAIN_LABELS: Record<string, string> = {
  recurring: "Recurring Payment",
  goals: "Savings Goal",
  groups: "Group Account",
  categories: "Category",
  security: "Security Settings",
};

const ACTION_LABELS: Record<string, string> = {
  list: "List",
  get: "View",
  create: "Create",
  update: "Update",
  pause: "Pause",
  resume: "Resume",
  cancel: "Cancel",
  deposit: "Deposit to",
  withdraw: "Withdraw from",
  add_member: "Add Member to",
  remove_member: "Remove Member from",
  payout: "Payout from",
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildTitle(action: string, domain: string): string {
  const actionLabel = ACTION_LABELS[action] ?? capitalize(action);
  const domainLabel = DOMAIN_LABELS[domain] ?? capitalize(domain);
  return `${actionLabel} ${domainLabel}`;
}

// ── Determine if an action is a mutation (needs confirmation) ───────────────

const READ_ACTIONS = new Set(["list", "get"]);

function isMutation(action: string): boolean {
  return !READ_ACTIONS.has(action);
}

// ── Determine the confirm dialog variant ────────────────────────────────────

function getVariant(action: string): "primary" | "danger" {
  if (action === "cancel" || action === "remove_member") return "danger";
  return "primary";
}

// ── Recurring domain handler ────────────────────────────────────────────────

async function handleRecurring(
  action: string,
  id: string | undefined,
  params: Record<string, unknown> | undefined,
  pushAndWait: ((props: Record<string, unknown>) => Promise<boolean>) | null,
): Promise<{ status: "success" | "error"; data: string; message?: string }> {
  switch (action) {
    case "list": {
      const data = await callApi("/recurring-payments");
      return { status: "success", data: JSON.stringify(data) };
    }

    case "get": {
      if (!id) return { status: "error", data: "", message: "An id is required to view a recurring payment." };
      const data = await callApi(`/recurring-payments/${id}`);
      return { status: "success", data: JSON.stringify(data) };
    }

    case "create": {
      if (!params?.recipient) return { status: "error", data: "", message: "Missing required parameter: recipient." };
      if (!params?.amount) return { status: "error", data: "", message: "Missing required parameter: amount." };
      if (!params?.token) return { status: "error", data: "", message: "Missing required parameter: token." };
      if (!params?.frequency) return { status: "error", data: "", message: "Missing required parameter: frequency." };

      const tokenSymbol = String(params.token).toUpperCase();
      const tokenInfo = TOKEN_MAP[tokenSymbol];
      if (!tokenInfo) return { status: "error", data: "", message: `Unknown token "${params.token}". Supported tokens: ${Object.keys(TOKEN_MAP).join(", ")}` };

      // Check balance before proceeding
      const requestedAmount = Number(String(params.amount));
      let balanceWarning = "";
      try {
        const balances = await fetchBalances();
        const userWallet = getUserWallet(balances);
        if (userWallet) {
          const balanceBase = getTokenBalance(userWallet, tokenSymbol);
          const balanceHuman = Number(fromBaseUnits(balanceBase, tokenInfo.decimals));
          if (requestedAmount > balanceHuman) {
            return {
              status: "error",
              data: "",
              message: `Insufficient ${tokenSymbol} balance. You have ${formatNumber(balanceHuman)} ${tokenSymbol} but the recurring payment requires ${formatNumber(requestedAmount)} ${tokenSymbol} per cycle. Top up first or reduce the amount.`,
            };
          }
          balanceWarning = balanceHuman < requestedAmount * 2
            ? ` (current balance: ${formatNumber(balanceHuman)} ${tokenSymbol} — enough for ~${Math.floor(balanceHuman / requestedAmount)} payment${Math.floor(balanceHuman / requestedAmount) !== 1 ? "s" : ""})`
            : "";
        }
      } catch {
        // Non-fatal — proceed without balance info
      }

      const baseUnits = toBaseUnits(String(params.amount), tokenInfo.decimals);
      const resolved = await resolveRecipient(String(params.recipient));

      const summary = `Send ${params.amount} ${tokenSymbol} to ${resolved.label} ${params.frequency}${balanceWarning}`;
      const details: Record<string, string> = {
        Recipient: resolved.label,
        Amount: `${params.amount} ${tokenSymbol}`,
        Frequency: String(params.frequency),
      };
      if (balanceWarning) details["Balance Note"] = balanceWarning.trim().replace(/^\(/, "").replace(/\)$/, "");
      if (params.label) details["Label"] = String(params.label);

      if (pushAndWait) {
        const confirmed = await pushAndWait({ domain: "recurring", action, summary, details });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const name = params.label
        ? String(params.label)
        : `${params.amount} ${tokenSymbol} to ${resolved.label} (${params.frequency})`;

      // Use the new-format API shape (type: "transfer")
      const isNativeEth = tokenSymbol === "ETH";
      const data = await callApi("/recurring-payments", {
        method: "POST",
        body: {
          type: isNativeEth ? "raw_transfer" : "transfer",
          name,
          to: resolved.address,
          amount: baseUnits,
          token: isNativeEth ? undefined : tokenSymbol.toLowerCase(),
          wallet: "user",
          frequency: String(params.frequency),
        },
      });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "pause": {
      if (!id) return { status: "error", data: "", message: "An id is required to pause a recurring payment." };
      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "recurring",
          action,
          summary: "Pause all future executions until resumed.",
          details: { "Schedule ID": id },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }
      const data = await callApi(`/recurring-payments/${id}/pause`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "resume": {
      if (!id) return { status: "error", data: "", message: "An id is required to resume a recurring payment." };
      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "recurring",
          action,
          summary: "Resume scheduled executions.",
          details: { "Schedule ID": id },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }
      const data = await callApi(`/recurring-payments/${id}/resume`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "cancel": {
      if (!id) return { status: "error", data: "", message: "An id is required to cancel a recurring payment." };
      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "recurring",
          action,
          summary: "Permanently cancel this recurring payment. This cannot be undone.",
          details: { "Schedule ID": id },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }
      const data = await callApi(`/recurring-payments/${id}/cancel`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data) };
    }

    default:
      return { status: "error", data: "", message: `Unsupported action "${action}" for recurring payments. Supported: list, get, create, pause, resume, cancel.` };
  }
}

// ── Goals domain handler ────────────────────────────────────────────────────

async function handleGoals(
  action: string,
  id: string | undefined,
  params: Record<string, unknown> | undefined,
  pushAndWait: ((props: Record<string, unknown>) => Promise<boolean>) | null,
): Promise<{ status: "success" | "error"; data: string; message?: string }> {
  switch (action) {
    case "list": {
      const data = await callApi("/goal-savings");
      return { status: "success", data: JSON.stringify(data) };
    }

    case "get": {
      if (!id) return { status: "error", data: "", message: "An id is required to view a savings goal." };
      const data = await callApi(`/goal-savings/${id}`);
      return { status: "success", data: JSON.stringify(data) };
    }

    case "create": {
      if (!params?.name) return { status: "error", data: "", message: "Missing required parameter: name." };
      if (!params?.targetAmount) return { status: "error", data: "", message: "Missing required parameter: targetAmount." };
      if (!params?.currency) return { status: "error", data: "", message: "Missing required parameter: currency." };

      const details: Record<string, string> = {
        Name: String(params.name),
        "Target Amount": String(params.targetAmount),
        Currency: String(params.currency),
      };
      if (params.targetDate) details["Target Date"] = new Date(String(params.targetDate)).toLocaleDateString();
      if (params.autoDeposit) {
        details["Auto Deposit"] = "Enabled";
        if (params.autoDepositAmount) details["Auto Amount"] = String(params.autoDepositAmount);
        if (params.autoDepositFrequency) details["Auto Frequency"] = String(params.autoDepositFrequency);
      }

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "goals",
          action,
          summary: `Create a savings goal "${params.name}" targeting ${params.targetAmount} ${params.currency}.`,
          details,
        });
        if (!confirmed) return { status: "success", data: "Goal creation cancelled." };
      }

      // Resolve token info from currency (e.g. "USDC" → address, decimals)
      const currencySymbol = String(params.currency).toUpperCase();
      const goalTokenInfo = TOKEN_MAP[currencySymbol];

      const body: Record<string, unknown> = {
        name: String(params.name),
        targetAmount: String(params.targetAmount),
        walletType: "server",
      };
      if (goalTokenInfo) {
        body.tokenAddress = goalTokenInfo.address;
        body.tokenSymbol = goalTokenInfo.symbol;
        body.tokenDecimals = goalTokenInfo.decimals;
      }
      if (params.targetDate !== undefined) body.endDate = String(params.targetDate);
      if (params.autoDeposit && params.autoDepositAmount) {
        body.depositAmount = String(params.autoDepositAmount);
        body.frequency = String(params.autoDepositFrequency ?? "monthly");
      }

      const data = await callApi("/goal-savings", { method: "POST", body });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "deposit": {
      if (!id) return { status: "error", data: "", message: "An id is required to deposit to a savings goal." };
      if (!params?.amount) return { status: "error", data: "", message: "Missing required parameter: amount." };

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "goals",
          action,
          summary: `Deposit ${params.amount} to savings goal.`,
          details: { "Goal ID": id, Amount: String(params.amount) },
        });
        if (!confirmed) return { status: "success", data: "Deposit cancelled." };
      }

      const data = await callApi(`/goal-savings/${id}/deposit`, { method: "POST", body: { amount: String(params.amount) } });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "pause": {
      if (!id) return { status: "error", data: "", message: "An id is required to pause a savings goal." };
      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "goals",
          action,
          summary: "Pause this savings goal. Auto-deposits will be suspended.",
          details: { "Goal ID": id },
        });
        if (!confirmed) return { status: "success", data: "Pause cancelled." };
      }
      const data = await callApi(`/goal-savings/${id}/pause`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "resume": {
      if (!id) return { status: "error", data: "", message: "An id is required to resume a savings goal." };
      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "goals",
          action,
          summary: "Resume this savings goal. Auto-deposits will restart.",
          details: { "Goal ID": id },
        });
        if (!confirmed) return { status: "success", data: "Resume cancelled." };
      }
      const data = await callApi(`/goal-savings/${id}/resume`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "cancel": {
      if (!id) return { status: "error", data: "", message: "An id is required to cancel a savings goal." };
      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "goals",
          action,
          summary: "Permanently cancel this savings goal. Any deposited funds will need to be withdrawn separately.",
          details: { "Goal ID": id },
        });
        if (!confirmed) return { status: "success", data: "Cancellation aborted." };
      }
      const data = await callApi(`/goal-savings/${id}/cancel`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "update": {
      if (!id) return { status: "error", data: "", message: "An id is required to update a savings goal." };
      if (!params || Object.keys(params).length === 0) return { status: "error", data: "", message: "At least one parameter is required to update a savings goal (e.g. name, targetAmount, targetDate)." };

      const details: Record<string, string> = { "Goal ID": id };
      if (params.name !== undefined) details["New Name"] = String(params.name);
      if (params.targetAmount !== undefined) details["New Target"] = String(params.targetAmount);
      if (params.targetDate !== undefined) details["New Target Date"] = new Date(String(params.targetDate)).toLocaleDateString();

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "goals",
          action,
          summary: "Update savings goal settings.",
          details,
        });
        if (!confirmed) return { status: "success", data: "Update cancelled." };
      }

      const data = await callApi(`/goal-savings/${id}`, { method: "PATCH", body: params });
      return { status: "success", data: JSON.stringify(data) };
    }

    default:
      return { status: "error", data: "", message: `Unsupported action "${action}" for savings goals. Supported: list, get, create, update, deposit, pause, resume, cancel.` };
  }
}

// ── Groups domain handler ───────────────────────────────────────────────────

async function handleGroups(
  action: string,
  id: string | undefined,
  params: Record<string, unknown> | undefined,
  pushAndWait: ((props: Record<string, unknown>) => Promise<boolean>) | null,
): Promise<{ status: "success" | "error"; data: string; message?: string }> {
  switch (action) {
    case "list": {
      const data = await callApi("/groups");
      return { status: "success", data: JSON.stringify(data) };
    }

    case "get": {
      if (!id) return { status: "error", data: "", message: "An id is required to view a group." };
      const data = await callApi(`/groups/${id}`);
      return { status: "success", data: JSON.stringify(data) };
    }

    case "create": {
      if (!params?.name) return { status: "error", data: "", message: "Missing required parameter: name." };

      const details: Record<string, string> = { Name: String(params.name) };
      if (params.description) details["Description"] = String(params.description);

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "groups",
          action,
          summary: `Create a new group account named "${params.name}".`,
          details,
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const data = await callApi("/groups", { method: "POST", body: { name: String(params.name) } });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "add_member": {
      if (!id) return { status: "error", data: "", message: "An id is required to add a member to a group." };
      if (!params?.member) return { status: "error", data: "", message: "Missing required parameter: member (address or username)." };

      const memberStr = String(params.member);
      const resolved = await resolveRecipient(memberStr);

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "groups",
          action,
          summary: `Add ${resolved.label} to the group.`,
          details: { "Group ID": id, Member: resolved.label },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const data = await callApi(`/groups/${id}/members`, { method: "POST", body: { identifier: memberStr } });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "remove_member": {
      if (!id) return { status: "error", data: "", message: "An id is required to remove a member from a group." };
      if (!params?.memberId) return { status: "error", data: "", message: "Missing required parameter: memberId." };

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "groups",
          action,
          summary: "Remove this member from the group.",
          details: { "Group ID": id, "Member ID": String(params.memberId) },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const data = await callApi(`/groups/${id}/members/${params.memberId}`, { method: "DELETE" });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "deposit": {
      if (!id) return { status: "error", data: "", message: "An id is required to deposit to a group." };
      if (!params?.amount) return { status: "error", data: "", message: "Missing required parameter: amount." };

      const token = params.token ? String(params.token) : "USDC";

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "groups",
          action,
          summary: `Deposit ${params.amount} ${token} to group.`,
          details: { "Group ID": id, Amount: String(params.amount), Token: token },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const data = await callApi(`/groups/${id}/deposit`, {
        method: "POST",
        body: { amount: String(params.amount), token },
      });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "payout": {
      if (!id) return { status: "error", data: "", message: "An id is required for a group payout." };
      if (!params?.amount) return { status: "error", data: "", message: "Missing required parameter: amount." };
      if (!params?.recipient) return { status: "error", data: "", message: "Missing required parameter: recipient." };

      const resolved = await resolveRecipient(String(params.recipient));

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "groups",
          action,
          summary: `Payout ${params.amount} to ${resolved.label} from group.`,
          details: { "Group ID": id, Amount: String(params.amount), Recipient: resolved.label },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const data = await callApi(`/groups/${id}/pay`, {
        method: "POST",
        body: { amount: String(params.amount), recipientAddress: resolved.address },
      });
      return { status: "success", data: JSON.stringify(data) };
    }

    default:
      return { status: "error", data: "", message: `Unsupported action "${action}" for groups. Supported: list, get, create, add_member, remove_member, deposit, payout.` };
  }
}

// ── Categories domain handler ───────────────────────────────────────────────

async function handleCategories(
  action: string,
  id: string | undefined,
  params: Record<string, unknown> | undefined,
  pushAndWait: ((props: Record<string, unknown>) => Promise<boolean>) | null,
): Promise<{ status: "success" | "error"; data: string; message?: string }> {
  switch (action) {
    case "list": {
      const data = await callApi("/categories");
      return { status: "success", data: JSON.stringify(data) };
    }

    case "create": {
      if (!params?.name) return { status: "error", data: "", message: "Missing required parameter: name." };

      const details: Record<string, string> = { Name: String(params.name) };
      if (params.icon) details["Icon"] = String(params.icon);

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "categories",
          action,
          summary: `Create a new category "${params.name}".`,
          details,
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const body: Record<string, unknown> = { name: String(params.name) };
      if (params.icon) body.icon = String(params.icon);

      const data = await callApi("/categories", { method: "POST", body });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "update": {
      if (!id) return { status: "error", data: "", message: "An id is required to update a category." };
      if (!params || Object.keys(params).length === 0) return { status: "error", data: "", message: "At least one parameter is required to update a category." };

      const data = await callApi(`/categories/${id}`, { method: "PATCH", body: params });
      return { status: "success", data: JSON.stringify(data) };
    }

    default:
      return { status: "error", data: "", message: `Unsupported action "${action}" for categories. Supported: list, create, update.` };
  }
}

// ── Security domain handler ─────────────────────────────────────────────────

async function handleSecurity(
  action: string,
): Promise<{ status: "success" | "error"; data: string; message?: string }> {
  switch (action) {
    case "list": {
      const data = await callApi("/security/approval");
      return { status: "success", data: JSON.stringify(data) };
    }

    default:
      return {
        status: "success",
        data: JSON.stringify({
          message: "Security mutations (PIN setup, passkey registration, approval changes) require native UI interactions that cannot be performed in chat. Please use the wallet Settings page to manage security settings.",
        }),
      };
  }
}

// ── The manage super tool ───────────────────────────────────────────────────

export const manageTool: ToolConfig = defineTool({
  name: "manage",
  description:
    "Set up autopay, recurring payments, scheduled transfers, savings goals, group accounts, spending categories, and security settings. Use this for any payment automation — e.g. 'pay mom 50 USDC every month', 'automate my rent', 'set up a savings goal'.",
  inputSchema: z.object({
    domain: z
      .string()
      .describe("Feature area — one of: 'recurring' (autopay/scheduled payments), 'goals' (savings targets), 'groups' (shared accounts), 'categories' (expense tracking), 'security' (approval settings)"),
    action: z
      .string()
      .optional()
      .describe("Action — one of: 'list', 'get', 'create', 'update', 'pause', 'resume', 'cancel', 'deposit', 'withdraw', 'add_member', 'remove_member', 'payout'. Default: 'list'"),
    id: z.string().optional().describe("Item ID for targeted actions"),
    params: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .optional()
      .describe(
        "Domain-specific parameters as a JSON object. " +
        "For recurring/create: { recipient (username or address), amount (human-readable e.g. '50'), token ('USDC' or 'ETH'), frequency ('daily'|'weekly'|'monthly'), label? (optional description) }. " +
        "For goals/create: { name, targetAmount, currency, targetDate?, autoDeposit?, autoDepositAmount?, autoDepositFrequency? }. " +
        "For groups/create: { name }. For groups/add_member: { member (username or address) }. " +
        "For deposit/withdraw: { amount }. For categories/create: { name, icon? }."
      ),
  }),
  displayPropsSchema: z.object({
    domain: z.string(),
    action: z.string(),
    summary: z.string(),
    details: z.record(z.string(), z.string()).optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,

  async do(input, display) {
    // Normalize domain: handle common AI variations
    const domainMap: Record<string, string> = {
      recurring: "recurring", recurring_payments: "recurring", autopay: "recurring", scheduled: "recurring",
      goals: "goals", savings: "goals", saving: "goals",
      groups: "groups", group: "groups",
      categories: "categories", category: "categories",
      security: "security",
    };
    const domain = domainMap[input.domain?.toLowerCase().trim()] ?? input.domain?.toLowerCase().trim();

    // Normalize action: handle common AI variations
    const actionMap: Record<string, string> = {
      create: "create", setup: "create", add: "create", new: "create",
      list: "list", show: "list", view: "list", get: "get",
      update: "update", edit: "update", modify: "update",
      pause: "pause", resume: "resume",
      cancel: "cancel", delete: "cancel", remove: "cancel",
      deposit: "deposit", withdraw: "withdraw",
      add_member: "add_member", remove_member: "remove_member", payout: "payout",
    };
    const rawAction = input.action ?? "list";
    const action = actionMap[rawAction.toLowerCase().trim()] ?? rawAction.toLowerCase().trim();

    const { id } = input;
    // Handle params sent as JSON string (common LLM behavior)
    let params: Record<string, unknown> | undefined;
    if (typeof input.params === "string") {
      try { params = JSON.parse(input.params); } catch { params = undefined; }
    } else {
      params = input.params as Record<string, unknown> | undefined;
    }

    // For mutations, provide pushAndWait; for reads, pass null
    const pushAndWait = isMutation(action)
      ? (props: Record<string, unknown>) => display.pushAndWait(props as { domain: string; action: string; summary: string; details?: Record<string, string> })
      : null;

    try {
      switch (domain) {
        case "recurring":
          return await handleRecurring(action, id, params, pushAndWait);
        case "goals":
          return await handleGoals(action, id, params, pushAndWait);
        case "groups":
          return await handleGroups(action, id, params, pushAndWait);
        case "categories":
          return await handleCategories(action, id, params, pushAndWait);
        case "security":
          return await handleSecurity(action);
        default:
          return { status: "error" as const, data: "", message: `Unknown domain "${domain}". Valid domains: recurring, goals, groups, categories, security.` };
      }
    } catch (e) {
      return { status: "error" as const, data: "", message: String(e) };
    }
  },

  render({ props, resolve }) {
    const title = buildTitle(props.action, props.domain);
    const variant = getVariant(props.action);

    return (
      <ConfirmDialog
        title={title}
        variant={variant}
        onConfirm={() => resolve(true)}
        onCancel={() => resolve(false)}
      >
        {props.summary && (
          <p style={{ color: "var(--text-secondary)", marginBottom: 8 }}>
            {props.summary}
          </p>
        )}
        {Object.entries(props.details ?? {}).map(([key, value]) => (
          <KVRow key={key} label={key} value={String(value)} />
        ))}
      </ConfirmDialog>
    );
  },
});
