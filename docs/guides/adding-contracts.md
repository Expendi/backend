# Adding Contract Connectors

This guide walks through how to add a new smart contract connector to Expendi so you can read from it and send transactions to it through the API.

## Concepts

A **ContractConnector** is a descriptor that tells Expendi everything it needs to interact with a deployed smart contract: its name, chain, address, ABI, and optional method shortcuts.

```typescript
// src/services/contract/types.ts

export interface ContractConnector {
  readonly name: string;              // Human-readable identifier (e.g., "usdc")
  readonly chainId: number;           // EVM chain ID (1, 137, 8453, etc.)
  readonly address: `0x${string}`;    // Deployed contract address
  readonly abi: Abi;                  // Full or partial ABI (viem Abi type)
  readonly methods?: Record<          // Optional shortcut aliases
    string,
    {
      readonly functionName: string;  // Actual Solidity function name
      readonly description?: string;  // Human-readable description
    }
  >;
}
```

Connectors are stored in the **ContractRegistry**, an in-memory `Map` keyed by `name:chainId`. The registry is pre-loaded at startup with all connectors defined in the `src/connectors/` directory.

## How Contract Registration Works

Contracts are defined in code, not registered via the API. The API registration endpoints (`POST /api/contracts`, `DELETE /api/contracts/:name/:chainId`) have been removed. All connectors are now defined as TypeScript files in `src/connectors/` and loaded automatically when the server starts.

The `ContractRegistryLive` layer reads the connector array from `src/connectors/index.ts` and registers every connector in the in-memory store during layer construction. This means all connectors are available immediately when the first HTTP request arrives.

## Step 1: Create a Connector File

Create a new file in `src/connectors/`. For example, to add a Uniswap V3 Router connector, create `src/connectors/uniswapv3.ts`:

```typescript
import type { ContractConnector } from "../services/contract/types.js";

// Include the ABI functions you need to call.
// You do not need the full contract ABI -- only the functions you plan to use.
const UNISWAP_V3_ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "exactInput",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "path", type: "bytes" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

// Optional method shortcuts map human-friendly names to Solidity functions.
const uniswapV3Methods = {
  swapExact: {
    functionName: "exactInputSingle",
    description: "Swap an exact amount of one token for another through a single pool",
  },
  swapExactMultihop: {
    functionName: "exactInput",
    description: "Swap an exact amount through a multi-hop path",
  },
} as const;

export const uniswapV3Connectors: ContractConnector[] = [
  // Uniswap V3 SwapRouter on Ethereum Mainnet
  {
    name: "uniswap-v3-router",
    chainId: 1,
    address: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    abi: UNISWAP_V3_ROUTER_ABI,
    methods: uniswapV3Methods,
  },
  // Uniswap V3 SwapRouter on Polygon
  {
    name: "uniswap-v3-router",
    chainId: 137,
    address: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    abi: UNISWAP_V3_ROUTER_ABI,
    methods: uniswapV3Methods,
  },
];
```

## Step 2: Register in the Connectors Index

Open `src/connectors/index.ts` and add your new connector:

```typescript
import type { ContractConnector } from "../services/contract/types.js";
import { erc20Connectors } from "./erc20.js";
import { erc721Connectors } from "./erc721.js";
import { uniswapV3Connectors } from "./uniswapv3.js";

export const connectors: ContractConnector[] = [
  ...erc20Connectors,
  ...erc721Connectors,
  ...uniswapV3Connectors,
];
```

## Step 3: Restart the Server

The connectors are loaded at startup, so you need to restart the development server for changes to take effect:

```bash
# If running with pnpm dev, stop and restart:
pnpm dev
```

Your connector is now registered and available through the API.

## Multi-Chain Connectors with `expandMultiChain`

When a contract is deployed at different addresses across multiple EVM chains, use the `MultiChainConnectorDef` type and the `expandMultiChain` helper instead of manually duplicating entries. This reduces boilerplate and keeps all deployment addresses in a single place.

### The `MultiChainConnectorDef` interface

```typescript
// src/services/contract/types.ts

export interface MultiChainConnectorDef {
  readonly name: string;
  readonly addresses: Record<number, `0x${string}`>;  // chainId -> address
  readonly abi: Abi;
  readonly methods?: ContractConnector["methods"];
}
```

### The `expandMultiChain` function

```typescript
export function expandMultiChain(def: MultiChainConnectorDef): ContractConnector[] {
  return Object.entries(def.addresses).map(([chainIdStr, address]) => ({
    name: def.name,
    chainId: Number(chainIdStr),
    address,
    abi: def.abi,
    ...(def.methods ? { methods: def.methods } : {}),
  }));
}
```

It takes a single `MultiChainConnectorDef` and returns one `ContractConnector` per chain entry in the `addresses` map. Each connector has its own `chainId` and `address` but shares the same `name`, `abi`, and `methods`.

### Example: multi-chain token connector

```typescript
import { expandMultiChain } from "../services/contract/types.js";

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
```

This produces USDC connectors for 5 chains and USDT connectors for 4 chains, all from two `expandMultiChain` calls. When you need to add a new chain for an existing token, simply add an entry to the `addresses` map.

### When to use `expandMultiChain` versus manual entries

Use `expandMultiChain` when the same contract interface (ABI + methods) is deployed at different addresses on multiple chains. Use manual `ContractConnector` entries when:

- Each chain deployment has a different ABI (e.g., proxy vs. implementation).
- You need different method shortcuts per chain.
- The contract exists on only one chain.

## Existing Connector Reference: ERC-20 Tokens

