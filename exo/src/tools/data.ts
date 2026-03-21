import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { apiToolResult, callApi } from "./api";
import { type WalletBalance, TOKEN_MAP, fromBaseUnits } from "./helpers";

/**
 * Token metadata for known tokens on Base (chain 8453).
 */
const TOKEN_INFO: Record<string, { address: string; decimals: number; symbol: string }> = {
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, symbol: "USDC" },
  WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" },
  ETH: { address: "0x0000000000000000000000000000000000000000", decimals: 18, symbol: "ETH" },
};

/**
 * Convert a wallet's raw base-unit balances to human-readable amounts.
 */
function humanizeBalances(wallet: WalletBalance) {
  const humanBalances: Record<string, string> = {};
  for (const [symbol, raw] of Object.entries(wallet.balances)) {
    const decimals = TOKEN_MAP[symbol]?.decimals ?? 18;
    humanBalances[symbol] = fromBaseUnits(raw, decimals);
  }
  return { ...wallet, balances: humanBalances };
}

const getWalletBalancesTool: ToolConfig = {
  name: "get_wallet_balances",
  description:
    "Get ETH and USDC balances for all wallets (user, server, agent). Returns human-readable amounts (e.g. '1.5' ETH, '100' USDC). Use when the user asks about their balance.",
  inputSchema: z.object({}),
  async do() {
    try {
      const wallets = await callApi<WalletBalance[]>("/wallets/balances");
      const humanized = wallets.map(humanizeBalances);
      return { status: "success" as const, data: JSON.stringify(humanized), renderData: humanized };
    } catch (e) {
      return { status: "error" as const, data: "", message: String(e) };
    }
  },
};

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
    return apiToolResult("/transactions", { query: input as Record<string, string | number | undefined> });
  },
};

const getTransactionDetailsTool: ToolConfig = {
  name: "get_transaction_details",
  description:
    "Get the status and full details of a previously submitted transaction by its ID.",
  inputSchema: z.object({
    transactionId: z.string().describe("Transaction ID"),
  }),
  async do(input) {
    return apiToolResult(`/transactions/${input.transactionId}`);
  },
};

const getTokenInfoTool: ToolConfig = {
  name: "get_token_info",
  description:
    "Look up token address, symbol, and decimals on Base chain. You already know USDC, WETH, ETH, and USDT — only call this for other tokens.",
  inputSchema: z.object({
    token: z.string().describe("Token symbol"),
  }),
  async do(input) {
    const key = input.token.toUpperCase();
    const info = TOKEN_INFO[key];

    if (!info) {
      return {
        status: "error" as const,
        data: "",
        message: `Unknown token "${input.token}". Supported tokens: ${Object.keys(TOKEN_INFO).join(", ")}`,
      };
    }

    return { status: "success" as const, data: JSON.stringify(info) };
  },
};

const getUserPreferencesTool: ToolConfig = {
  name: "get_user_preferences",
  description:
    "Get the user's saved preferences (country, currency, mobile network, default wallet).",
  inputSchema: z.object({}),
  async do() {
    return apiToolResult("/profile/preferences");
  },
};

export const utilityTools: ToolConfig[] = [
  getWalletBalancesTool,
  listTransactionsTool,
  getTransactionDetailsTool,
  getTokenInfoTool,
  getUserPreferencesTool,
];
