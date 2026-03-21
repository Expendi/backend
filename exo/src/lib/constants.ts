export const BASE_CHAIN_ID = 8453;

// Trust Wallet assets CDN — verified working URLs for each token
const TW = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";

export interface TokenMeta {
  address: string;
  decimals: number;
  symbol: string;
  name: string;
  color: string;
  icon: string;
}

export const TOKEN_ADDRESSES: Record<string, TokenMeta> = {
  ETH: {
    address: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    symbol: "ETH",
    name: "Ethereum",
    color: "#627EEA",
    icon: `${TW}/ethereum/info/logo.png`,
  },
  WETH: {
    address: "0x4200000000000000000000000000000000000006",
    decimals: 18,
    symbol: "WETH",
    name: "Wrapped Ether",
    color: "#627EEA",
    icon: `${TW}/ethereum/info/logo.png`,
  },
  USDC: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    symbol: "USDC",
    name: "USD Coin",
    color: "#2775CA",
    icon: `${TW}/base/assets/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/logo.png`,
  },
  cbETH: {
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    decimals: 18,
    symbol: "cbETH",
    name: "Coinbase Staked ETH",
    color: "#0052FF",
    icon: `${TW}/base/assets/0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22/logo.png`,
  },
  cbBTC: {
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    decimals: 8,
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    color: "#F7931A",
    icon: "https://coin-images.coingecko.com/coins/images/40143/large/cbbtc.webp",
  },
  AERO: {
    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    decimals: 18,
    symbol: "AERO",
    name: "Aerodrome Finance",
    color: "#0062FF",
    icon: `${TW}/base/assets/0x940181a94A35A4569E4529A3CDfB74e38FD98631/logo.png`,
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

export const ONRAMP_ASSETS = ["USDC"] as const;

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
