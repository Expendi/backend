# Expendi Backend API -- Frontend Integration Skill

## 1. Overview

Expendi is a crypto financial backend built with **Hono + Effect-TS** on Node.js, deployed on the **Base** chain (chain ID `8453`). It provides:

- **Wallet management** -- three wallets per user (user, server, agent) via Privy embedded wallets
- **Transaction execution** -- contract calls and raw transactions on Base (with optional gas sponsorship)
- **Recurring payments** -- scheduled ERC-20 transfers, raw transfers, contract calls, and offramps
- **Yield positions** -- deposit into ERC-4626 vaults with time-locked positions
- **Offramp to African mobile money** -- via Pretium (Kenya, Nigeria, Ghana, Uganda, DR Congo, Malawi, Ethiopia)
- **Onramp from African mobile money** -- via Pretium (Kenya, Ghana, Uganda, DR Congo, Malawi) — fiat → stablecoins (USDC, USDT, CUSD) on Base
- **Token swaps** -- Uniswap V3 swaps on Base
- **Swap automations** -- indicator-based conditional swaps (price above/below, percent change)
- **Group accounts** -- shared wallets with admin/member roles, on-chain via GroupAccount contracts
- **Goal savings** -- savings goals with target amounts, optional recurring deposits into yield pools, and progress tracking
- **Usernames** -- human-readable identifiers for wallet addresses
- **Transaction categories** -- user-defined and global categories for organizing transactions
- **Transaction approval** -- optional per-user PIN or passkey verification for mutating financial operations

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
| GET | `/api/profile` | Privy | -- | Full profile with wallet objects (id, type, privyWalletId, ownerId, address, chainId, createdAt) + `username` |
| GET | `/api/profile/wallets` | Privy | -- | `{ user: "0x...", server: "0x...", agent: "0x..." }` (addresses only) |
| PUT | `/api/profile/username` | Privy | `{ username: string }` | Updated profile. Username: 3-20 chars, `^[a-z0-9_]+$`. |
| GET | `/api/profile/resolve/:username` | Privy | -- | `{ username, userId, address }` -- resolve username to wallet address |
| GET | `/api/profile/preferences` | Privy | -- | User preferences object (phoneNumber, mobileNetwork, country, etc.) |
| PATCH | `/api/profile/preferences` | Privy | `Partial<UserPreferences>` | Merged preferences object. Only provided fields are updated; existing fields preserved. |

