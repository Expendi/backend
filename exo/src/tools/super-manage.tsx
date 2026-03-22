import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow } from "./components";
import {
  TOKEN_MAP,
  toBaseUnits,
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
  splits: "Split Expense",
  categories: "Category",
  security: "Security Settings",
  mandates: "Mandate",
  agent_wallet: "Agent Wallet",
  inbox: "Inbox",
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
  balance: "View Balance",
  fund: "Fund",
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

const READ_ACTIONS = new Set(["list", "get", "balance", "unread"]);

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
          // Backend returns human-readable balances
          const balanceHuman = Number(getTokenBalance(userWallet, tokenSymbol));
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

      const resolved = await resolveRecipient(String(params.recipient));
      // Amount stays human-readable — the backend handles raw unit conversion
      const humanAmount = String(params.amount);

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
      // Amount is human-readable (e.g. "0.17" for 0.17 USDC) — the backend converts to raw units at execution time
      const isNativeEth = tokenSymbol === "ETH";
      const data = await callApi("/recurring-payments", {
        method: "POST",
        body: {
          type: isNativeEth ? "raw_transfer" : "transfer",
          name,
          to: resolved.address,
          amount: humanAmount,
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

    case "spending": {
      const since = params?.since ? String(params.since) : undefined;
      const query = since ? { since } : undefined;
      const data = await callApi("/categories/spending", { query });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "set_limit": {
      if (!id) return { status: "error", data: "", message: "A category id is required to set a spending limit." };
      if (!params?.monthlyLimit) return { status: "error", data: "", message: "Missing required parameter: monthlyLimit." };

      const tokenSymbol = String(params.token ?? "USDC").toUpperCase();
      const tokenInfo = TOKEN_MAP[tokenSymbol];
      if (!tokenInfo) return { status: "error", data: "", message: `Unknown token "${tokenSymbol}".` };

      const limitBase = toBaseUnits(String(params.monthlyLimit), tokenInfo.decimals);

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "categories",
          action: "set_limit",
          summary: `Set monthly spending limit of ${params.monthlyLimit} ${tokenSymbol} for this category.`,
          details: { "Monthly Limit": `${params.monthlyLimit} ${tokenSymbol}` },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const data = await callApi(`/categories/${id}/limit`, {
        method: "PUT",
        body: {
          monthlyLimit: limitBase,
          tokenAddress: tokenInfo.address,
          tokenSymbol: tokenInfo.symbol,
          tokenDecimals: tokenInfo.decimals,
        },
      });
      return { status: "success", data: JSON.stringify(data) };
    }

    default:
      return { status: "error", data: "", message: `Unsupported action "${action}" for categories. Supported: list, create, update, spending, set_limit.` };
  }
}

// ── Split expenses domain handler ───────────────────────────────────────────

async function handleSplits(
  action: string,
  id: string | undefined,
  params: Record<string, unknown> | undefined,
  pushAndWait: ((props: Record<string, unknown>) => Promise<boolean>) | null,
): Promise<{ status: "success" | "error"; data: string; message?: string }> {
  switch (action) {
    case "list": {
      const data = await callApi("/split-expenses");
      return { status: "success", data: JSON.stringify(data) };
    }

    case "owed": {
      const data = await callApi("/split-expenses/owed");
      return { status: "success", data: JSON.stringify(data) };
    }

    case "get": {
      if (!id) return { status: "error", data: "", message: "An id is required to view a split expense." };
      const data = await callApi(`/split-expenses/${id}`);
      return { status: "success", data: JSON.stringify(data) };
    }

    case "create": {
      if (!params?.title) return { status: "error", data: "", message: "Missing required parameter: title." };
      if (!params?.totalAmount) return { status: "error", data: "", message: "Missing required parameter: totalAmount." };
      if (!params?.shares || !Array.isArray(params.shares) || params.shares.length === 0) {
        return { status: "error", data: "", message: "Missing required parameter: shares (array of { userId, amount })." };
      }

      const tokenSymbol = String(params.token ?? "USDC").toUpperCase();
      const tokenInfo = TOKEN_MAP[tokenSymbol];
      if (!tokenInfo) return { status: "error", data: "", message: `Unknown token "${tokenSymbol}".` };

      const totalBase = toBaseUnits(String(params.totalAmount), tokenInfo.decimals);

      // Resolve shares — each share has a userId (username or address) and amount
      const resolvedShares: Array<{ userId: string; amount: string }> = [];
      for (const share of params.shares as Array<{ userId: string; amount: string }>) {
        const shareBase = toBaseUnits(String(share.amount), tokenInfo.decimals);
        resolvedShares.push({ userId: share.userId, amount: shareBase });
      }

      const details: Record<string, string> = {
        Title: String(params.title),
        Total: `${params.totalAmount} ${tokenSymbol}`,
        Participants: `${resolvedShares.length} people`,
      };

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "splits",
          action,
          summary: `Split "${params.title}" — ${params.totalAmount} ${tokenSymbol} among ${resolvedShares.length} people.`,
          details,
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const data = await callApi("/split-expenses", {
        method: "POST",
        body: {
          title: String(params.title),
          totalAmount: totalBase,
          tokenAddress: tokenInfo.address,
          tokenSymbol: tokenInfo.symbol,
          tokenDecimals: tokenInfo.decimals,
          chainId: 8453,
          shares: resolvedShares,
          categoryId: params.categoryId ? String(params.categoryId) : undefined,
        },
      });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "pay": {
      if (!id) return { status: "error", data: "", message: "A share id is required to pay a split expense." };

      let balances;
      try { balances = await fetchBalances(); } catch { return { status: "error", data: "", message: "Failed to fetch balances." }; }
      const userWallet = getUserWallet(balances);
      if (!userWallet) return { status: "error", data: "", message: "No user wallet found." };

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "splits",
          action,
          summary: "Pay your share of this split expense.",
          details: { "Share ID": id },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const data = await callApi(`/split-expenses/${id}/pay`, {
        method: "POST",
        body: {
          walletId: userWallet.walletId,
          walletType: "user",
        },
      });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "cancel": {
      if (!id) return { status: "error", data: "", message: "An id is required to cancel a split expense." };

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "splits",
          action,
          summary: "Cancel this split expense. Unpaid shares will be cancelled.",
          details: {},
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const data = await callApi(`/split-expenses/${id}`, { method: "DELETE" });
      return { status: "success", data: JSON.stringify(data) };
    }

    default:
      return { status: "error", data: "", message: `Unsupported action "${action}" for splits. Supported: list, owed, get, create, pay, cancel.` };
  }
}

// ── Mandates domain handler ─────────────────────────────────────────────────

async function handleMandates(
  action: string,
  id: string | undefined,
  params: Record<string, unknown> | undefined,
  pushAndWait: ((props: Record<string, unknown>) => Promise<boolean>) | null,
): Promise<{ status: "success" | "error"; data: string; message?: string }> {
  switch (action) {
    case "list": {
      const data = await callApi("/agent/mandates");
      return { status: "success", data: JSON.stringify(data) };
    }

    case "get": {
      if (!id) return { status: "error", data: "", message: "An id is required to view a mandate." };
      const data = await callApi(`/agent/mandates/${id}`);
      return { status: "success", data: JSON.stringify(data) };
    }

    case "create": {
      if (!params?.type) return { status: "error", data: "", message: "Missing required parameter: type." };
      if (!params?.name) return { status: "error", data: "", message: "Missing required parameter: name." };
      if (!params?.trigger) return { status: "error", data: "", message: "Missing required parameter: trigger." };
      if (!params?.action) return { status: "error", data: "", message: "Missing required parameter: action." };

      const validTypes = ["dca", "auto_offramp", "rebalance", "alert", "auto_save", "custom", "price_alert", "auto_cashout", "limit_order", "yield_harvest", "recurring_swap"];
      const mandateType = String(params.type).toLowerCase();
      if (!validTypes.includes(mandateType)) {
        return { status: "error", data: "", message: `Invalid mandate type "${params.type}". Supported types: ${validTypes.join(", ")}` };
      }

      const trigger = typeof params.trigger === "string" ? JSON.parse(params.trigger) : params.trigger;
      const actionConfig = typeof params.action === "string" ? JSON.parse(params.action) : params.action;

      // Convert human-readable amounts to base units in the action config
      const convertedAction = { ...actionConfig };
      if (convertedAction.amount && convertedAction.type) {
        let actionToken = "USDC";
        if (convertedAction.type === "swap" && convertedAction.from) {
          actionToken = String(convertedAction.from).toUpperCase();
        } else if (convertedAction.type === "transfer" && convertedAction.token) {
          actionToken = String(convertedAction.token).toUpperCase();
        }
        const tokenInfo = TOKEN_MAP[actionToken];
        if (tokenInfo) {
          convertedAction.amount = toBaseUnits(String(convertedAction.amount), tokenInfo.decimals);
        }
      }

      const details: Record<string, string> = {
        Name: String(params.name),
        Type: mandateType,
        Trigger: JSON.stringify(trigger),
        Action: JSON.stringify(actionConfig),
      };
      if (params.description) details["Description"] = String(params.description);
      if (params.constraints) details["Constraints"] = JSON.stringify(params.constraints);
      if (params.expiresAt) details["Expires At"] = new Date(String(params.expiresAt)).toLocaleDateString();

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "mandates",
          action: "create",
          summary: `Create a "${mandateType}" mandate: ${params.name}.`,
          details,
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const body: Record<string, unknown> = {
        type: mandateType,
        name: String(params.name),
        trigger,
        action: convertedAction,
      };
      if (params.description) body.description = String(params.description);
      if (params.constraints) body.constraints = typeof params.constraints === "string" ? JSON.parse(params.constraints) : params.constraints;
      if (params.expiresAt) body.expiresAt = String(params.expiresAt);

      const data = await callApi("/agent/mandates", { method: "POST", body });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "pause": {
      if (!id) return { status: "error", data: "", message: "An id is required to pause a mandate." };
      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "mandates",
          action,
          summary: "Pause this mandate. It will stop executing until resumed.",
          details: { "Mandate ID": id },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }
      const data = await callApi(`/agent/mandates/${id}/pause`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "resume": {
      if (!id) return { status: "error", data: "", message: "An id is required to resume a mandate." };
      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "mandates",
          action,
          summary: "Resume this mandate. It will start executing again.",
          details: { "Mandate ID": id },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }
      const data = await callApi(`/agent/mandates/${id}/resume`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "cancel": {
      if (!id) return { status: "error", data: "", message: "An id is required to cancel a mandate." };
      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "mandates",
          action,
          summary: "Permanently revoke this mandate. This cannot be undone.",
          details: { "Mandate ID": id },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }
      const data = await callApi(`/agent/mandates/${id}`, { method: "DELETE" });
      return { status: "success", data: JSON.stringify(data) };
    }

    default:
      return { status: "error", data: "", message: `Unsupported action "${action}" for mandates. Supported: list, get, create, pause, resume, cancel.` };
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

// ── Agent wallet domain handler ─────────────────────────────────────────────

async function handleAgentWallet(
  action: string,
  _id: string | undefined,
  params: Record<string, unknown> | undefined,
  pushAndWait: ((props: Record<string, unknown>) => Promise<boolean>) | null,
): Promise<{ status: "success" | "error"; data: string; message?: string }> {
  switch (action) {
    case "list":
    case "balance": {
      const data = await callApi("/agent/wallet/balance");
      return { status: "success", data: JSON.stringify(data) };
    }

    case "fund": {
      if (!params?.amount) return { status: "error", data: "", message: "Missing required parameter: amount." };

      const tokenSymbol = String(params.token ?? "USDC").toUpperCase();
      const tokenInfo = TOKEN_MAP[tokenSymbol];
      if (!tokenInfo) return { status: "error", data: "", message: `Unknown token "${tokenSymbol}". Supported tokens: ${Object.keys(TOKEN_MAP).join(", ")}` };

      const baseUnits = toBaseUnits(String(params.amount), tokenInfo.decimals);

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "agent_wallet",
          action: "fund",
          summary: `Fund agent wallet with ${params.amount} ${tokenSymbol}.`,
          details: { Amount: `${params.amount} ${tokenSymbol}` },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const data = await callApi("/agent/wallet/fund", {
        method: "POST",
        body: { amount: baseUnits, token: tokenSymbol },
      });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "withdraw": {
      if (!params?.amount) return { status: "error", data: "", message: "Missing required parameter: amount." };

      const tokenSymbol = String(params.token ?? "USDC").toUpperCase();
      const tokenInfo = TOKEN_MAP[tokenSymbol];
      if (!tokenInfo) return { status: "error", data: "", message: `Unknown token "${tokenSymbol}". Supported tokens: ${Object.keys(TOKEN_MAP).join(", ")}` };

      const baseUnits = toBaseUnits(String(params.amount), tokenInfo.decimals);

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "agent_wallet",
          action: "withdraw",
          summary: `Withdraw ${params.amount} ${tokenSymbol} from agent wallet.`,
          details: { Amount: `${params.amount} ${tokenSymbol}` },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const data = await callApi("/agent/wallet/withdraw", {
        method: "POST",
        body: { amount: baseUnits, token: tokenSymbol },
      });
      return { status: "success", data: JSON.stringify(data) };
    }

    default:
      return { status: "error", data: "", message: `Unsupported action "${action}" for agent wallet. Supported: list (or balance), fund, withdraw.` };
  }
}

// ── Inbox domain handler ─────────────────────────────────────────────────────

async function handleInbox(
  action: string,
  id: string | undefined,
  params: Record<string, unknown> | undefined,
  pushAndWait: ((props: Record<string, unknown>) => Promise<boolean>) | null,
): Promise<{ status: "success" | "error"; data: string; message?: string }> {
  switch (action) {
    case "list": {
      const query: Record<string, string> = {};
      if (params?.category) query.category = String(params.category);
      if (params?.status) query.status = String(params.status);
      if (params?.priority) query.priority = String(params.priority);
      if (params?.limit) query.limit = String(params.limit);
      if (params?.offset) query.offset = String(params.offset);
      const data = await callApi("/agent/inbox", { query });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "unread": {
      const data = await callApi("/agent/inbox/unread");
      return { status: "success", data: JSON.stringify(data) };
    }

    case "read": {
      if (!id) return { status: "error", data: "", message: "An id is required to mark an inbox item as read." };
      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "inbox",
          action,
          summary: "Mark this inbox item as read.",
          details: { "Item ID": id },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }
      const data = await callApi(`/agent/inbox/${id}/read`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "read_all": {
      if (pushAndWait) {
        const details: Record<string, string> = {};
        if (params?.category) details["Category"] = String(params.category);
        const confirmed = await pushAndWait({
          domain: "inbox",
          action,
          summary: params?.category
            ? `Mark all "${params.category}" inbox items as read.`
            : "Mark all inbox items as read.",
          details,
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }
      const body: Record<string, unknown> = {};
      if (params?.category) body.category = String(params.category);
      const data = await callApi("/agent/inbox/read-all", { method: "POST", body });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "dismiss": {
      if (!id) return { status: "error", data: "", message: "An id is required to dismiss an inbox item." };
      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "inbox",
          action,
          summary: "Dismiss this inbox item.",
          details: { "Item ID": id },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }
      const data = await callApi(`/agent/inbox/${id}/dismiss`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data) };
    }

    case "action": {
      if (!id) return { status: "error", data: "", message: "An id is required to act on an inbox item." };
      const approved = params?.approved !== undefined ? Boolean(params.approved) : true;

      if (pushAndWait) {
        const confirmed = await pushAndWait({
          domain: "inbox",
          action,
          summary: approved ? "Approve this inbox action." : "Reject this inbox action.",
          details: {
            "Item ID": id,
            Decision: approved ? "Approve" : "Reject",
            ...(params?.note ? { Note: String(params.note) } : {}),
          },
        });
        if (!confirmed) return { status: "success", data: "Cancelled." };
      }

      const body: Record<string, unknown> = { approved };
      if (params?.note) body.note = String(params.note);
      const data = await callApi(`/agent/inbox/${id}/action`, { method: "POST", body });
      return { status: "success", data: JSON.stringify(data) };
    }

    default:
      return { status: "error", data: "", message: `Unsupported action "${action}" for inbox. Supported: list, unread, read, read_all, dismiss, action.` };
  }
}

// ── The manage super tool ───────────────────────────────────────────────────

export const manageTool: ToolConfig = defineTool({
  name: "manage",
  description:
    "Set up autopay, recurring payments, savings goals, group accounts, split expenses, spending categories, security settings, automated mandates (DCA, alerts, rebalancing), agent wallet management, and agent inbox (messages, notifications, actionable items). " +
    "Use this for any payment automation, expense splitting, financial management, agent wallet operations, or inbox management.",
  inputSchema: z.object({
    domain: z
      .enum(["recurring", "goals", "groups", "categories", "splits", "security", "mandates", "agent_wallet", "inbox"])
      .describe(
        "Feature area to manage. " +
        "'recurring' = autopay/scheduled payments. " +
        "'goals' = savings targets. " +
        "'groups' = shared/group accounts. " +
        "'splits' = split expenses among people. " +
        "'categories' = expense categories + spending analytics. " +
        "'security' = PIN and approval settings. " +
        "'mandates' = automated rules (DCA, auto-offramp, rebalance, alerts, auto-save). " +
        "'agent_wallet' = agent wallet balances, funding, and withdrawals. " +
        "'inbox' = agent inbox messages, notifications, and actionable items."
      ),
    action: z
      .enum(["list", "get", "create", "update", "pause", "resume", "cancel", "deposit", "withdraw", "add_member", "remove_member", "payout", "pay", "owed", "spending", "set_limit", "balance", "fund", "unread", "read", "read_all", "dismiss", "action"])
      .optional()
      .describe(
        "Action to perform. Default: 'list'. " +
        "Common combos: recurring + create/pause/resume/cancel, goals + create/deposit/cancel, " +
        "groups + create/add_member/deposit/payout, " +
        "splits + create/list/owed/pay/cancel, " +
        "categories + create/update/spending/set_limit, " +
        "security + get/update, " +
        "mandates + list/get/create/pause/resume/cancel, " +
        "agent_wallet + list (or balance)/fund/withdraw, " +
        "inbox + list/unread/read/read_all/dismiss/action."
      ),
    id: z.string().optional().describe("Item ID — required for get, update, pause, resume, cancel, deposit, withdraw, add_member, remove_member, payout, pay."),
    params: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .optional()
      .describe(
        "Domain-specific parameters as a JSON object. All amounts are HUMAN-READABLE (e.g. '50', not base units). " +
        "recurring/create: { recipient: 'username or 0x address', amount: '50', token: 'USDC', frequency: 'daily' | 'weekly' | 'monthly', label?: 'rent payment' }. " +
        "goals/create: { name: 'Emergency Fund', targetAmount: '1000', currency: 'USDC', targetDate?: '2026-12-31', autoDeposit?: true, autoDepositAmount?: '100', autoDepositFrequency?: 'monthly' }. " +
        "goals/deposit: { amount: '50' }. " +
        "groups/create: { name: 'Rent Pool' }. groups/add_member: { member: 'username or 0x address' }. " +
        "groups/deposit: { amount: '50', token: 'USDC' }. groups/payout: { amount: '50', token: 'USDC' }. " +
        "splits/create: { title: 'Dinner', totalAmount: '100', token: 'USDC', shares: [{ userId: 'username', amount: '50' }], categoryId?: 'cat-id' }. " +
        "splits/pay: (no params, just pass the share id). " +
        "categories/create: { name: 'Food & Dining', icon?: '🍔' }. " +
        "categories/spending: { since?: '2026-01-01' } (defaults to current month). " +
        "categories/set_limit: { monthlyLimit: '500', token: 'USDC' }. " +
        "security/update: { pin: '1234' }. " +
        "mandates/create: { type: 'dca' | 'auto_offramp' | 'rebalance' | 'alert' | 'auto_save' | 'custom', name: 'Weekly ETH DCA', trigger: { type: 'schedule', frequency: '7d' }, action: { type: 'swap', from: 'USDC', to: 'ETH', amount: '10' }, description?: 'Buy ETH weekly', constraints?: { maxPerExecution: '100', maxPerDay: '200' }, expiresAt?: '2026-12-31' }. " +
        "agent_wallet/fund: { amount: '100', token?: 'USDC' }. " +
        "agent_wallet/withdraw: { amount: '50', token?: 'USDC' }. " +
        "inbox/list: { category?: 'research' | 'request' | 'alert' | 'news' | 'suggestion' | 'mandate_update', status?: 'unread' | 'read' | 'actioned' | 'dismissed', priority?: 'low' | 'medium' | 'high' | 'urgent', limit?: 20, offset?: 0 }. " +
        "inbox/unread: (no params). " +
        "inbox/read_all: { category?: 'research' }. " +
        "inbox/action: { approved: true/false, note?: 'looks good' }."
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
      splits: "splits", split: "splits", split_expenses: "splits", expenses: "splits",
      categories: "categories", category: "categories",
      security: "security",
      mandates: "mandates", mandate: "mandates", automation: "mandates", automate: "mandates", dca: "mandates", auto: "mandates",
      agent_wallet: "agent_wallet", wallet: "agent_wallet", agent: "agent_wallet", budget: "agent_wallet",
      inbox: "inbox", messages: "inbox", notifications: "inbox",
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
      pay: "pay", settle: "pay",
      owed: "owed", debts: "owed",
      spending: "spending", analytics: "spending",
      set_limit: "set_limit", limit: "set_limit",
      balance: "balance", balances: "balance",
      fund: "fund",
      unread: "unread",
      read: "read", mark_read: "read",
      read_all: "read_all", mark_all_read: "read_all",
      dismiss: "dismiss",
      action: "action", approve: "action", reject: "action",
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
        case "splits":
          return await handleSplits(action, id, params, pushAndWait);
        case "security":
          return await handleSecurity(action);
        case "mandates":
          return await handleMandates(action, id, params, pushAndWait);
        case "agent_wallet":
          return await handleAgentWallet(action, id, params, pushAndWait);
        case "inbox":
          return await handleInbox(action, id, params, pushAndWait);
        default:
          return { status: "error" as const, data: "", message: `Unknown domain "${domain}". Valid domains: recurring, goals, groups, categories, splits, security, mandates, agent_wallet, inbox.` };
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
