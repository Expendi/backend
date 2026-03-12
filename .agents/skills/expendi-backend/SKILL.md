# Expendi Backend API -- Frontend Integration Skill

## 1. Overview

Expendi is a crypto financial backend built with **Hono + Effect-TS** on Node.js, deployed on the **Base** chain (chain ID `8453`). It provides:

- **Wallet management** -- three wallets per user (user, server, agent) via Privy embedded wallets
- **Transaction execution** -- contract calls and raw transactions on Base (with optional gas sponsorship)
- **Recurring payments** -- scheduled ERC-20 transfers, raw transfers, contract calls, and offramps
- **Yield positions** -- deposit into ERC-4626 vaults with time-locked positions
- **Offramp to African mobile money** -- via Pretium (Kenya, Nigeria, Ghana, Uganda, DR Congo, Malawi, Ethiopia)
- **Token swaps** -- Uniswap V3 swaps on Base
- **Transaction categories** -- user-defined and global categories with spending limits and analytics
- **Swap automations** -- scheduled recurring Uniswap swaps (DCA)
- **Group accounts** -- shared expense groups with member deposits, payouts, and admin controls
- **Split expenses** -- create and track shared expense splits within groups
- **Goal savings** -- savings goals with manual and automated deposits
- **Transaction approval** -- optional PIN or passkey (WebAuthn) gating on sensitive mutations
- **AI chat agent** -- SSE streaming chat endpoint powered by Glove Core (supports Anthropic, OpenAI, OpenRouter, Gemini, etc.)
- **Onramp from fiat** -- via Pretium (receive crypto by paying with mobile money or bank transfer)

The backend base URL defaults to `http://localhost:3000` in development.

---

## 2. Authentication

### Public API (`/api/*`) -- Privy Access Token

All `/api/*` routes require a Privy access token:

```
Authorization: Bearer <privy-access-token>
```

The token is obtained from the Privy SDK after the user authenticates (email, social login, or wallet connect).

### Development Bypass

When the backend runs with `NODE_ENV=development`, you can skip real Privy auth by sending:

```
X-Dev-User-Id: <any-string-you-choose>
```

This sets the authenticated user ID to whatever string you provide. Useful for local development without Privy setup.

### Admin API (`/internal/*`) -- API Key

```
X-Admin-Key: <admin-api-key>
```

The key matches the `ADMIN_API_KEY` environment variable on the backend. These routes are not for end-users.

### Webhooks (`/webhooks/*`) -- No Auth

Webhook endpoints accept POST requests without authentication. In production, protect with IP allowlisting.

---

## 3. Response Format

All endpoints return consistent JSON shapes.

**Success (HTTP 200 or 201):**
```json
{
  "success": true,
  "data": { ... }
}
```

**Known/domain error (HTTP 400):**
```json
{
  "success": false,
  "error": {
    "_tag": "ErrorType",
    "message": "Human-readable description"
  }
}
```

**Authentication error (HTTP 401):**
```json
{ "error": "Unauthorized" }
```

**Forbidden (HTTP 403):**
```json
{ "error": "Forbidden" }
```

**Internal error (HTTP 500):**
```json
{
  "success": false,
  "error": {
    "_tag": "InternalError",
    "message": "..."
  }
}
```

---

## 4. Onboarding Flow

Users must be onboarded before using wallets, transactions, or any feature that requires a wallet. Onboarding is **idempotent** -- calling it multiple times for the same user returns the existing profile.

1. Authenticate with Privy (get access token)
2. `POST /api/onboard` with optional `{ "chainId": 8453 }` body
3. Backend creates 3 Privy embedded wallets (user, server, agent) and a user profile
4. Response includes the profile with wallet IDs and addresses
5. Use wallet IDs in subsequent API calls (transactions, swaps, yield, etc.)

```typescript
// After Privy login:
const res = await api.post("/api/onboard", { chainId: 8453 });
const { profile, wallets } = res.data;
// wallets.user.address  -- user's wallet address
// wallets.server.address -- server-side wallet address
// wallets.agent.address -- AI agent wallet address
```

---

## 5. Complete Endpoint Reference

### 5.1 Health and Discovery

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | None | Returns API name, version, and available endpoint groups |
| GET | `/health` | None | Returns `{ "status": "ok", "timestamp": "..." }` |

### 5.2 Onboarding and Profile

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/onboard` | Privy | `{ chainId?: number }` | `{ profile: { id, privyUserId, userWalletId, serverWalletId, agentWalletId, createdAt, updatedAt }, wallets: { user: Wallet, server: Wallet, agent: Wallet } }` |
| GET | `/api/profile` | Privy | -- | Full profile with wallet objects (id, type, privyWalletId, ownerId, address, chainId, createdAt) |
| PUT | `/api/profile/username` | Privy | `{ username: string }` | Claim or update username |
| GET | `/api/profile/resolve/:username` | Privy | -- | Resolve username to wallet address |
| GET | `/api/profile/preferences` | Privy | -- | Get user preferences (theme, defaults, notifications) |
| PATCH | `/api/profile/preferences` | Privy | `{ theme?: string, ... }` | Merge-update user preferences |
| GET | `/api/profile/wallets` | Privy | -- | `{ user: "0x...", server: "0x...", agent: "0x..." }` (addresses only) |

### 5.3 Wallets

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/wallets` | Privy | -- | Array of user's wallets: `[{ id, type, privyWalletId, ownerId, address, chainId, createdAt }]` |
| GET | `/api/wallets/balances` | Privy | -- | On-chain token balances for all user's wallets (symbol, decimals, raw balance, formatted) |
| GET | `/api/wallets/:id` | Privy | -- | Single wallet object (must be owned by the authenticated user) |
| POST | `/api/wallets/user` | Privy | -- | `{ address: "0x...", type: "user" }` |
| POST | `/api/wallets/:id/sign` | Privy | `{ message: string }` | `{ signature: "0x..." }` |