### 5.3 Wallets

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/wallets` | Privy | -- | Array of user's wallets: `[{ id, type, privyWalletId, ownerId, address, chainId, createdAt }]` |
| GET | `/api/wallets/:id` | Privy | -- | Single wallet object (must be owned by the authenticated user) |
| POST | `/api/wallets/user` | Privy | -- | `{ address: "0x...", type: "user" }` |
| POST | `/api/wallets/:id/sign` | Privy | `{ message: string }` | `{ signature: "0x..." }` |
| POST | `/api/wallets/transfer` | Privy | `{ from, to, amount, token?, chainId?, categoryId? }` | Transaction result |
| GET | `/api/wallets/deposits` | Privy | Query: `chainId?`, `blocks?` | Array of incoming ERC-20 deposits (scanned from recent on-chain blocks) |

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

**POST `/api/wallets/transfer` body:**
```typescript
{
  from: "user" | "server" | "agent";   // Source wallet type
  to: "user" | "server" | "agent";     // Destination wallet type (must differ from 'from')
  amount: string;                       // Token units (e.g. "1000000" = 1 USDC)
  token?: string;                       // Contract name, defaults to "usdc"
  chainId?: number;                     // Defaults to backend default chain
  categoryId?: string;                  // Optional category
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
  sponsor?: boolean;        // Enable Privy gas sponsorship (defaults to true)
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

#### Category Limits

Limits are **per-user, per-category, per-token**. The unique constraint is `(userId, categoryId, tokenAddress)`, so a single category can have different limits for different tokens.

| Method | Path | Auth | Query Params | Response |
|--------|------|------|--------------|----------|
| GET | `/api/categories/limits` | Privy | -- | Array of all user's limits (includes `categoryName`) |
| GET | `/api/categories/:id/limit` | Privy | `?tokenAddress=0x...` (optional) | Array of limits for category; single object if `tokenAddress` provided |
| PUT | `/api/categories/:id/limit` | Privy | -- | Upserted `CategoryLimit` object |
| DELETE | `/api/categories/:id/limit` | Privy | `?tokenAddress=0x...` (optional) | `{ deleted: true, count: N }` |

**PUT `/api/categories/:id/limit` body (upsert — creates or updates):**
```typescript
{
  monthlyLimit: string;    // Raw token amount as string (e.g. "500000000" for 500 USDC)
  tokenAddress: string;    // ERC-20 contract address
  tokenSymbol: string;     // e.g. "USDC"
  tokenDecimals: number;   // e.g. 6
}
```

**`CategoryLimit` object shape:**
```typescript
{
  id: string;
  userId: string;
  categoryId: string;
  monthlyLimit: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  createdAt: string;
  updatedAt: string;
}
```

> **Notes:**
> - `GET /:id/limit` without `?tokenAddress` returns an **array** of all limits for that category. With `?tokenAddress` it returns a **single object** or 400 if not found.
> - `DELETE /:id/limit` without `?tokenAddress` deletes **all** limits for that category. With `?tokenAddress` it deletes only the matching limit.
> - Schema: `src/db/schema/category-limits.ts`

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

**POST `/api/recurring-payments` body (new format — use-case-driven):**

*Transfer (ERC-20):*
```typescript
{
  type: "transfer";
  name?: string;               // User-defined label (e.g. "Rent Payment")
  wallet?: "user" | "server" | "agent";  // Defaults to "server"
  walletId?: string;
  to: string;                  // Recipient address
  amount: string;              // Token amount in base units
  token?: string;              // Defaults to "usdc"
  chainId?: number;
  frequency: string;           // Interval: "5m", "1h", "1d", "7d", "30d"
  startDate?: string;          // ISO 8601 (defaults to now)
  endDate?: string;            // ISO 8601 (optional)
  maxRetries?: number;         // Default: 3
  categoryId?: string;         // Transaction category ID
  executeImmediately?: boolean;
}
```

*Offramp:*
```typescript
{
  type: "offramp";
  name?: string;
  wallet?: "user" | "server" | "agent";
  walletId?: string;
  amount: string;              // Fiat amount by default (e.g. "1000" KES)
  currency?: string;           // Resolved from recipient.country if omitted
  amountInUsdc?: boolean;      // Set true if amount is USDC instead of fiat
  recipient?: { phoneNumber?, mobileNetwork?, country?, paymentMethod?, accountNumber?, accountName?, bankAccount?, bankCode?, bankName? };
  token?: string;              // Defaults to "usdc"
  chainId?: number;
  frequency: string;
  startDate?: string;
  endDate?: string;
  maxRetries?: number;
  categoryId?: string;
  executeImmediately?: boolean;
}
```

*Raw transfer & contract call types also supported — see `raw_transfer` and `contract_call` type variants.*

**Legacy format (backward compatible):**
```typescript
{
  name?: string;               // User-defined label
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
  executeImmediately?: boolean; // If true, first payment runs at startDate; otherwise first payment is at startDate + frequency (default: false)
  maxRetries?: number;         // Default: 3
  categoryId?: string;         // Transaction category ID
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
  name: string | null;
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
  categoryId: string | null;
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
| GET | `/api/yield/positions/:id/accrued-yield` | Privy | -- | Live accrued yield from chain |
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

### 5.8 Pretium (Offramp & Onramp — African Mobile Money / Bank)

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
  walletId: string;           // Wallet to debit USDC from
  usdcAmount: number;         // USDC amount (not wei, e.g., 10.5)
  phoneNumber: string;        // Recipient phone number
  mobileNetwork: string;      // e.g., "safaricom", "mtn", "airtel"
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

#### Onramp (Fiat → Stablecoin)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/pretium/onramp/countries` | Privy | -- | Array of onramp-supported countries with mobile networks |
| POST | `/api/pretium/onramp` | Privy | See below | `{ transaction, pretiumResponse }` (HTTP 201) |
| GET | `/api/pretium/onramp` | Privy | Query: `?limit=50&offset=0` | Array of user's onramp transactions |
| GET | `/api/pretium/onramp/:id` | Privy | -- | Single onramp transaction |
| POST | `/api/pretium/onramp/:id/refresh` | Privy | -- | `{ transaction, pretiumStatus }` (polls Pretium for latest status) |

**POST `/api/pretium/onramp` body:**
```typescript
{
  country: string;            // "KE", "GH", "UG", "CD", "MW" (NOT NG or ET)
  walletId: string;           // Wallet to associate with the transaction
  fiatAmount: number;         // Amount of fiat currency to pay
  phoneNumber: string;        // Payer's phone number for mobile money
  mobileNetwork: string;      // e.g., "safaricom", "mtn", "airtel"
  asset: string;              // Stablecoin to receive: "USDC" | "USDT" | "CUSD"
  address: string;            // Wallet address to receive stablecoins (on Base)
  fee?: number;               // Fee amount in fiat
  callbackUrl?: string;       // Webhook URL (auto-generated from SERVER_BASE_URL if omitted)
}
```

**Onramp-supported countries:**

| Country | Code | Currency | Mobile Networks |
|---------|------|----------|-----------------|
| Kenya | KE | KES | safaricom, airtel |
| Ghana | GH | GHS | mtn, vodafone, airtel |
| Uganda | UG | UGX | mtn, airtel |
| DR Congo | CD | CDF | vodacom, airtel, orange |
| Malawi | MW | MWK | airtel, tnm |

**Onramp supported assets:** `USDC` | `USDT` | `CUSD`

**Onramp transaction lifecycle:**
1. `pending` — onramp initiated, waiting for user to pay via mobile money
2. `processing` — mobile money payment confirmed (first webhook), waiting for stablecoin release
3. `completed` — stablecoins released to wallet address (second webhook with `is_released: true` and `transaction_hash`)
4. `failed` / `reversed` — payment failed or was reversed

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

### 5.10 Swap Automations

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/swap-automations` | Privy | -- | Array of user's swap automations |
| GET | `/api/swap-automations/:id` | Privy | -- | Single swap automation |
| POST | `/api/swap-automations` | Privy | See below | Created automation (HTTP 201) |
| PATCH | `/api/swap-automations/:id` | Privy | Partial update fields | Updated automation |
| POST | `/api/swap-automations/:id/pause` | Privy | -- | Paused automation |
| POST | `/api/swap-automations/:id/resume` | Privy | -- | Resumed automation |
| POST | `/api/swap-automations/:id/cancel` | Privy | -- | Cancelled automation |
| GET | `/api/swap-automations/:id/executions` | Privy | Query: `?limit=50` | Execution history |

**POST `/api/swap-automations` body:**
```typescript
{
  walletId: string;
  walletType: "user" | "server" | "agent";
  tokenIn: string;             // Token address
  tokenOut: string;            // Token address
  amount: string;              // In smallest unit
  indicatorType: "price_above" | "price_below" | "percent_change_up" | "percent_change_down";
  indicatorToken: string;      // e.g., "ETH"
  thresholdValue: number;      // Price threshold or percent change
  slippageTolerance?: number;  // Default: 0.5
  maxExecutions?: number;      // Default: 1
  cooldownSeconds?: number;    // Default: 60
  maxRetries?: number;         // Default: 3
  maxExecutionsPerDay?: number; // Optional daily limit
}
```

### 5.11 Group Accounts

Group accounts are shared wallets with admin/member roles, powered by on-chain smart contracts on Base.

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/groups` | Privy | `{ name, description?, members: string[] }` | Created group (HTTP 201). Members are usernames or 0x addresses. |
| GET | `/api/groups` | Privy | -- | Array of user's groups |
| GET | `/api/groups/:id` | Privy | -- | Group with members (includes usernames, addresses, roles) |
| GET | `/api/groups/:id/members` | Privy | -- | Array of members |
| POST | `/api/groups/:id/members` | Privy | `{ member: string }` | Added member (HTTP 201). Admin only. |
| DELETE | `/api/groups/:id/members/:identifier` | Privy | -- | `{ removed: true }`. Admin only. |
| POST | `/api/groups/:id/pay` | Privy | `{ to, amount, token? }` | `{ transactionId }`. Admin payout. |
| POST | `/api/groups/:id/deposit` | Privy | `{ amount, token? }` | `{ transactionId }`. Any member. |
| POST | `/api/groups/:id/transfer-admin` | Privy | `{ newAdmin: string }` | `{ transferred: true }`. Admin only. |
| GET | `/api/groups/:id/balance` | Privy | Query: `?tokens=0xAddr1,0xAddr2` | `{ eth, tokens: { addr: balance } }` |

### 5.12 Split Expenses

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/split-expenses` | Privy | See below | Created expense (HTTP 201) |
| GET | `/api/split-expenses` | Privy | -- | Array of user's split expenses (as creator or participant) |
| GET | `/api/split-expenses/:id` | Privy | -- | Expense with all share details |
| POST | `/api/split-expenses/:id/pay` | Privy | `{ walletId: string, walletType: "user" \| "server" \| "agent" }` | Pay your share |
| DELETE | `/api/split-expenses/:id` | Privy | -- | Cancel expense (creator only) |

**POST `/api/split-expenses` body:**
```typescript
{
  title: string;                 // e.g. "Dinner at Luigi's"
  tokenAddress: string;          // ERC-20 token address
  tokenSymbol: string;           // e.g. "USDC"
  tokenDecimals: number;         // e.g. 6
  totalAmount: string;           // Total amount in smallest unit
  chainId: number;               // e.g. 8453
  transactionId?: string;        // Optional linked transaction
  shares: { userId: string; amount: string }[];
}
```

### 5.13 Goal Savings

Goal savings lets users define savings goals with a target token and amount, optionally automating recurring deposits from a server wallet into a yield pool. Each deposit creates a yield position. When accumulated deposits reach the target, the goal is marked completed.

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/goal-savings` | Privy | -- | Array of user's goals |
| POST | `/api/goal-savings` | Privy | See below | Created goal (HTTP 201) |
| GET | `/api/goal-savings/:id` | Privy | -- | Single goal (ownership enforced) |
| PATCH | `/api/goal-savings/:id` | Privy | See below | Updated goal |
| POST | `/api/goal-savings/:id/pause` | Privy | -- | Paused goal |
| POST | `/api/goal-savings/:id/resume` | Privy | -- | Resumed goal (resets failures, recalculates next deposit) |
| POST | `/api/goal-savings/:id/cancel` | Privy | -- | Cancelled goal (existing positions remain) |
| POST | `/api/goal-savings/:id/deposit` | Privy | See below | Manual deposit (HTTP 201) |
| GET | `/api/goal-savings/:id/accrued-yield` | Privy | -- | Aggregated live yield across all deposits |
| GET | `/api/goal-savings/:id/deposits` | Privy | Query: `?limit=50` | Array of deposit records |

**POST `/api/goal-savings` body:**
```typescript
{
  name: string;                      // e.g. "House Fund"
  description?: string;
  targetAmount: string;              // String bigint target
  tokenAddress: string;              // ERC-20 token address
  tokenSymbol: string;               // e.g. "USDC"
  tokenDecimals: number;             // e.g. 6
  walletId?: string;                 // Server wallet for deposits (resolved from profile if omitted)
  walletType?: "server" | "agent";
  vaultId?: string;                  // Yield vault for deposits
  chainId?: number;
  depositAmount?: string;            // Per-deposit amount for automation
  unlockTimeOffsetSeconds?: number;  // Seconds added to deposit time for lock expiry
  frequency?: string;                // Format: "<number><unit>" where unit is s|m|h|d|w (e.g. "30s", "5m", "2h", "1d", "1w"). null = manual only
  startDate?: string;                // ISO 8601
  endDate?: string;                  // ISO 8601
  maxRetries?: number;               // Default: 3
}
```

Automation fields (`walletId`/`walletType`, `vaultId`, `depositAmount`, `frequency`) are all-or-nothing.

**Frequency format:** `"<number><unit>"` where unit is one of `s` (seconds), `m` (minutes), `h` (hours), `d` (days), `w` (weeks). Examples: `"30s"`, `"5m"`, `"2h"`, `"1d"`, `"1w"`. Invalid formats default to 1 day.

**PATCH `/api/goal-savings/:id` body (all fields optional):**
```typescript
{
  name?: string;
  description?: string;
  depositAmount?: string;
  frequency?: string;     // Format: "<number><unit>" (s|m|h|d|w). Recalculates nextDepositAt
  endDate?: string | null;
  maxRetries?: number;
}
```

**POST `/api/goal-savings/:id/deposit` body:**
```typescript
{
  amount: string;                    // Deposit amount
  walletId?: string;                 // Falls back to goal's walletId, then profile
  walletType?: "server" | "agent";
  vaultId?: string;                  // Falls back to goal's vaultId
  chainId?: number;
  unlockTimeOffsetSeconds?: number;  // Falls back to goal's setting
}
```

**GoalSaving object shape:**
```typescript
interface GoalSaving {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  targetAmount: string;
  accumulatedAmount: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  status: "active" | "paused" | "cancelled" | "completed";
  walletId: string | null;
  walletType: string | null;
  vaultId: string | null;
  chainId: number | null;
  depositAmount: string | null;
  unlockTimeOffsetSeconds: number | null;
  frequency: string | null;
  nextDepositAt: string | null;
  startDate: string | null;
  endDate: string | null;
  maxRetries: number;
  consecutiveFailures: number;
  totalDeposits: number;
  createdAt: string;
  updatedAt: string;
}
```

**GoalSavingsDeposit object shape:**
```typescript
interface GoalSavingsDeposit {
  id: string;
  goalId: string;
  yieldPositionId: string;
  amount: string;
  depositType: "automated" | "manual";
  status: "pending" | "confirmed" | "failed";
  error: string | null;
  depositedAt: string;
}
```

**GET `/api/goal-savings/:id/accrued-yield` response:**
```typescript
interface GoalAccruedYieldInfo {
  goalId: string;
  totalPrincipalAmount: string;
  totalCurrentAssets: string;
  totalAccruedYield: string;
  positions: Array<{
    positionId: string;
    principalAmount: string;
    currentAssets: string;
    accruedYield: string;
    estimatedApy: string;
  }>;
}
```

Reads live yield from chain for each deposit position linked to the goal and returns aggregated totals plus per-position breakdowns. This is a read-only operation — no snapshots are persisted.

**Business logic & edge cases:**
- **Deposit rejection:** Deposits to goals with status `cancelled` or `completed` are rejected with an error.
- **Deposit requirements:** Both `walletId` and `vaultId` must be resolvable (from request body, goal, or user profile) for a deposit to succeed. Missing either causes a failure.
- **Auto-completion:** When `accumulatedAmount >= targetAmount` after a deposit, the goal status is automatically set to `completed`.
- **Automated deposit processing** (`processDueDeposits`, triggered via `POST /internal/goal-savings/process`):
  - Picks up all `active` goals where `frequency` is set and `nextDepositAt <= now`.
  - On success: resets `consecutiveFailures` to 0 and advances `nextDepositAt` by the frequency interval.
  - On failure: increments `consecutiveFailures`. If `consecutiveFailures >= maxRetries`, the goal is auto-paused.
  - If the next scheduled deposit would fall after `endDate`, the goal is auto-completed.
- **Resume behavior:** Resuming a paused goal resets `consecutiveFailures` to 0 and recalculates `nextDepositAt` from the current time plus the frequency interval.
- **Manual deposit wallet fallback chain:** `request body walletId` -> `goal.walletId` -> user profile (`serverWalletId` or `agentWalletId` based on `walletType`).

### 5.14 Transaction Approval / Security

Transaction approval is an optional per-user security feature. When enabled, mutating API requests to financial endpoints require an `X-Approval-Token` header. The token is obtained by verifying the user's PIN or passkey via `POST /api/security/approval/verify` and is valid for 5 minutes.

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/security/approval` | Privy | -- | Approval settings: `{ enabled, method, passkeyCount }` |
| POST | `/api/security/approval/pin/setup` | Privy | `{ pin: string }` | `{ success: true }` -- PIN must be 4-6 digits |
| POST | `/api/security/approval/pin/change` | Privy | `{ currentPin: string, newPin: string }` | `{ success: true }` |
| DELETE | `/api/security/approval/pin` | Privy | `{ pin: string }` | `{ success: true }` -- removes PIN |
| POST | `/api/security/approval/passkey/register` | Privy | -- | WebAuthn registration options |
| POST | `/api/security/approval/passkey/register/verify` | Privy | `{ credential: RegistrationResponseJSON, label?: string }` | `{ success: true }` -- completes passkey registration |
| GET | `/api/security/approval/passkeys` | Privy | -- | Array of registered passkeys |
| DELETE | `/api/security/approval/passkeys/:id` | Privy | -- | `{ success: true }` -- removes a passkey |
| POST | `/api/security/approval/verify` | Privy | `{ method: "pin" \| "passkey", pin?: string, credential?: AuthenticationResponseJSON }` | `{ token: string }` -- approval token valid for 5 minutes |
| DELETE | `/api/security/approval` | Privy | `{ pin?: string, credential?: AuthenticationResponseJSON }` | `{ success: true }` -- disables transaction approval entirely |

**Gated routes (require `X-Approval-Token` when approval is enabled):**

These routes require the approval token header for mutating (POST) requests only. GET requests on these paths are NOT gated:

- `POST /api/transactions/*`
- `POST /api/wallets/transfer`
- `POST /api/pretium/offramp`
- `POST /api/pretium/onramp`
- `POST /api/yield/positions`
- `POST /api/uniswap/swap`
- `POST /api/groups/*/pay`
- `POST /api/groups/*/deposit`

**Brute-force protection:** 5 failed verification attempts result in a 15-minute lockout.

**Backend-automated flows bypass:** Recurring payments, goal savings deposits, and swap automations call services directly and do not require an approval token.

### 5.15 Chat / AI Agent

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/chat` | Privy | See below | SSE stream |

The chat endpoint streams LLM responses via Server-Sent Events. Tools are serialized as JSON Schema from the client and converted to Zod schemas server-side. Tools execute client-side — the server only handles the LLM conversation loop.

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
- `tool_use` — `{ type: "tool_use", id: "...", name: "...", input: {...} }` — tool invocation (client executes the tool, not the server)
- `done` — `{ type: "done", message: {...}, tokens_in: N, tokens_out: N }` — stream complete

**LLM configuration (backend env vars):**
| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `anthropic` | Provider: `anthropic`, `openai`, `openrouter`, `gemini`, etc. |
| `LLM_MODEL` | Provider default | Model ID (e.g. `claude-sonnet-4-20250514`) |
| `LLM_API_KEY` | Provider-specific env var | API key (falls back to e.g. `ANTHROPIC_API_KEY`) |
| `LLM_BASE_URL` | Provider default | Custom base URL for OpenAI-compatible providers |
| `LLM_MAX_TOKENS` | `4096` | Max tokens per response |
| `LLM_FORMAT` | Auto | SDK format: `openai`, `anthropic`, or `bedrock` |

Unknown providers are automatically registered as OpenAI-compatible at runtime.

### 5.16 Webhooks

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| POST | `/webhooks/pretium` | None | See below | Pretium payment callback (handles two shapes) |

**Pretium webhook callback shapes:**

1. **Status update** (offramp + onramp payment collection): `{ transaction_code, status, receipt_number?, failure_reason?, amount?, currency_code? }`
   - For offramp: `completed` marks the transaction as done
   - For onramp: `completed` means payment collected — transaction moves to `processing` (waits for asset release)

2. **Asset release** (onramp only): `{ is_released: true, transaction_code, transaction_hash }`
   - Sent after stablecoins are released to the user's wallet
   - Marks the onramp transaction as `completed` and stores the on-chain tx hash

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
| POST | `/internal/goal-savings/process` | Process due goal savings deposits |

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

// Transfer between own wallets (e.g. user → server)
const transfer = await request<Transaction>("/api/wallets/transfer", {
  method: "POST",
  body: {
    from: "user",
    to: "server",
    amount: "5000000",     // 5 USDC
    token: "usdc",         // optional, defaults to "usdc"
  },
});
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

The backend handles the entire offramp flow automatically — it sends USDC to the settlement address, converts amounts, and triggers fiat disbursement. The frontend only needs one API call:

```typescript
// Step 1 (optional): Preview exchange rate
const conversion = await request("/api/pretium/convert/usdc-to-fiat", {
  method: "POST",
  body: { usdcAmount: 10, currency: "KES" },
});
// conversion.data = { amount: 1290, exchangeRate: 129.05, ... }

// Step 2: Initiate the offramp (backend sends USDC + disburses fiat automatically)
const offramp = await request("/api/pretium/offramp", {
  method: "POST",
  body: {
    country: "KE",
    walletId: serverWalletId,
    usdcAmount: 10,
    phoneNumber: "254712345678",
    mobileNetwork: "safaricom",
    paymentType: "MOBILE",
  },
});

// Step 3: Poll for status updates
const status = await request(`/api/pretium/offramp/${offramp.data.transaction.id}`);
// Or refresh from Pretium:
const refreshed = await request(`/api/pretium/offramp/${offramp.data.transaction.id}/refresh`, {
  method: "POST",
});
```

### 7.9 Initiating an Onramp from Mobile Money

```typescript
// Step 1: Get the list of onramp-supported countries
const countries = await request("/api/pretium/onramp/countries");
// countries = [{ code: "KE", name: "Kenya", currency: "KES", mobileNetworks: ["SAFARICOM", "AIRTEL"] }, ...]

// Step 2: Get exchange rate (reuses the same conversion endpoints)
const conversion = await request("/api/pretium/convert/fiat-to-usdc", {
  method: "POST",
  body: { fiatAmount: 5000, currency: "KES" },
});
// conversion.data = { usdcAmount: "38.61", exchangeRate: "129.50", ... }

// Step 3: Initiate the onramp (user will receive a mobile money payment prompt)
const onramp = await request("/api/pretium/onramp", {
  method: "POST",
  body: {
    country: "KE",
    walletId: userWalletId,
    fiatAmount: 5000,
    phoneNumber: "254712345678",
    mobileNetwork: "SAFARICOM",
    asset: "USDC",                // or "USDT" or "CUSD"
    address: userWalletAddress,   // Base chain wallet address
  },
});

// Step 4: Poll for status updates
// Status flow: pending → processing (payment collected) → completed (stablecoins released)
const status = await request(`/api/pretium/onramp/${onramp.data.transaction.id}`);

// Or refresh from Pretium:
const refreshed = await request(`/api/pretium/onramp/${onramp.data.transaction.id}/refresh`, {
  method: "POST",
});
// When completed, transaction.onChainTxHash will contain the stablecoin transfer hash
```

### 7.10 Creating a Recurring Payment

```typescript
// Monthly USDC payment -- new format, pay now then every 30 days
const schedule = await request("/api/recurring-payments", {
  method: "POST",
  body: {
    type: "transfer",
    name: "Monthly Rent",           // User-defined label
    wallet: "server",
    to: "0xRecipientAddress...",
    amount: "5000000",              // 5 USDC
    token: "usdc",
    chainId: 8453,
    frequency: "30d",               // Every 30 days
    executeImmediately: true,       // First payment runs immediately
    categoryId: "cat-uuid",         // Optional transaction category
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

### 7.11 Creating a Savings Goal with Automated Deposits

```typescript
// Create a savings goal with weekly automated deposits
const goal = await request<GoalSaving>("/api/goal-savings", {
  method: "POST",
  body: {
    name: "House Fund",
    targetAmount: "1000000000",         // 1000 USDC (6 decimals)
    tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    walletType: "server",               // Use server wallet
    vaultId: vaultId,                   // Yield vault UUID
    chainId: 8453,
    depositAmount: "50000000",          // 50 USDC per deposit
    unlockTimeOffsetSeconds: 2592000,   // 30-day lock per deposit
    frequency: "7d",                    // Weekly
  },
});

// Make a manual one-time deposit
const deposit = await request(`/api/goal-savings/${goal.id}/deposit`, {
  method: "POST",
  body: {
    amount: "100000000",   // 100 USDC
    walletType: "server",
    vaultId: vaultId,
  },
});

// Check progress
const updated = await request<GoalSaving>(`/api/goal-savings/${goal.id}`);
console.log(`Progress: ${updated.accumulatedAmount} / ${updated.targetAmount}`);
console.log(`Status: ${updated.status}`);  // "active" or "completed"

// List deposits
const deposits = await request(`/api/goal-savings/${goal.id}/deposits`);

// Check live accrued yield across all deposits
const yieldInfo = await request(`/api/goal-savings/${goal.id}/accrued-yield`);
console.log(`Total yield: ${yieldInfo.totalAccruedYield}`);
console.log(`Positions: ${yieldInfo.positions.length}`);

// Pause automation
await request(`/api/goal-savings/${goal.id}/pause`, { method: "POST" });

// Resume
await request(`/api/goal-savings/${goal.id}/resume`, { method: "POST" });

// Update automation settings (e.g. change to daily deposits, increase amount)
await request(`/api/goal-savings/${goal.id}`, {
  method: "PATCH",
  body: {
    frequency: "1d",
    depositAmount: "75000000",   // 75 USDC
  },
});

// Cancel the goal (existing yield positions remain untouched)
await request(`/api/goal-savings/${goal.id}/cancel`, { method: "POST" });
```

### 7.12 Setting Up Transaction Approval and Using It

```typescript
// Step 1: Set up a transaction PIN
await request("/api/security/approval/pin/setup", {
  method: "POST",
  body: { pin: "1234" },  // 4-6 digits
});

// Step 2: Check approval settings
const settings = await request("/api/security/approval");
// settings = { enabled: true, method: "pin", passkeyCount: 0 }

// Step 3: Before a gated request, verify and get an approval token
const { token } = await request<{ token: string }>("/api/security/approval/verify", {
  method: "POST",
  body: { method: "pin", pin: "1234" },
});

// Step 4: Use the approval token in the X-Approval-Token header for gated requests
const transferResult = await fetch(`${BASE_URL}/api/wallets/transfer`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "X-Approval-Token": token,  // Valid for 5 minutes
  },
  body: JSON.stringify({
    from: "user",
    to: "server",
    amount: "5000000",
    token: "usdc",
  }),
});

// The same token can be reused for multiple requests within the 5-minute window.
// After expiry, call /api/security/approval/verify again.
```

**Changing or removing PIN:**

```typescript
// Change PIN
await request("/api/security/approval/pin/change", {
  method: "POST",
  body: { currentPin: "1234", newPin: "5678" },
});

// Remove PIN (disables approval if no passkeys are registered)
await request("/api/security/approval/pin", {
  method: "DELETE",
  body: { pin: "5678" },
});

// Disable transaction approval entirely
const { token } = await request<{ token: string }>("/api/security/approval/verify", {
  method: "POST",
  body: { method: "pin", pin: "5678" },
});
await fetch(`${BASE_URL}/api/security/approval`, {
  method: "DELETE",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({ pin: "5678" }),
});
```

### 7.13 AI Agent Chat (Glove Integration)

The demo app uses Glove React for the AI chat interface. The backend's `/api/chat` route streams SSE events. Tools execute client-side — the server only handles the LLM conversation loop.

```typescript
import { GloveClient } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";

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

// Create the Glove client — it serializes tool schemas to JSON Schema
// and streams them to the backend's /api/chat SSE endpoint
const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You are a helpful crypto wallet assistant.",
  tools: [getBalances, /* ...other tools */],
});

