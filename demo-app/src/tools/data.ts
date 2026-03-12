import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi, apiToolResult } from "./api";

/**
 * Token metadata for known tokens on Base (chain 8453).
 */
const TOKEN_INFO: Record<string, { address: string; decimals: number; symbol: string }> = {
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, symbol: "USDC" },
  WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" },
  ETH: { address: "0x0000000000000000000000000000000000000000", decimals: 18, symbol: "ETH" },
  USDT: { address: "0x2d1aDB45Bb1d7D2556c6558aDb76CFD4F9F4ed16", decimals: 6, symbol: "USDT" },
};

const getWalletBalancesTool: ToolConfig = {
  name: "get_wallet_balances",
  description:
    "Get ETH and USDC balances for all wallets (user, server, agent). Returns amounts in base units. Use this before any send/transfer to verify sufficient funds. Prefer this over get_wallet_balance when you need an overview.",
  inputSchema: z.object({}),
  async do() {
    return apiToolResult("/wallets/balances");
  },
};

const getWalletBalanceTool: ToolConfig = {
  name: "get_wallet_balance",
  description:
    "Get ETH and USDC balance for a single wallet by type. Returns amounts in base units. Use get_wallet_balances instead if you need balances for multiple wallets.",
  inputSchema: z.object({
    walletType: z
      .enum(["user", "server", "agent"])
      .describe("Which wallet to check"),
  }),
  async do(input) {
    try {
      const allBalances = await callApi<
        Array<{ type: string; [key: string]: unknown }>
      >("/wallets/balances");

      const match = allBalances.find(
        (w) => w.type === input.walletType,
      );

      if (!match) {
        return {
          status: "error" as const,
          data: "",
          message: `No wallet found with type "${input.walletType}"`,
        };
      }

      return { status: "success" as const, data: JSON.stringify(match) };
    } catch (e) {
      return { status: "error" as const, data: "", message: String(e) };
    }
  },
};

const getTransactionDetailsTool: ToolConfig = {
  name: "get_transaction_details",
  description:
    "Get the status and full details of a previously submitted transaction by its ID. Use when the user asks about a specific transaction.",
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
    token: z
      .string()
      .describe("Token symbol: USDC, WETH, ETH, or USDT"),
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

const convertTokenAmountTool: ToolConfig = {
  name: "convert_token_amount",
  description:
    "Convert between human-readable token amounts and base units. For simple amounts (e.g. 5 USDC = 5000000, 1 ETH = 1000000000000000000), do the math yourself. Only call this for complex or fractional amounts you are unsure about.",
  inputSchema: z.object({
    amount: z.string().describe("Amount to convert"),
    token: z.string().describe("Token symbol: USDC, WETH, ETH, USDT"),
    direction: z
      .enum(["to_base", "to_human"])
      .describe(
        "'to_base' converts 1.5 USDC → 1500000, 'to_human' converts 1500000 → 1.5 USDC",
      ),
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

    const amountStr = input.amount.trim();
    if (amountStr === "" || isNaN(Number(amountStr))) {
      return {
        status: "error" as const,
        data: "",
        message: `Invalid amount "${input.amount}". Must be a numeric value.`,
      };
    }

    const factor = BigInt(10) ** BigInt(info.decimals);

    if (input.direction === "to_base") {
      // Convert human-readable to base units (e.g. 1.5 USDC -> 1500000)
      const parts = amountStr.split(".");
      const whole = parts[0];
      const frac = (parts[1] ?? "").padEnd(info.decimals, "0").slice(0, info.decimals);
      const baseAmount = BigInt(whole) * factor + BigInt(frac);

      return {
        status: "success" as const,
        data: JSON.stringify({
          amount: baseAmount.toString(),
          token: info.symbol,
          decimals: info.decimals,
          humanReadable: amountStr,
        }),
      };
    }

    // to_human: convert base units to human-readable (e.g. 1500000 -> 1.5)
    const baseVal = BigInt(amountStr);
    const wholePart = baseVal / factor;
    const fracPart = baseVal % factor;
    const fracStr = fracPart.toString().padStart(info.decimals, "0").replace(/0+$/, "");
    const humanReadable = fracStr.length > 0
      ? `${wholePart}.${fracStr}`
      : wholePart.toString();

    return {
      status: "success" as const,
      data: JSON.stringify({
        amount: humanReadable,
        token: info.symbol,
        decimals: info.decimals,
        baseUnits: amountStr,
      }),
    };
  },
};

const getUserPreferencesTool: ToolConfig = {
  name: "get_user_preferences",
  description:
    "Get the user's saved preferences (country, currency, mobile network, default wallet). Use before on/off-ramp to pre-fill defaults so the user doesn't have to specify them every time.",
  inputSchema: z.object({}),
  async do() {
    return apiToolResult("/profile/preferences");
  },
};

export const dataTools: ToolConfig[] = [
  getWalletBalancesTool,
  getWalletBalanceTool,
  getTransactionDetailsTool,
  getTokenInfoTool,
  convertTokenAmountTool,
  getUserPreferencesTool,
];
