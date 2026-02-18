import { expandMultiChain } from "../services/contract/types.js";

// Standard ERC-721 ABI covering all required interface methods.
// Conforms to EIP-721: https://eips.ethereum.org/EIPS/eip-721
// Includes the optional ERC-721 Metadata extension (name, symbol, tokenURI).
const ERC721_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getApproved",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  // ERC-721 Metadata extension
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
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  // ERC-165 supportsInterface (required by ERC-721)
  {
    type: "function",
    name: "supportsInterface",
    stateMutability: "view",
    inputs: [{ name: "interfaceId", type: "bytes4" }],
    outputs: [{ name: "", type: "bool" }],
  },
  // Events
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "approved", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ApprovalForAll",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "operator", type: "address", indexed: true },
      { name: "approved", type: "bool", indexed: false },
    ],
  },
] as const;

// Common method shortcuts for ERC-721 operations.
const erc721Methods = {
  transfer: {
    functionName: "transferFrom",
    description: "Transfer an NFT from one address to another",
  },
  safeTransfer: {
    functionName: "safeTransferFrom",
    description: "Safely transfer an NFT, checking that the receiver can handle it",
  },
  approve: {
    functionName: "approve",
    description: "Approve an address to transfer a specific token",
  },
  approveAll: {
    functionName: "setApprovalForAll",
    description: "Approve or revoke an operator for all tokens owned by the caller",
  },
  owner: {
    functionName: "ownerOf",
    description: "Get the owner of a specific token",
  },
  balance: {
    functionName: "balanceOf",
    description: "Get the number of NFTs owned by an address",
  },
  metadata: {
    functionName: "tokenURI",
    description: "Get the metadata URI for a specific token",
  },
  collectionName: {
    functionName: "name",
    description: "Get the name of the NFT collection",
  },
  collectionSymbol: {
    functionName: "symbol",
    description: "Get the symbol of the NFT collection",
  },
} as const;

export const erc721Connectors = [
  ...expandMultiChain({
    name: "bayc",
    addresses: {
      1: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D", // Ethereum Mainnet
    },
    abi: ERC721_ABI,
    methods: erc721Methods,
  }),
];