// Wrap your app with GloveProvider
// <GloveProvider client={gloveClient}>
//   <App />
// </GloveProvider>

// In components, use the useGlove() hook:
// const { timeline, streamingText, busy, slots, sendMessage, renderSlot } = useGlove();
```

### 7.14 Split Expenses

```typescript
// Create a split expense
const expense = await request("/api/split-expenses", {
  method: "POST",
  body: {
    title: "Dinner at Luigi's",
    tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    totalAmount: "45000000",  // 45 USDC
    chainId: 8453,
    shares: [
      { userId: "did:privy:user1", amount: "22500000" },
      { userId: "did:privy:user2", amount: "22500000" },
    ],
  },
});

// Pay your share
await request(`/api/split-expenses/${expense.id}/pay`, {
  method: "POST",
  body: { walletId: userWalletId, walletType: "user" },
});

// List your split expenses
const expenses = await request("/api/split-expenses");
```

### 7.15 User Preferences

```typescript
// Get user preferences
const prefs = await request("/api/profile/preferences");
// prefs => { phoneNumber: "+254700000000", mobileNetwork: "Safaricom", country: "KE" }

// Update preferences (merge — only provided fields are changed)
const updated = await request("/api/profile/preferences", {
  method: "PATCH",
  body: { phoneNumber: "+254700000000", mobileNetwork: "Safaricom", country: "KE" },
});
```

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
| `SwapAutomationError` | Swap automation operation failure |
| `GroupAccountError` | Group account operation failure (not admin, group not found, etc.) |
| `GoalSavingsError` | Goal savings operation failure (goal not found, cancelled/completed, missing config) |
| `ApprovalError` | Transaction approval failure (invalid PIN, locked out, expired token, passkey verification failed) |
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
| `SERVER_BASE_URL` (backend) | Base URL for auto-generated webhook callback URLs | `https://api.expendi.app` |
| `APPROVAL_TOKEN_SECRET` (backend) | Secret for signing approval tokens (defaults to dev value) | `your-secret-key` |

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