The `src/connectors/erc20.ts` file is a good reference for how to structure connector files. It uses the `expandMultiChain` pattern described above. Here is how it is organized:

```typescript
import { expandMultiChain } from "../services/contract/types.js";

// Full ERC-20 ABI conforming to EIP-20
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
  // Events included for completeness
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

// Shared method shortcuts for all ERC-20 connectors
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
```

Key patterns to follow:

1. **Define the ABI as `as const`** -- This preserves the literal types that viem uses for type-safe encoding.
2. **Share method shortcuts** -- If multiple deployments of the same contract type use the same method aliases, define the methods object once and reuse it.
3. **Use `expandMultiChain`** -- For contracts deployed at different addresses on multiple chains, use the `expandMultiChain` helper to avoid duplication.
4. **Export an array** -- Each file exports a `ContractConnector[]` array that gets spread into the main connectors list.
5. **Comment each deployment** -- Include the chain and any relevant context (e.g., "Proxy contract address", "Native USDC issued by Circle").

## Using Method Shortcuts

The `methods` field in the connector maps short, human-friendly names to actual Solidity function names. When calling the contract through the API, you can use either the shortcut name or the actual function name. The `ContractExecutor` resolves the mapping:

```typescript
// Inside ContractExecutor.execute:
const methodEntry = connector.methods?.[request.method];
const functionName = methodEntry ? methodEntry.functionName : request.method;
```

So both of these are equivalent:

```bash
# Using the shortcut "balance"
curl -X POST http://localhost:3000/api/contracts/read \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "contractName": "usdc", "chainId": 1, "method": "balance", "args": ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"] }'

# Using the actual function name "balanceOf"
curl -X POST http://localhost:3000/api/contracts/read \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "contractName": "usdc", "chainId": 1, "method": "balanceOf", "args": ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"] }'
```

## Reading from Contracts

Use `POST /api/contracts/read` for view/pure functions that do not modify state. This endpoint requires Privy authentication:

```bash
curl -X POST http://localhost:3000/api/contracts/read \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contractName": "usdc",
    "chainId": 1,
    "method": "balanceOf",
    "args": ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]
  }'
```

Response:

```json
{
  "success": true,
  "data": {
    "result": "1000000000"
  }
}
```

Under the hood, `ContractExecutor.readContract` creates a viem `PublicClient` for the chain and calls `client.readContract(...)`. No wallet or transaction is involved.

## Writing to Contracts (Send Transactions)

Use `POST /api/transactions/contract` to execute state-changing functions. This goes through the full transaction lifecycle: ledger intent creation, ABI encoding, wallet signing, and status tracking. This endpoint requires Privy authentication and verifies that the authenticated user owns the specified wallet:

```bash
curl -X POST http://localhost:3000/api/transactions/contract \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "your-wallet-db-id",
    "walletType": "user",
    "contractName": "usdc",
    "chainId": 1,
    "method": "send",
    "args": ["0xRecipientAddress", "1000000"],
    "categoryId": "optional-category-id"
  }'
```

Note that `userId` is no longer passed in the request body -- it is automatically set from the authenticated user's Privy DID.

Response:

```json
{
  "success": true,
  "data": {
    "id": "tx-uuid",
    "walletId": "your-wallet-db-id",
    "walletType": "user",
    "chainId": "1",
    "contractId": "usdc",
    "method": "send",
    "payload": { "args": ["0xRecipientAddress", "1000000"] },
    "status": "submitted",
    "txHash": "0xabc123...",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

### What happens internally

1. `TransactionService.submitContractTransaction` creates a ledger intent via `LedgerService.createIntent` (status: `pending`).
2. `ContractExecutor.execute` looks up the connector in `ContractRegistry`, resolves method shortcuts, encodes function data with `viem.encodeFunctionData`, then calls `WalletInstance.sendTransaction`.
3. If execution succeeds, `LedgerService.markSubmitted` updates the intent with the tx hash (status: `submitted`).
4. If execution fails, `LedgerService.markFailed` records the error (status: `failed`).

## Registering the Same Contract on Multiple Chains

Connectors are keyed by `name:chainId`, so you can define the same logical contract on different chains. Simply add multiple entries to your connector array with the same `name` but different `chainId` and `address` values:

```typescript
export const myTokenConnectors: ContractConnector[] = [
  {
    name: "mytoken",
    chainId: 1,
    address: "0x1111111111111111111111111111111111111111",
    abi: MY_TOKEN_ABI,
    methods: myTokenMethods,
  },
  {
    name: "mytoken",
    chainId: 137,
    address: "0x2222222222222222222222222222222222222222",
    abi: MY_TOKEN_ABI,
    methods: myTokenMethods,
  },
];
```

When calling the contract through the API, the `chainId` parameter selects which deployment to use.

## Listing Registered Contracts

All registered connectors can be viewed through the read-only API:

```bash
# List all registered contracts
curl http://localhost:3000/api/contracts \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"

# Get a specific contract
curl http://localhost:3000/api/contracts/usdc/1 \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

## Error Handling

Two error types are relevant when working with contracts:

- `ContractNotFoundError` -- Returned when you try to `get`, `execute`, or `readContract` with a name/chainId combination that is not in the registry.
- `ContractExecutionError` -- Returned when ABI encoding fails or the on-chain call fails.

Both include a `_tag` field that lets you identify them in API responses:

```json
{
  "success": false,
  "error": {
    "_tag": "ContractNotFoundError",
    "message": "ContractNotFoundError: {\"name\":\"usdc\",\"chainId\":42161}"
  }
}
```