**Wallet object shape:**
```typescript
interface Wallet {
  id: string;            // UUID
  type: "user" | "server" | "agent";
  privyWalletId: string;
  ownerId: string;       // Privy user DID
  address: string | null; // 0x address
  chainId: string | null;
  createdAt: string;     // ISO 8601
}
```

### 5.4 Transactions

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/transactions` | Privy | -- | Array of user's transactions |
| GET | `/api/transactions/:id` | Privy | -- | Single transaction (must be owned by user) |
| POST | `/api/transactions/contract` | Privy | See below | Transaction result with `id`, `txHash`, `status` |
| POST | `/api/transactions/raw` | Privy | See below | Transaction result with `id`, `txHash`, `status` |

**POST `/api/transactions/contract` body:**
```typescript
{
  walletId?: string;        // Direct wallet ID (optional if walletType given)
  walletType: "user" | "server" | "agent"; // Resolves wallet from profile
  contractName: string;     // Registered contract name
  chainId?: number;         // Defaults to backend default chain
  method: string;           // Contract method name
  args: unknown[];          // Method arguments
  value?: string;           // Wei value as string (optional)
  categoryId?: string;      // Transaction category UUID (optional)
}
```

**POST `/api/transactions/raw` body:**
```typescript
{
  walletId?: string;
  walletType: "user" | "server" | "agent";
  chainId?: number;
  to: `0x${string}`;       // Destination address
  data?: `0x${string}`;    // Calldata (optional)
  value?: string;           // Wei value as string (optional)
  categoryId?: string;
  sponsor?: boolean;        // Enable Privy gas sponsorship (optional)
}
```

**Transaction object shape:**
```typescript
interface Transaction {
  id: string;
  walletId: string;
  walletType: "user" | "server" | "agent";
  chainId: string;
  contractId: string | null;
  method: string;
  payload: Record<string, unknown>;
  status: "pending" | "submitted" | "confirmed" | "failed";
  txHash: string | null;
  gasUsed: string | null;   // bigint as string
  categoryId: string | null;
  userId: string | null;
  error: string | null;
  createdAt: string;
  confirmedAt: string | null;
}
```

### 5.5 Transaction Categories

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/categories` | Privy | -- | Array of global + user's categories |
| GET | `/api/categories/:id` | Privy | -- | Single category |
| POST | `/api/categories` | Privy | `{ name: string, description?: string }` | Created category |
| PUT | `/api/categories/:id` | Privy | `{ name?: string, description?: string }` | Updated category (user-owned only) |
| DELETE | `/api/categories/:id` | Privy | -- | `{ deleted: true, id: "..." }` (user-owned only) |
| GET | `/api/categories/limits` | Privy | -- | All spending limits for the user |
| GET | `/api/categories/:id/limit` | Privy | -- | Limit for a specific category |
| PUT | `/api/categories/:id/limit` | Privy | `{ amount: string }` | Set/update spending limit (upsert) |
| DELETE | `/api/categories/:id/limit` | Privy | -- | Remove spending limit |
| GET | `/api/categories/spending` | Privy | Query: `?from=&to=` | Spending per category for period (default: current month) |
| GET | `/api/categories/spending/daily` | Privy | Query: `?from=&to=` | Daily spending breakdown for charts |