- **Pretium offramp flow:** The backend handles the entire offramp automatically — the frontend does NOT need to send USDC separately. When calling `POST /api/pretium/offramp`, the backend: (1) sends USDC from the specified wallet to the settlement address on-chain, (2) converts the USDC amount to fiat using the exchange rate, and (3) calls the Pretium disburse API. The frontend only needs to provide `country`, `walletId`, `usdcAmount`, `phoneNumber`, `mobileNetwork`, and optionally `paymentType`. No `transactionHash` is needed — it's generated internally. For Kenya disbursements, `mobile_network` is sent for all payment types (MOBILE, BUY_GOODS, PAYBILL) using the actual network from the request. Fiat amounts are always floored to integers per the Pretium API spec.

- **Pretium onramp flow:** The frontend calls `POST /api/pretium/onramp` with country, fiat amount, phone number, network, asset (USDC/USDT/CUSD), and wallet address. The user receives a mobile money payment prompt. Two webhooks follow: (1) payment collected → status moves to `processing`, (2) stablecoins released → status moves to `completed` with on-chain tx hash. No on-chain transfer is needed from the frontend — Pretium handles stablecoin delivery.

- **Callback URLs:** The backend auto-generates webhook callback URLs using the `SERVER_BASE_URL` environment variable (defaults to `http://localhost:{port}`). Set this to your production domain (e.g., `https://api.expendi.app`) when deployed.

