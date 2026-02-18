import { expandMultiChain } from "../services/contract/types.js";

// YieldTimeLock ABI — combines time-locked deposits with Morpho vault yield
// generation. Users lock ERC-20 tokens into whitelisted ERC-4626 vaults to
// earn yield during the lock period. Supports emergency withdrawals, labels,
// and yield preview.
const YIELD_TIMELOCK_ABI = [
  // ── External (write) ──────────────────────────────────────────────
  {
    type: "function",
    name: "lockWithYield",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "unlockTime", type: "uint256" },
      { name: "label", type: "string" },
    ],
    outputs: [{ name: "lockId", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "lockId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimEmergencyFunds",
    stateMutability: "nonpayable",
    inputs: [{ name: "lockId", type: "uint256" }],
    outputs: [],
  },
  // ── Owner-only ────────────────────────────────────────────────────
  {
    type: "function",
    name: "extendLock",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lockId", type: "uint256" },
      { name: "newUnlockTime", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "emergencyWithdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "lockId", type: "uint256" }],
    outputs: [],
  },
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
    name: "getYieldLock",
    stateMutability: "view",
    inputs: [{ name: "lockId", type: "uint256" }],
    outputs: [
      {
        name: "lock",
        type: "tuple",
        components: [
          { name: "depositor", type: "address" },
          { name: "vault", type: "address" },
          { name: "underlyingToken", type: "address" },
          { name: "shares", type: "uint256" },
          { name: "principalAssets", type: "uint256" },
          { name: "unlockTime", type: "uint256" },
          { name: "withdrawn", type: "bool" },
          { name: "isEmergencyWithdrawn", type: "bool" },
          { name: "label", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getUserYieldLockIds",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "lockIds", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getUserLocksByLabel",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "label", type: "string" },
    ],
    outputs: [{ name: "lockIds", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "isUnlocked",
    stateMutability: "view",
    inputs: [{ name: "lockId", type: "uint256" }],
    outputs: [{ name: "unlocked", type: "bool" }],
  },
  {
    type: "function",
    name: "previewWithdraw",
    stateMutability: "view",
    inputs: [{ name: "lockId", type: "uint256" }],
    outputs: [
      { name: "totalAssets", type: "uint256" },
      { name: "fee", type: "uint256" },
      { name: "netAssets", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getAccruedYield",
    stateMutability: "view",
    inputs: [{ name: "lockId", type: "uint256" }],
    outputs: [
      { name: "yield", type: "uint256" },
      { name: "currentAssets", type: "uint256" },
    ],
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
    name: "yieldLocks",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "depositor", type: "address" },
      { name: "vault", type: "address" },
      { name: "underlyingToken", type: "address" },
      { name: "shares", type: "uint256" },
      { name: "principalAssets", type: "uint256" },
      { name: "unlockTime", type: "uint256" },
      { name: "withdrawn", type: "bool" },
      { name: "isEmergencyWithdrawn", type: "bool" },
      { name: "label", type: "string" },
    ],
  },
  {
    type: "function",
    name: "emergencyAssets",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nextLockId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
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
    name: "YieldLockCreated",
    inputs: [
      { name: "lockId", type: "uint256", indexed: true },
      { name: "depositor", type: "address", indexed: true },
      { name: "vault", type: "address", indexed: true },
      { name: "underlyingToken", type: "address", indexed: false },
      { name: "principalAssets", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
      { name: "unlockTime", type: "uint256", indexed: false },
      { name: "label", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "YieldLockWithdrawn",
    inputs: [
      { name: "lockId", type: "uint256", indexed: true },
      { name: "depositor", type: "address", indexed: true },
      { name: "vault", type: "address", indexed: true },
      { name: "shares", type: "uint256", indexed: false },
      { name: "totalAssets", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "netAssets", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LockExtended",
    inputs: [
      { name: "lockId", type: "uint256", indexed: true },
      { name: "oldUnlockTime", type: "uint256", indexed: false },
      { name: "newUnlockTime", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EmergencyWithdrawal",
    inputs: [
      { name: "lockId", type: "uint256", indexed: true },
      { name: "vault", type: "address", indexed: true },
      { name: "shares", type: "uint256", indexed: false },
      { name: "assets", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EmergencyFundsClaimed",
    inputs: [
      { name: "lockId", type: "uint256", indexed: true },
      { name: "depositor", type: "address", indexed: true },
      { name: "totalAssets", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "netAssets", type: "uint256", indexed: false },
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
      { name: "lockId", type: "uint256", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  // ── Errors ────────────────────────────────────────────────────────
  { type: "error", name: "UnlockTimeNotInFuture", inputs: [] },
  { type: "error", name: "AmountMustBeGreaterThanZero", inputs: [] },
  { type: "error", name: "NotDepositor", inputs: [] },
  { type: "error", name: "LockNotExpired", inputs: [] },
  { type: "error", name: "AlreadyWithdrawn", inputs: [] },
  { type: "error", name: "LockIsEmergencyWithdrawn", inputs: [] },
  { type: "error", name: "NotEmergencyWithdrawn", inputs: [] },
  { type: "error", name: "NewUnlockTimeMustBeAfterCurrent", inputs: [] },
  { type: "error", name: "VaultNotWhitelisted", inputs: [] },
  { type: "error", name: "VaultAlreadyWhitelisted", inputs: [] },
  { type: "error", name: "VaultNotInWhitelist", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "FeeTooHigh", inputs: [] },
  { type: "error", name: "LockAlreadyProcessed", inputs: [] },
] as const;

// Common method shortcuts for YieldTimeLock operations.
const yieldTimelockMethods = {
  lock: {
    functionName: "lockWithYield",
    description: "Lock tokens into a yield-generating vault until unlock time",
  },
  withdraw: {
    functionName: "withdraw",
    description: "Withdraw a lock after it expires (redeems shares, deducts fee)",
  },
  claimEmergency: {
    functionName: "claimEmergencyFunds",
    description: "Claim funds after an owner-initiated emergency withdrawal",
  },
  getLock: {
    functionName: "getYieldLock",
    description: "Get full details of a yield lock by ID",
  },
  userLocks: {
    functionName: "getUserYieldLockIds",
    description: "Get all lock IDs for a user",
  },
  locksByLabel: {
    functionName: "getUserLocksByLabel",
    description: "Get lock IDs for a user filtered by label",
  },
  isUnlocked: {
    functionName: "isUnlocked",
    description: "Check if a lock's unlock time has passed",
  },
  preview: {
    functionName: "previewWithdraw",
    description: "Preview withdrawal: total assets, fee, and net assets",
  },
  yield: {
    functionName: "getAccruedYield",
    description: "Get accrued yield and current asset value for a lock",
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
  extend: {
    functionName: "extendLock",
    description: "Extend a lock's unlock time (owner only, can never shorten)",
  },
  emergencyWithdraw: {
    functionName: "emergencyWithdraw",
    description: "Emergency redeem shares to contract (owner only)",
  },
  addVault: {
    functionName: "addVault",
    description: "Whitelist a new vault (owner only)",
  },
  removeVault: {
    functionName: "removeVault",
    description: "Remove a vault from whitelist (owner only)",
  },
  setFee: {
    functionName: "setFeeBps",
    description: "Update withdrawal fee in basis points (owner only, max 1000)",
  },
  setFeeRecipient: {
    functionName: "setFeeRecipient",
    description: "Update fee recipient address (owner only)",
  },
} as const;

// ── Connector Definitions ─────────────────────────────────────────────
// Add deployed YieldTimeLock addresses per chain.

export const yieldTimelockConnectors = [
  ...expandMultiChain({
    name: "yield-timelock",
    addresses: {
      1: "0x0000000000000000000000000000000000000000", // Ethereum Mainnet — TODO: replace with actual deployment address
    },
    abi: YIELD_TIMELOCK_ABI,
    methods: yieldTimelockMethods,
  }),
];
