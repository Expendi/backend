import { expandMultiChain } from "../services/contract/types.js";

// TimeLock ABI — allows users to lock ETH or ERC-20 tokens for a specified
// duration. Funds can only be withdrawn by the original depositor after the
// lock period expires. Each lock has a unique auto-incrementing ID.
const TIMELOCK_ABI = [
  // ── External (write) ──────────────────────────────────────────────
  {
    type: "function",
    name: "lockETH",
    stateMutability: "payable",
    inputs: [{ name: "unlockTime", type: "uint256" }],
    outputs: [{ name: "lockId", type: "uint256" }],
  },
  {
    type: "function",
    name: "lockERC20",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "unlockTime", type: "uint256" },
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
  // ── View functions ────────────────────────────────────────────────
  {
    type: "function",
    name: "getLock",
    stateMutability: "view",
    inputs: [{ name: "lockId", type: "uint256" }],
    outputs: [
      {
        name: "lock",
        type: "tuple",
        components: [
          { name: "depositor", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "unlockTime", type: "uint256" },
          { name: "withdrawn", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getUserLockIds",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
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
    name: "locks",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "depositor", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "unlockTime", type: "uint256" },
      { name: "withdrawn", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "userLocks",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "uint256" },
    ],
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
  // ── Events ────────────────────────────────────────────────────────
  {
    type: "event",
    name: "LockCreated",
    inputs: [
      { name: "lockId", type: "uint256", indexed: true },
      { name: "depositor", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "unlockTime", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "lockId", type: "uint256", indexed: true },
      { name: "depositor", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
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
  // ── Errors ────────────────────────────────────────────────────────
  { type: "error", name: "UnlockTimeNotInFuture", inputs: [] },
  { type: "error", name: "AmountMustBeGreaterThanZero", inputs: [] },
  { type: "error", name: "NotDepositor", inputs: [] },
  { type: "error", name: "LockNotExpired", inputs: [] },
  { type: "error", name: "AlreadyWithdrawn", inputs: [] },
  { type: "error", name: "NewUnlockTimeMustBeAfterCurrent", inputs: [] },
  { type: "error", name: "InvalidTokenAddress", inputs: [] },
  { type: "error", name: "ETHTransferFailed", inputs: [] },
] as const;

// Common method shortcuts for TimeLock operations.
const timelockMethods = {
  lockETH: {
    functionName: "lockETH",
    description: "Lock ETH until a specified unlock time (send ETH with call)",
  },
  lockToken: {
    functionName: "lockERC20",
    description: "Lock ERC-20 tokens until a specified unlock time",
  },
  withdraw: {
    functionName: "withdraw",
    description: "Withdraw funds from an expired lock",
  },
  getLock: {
    functionName: "getLock",
    description: "Get full details of a lock by ID",
  },
  userLocks: {
    functionName: "getUserLockIds",
    description: "Get all lock IDs for a user",
  },
  isUnlocked: {
    functionName: "isUnlocked",
    description: "Check if a lock's unlock time has passed",
  },
  nextId: {
    functionName: "nextLockId",
    description: "Get the next lock ID to be assigned",
  },
  extend: {
    functionName: "extendLock",
    description: "Extend a lock's unlock time (owner only, can never shorten)",
  },
} as const;

// ── Connector Definitions ─────────────────────────────────────────────
// Add deployed TimeLock addresses per chain.

export const timelockConnectors = [
  ...expandMultiChain({
    name: "timelock",
    addresses: {
      1: "0x0000000000000000000000000000000000000000", // Ethereum Mainnet — TODO: replace with actual deployment address
    },
    abi: TIMELOCK_ABI,
    methods: timelockMethods,
  }),
];