- **Uniswap swap flow:** The `/api/uniswap/swap` endpoint handles the full flow (check approval, submit approval tx if needed, get quote, submit swap tx) in a single call. Use `/api/uniswap/quote` for read-only price checks before committing.

- **Transaction approval:** Optional per-user security layer. When enabled, mutating requests to financial endpoints (`/api/transactions/*`, `/api/wallets/transfer`, `/api/pretium/offramp`, `/api/pretium/onramp`, `/api/yield/positions`, `/api/uniswap/swap`, `/api/groups/*/pay`, `/api/groups/*/deposit`) require an `X-Approval-Token` header. The token is obtained via `POST /api/security/approval/verify` with PIN or passkey credentials and is valid for 5 minutes. GET requests are never gated. Backend-automated flows (recurring payments, goal savings, swap automations) bypass approval entirely since they call services directly without going through the HTTP middleware.

- **Gas sponsorship and transaction hash resolution:** All wallet `sendTransaction` calls use Privy gas sponsorship by default (`sponsor: true` in `SendTransactionParams`). When sponsoring is enabled, Privy returns a `transaction_id` instead of a direct on-chain hash. The backend automatically resolves the actual on-chain hash by polling `privy.transactions().get(transaction_id)` via a shared `resolveTransactionHash()` utility (`src/services/wallet/resolve-tx-hash.ts`). This applies to all wallet types (user, server, agent). Non-sponsored transactions (`sponsor: false`) return the hash directly without polling. Gas sponsorship policies must be configured in the Privy dashboard for the target chains.
