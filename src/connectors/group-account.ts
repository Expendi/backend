// GroupAccount ABI — used by the service for encoding calldata against
// dynamic group addresses. Not registered in the connector registry since
// each group has a unique address.

export const GROUP_ACCOUNT_ABI = [
  // ── Admin management ────────────────────────────────────────────
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "transferAdmin",
    stateMutability: "nonpayable",
    inputs: [{ name: "newAdmin", type: "address" }],
    outputs: [],
  },

  // ── Member management ───────────────────────────────────────────
  {
    type: "function",
    name: "addMember",
    stateMutability: "nonpayable",
    inputs: [{ name: "member", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "removeMember",
    stateMutability: "nonpayable",
    inputs: [{ name: "member", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "isMember",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getMembers",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },

  // ── Payments (admin only) ───────────────────────────────────────
  {
    type: "function",
    name: "pay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "payToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },

  // ── Deposits ────────────────────────────────────────────────────
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "depositToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },

  // ── Events ──────────────────────────────────────────────────────
  {
    type: "event",
    name: "MemberAdded",
    inputs: [{ name: "member", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "MemberRemoved",
    inputs: [{ name: "member", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "AdminTransferred",
    inputs: [
      { name: "oldAdmin", type: "address", indexed: true },
      { name: "newAdmin", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Payment",
    inputs: [
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TokenPayment",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Deposit",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TokenDeposit",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "from", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },

  // ── Receive ETH ─────────────────────────────────────────────────
  { type: "receive", stateMutability: "payable" },
] as const;

export const groupAccountMethods = {
  admin: { functionName: "admin", description: "Get the group admin address" },
  transferAdmin: { functionName: "transferAdmin", description: "Transfer admin role to a new address" },
  addMember: { functionName: "addMember", description: "Add a member to the group" },
  removeMember: { functionName: "removeMember", description: "Remove a member from the group" },
  isMember: { functionName: "isMember", description: "Check if an address is a member" },
  getMembers: { functionName: "getMembers", description: "Get all member addresses" },
  pay: { functionName: "pay", description: "Send ETH from the group to an address" },
  payToken: { functionName: "payToken", description: "Send ERC-20 tokens from the group to an address" },
  deposit: { functionName: "deposit", description: "Deposit ETH into the group" },
  depositToken: { functionName: "depositToken", description: "Deposit ERC-20 tokens into the group" },
} as const;