### 5.6 Recurring Payments

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/recurring-payments` | Privy | -- | Array of user's schedules |
| GET | `/api/recurring-payments/:id` | Privy | -- | Single schedule |
| POST | `/api/recurring-payments` | Privy | See below | Created schedule (HTTP 201) |
| POST | `/api/recurring-payments/:id/pause` | Privy | -- | Updated schedule |
| POST | `/api/recurring-payments/:id/resume` | Privy | -- | Updated schedule |
| POST | `/api/recurring-payments/:id/cancel` | Privy | -- | Updated schedule |
| GET | `/api/recurring-payments/:id/executions` | Privy | Query: `?limit=50` | Array of execution records |

**POST `/api/recurring-payments` body:**
```typescript
{
  walletId?: string;
  walletType: "user" | "server" | "agent";
  recipientAddress: string;    // 0x address
  paymentType: "erc20_transfer" | "raw_transfer" | "contract_call" | "offramp";
  amount: string;              // Token amount as string
  tokenContractName?: string;  // For erc20_transfer
  contractName?: string;       // For contract_call
  contractMethod?: string;     // For contract_call
  contractArgs?: unknown[];    // For contract_call
  chainId?: number;
  frequency: string;           // Interval: "5m", "1h", "1d", "7d", "30d"
  startDate?: string;          // ISO 8601 (defaults to now)
  endDate?: string;            // ISO 8601 (optional)
  maxRetries?: number;         // Default: 3
  offramp?: {                  // For offramp payment type
    currency: string;
    fiatAmount: string;
    provider: string;
    destinationId: string;
    metadata?: Record<string, unknown>;
  };
}
```

**Schedule object shape:**
```typescript
interface RecurringPayment {
  id: string;
  userId: string;
  walletId: string;
  walletType: "user" | "server" | "agent";
  recipientAddress: string;
  paymentType: "erc20_transfer" | "raw_transfer" | "contract_call" | "offramp";
  amount: string;
  tokenContractName: string | null;
  contractName: string | null;
  contractMethod: string | null;
  contractArgs: unknown[] | null;
  chainId: number;
  isOfframp: boolean;
  offrampCurrency: string | null;
  offrampFiatAmount: string | null;
  offrampProvider: string | null;
  offrampDestinationId: string | null;
  offrampMetadata: Record<string, unknown> | null;
  frequency: string;
  status: "active" | "paused" | "cancelled" | "completed" | "failed";
  startDate: string;
  endDate: string | null;
  nextExecutionAt: string;
  maxRetries: number;
  consecutiveFailures: number;
  totalExecutions: number;
  createdAt: string;
  updatedAt: string;
}
```

### 5.7 Yield

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/yield/vaults` | Privy | Query: `?chainId=8453` | Array of active vaults |
| GET | `/api/yield/vaults/:id` | Privy | -- | Single vault |
| POST | `/api/yield/positions` | Privy | See below | Created position (HTTP 201) |
| GET | `/api/yield/positions` | Privy | -- | Array of user's positions |
| GET | `/api/yield/positions/:id` | Privy | -- | Single position |
| POST | `/api/yield/positions/:id/withdraw` | Privy | `{ walletId?: string, walletType: "user" \| "server" \| "agent" }` | Withdrawal result |
| GET | `/api/yield/positions/:id/history` | Privy | Query: `?limit=50` | Array of yield snapshots |
| GET | `/api/yield/portfolio` | Privy | -- | Portfolio summary (totals, APY) |

**POST `/api/yield/positions` body:**
```typescript
{
  walletId?: string;
  walletType: "user" | "server" | "agent";
  vaultId: string;        // UUID of the vault
  amount: string;          // Deposit amount as string
  unlockTime: number;      // Unix timestamp for maturity
  label?: string;          // Optional label
  chainId?: number;
}
```

### 5.8 Pretium (On/Offramp — African Mobile Money / Bank)

#### Country and Payment Info

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/pretium/countries` | Privy | -- | Array of supported countries with payment configs |
| GET | `/api/pretium/countries/:code` | Privy | -- | Single country details (code is uppercase: KE, NG, GH, etc.) |

#### Exchange Rates

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/pretium/exchange-rate/:currency` | Privy | -- | Exchange rate for currency (e.g., KES, NGN) |
| POST | `/api/pretium/convert/usdc-to-fiat` | Privy | `{ usdcAmount: number, currency: string }` | `{ amount, exchangeRate, ... }` |
| POST | `/api/pretium/convert/fiat-to-usdc` | Privy | `{ fiatAmount: number, currency: string }` | `{ amount, exchangeRate, ... }` |

#### Validation

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/pretium/validate/phone` | Privy | `{ country: string, phoneNumber: string, network: string }` | Name lookup result (KE, GH, UG only) |
| POST | `/api/pretium/validate/bank-account` | Privy | `{ country: string, accountNumber: string, bankCode: string }` | Name lookup result (NG only) |

#### Banks

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/pretium/banks/:country` | Privy | -- | Array of banks (NG and KE only) |

#### Settlement

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/pretium/settlement-address` | Privy | -- | `{ address: "0x...", chain: "BASE" }` |

#### Offramp

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/pretium/offramp` | Privy | See below | `{ transaction, pretiumResponse }` (HTTP 201) |
| GET | `/api/pretium/offramp` | Privy | Query: `?limit=50&offset=0` | Array of user's offramp transactions |
| GET | `/api/pretium/offramp/:id` | Privy | -- | Single offramp transaction |
| POST | `/api/pretium/offramp/:id/refresh` | Privy | -- | `{ transaction, pretiumStatus }` (polls Pretium for latest status) |

**POST `/api/pretium/offramp` body:**
```typescript
{
  country: string;            // "KE", "NG", "GH", "UG", "CD", "MW", "ET"
  walletId: string;           // Wallet that sent the USDC
  usdcAmount: number;         // USDC amount (not wei, e.g., 10.5)
  phoneNumber: string;        // Recipient phone number
  mobileNetwork: string;      // e.g., "safaricom", "mtn", "airtel"
  transactionHash: string;    // On-chain tx hash of USDC transfer to settlement
  paymentType?: string;       // "MOBILE" | "BUY_GOODS" | "PAYBILL" | "BANK_TRANSFER"
  accountNumber?: string;     // For PAYBILL payments
  accountName?: string;       // For NG bank transfers
  bankAccount?: string;       // Bank account number
  bankCode?: string;          // Bank code
  bankName?: string;          // Bank name
  callbackUrl?: string;       // Webhook URL for status updates
  fee?: number;               // Fee amount
}
```

**Supported countries and currencies:**

