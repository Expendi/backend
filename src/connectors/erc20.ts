import { expandMultiChain } from "../services/contract/types.js";

// Standard ERC-20 ABI covering all required and optional interface methods.
// Conforms to EIP-20: https://eips.ethereum.org/EIPS/eip-20
const ERC20_ABI = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

// Common method shortcuts shared by all ERC-20 connectors.
// These map human-readable operation names to their on-chain function names.
const erc20Methods = {
  send: {
    functionName: "transfer",
    description: "Transfer tokens to a recipient address",
  },
  approve: {
    functionName: "approve",
    description: "Approve a spender to use tokens on your behalf",
  },
  transferFrom: {
    functionName: "transferFrom",
    description: "Transfer tokens from one address to another using an allowance",
  },
  balance: {
    functionName: "balanceOf",
    description: "Get the token balance of an address",
  },
  allowance: {
    functionName: "allowance",
    description: "Check how many tokens a spender is allowed to use",
  },
  supply: {
    functionName: "totalSupply",
    description: "Get the total supply of the token",
  },
  tokenName: {
    functionName: "name",
    description: "Get the human-readable name of the token",
  },
  tokenSymbol: {
    functionName: "symbol",
    description: "Get the ticker symbol of the token",
  },
  tokenDecimals: {
    functionName: "decimals",
    description: "Get the number of decimals used by the token",
  },
} as const;

export const erc20Connectors = [
  ...expandMultiChain({
    name: "usdc",
    addresses: {
      1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",    // Ethereum Mainnet
      137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",  // Polygon PoS
      42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum One
      10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",    // Optimism
      8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  // Base
    },
    abi: ERC20_ABI,
    methods: erc20Methods,
  }),
  ...expandMultiChain({
    name: "usdt",
    addresses: {
      1: "0xdAC17F958D2ee523a2206206994597C13D831ec7",    // Ethereum Mainnet
      137: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",  // Polygon PoS
      42161: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", // Arbitrum One
      10: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",    // Optimism
    },
    abi: ERC20_ABI,
    methods: erc20Methods,
  }),
];
