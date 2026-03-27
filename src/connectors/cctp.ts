import { expandMultiChain } from "../services/contract/types.js";

// ── CCTP Domain IDs ────────────────────────────────────────────────
// Circle assigns each chain a unique domain identifier for CCTP routing.
export const CCTP_DOMAIN_IDS: Record<number, number> = {
  1: 0,       // Ethereum
  10: 2,      // Optimism
  42161: 3,   // Arbitrum
  8453: 6,    // Base
  137: 7,     // Polygon PoS
  480: 9,     // World Chain
};

// Reverse lookup: domain → chainId
export const DOMAIN_TO_CHAIN_ID: Record<number, number> = Object.fromEntries(
  Object.entries(CCTP_DOMAIN_IDS).map(([chainId, domain]) => [domain, Number(chainId)])
);

// ── TokenMessenger ABI (depositForBurn) ────────────────────────────
const TOKEN_MESSENGER_ABI = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
  {
    type: "event",
    name: "DepositForBurn",
    inputs: [
      { name: "nonce", type: "uint64", indexed: true },
      { name: "burnToken", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "depositor", type: "address", indexed: true },
      { name: "mintRecipient", type: "bytes32", indexed: false },
      { name: "destinationDomain", type: "uint32", indexed: false },
      { name: "destinationTokenMessenger", type: "bytes32", indexed: false },
      { name: "destinationCaller", type: "bytes32", indexed: false },
    ],
  },
] as const;

const tokenMessengerMethods = {
  depositForBurn: {
    functionName: "depositForBurn",
    description:
      "Burn USDC on the source chain to mint on a destination chain via CCTP",
  },
} as const;

// ── MessageTransmitter ABI (receiveMessage + MessageSent event) ───
const MESSAGE_TRANSMITTER_ABI = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
  {
    type: "event",
    name: "MessageSent",
    inputs: [
      { name: "message", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MessageReceived",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "sourceDomain", type: "uint32", indexed: false },
      { name: "nonce", type: "uint64", indexed: true },
      { name: "sender", type: "bytes32", indexed: false },
      { name: "messageBody", type: "bytes", indexed: false },
    ],
  },
] as const;

const messageTransmitterMethods = {
  receiveMessage: {
    functionName: "receiveMessage",
    description:
      "Receive a CCTP message with attestation to mint USDC on the destination chain",
  },
} as const;

// ── Contract addresses ─────────────────────────────────────────────
// CCTP V1 mainnet addresses from Circle's documentation.

export const cctpTokenMessengerConnectors = [
  ...expandMultiChain({
    name: "cctp-token-messenger",
    addresses: {
      1: "0xBd3fa81B58Ba92a82136038B25aDec7066af3155",      // Ethereum
      10: "0x2B4069517957735bE00ceE0fadAE88a26365528f",     // Optimism
      42161: "0x19330d10D9Cc8751218eaf51E8885D058642E08A",  // Arbitrum
      8453: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",   // Base
      137: "0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE",    // Polygon
      480: "0x2B4069517957735bE00ceE0fadAE88a26365528f",    // World Chain
    },
    abi: TOKEN_MESSENGER_ABI,
    methods: tokenMessengerMethods,
  }),
];

export const cctpMessageTransmitterConnectors = [
  ...expandMultiChain({
    name: "cctp-message-transmitter",
    addresses: {
      1: "0x0a992d191DEeC32aFe36203Ad87D7d289a738F81",      // Ethereum
      10: "0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8",     // Optimism
      42161: "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",  // Arbitrum
      8453: "0xAD09780d193884d503182aD4F75D113B9B1A7f14",   // Base
      137: "0xF3be9355363857F3e001be68856A2f96b4C39BA9",    // Polygon
      480: "0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8",   // World Chain
    },
    abi: MESSAGE_TRANSMITTER_ABI,
    methods: messageTransmitterMethods,
  }),
];

export const cctpConnectors = [
  ...cctpTokenMessengerConnectors,
  ...cctpMessageTransmitterConnectors,
];