| Country | Code | Currency | Mobile Networks | Payment Types |
|---------|------|----------|-----------------|---------------|
| Kenya | KE | KES | safaricom, airtel | MOBILE, BUY_GOODS, PAYBILL, BANK_TRANSFER |
| Nigeria | NG | NGN | -- | BANK_TRANSFER |
| Ghana | GH | GHS | mtn, vodafone, airtel | MOBILE |
| Uganda | UG | UGX | mtn, airtel | MOBILE |
| DR Congo | CD | CDF | vodacom, airtel, orange | MOBILE |
| Malawi | MW | MWK | airtel, tnm | MOBILE |
| Ethiopia | ET | ETB | telebirr | MOBILE |

**Offramp transaction statuses:** `pending` | `processing` | `completed` | `failed` | `reversed`

#### Onramp (Fiat to Crypto)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/pretium/onramp/countries` | Privy | -- | List onramp-supported countries |
| POST | `/api/pretium/onramp` | Privy | `{ country, walletId, fiatAmount, currency, ... }` | Initiate onramp (HTTP 201) |
| GET | `/api/pretium/onramp` | Privy | Query: `?limit=50&offset=0` | List user's onramp transactions |
| GET | `/api/pretium/onramp/:id` | Privy | -- | Get onramp transaction |
| POST | `/api/pretium/onramp/:id/refresh` | Privy | -- | Poll Pretium for latest status |

> **Note:** Pretium expects local phone numbers without the country code prefix for mobile network payments.

### 5.9 Uniswap (Token Swaps on Base)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/uniswap/check-approval` | Privy | `{ walletId: string, tokenIn: string, amount: string }` | `{ approval: { to, data, value } \| null }` |
| POST | `/api/uniswap/quote` | Privy | See below | Quote with routing, input/output amounts, gas fee |
| POST | `/api/uniswap/swap` | Privy | See below | `{ approvalTxId?, swapTxId, swapTxHash, quote: { routing, input, output, gasFeeUSD } }` |

**POST `/api/uniswap/quote` body:**
```typescript
{
  walletId: string;
  tokenIn: string;           // Token address (see table below)
  tokenOut: string;          // Token address
  amount: string;            // Amount in token units (wei for ETH, 6 decimals for USDC)
  type?: "EXACT_INPUT" | "EXACT_OUTPUT";  // Default: EXACT_INPUT
  slippageTolerance?: number; // e.g., 0.5 for 0.5%
}
```

**POST `/api/uniswap/swap` body:** Same as quote body. The backend handles approval, quoting, and swap execution in a single call.

All Uniswap operations are on **Base (chain ID 8453)**.

### 5.10 Swap Automations (DCA)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/swap-automations` | Privy | -- | Array of user's automations |
| GET | `/api/swap-automations/:id` | Privy | -- | Single automation |
| POST | `/api/swap-automations` | Privy | See below | Created automation (HTTP 201) |
| PATCH | `/api/swap-automations/:id` | Privy | Partial update | Updated automation |
| POST | `/api/swap-automations/:id/pause` | Privy | -- | Paused |
| POST | `/api/swap-automations/:id/resume` | Privy | -- | Resumed |
| POST | `/api/swap-automations/:id/cancel` | Privy | -- | Cancelled |
| GET | `/api/swap-automations/:id/executions` | Privy | Query: `?limit=50` | Execution history |

### 5.11 Group Accounts

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/groups` | Privy | `{ name: string, tokenAddress: string, ... }` | Created group (HTTP 201) |
| GET | `/api/groups` | Privy | -- | Array of user's groups |
| GET | `/api/groups/:id` | Privy | -- | Group with members |
| GET | `/api/groups/:id/members` | Privy | -- | Members with usernames + addresses |
| POST | `/api/groups/:id/members` | Privy | `{ userId: string }` | Add member (admin only, HTTP 201) |
| DELETE | `/api/groups/:id/members/:identifier` | Privy | -- | Remove member (admin only) |
| POST | `/api/groups/:id/pay` | Privy | `{ walletId, amount, recipientAddress, ... }` | Admin payout (approval required) |
| POST | `/api/groups/:id/deposit` | Privy | `{ walletId, amount, ... }` | Member deposit (approval required) |
| POST | `/api/groups/:id/transfer-admin` | Privy | `{ newAdminId: string }` | Transfer admin role |
| GET | `/api/groups/:id/balance` | Privy | Query: `?tokens=0x...` | Group balance for specified tokens |

### 5.12 Split Expenses

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/split-expenses` | Privy | See below | Created expense (HTTP 201) |
| GET | `/api/split-expenses` | Privy | -- | Array of user's split expenses |
| GET | `/api/split-expenses/:id` | Privy | -- | Expense with shares |
| POST | `/api/split-expenses/:id/pay` | Privy | `{ walletId: string, walletType: "user" \| "server" \| "agent" }` | Pay your share |
| DELETE | `/api/split-expenses/:id` | Privy | -- | Cancel expense (creator only) |

**POST `/api/split-expenses` body:**
```typescript
{
  title: string;
  tokenAddress: string;        // ERC-20 token address
  tokenSymbol: string;
  tokenDecimals: number;
  totalAmount: string;         // Total amount in smallest unit
  chainId: number;
  transactionId?: string;      // Optional linked transaction
  shares: { userId: string; amount: string }[];
}
```

