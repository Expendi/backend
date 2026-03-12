export const BASE_CHAIN_ID = 8453;

export const TOKEN_ADDRESSES: Record<string, { address: string; decimals: number; symbol: string }> = {
  ETH: {
    address: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    symbol: "ETH",
  },
  WETH: {
    address: "0x4200000000000000000000000000000000000006",
    decimals: 18,
    symbol: "WETH",
  },
  USDC: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    symbol: "USDC",
  },
  USDbC: {
    address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6Ca",
    decimals: 6,
    symbol: "USDbC",
  },
};

export const OFFRAMP_COUNTRIES = [
  { code: "KE", name: "Kenya", currency: "KES", networks: ["safaricom", "airtel"], paymentTypes: ["MOBILE", "BUY_GOODS", "PAYBILL", "BANK_TRANSFER"] },
  { code: "NG", name: "Nigeria", currency: "NGN", networks: [], paymentTypes: ["BANK_TRANSFER"] },
  { code: "GH", name: "Ghana", currency: "GHS", networks: ["mtn", "vodafone", "airtel"], paymentTypes: ["MOBILE"] },
  { code: "UG", name: "Uganda", currency: "UGX", networks: ["mtn", "airtel"], paymentTypes: ["MOBILE"] },
  { code: "CD", name: "DR Congo", currency: "CDF", networks: ["vodacom", "airtel", "orange"], paymentTypes: ["MOBILE"] },
  { code: "MW", name: "Malawi", currency: "MWK", networks: ["airtel", "tnm"], paymentTypes: ["MOBILE"] },
  { code: "ET", name: "Ethiopia", currency: "ETB", networks: ["telebirr"], paymentTypes: ["MOBILE"] },
] as const;

export const ONRAMP_COUNTRIES = [
  { code: "KE", name: "Kenya", currency: "KES", networks: ["safaricom", "airtel"] },
  { code: "GH", name: "Ghana", currency: "GHS", networks: ["mtn", "vodafone", "airtel"] },
  { code: "UG", name: "Uganda", currency: "UGX", networks: ["mtn", "airtel"] },
  { code: "CD", name: "DR Congo", currency: "CDF", networks: ["vodacom", "airtel", "orange"] },
  { code: "MW", name: "Malawi", currency: "MWK", networks: ["airtel", "tnm"] },
] as const;

export const ONRAMP_ASSETS = ["USDC", "USDT", "CUSD"] as const;

export const FREQUENCY_OPTIONS = [
  { label: "Every 5 minutes", value: "5m" },
  { label: "Every hour", value: "1h" },
  { label: "Daily", value: "1d" },
  { label: "Weekly", value: "7d" },
  { label: "Monthly (30d)", value: "30d" },
] as const;

export const WALLET_TYPES = ["user", "server", "agent"] as const;
export type WalletType = (typeof WALLET_TYPES)[number];

export const PAYMENT_TYPES = ["erc20_transfer", "raw_transfer", "contract_call", "offramp"] as const;
export const INDICATOR_TYPES = ["price_above", "price_below", "percent_change_up", "percent_change_down"] as const;
