import { expandMultiChain } from "../services/contract/types.js";

// MorphoVaultDepositor ABI — facilitates depositing ERC-20 tokens into
// Morpho MetaMorpho ERC-4626 vaults with per-user share tracking and
// withdrawal fees.
const MORPHO_VAULT_DEPOSITOR_ABI = [
  // ── External (write) ──────────────────────────────────────────────
  {
    type: "function",
    name: "depositToVault",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawFromVault",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "shares", type: "uint256" },
    ],
    outputs: [],
  },
  // ── Owner-only: vault management ──────────────────────────────────
  {
    type: "function",
    name: "addVault",
    stateMutability: "nonpayable",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "removeVault",
    stateMutability: "nonpayable",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [],
  },
  // ── Owner-only: fee management ────────────────────────────────────
  {
    type: "function",
    name: "setFeeBps",
    stateMutability: "nonpayable",
    inputs: [{ name: "newFeeBps", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setFeeRecipient",
    stateMutability: "nonpayable",
    inputs: [{ name: "newFeeRecipient", type: "address" }],
    outputs: [],
  },
  // ── View functions ────────────────────────────────────────────────
  {
    type: "function",
    name: "getUserShares",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "vault", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "isVaultWhitelisted",
    stateMutability: "view",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [{ name: "whitelisted", type: "bool" }],
  },
  {
    type: "function",
    name: "getVaultList",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "vaults", type: "address[]" }],
  },
  {
    type: "function",
    name: "whitelistedVaults",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "userShares",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "vaultList",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "feeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "feeRecipient",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "BPS_DENOMINATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_FEE_BPS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "DEFAULT_FEE_BPS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // ── Events ────────────────────────────────────────────────────────
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "vault", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawnFromVault",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "vault", type: "address", indexed: true },
      { name: "shares", type: "uint256", indexed: false },
      { name: "assets", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VaultAdded",
    inputs: [{ name: "vault", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "VaultRemoved",
    inputs: [{ name: "vault", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "FeeUpdated",
    inputs: [
      { name: "oldFeeBps", type: "uint256", indexed: false },
      { name: "newFeeBps", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeeRecipientUpdated",
    inputs: [
      { name: "oldRecipient", type: "address", indexed: true },
      { name: "newRecipient", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "FeeCollected",
    inputs: [
      { name: "vault", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  // ── Errors ────────────────────────────────────────────────────────
  { type: "error", name: "VaultNotWhitelisted", inputs: [] },
  { type: "error", name: "AmountMustBeGreaterThanZero", inputs: [] },
  { type: "error", name: "SharesMustBeGreaterThanZero", inputs: [] },
  { type: "error", name: "InsufficientShares", inputs: [] },
  { type: "error", name: "VaultAlreadyWhitelisted", inputs: [] },
  { type: "error", name: "VaultNotInWhitelist", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "FeeTooHigh", inputs: [] },
] as const;

// Common method shortcuts for MorphoVaultDepositor operations.
const morphoMethods = {
  deposit: {
    functionName: "depositToVault",
    description: "Deposit underlying assets into a whitelisted Morpho vault",
  },
  withdraw: {
    functionName: "withdrawFromVault",
    description: "Redeem shares from a Morpho vault (fee deducted)",
  },
  shares: {
    functionName: "getUserShares",
    description: "Get tracked shares for a user in a vault",
  },
  isWhitelisted: {
    functionName: "isVaultWhitelisted",
    description: "Check if a vault is whitelisted",
  },
  vaults: {
    functionName: "getVaultList",
    description: "Get all whitelisted vault addresses",
  },
  fee: {
    functionName: "feeBps",
    description: "Get the current withdrawal fee in basis points",
  },
  feeRecipient: {
    functionName: "feeRecipient",
    description: "Get the address that receives withdrawal fees",
  },
  addVault: {
    functionName: "addVault",
    description: "Whitelist a new Morpho vault (owner only)",
  },
  removeVault: {
    functionName: "removeVault",
    description: "Remove a vault from the whitelist (owner only)",
  },
  setFee: {
    functionName: "setFeeBps",
    description: "Update the withdrawal fee in basis points (owner only, max 1000)",
  },
  setFeeRecipient: {
    functionName: "setFeeRecipient",
    description: "Update the fee recipient address (owner only)",
  },
} as const;

// ── Connector Definitions ─────────────────────────────────────────────
// Add deployed MorphoVaultDepositor addresses per chain.

export const morphoVaultDepositorConnectors = [
  ...expandMultiChain({
    name: "morpho-vault-depositor",
    addresses: {
      1: "0x0000000000000000000000000000000000000000", // Ethereum Mainnet — TODO: replace with actual deployment address
    },
    abi: MORPHO_VAULT_DEPOSITOR_ABI,
    methods: morphoMethods,
  }),
];