### 5.13 Goal Savings

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/goal-savings` | Privy | -- | Array of user's goals |
| POST | `/api/goal-savings` | Privy | `{ name, targetAmount, tokenAddress, ... }` | Created goal (HTTP 201) |
| GET | `/api/goal-savings/:id` | Privy | -- | Goal details (ownership check) |
| PATCH | `/api/goal-savings/:id` | Privy | Partial update | Updated goal |
| POST | `/api/goal-savings/:id/pause` | Privy | -- | Paused |
| POST | `/api/goal-savings/:id/resume` | Privy | -- | Resumed |
| POST | `/api/goal-savings/:id/cancel` | Privy | -- | Cancelled |
| POST | `/api/goal-savings/:id/deposit` | Privy | `{ walletId, amount, ... }` | Manual deposit (HTTP 201) |
| GET | `/api/goal-savings/:id/deposits` | Privy | Query: `?limit=50` | Deposit history |

### 5.14 Transaction Approval / Security

Users can optionally protect sensitive mutations (transfers, swaps, on/offramp, yield) with a PIN or passkey (WebAuthn). When enabled, the frontend must obtain an approval token before calling protected routes.

**Flow:**
1. User enables approval via `POST /api/security/approval/pin/setup` or passkey registration
2. Before a protected mutation, call `POST /api/security/approval/verify` with PIN or passkey assertion
3. Receive an `X-Approval-Token` (HMAC-SHA256 signed, 5-minute TTL)
4. Include the token in the `X-Approval-Token` header on the protected request

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/security/approval` | Privy | -- | `{ enabled, method, passkeyCount }` |
| POST | `/api/security/approval/pin/setup` | Privy | `{ pin: string }` | Set up PIN (4-6 digits) |
| POST | `/api/security/approval/pin/change` | Privy | `{ currentPin, newPin }` | Change PIN |
| DELETE | `/api/security/approval/pin` | Privy | `{ pin: string }` | Remove PIN (requires verification) |
| POST | `/api/security/approval/passkey/register` | Privy | -- | WebAuthn registration options |
| POST | `/api/security/approval/passkey/register/verify` | Privy | WebAuthn attestation response | Complete registration |
| GET | `/api/security/approval/passkeys` | Privy | -- | List registered passkeys |
| DELETE | `/api/security/approval/passkeys/:id` | Privy | -- | Remove passkey |
| POST | `/api/security/approval/verify` | Privy | `{ method: "pin" \| "passkey", pin?: string, assertion?: object }` | Returns `{ token: "..." }` (5-min TTL) |
| DELETE | `/api/security/approval` | Privy | -- | Disable approval entirely |

**Protected routes (require `X-Approval-Token` header when approval is enabled):**
- `POST /api/transactions/*`
- `POST /api/wallets/transfer`
- `POST /api/pretium/onramp`, `POST /api/pretium/offramp`
- `POST /api/yield/positions`, `POST /api/yield/positions/:id/withdraw`
- `POST /api/uniswap/swap`
- `POST /api/groups/:id/pay`, `POST /api/groups/:id/deposit`

**Security details:**
- PIN: 4-6 digits, bcrypt-hashed (12 rounds), rate-limited (5 attempts → 15-minute lockout)
- Passkey: WebAuthn standard with counter-based replay protection
- Approval tokens: HMAC-SHA256 with 5-minute expiry

### 5.15 Chat / AI Agent

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/chat` | Privy | See below | SSE stream |

**Request body:**
```typescript
{
  systemPrompt: string;
  messages: { sender: "user" | "agent"; text: string; tool_calls?: ToolCall[] }[];
  tools?: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;  // JSON Schema
  }[];
}
```

**SSE events:**
- `text_delta` — `{ type: "text_delta", text: "..." }` — streaming text chunk from the model
- `tool_use` — `{ type: "tool_use", id: "...", name: "...", input: {...} }` — tool invocation (tools execute client-side, NOT on the server)
- `done` — `{ type: "done", message: {...}, tokens_in: N, tokens_out: N }` — stream complete

**LLM configuration (backend env vars):**
| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `anthropic` | Provider: `anthropic`, `openai`, `openrouter`, `gemini`, etc. |
| `LLM_MODEL` | Provider default | Model ID |
| `LLM_API_KEY` | Provider env var | API key (falls back to e.g. `ANTHROPIC_API_KEY`) |
| `LLM_BASE_URL` | Provider default | Custom base URL for OpenAI-compatible providers |
| `LLM_MAX_TOKENS` | `4096` | Max tokens per response |
| `LLM_FORMAT` | Auto | SDK format: `openai`, `anthropic`, or `bedrock` |

Unknown providers are automatically registered as OpenAI-compatible at runtime.

### 5.16 Webhooks

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| POST | `/webhooks/pretium` | None | `{ transaction_code, status, receipt_number?, failure_reason?, amount?, currency_code? }` | Pretium payment status callback |

### 5.17 Internal/Admin API

All internal routes require `X-Admin-Key` header. These are not for frontend use in normal flows but are listed for completeness.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/internal/wallets` | List all wallets |
| POST | `/internal/wallets/server` | Create server wallet |
| POST | `/internal/wallets/agent` | Create agent wallet (body: `{ agentId }`) |
| GET | `/internal/transactions` | List all transactions (`?limit&offset`) |
| GET | `/internal/transactions/wallet/:walletId` | Transactions by wallet |
| GET | `/internal/transactions/user/:userId` | Transactions by user |
| PATCH | `/internal/transactions/:id/confirm` | Mark confirmed (body: `{ gasUsed? }`) |
| PATCH | `/internal/transactions/:id/fail` | Mark failed (body: `{ error }`) |
| GET | `/internal/jobs` | List jobs |
| GET | `/internal/jobs/:id` | Get job |
| POST | `/internal/jobs` | Create job |
| POST | `/internal/jobs/:id/cancel` | Cancel job |
| POST | `/internal/jobs/process` | Process due jobs |
| GET | `/internal/profiles` | List all profiles |
| GET | `/internal/profiles/:privyUserId` | Get profile with wallets |
| POST | `/internal/profiles/:privyUserId/onboard` | Admin onboard user |
| GET | `/internal/recurring-payments` | List all schedules |
| GET | `/internal/recurring-payments/:id` | Get schedule |
| POST | `/internal/recurring-payments/:id/execute` | Force-execute schedule |
| GET | `/internal/recurring-payments/:id/executions` | Execution history |
| POST | `/internal/recurring-payments/process` | Process all due payments |
| GET | `/internal/yield/vaults` | List all vaults (including inactive) |
| POST | `/internal/yield/vaults` | Add vault |
| DELETE | `/internal/yield/vaults/:id` | Deactivate vault |
| POST | `/internal/yield/vaults/sync` | Sync vaults from chain |
| GET | `/internal/yield/positions` | List all positions |
| POST | `/internal/yield/snapshots/run` | Trigger yield snapshots |
| POST | `/internal/goal-savings/process` | Process due goal deposits |

