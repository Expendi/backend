/**
 * Shared helpers for super tools — token maps, amount parsing, balance fetching.
 * Ported from the backend super-tools.ts orchestration logic.
 */

import { callApi } from "./api";

// ── Token map for Base chain (8453) ──────────────────────────────────

export const TOKEN_MAP: Record<string, { address: string; decimals: number; symbol: string }> = {
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, symbol: "USDC" },
  WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" },
  ETH: { address: "0x0000000000000000000000000000000000000000", decimals: 18, symbol: "ETH" },
  USDbC: { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6Da", decimals: 6, symbol: "USDbC" },
  cbETH: { address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18, symbol: "cbETH" },
};

// ── Currency → Country mapping (for Pretium) ─────────────────────────

export const CURRENCY_TO_COUNTRY: Record<string, string> = {
  KES: "KE",
  NGN: "NG",
  GHS: "GH",
  TZS: "TZ",
  UGX: "UG",
  ZAR: "ZA",
  RWF: "RW",
};

// ── Token resolution ─────────────────────────────────────────────────

/**
 * Normalize token symbols: "usdc" → "USDC", "ethereum" → "ETH", etc.
 */
export function resolveTokenSymbol(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (upper === "ETHEREUM") return "ETH";
  if (upper === "WRAPPED ETH" || upper === "WRAPPED ETHER") return "WETH";
  return upper;
}

/**
 * Parse amount strings like "10 USDC", "0.5ETH", "$100", "all".
 * Returns the numeric part and optional token symbol.
 */
export function parseAmountString(raw: string): { amount: string; token?: string } {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === "all") {
    return { amount: "all" };
  }

  // Match "10 USDC", "0.5ETH", "$100"
  const match = trimmed.match(/^\$?([\d,]+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
  if (match) {
    const amount = match[1]!.replace(/,/g, "");
    const token = match[2] ? resolveTokenSymbol(match[2]) : undefined;
    return { amount, token };
  }

  // Plain number
  const numMatch = trimmed.match(/^[\d,]+(?:\.\d+)?$/);
  if (numMatch) {
    return { amount: trimmed.replace(/,/g, "") };
  }

  return { amount: trimmed };
}

// ── Unit conversion ──────────────────────────────────────────────────

/**
 * Convert a human-readable amount to base units.
 * e.g. toBaseUnits("10", 6) → "10000000"
 */
export function toBaseUnits(amount: string, decimals: number): string {
  const parts = amount.split(".");
  const whole = parts[0] ?? "0";
  const frac = (parts[1] ?? "").padEnd(decimals, "0").slice(0, decimals);
  const factor = BigInt(10) ** BigInt(decimals);
  return (BigInt(whole) * factor + BigInt(frac)).toString();
}

/**
 * Convert base units to human-readable amount.
 * e.g. fromBaseUnits("10000000", 6) → "10"
 */
export function fromBaseUnits(base: string, decimals: number): string {
  const factor = BigInt(10) ** BigInt(decimals);
  const val = BigInt(base);
  const whole = val / factor;
  const frac = val % factor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
}

/**
 * Format a number for display with thousands separators.
 */
export function formatNumber(value: number, maxDecimals: number = 6): string {
  if (value === 0) return "0";
  if (value < 0.001 && value > 0) return value.toFixed(maxDecimals);
  const decimals = value >= 1 ? 2 : 4;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

// ── API helpers ──────────────────────────────────────────────────────

export interface WalletBalance {
  type: string;
  walletId: string;
  address: string;
  balances: {
    ETH: string;
    USDC: string;
    [key: string]: string;
  };
  // Legacy flat fields (in case backend format varies)
  ethBalance?: string;
  usdcBalance?: string;
  [key: string]: unknown;
}

export interface UserPreferences {
  country?: string;
  currency?: string;
  phoneNumber?: string;
  mobileNetwork?: string;
  defaultWalletType?: string;
  [key: string]: unknown;
}

/**
 * Fetch all wallet balances for the current user.
 */
export async function fetchBalances(): Promise<WalletBalance[]> {
  return callApi<WalletBalance[]>("/wallets/balances");
}

/**
 * Fetch user preferences (country, currency, phone, network defaults).
 */
export async function fetchPreferences(): Promise<UserPreferences> {
  return callApi<UserPreferences>("/profile/preferences");
}

/**
 * Get the user wallet from a list of balances.
 */
export function getUserWallet(balances: WalletBalance[]): WalletBalance | undefined {
  return balances.find((w) => w.type === "user");
}

/**
 * Get balance for a specific token from a wallet balance record.
 * Returns the balance in base units.
 */
export function getTokenBalance(wallet: WalletBalance, tokenSymbol: string): string {
  const upper = tokenSymbol.toUpperCase();
  // Primary: read from nested balances object (backend format)
  if (wallet.balances) {
    if (upper === "ETH" || upper === "WETH") return wallet.balances.ETH ?? "0";
    if (upper === "USDC") return wallet.balances.USDC ?? "0";
    return wallet.balances[upper] ?? "0";
  }
  // Fallback: flat fields
  if (upper === "ETH" || upper === "WETH") return wallet.ethBalance ?? "0";
  if (upper === "USDC") return wallet.usdcBalance ?? "0";
  const key = `${tokenSymbol.toLowerCase()}Balance`;
  return String(wallet[key] ?? "0");
}

/**
 * Resolve a recipient string to an address.
 * If it looks like an address (0x + 40 hex chars), return it directly.
 * Otherwise, try to resolve as a username.
 */
export async function resolveRecipient(
  to: string
): Promise<{ address: string; label: string }> {
  const trimmed = to.trim();

  // Direct address
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    return { address: trimmed, label: `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}` };
  }

  // Try username resolution
  try {
    const result = await callApi<{ address: string; username: string }>(
      `/profile/resolve/${encodeURIComponent(trimmed)}`
    );
    return {
      address: result.address,
      label: `@${result.username} (${result.address.slice(0, 8)}...${result.address.slice(-6)})`,
    };
  } catch {
    throw new Error(`Could not resolve "${trimmed}" to an address. Try using a wallet address (0x...) instead.`);
  }
}