---

## 6. Base Chain Token Addresses (for Uniswap)

| Token | Address | Decimals |
|-------|---------|----------|
| ETH (native) | `0x0000000000000000000000000000000000000000` | 18 |
| WETH | `0x4200000000000000000000000000000000000006` | 18 |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| USDbC (bridged) | `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6Ca` | 6 |

When specifying `amount` for Uniswap endpoints, use the token's smallest unit:
- ETH/WETH: wei (multiply by 10^18), e.g., "1000000000000000000" for 1 ETH
- USDC/USDbC: 6 decimals, e.g., "1000000" for 1 USDC

---

## 7. Frontend Integration Patterns

### 7.1 Setting Up Privy Auth in React

```typescript
// providers.tsx
import { PrivyProvider } from "@privy-io/react-auth";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["email", "wallet", "google", "apple"],
        appearance: {
          theme: "dark",
        },
        embeddedWallets: {
          createOnLogin: "off", // Backend handles wallet creation via onboarding
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
```

### 7.2 Creating an API Client

```typescript
// lib/api.ts
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    body?: unknown;
    accessToken: string | null;
  }
): Promise<{ success: true; data: T } | { success: false; error: { _tag: string; message: string } }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.accessToken) {
    headers["Authorization"] = `Bearer ${options.accessToken}`;
  } else if (process.env.NODE_ENV === "development") {
    // Dev bypass -- use a stable user ID for local testing
    headers["X-Dev-User-Id"] = "dev-user-1";
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    throw new Error("Unauthorized -- access token expired or invalid");
  }

  if (res.status === 403) {
    throw new Error("Forbidden -- insufficient permissions");
  }

  return res.json();
}
```

### 7.3 Using the API Client with Privy

```typescript
// hooks/use-api.ts
import { usePrivy } from "@privy-io/react-auth";
import { apiRequest } from "../lib/api";

export function useApi() {
  const { getAccessToken } = usePrivy();

  async function request<T>(
    path: string,
    options?: { method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; body?: unknown }
  ) {
    const accessToken = await getAccessToken();
    const result = await apiRequest<T>(path, {
      ...options,
      accessToken,
    });

    if (!result.success) {
      throw new Error(`${result.error._tag}: ${result.error.message}`);
    }

    return result.data;
  }

  return { request };
}
```

### 7.4 Onboarding Flow

```typescript
// components/onboard-button.tsx
import { useApi } from "../hooks/use-api";

interface OnboardResult {
  profile: {
    id: string;
    privyUserId: string;
    userWalletId: string;
    serverWalletId: string;
    agentWalletId: string;
  };
  wallets: {
    user: { id: string; address: string; type: "user" };
    server: { id: string; address: string; type: "server" };
    agent: { id: string; address: string; type: "agent" };
  };
}

function OnboardButton() {
  const { request } = useApi();

  async function handleOnboard() {
    const result = await request<OnboardResult>("/api/onboard", {
      method: "POST",
      body: { chainId: 8453 },
    });

    console.log("User wallet:", result.wallets.user.address);
    console.log("Server wallet:", result.wallets.server.address);
    console.log("Agent wallet:", result.wallets.agent.address);
  }

  return <button onClick={handleOnboard}>Set Up Account</button>;
}
```

### 7.5 Listing Wallets and Transactions

```typescript
// Fetch wallets
const wallets = await request<Wallet[]>("/api/wallets");

// Fetch wallet addresses only
const addresses = await request<{ user: string; server: string; agent: string }>(
  "/api/profile/wallets"
);

// Fetch transactions
const transactions = await request<Transaction[]>("/api/transactions");

// Fetch single transaction
const tx = await request<Transaction>(`/api/transactions/${txId}`);
```

### 7.6 Submitting a USDC Transfer

To send USDC, use a raw transaction that calls the ERC-20 `transfer` function, or use the contract transaction endpoint with a registered contract name.

```typescript
import { encodeFunctionData, parseUnits } from "viem";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Encode ERC-20 transfer calldata
const data = encodeFunctionData({
  abi: [
    {
      name: "transfer",
      type: "function",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ type: "bool" }],
    },
  ],
  functionName: "transfer",
  args: [recipientAddress, parseUnits("10", 6)], // 10 USDC
});

const result = await request<Transaction>("/api/transactions/raw", {
  method: "POST",
  body: {
    walletType: "server",    // Use the server wallet
    to: USDC_ADDRESS,
    data,
    chainId: 8453,
  },
});

console.log("TX hash:", result.txHash);
```

### 7.7 Getting a Swap Quote and Executing a Swap

```typescript
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";

// Step 1: Get a quote (read-only, no transaction submitted)
const quote = await request("/api/uniswap/quote", {
  method: "POST",
  body: {
    walletId: userWalletId,
    tokenIn: USDC,
    tokenOut: WETH,
    amount: "10000000",      // 10 USDC (6 decimals)
    type: "EXACT_INPUT",
    slippageTolerance: 0.5,  // 0.5%
  },
});

// Step 2: Execute the swap (handles approval + quote + execution)
const swapResult = await request("/api/uniswap/swap", {
  method: "POST",
  body: {
    walletId: userWalletId,
    tokenIn: USDC,
    tokenOut: WETH,
    amount: "10000000",
    type: "EXACT_INPUT",
    slippageTolerance: 0.5,
  },
});

// swapResult = {
//   approvalTxId: "..." | undefined,  // Set if token approval was needed
//   swapTxId: "...",
//   swapTxHash: "0x...",
//   quote: { routing, input, output, gasFeeUSD }
// }
```

### 7.8 Initiating an Offramp to Mobile Money

```typescript
import { encodeFunctionData, parseUnits } from "viem";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Step 1: Get the settlement address
const { address: settlementAddress } = await request<{ address: string; chain: string }>(
  "/api/pretium/settlement-address"
);

// Step 2: Get exchange rate
const conversion = await request("/api/pretium/convert/usdc-to-fiat", {
  method: "POST",
  body: { usdcAmount: 10, currency: "KES" },
});
// conversion.data = { amount: 1290.50, exchangeRate: 129.05, ... }

// Step 3: Send USDC to settlement address on-chain
const transferData = encodeFunctionData({
  abi: [{
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  }],
  functionName: "transfer",
  args: [settlementAddress, parseUnits("10", 6)],
});

const transferTx = await request<Transaction>("/api/transactions/raw", {
  method: "POST",
  body: {
    walletType: "server",
    to: USDC_ADDRESS,
    data: transferData,
    chainId: 8453,
  },
});

// Step 4: Initiate the offramp (disburse fiat)
const offramp = await request("/api/pretium/offramp", {
  method: "POST",
  body: {
    country: "KE",
    walletId: serverWalletId,
    usdcAmount: 10,
    phoneNumber: "254712345678",
    mobileNetwork: "safaricom",
    transactionHash: transferTx.txHash,
    paymentType: "MOBILE",
  },
});

// Step 5: Poll for status updates
const status = await request(`/api/pretium/offramp/${offramp.data.transaction.id}`);
// Or refresh from Pretium:
const refreshed = await request(`/api/pretium/offramp/${offramp.data.transaction.id}/refresh`, {
  method: "POST",
});
```

### 7.9 Creating a Recurring Payment

```typescript
// Monthly USDC payment
const schedule = await request("/api/recurring-payments", {
  method: "POST",
  body: {
    walletType: "server",
    recipientAddress: "0xRecipientAddress...",
    paymentType: "erc20_transfer",
    amount: "5000000",              // 5 USDC
    tokenContractName: "USDC",      // Registered contract name
    chainId: 8453,
    frequency: "30d",               // Every 30 days
    startDate: new Date().toISOString(),
    maxRetries: 3,
  },
});

// Pause it
await request(`/api/recurring-payments/${schedule.id}/pause`, { method: "POST" });

// Resume it
await request(`/api/recurring-payments/${schedule.id}/resume`, { method: "POST" });

// Cancel it
await request(`/api/recurring-payments/${schedule.id}/cancel`, { method: "POST" });

// Get execution history
const executions = await request(`/api/recurring-payments/${schedule.id}/executions`);
```

### 7.10 Transaction Approval Flow

```typescript
// 1. Check if approval is enabled
const settings = await request<{
  enabled: boolean;
  method: "pin" | "passkey" | null;
  passkeyCount: number;
}>("/api/security/approval");

// 2. If enabled, verify before protected mutations
if (settings.enabled) {
  let token: string;

  if (settings.method === "pin") {
    const pin = prompt("Enter your PIN:");
    const result = await request<{ token: string }>("/api/security/approval/verify", {
      method: "POST",
      body: { method: "pin", pin },
    });
    token = result.token;
  } else {
    // Passkey flow — use @simplewebauthn/browser
    const { startAuthentication } = await import("@simplewebauthn/browser");
    // Server generates challenge options internally during verify
    const assertion = await startAuthentication(/* options from verify flow */);
    const result = await request<{ token: string }>("/api/security/approval/verify", {
      method: "POST",
      body: { method: "passkey", assertion },
    });
    token = result.token;
  }

  // 3. Include token on protected request
  const headers = { "X-Approval-Token": token };
  await request("/api/wallets/transfer", {
    method: "POST",
    body: { walletType: "user", to: recipientAddress, amount: "1000000" },
    headers,
  });
}
```

### 7.11 AI Agent Chat (Glove Integration)

The demo app uses Glove React for the AI chat interface. The backend's `/api/chat` route streams SSE events. Tools execute client-side:

```typescript
import { GloveClient } from "glove-react";
import type { ToolConfig } from "glove-react";

// Define tools as Glove ToolConfig objects
const getBalances: ToolConfig = {
  name: "get_balances",
  description: "Get wallet balances for the authenticated user",
  inputSchema: z.object({}),
  async do() {
    const balances = await api.get("/api/wallets/balances");
    return { status: "success", data: balances };
  },
};

// Create client — Glove serializes tool schemas to JSON Schema
// and streams them to the backend's /api/chat SSE endpoint
const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You are a helpful crypto wallet assistant.",
  tools: [getBalances, /* ...other tools */],
});
```

The `GloveProvider` wraps the React app, and `useGlove()` provides the chat state (timeline, streaming text, slots, sendMessage, etc.).

---

## 8. Error Handling

### Error Tags

Domain errors returned in `error._tag` include:

| Error Tag | Description |
|-----------|-------------|
| `WalletError` | Wallet creation, resolution, or signing failure |
| `TransactionError` | Transaction submission or lookup failure |
| `LedgerError` | Ledger recording or query failure |
| `ContractExecutionError` | On-chain contract call failed |
| `ContractNotFoundError` | Contract name not found in registry |
| `OnboardingError` | User onboarding failure (e.g., Privy wallet creation issue) |
| `RecurringPaymentError` | Recurring payment schedule operation failure |
| `OfframpError` | Fiat disbursement failure via Pretium |
| `UniswapError` | Swap quote, approval, or execution failure |
| `YieldError` | Vault or position operation failure |
| `InternalError` | Unhandled server-side error |

### Frontend Error Handling Pattern

```typescript
async function safeRequest<T>(path: string, options?: { method?: string; body?: unknown }) {
  try {
    const result = await apiRequest<T>(path, {
      ...options,
      accessToken: await getAccessToken(),
    });

    if (!result.success) {
      const { _tag, message } = result.error;

      switch (_tag) {
        case "OnboardingError":
          // Prompt user to complete onboarding
          break;
        case "WalletError":
          // Wallet issue -- may need re-onboarding
          break;
        case "UniswapError":
          // Swap failed -- show error and suggest retry
          break;
        case "OfframpError":
          // Offramp failed -- check phone number, network, etc.
          break;
        default:
          // Generic error display
          break;
      }

      throw new ApiError(_tag, message);
    }

    return result.data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("NetworkError", "Failed to connect to server");
  }
}

class ApiError extends Error {
  constructor(public tag: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}
```

---

## 9. Environment Setup

Frontend applications need these environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy application ID (must match backend's `PRIVY_APP_ID`) | `clxxxxxxxxxxxxxx` |
| `NEXT_PUBLIC_API_URL` | Backend API URL | `http://localhost:3000` |

For local development with the dev bypass (no Privy required), only `NEXT_PUBLIC_API_URL` is needed.

### Minimal `.env.local` for Development

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
```

---

## 10. Key Implementation Notes

- **Wallet resolution:** Most endpoints that require a wallet accept either `walletId` (direct UUID) or `walletType` (`"user" | "server" | "agent"`). When `walletType` is provided without `walletId`, the backend resolves the wallet from the user's onboarding profile. Prefer using `walletType` for simplicity.

- **Chain ID:** Defaults to the backend's configured `DEFAULT_CHAIN_ID` when not specified. For Base mainnet, use `8453`.

- **Amounts as strings:** All token amounts are strings to avoid floating-point precision issues. Use the token's smallest unit (wei for ETH, 6-decimal units for USDC).

- **Idempotent onboarding:** `POST /api/onboard` is safe to call multiple times. If the user already has a profile, it returns the existing one.

- **CORS:** The backend enables CORS for all origins (`*`). No special configuration needed on the frontend.

- **Pretium offramp flow:** The frontend must first send USDC to the settlement address on-chain, then call the offramp endpoint with the transaction hash as proof. The backend handles the fiat disbursement.

- **Uniswap swap flow:** The `/api/uniswap/swap` endpoint handles the full flow (check approval, submit approval tx if needed, get quote, submit swap tx) in a single call. Use `/api/uniswap/quote` for read-only price checks before committing.

- **Gas sponsorship:** All wallet `sendTransaction` calls support Privy gas sponsorship. Set `sponsor: true` in the transaction params to have Privy pay the gas fees. This requires gas sponsorship policies to be configured in the Privy dashboard for the target chains.
