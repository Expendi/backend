# API Reference

All endpoints return JSON in a consistent envelope:

**Success (HTTP 200):**
```json
{
  "success": true,
  "data": { }
}
```

**Known error (HTTP 400):**
```json
{
  "success": false,
  "error": {
    "_tag": "ErrorType",
    "message": "Human-readable error description"
  }
}
```

**Unauthorized (HTTP 401):**
```json
{
  "error": "Unauthorized"
}
```

**Forbidden (HTTP 403):**
```json
{
  "error": "Forbidden"
}
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

## Authentication

Expendi uses two authentication mechanisms:

| Route prefix | Auth method | Header | Description |
|-------------|-------------|--------|-------------|
| `/api/*` | Privy access token | `Authorization: Bearer <token>` | Verifies the user's identity via Privy. The user's DID is extracted and used to scope all operations. |
| `/internal/*` | Admin API key | `X-Admin-Key: <key>` | Static key matching the `ADMIN_API_KEY` environment variable. Used by the admin dashboard and backend services. |
| `/`, `/health` | None | -- | Unauthenticated health and discovery endpoints. |

---

## Unauthenticated Routes

### `GET /`

Returns service metadata and available endpoint paths. No authentication required.

```bash
curl http://localhost:3000/
```

```json
{
  "name": "Expendi",
  "version": "1.0.0",
  "description": "Crypto financial backend",
  "endpoints": {
    "wallets": "/api/wallets",
    "transactions": "/api/transactions",
    "categories": "/api/categories",
    "onboard": "/api/onboard",
    "profile": "/api/profile"
  }
}
```

### `GET /health`

Health check endpoint. No authentication required.

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

## Public API

All `/api/*` routes require the `Authorization: Bearer <token>` header with a valid Privy access token. Operations are scoped to the authenticated user -- users can only access their own wallets, transactions, and categories.

---

### Wallets

#### `GET /api/wallets`

List the authenticated user's own wallets, ordered by creation date.

```bash
curl http://localhost:3000/api/wallets \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<Wallet>` (filtered to `ownerId = authenticated user`)

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "type": "user",
      "privyWalletId": "privy-id",
      "ownerId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
      "address": "0x1234...abcd",
      "chainId": null,
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

#### `GET /api/wallets/:id`

Get a wallet by its database ID. Returns the wallet only if the authenticated user owns it.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl http://localhost:3000/api/wallets/some-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Wallet`

**Errors:** `Error` if not found or not owned by the authenticated user (HTTP 400).

#### `POST /api/wallets/user`

Create a new user wallet. The `userId` is automatically extracted from the authenticated Privy token -- no request body is needed.

```bash
curl -X POST http://localhost:3000/api/wallets/user \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json"
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "address": "0x1234...abcd",
    "type": "user"
  }
}
```

**Errors:** `WalletError` if Privy wallet creation or database persistence fails.

#### `POST /api/wallets/:id/sign`

Sign a message with a wallet. The authenticated user must own the wallet.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `id` | path | string | yes | Wallet database ID |
| `message` | body | string | yes | Message to sign |

```bash
curl -X POST http://localhost:3000/api/wallets/some-uuid/sign \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "message": "Hello, Expendi!" }'
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "signature": "0xabc123..."
  }
}
```

**Errors:** `Error` if wallet not found or not owned by the user. `WalletError` if signing fails.

---

### Transactions

#### `GET /api/transactions`

List the authenticated user's own transactions.

```bash
curl http://localhost:3000/api/transactions \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<Transaction>` (filtered to `userId = authenticated user`)

#### `GET /api/transactions/:id`

Get a transaction by its database ID. Returns the transaction only if the authenticated user owns it.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl http://localhost:3000/api/transactions/some-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Transaction`

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "walletId": "wallet-uuid",
    "walletType": "user",
    "chainId": "1",
    "contractId": "usdc",
    "method": "transfer",
    "payload": { "args": ["0xRecipient", "1000000"] },
    "status": "submitted",
    "txHash": "0xabc123...",
    "gasUsed": null,
    "categoryId": null,
    "userId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
    "error": null,
    "createdAt": "2025-01-01T00:00:00.000Z",
    "confirmedAt": null
  }
}
```

**Errors:** `Error` if not found or not owned by the authenticated user.

#### `POST /api/transactions/contract`

Submit a contract transaction. Creates a ledger intent, encodes the contract call, and sends it through the wallet. The authenticated user must own the specified wallet. The `userId` is automatically set from the auth context.

You can identify the wallet in one of two ways:
- **By ID:** Pass `walletId` with the database UUID of the wallet.
- **By type:** Pass `walletType` without `walletId`. The system resolves the wallet from the user's onboarding profile (`user_profiles` table). This requires the user to be onboarded via `POST /api/onboard` first.

If both `walletId` and `walletType` are provided, `walletId` takes precedence.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `walletId` | string | no | Database ID of the wallet to use. Required if `walletType` is not provided. |
| `walletType` | `"user"` \| `"server"` \| `"agent"` | no | Wallet type to resolve from the user's profile. Required if `walletId` is not provided. |
| `contractName` | string | yes | Name of a registered contract connector |
| `chainId` | number | yes | EVM chain ID |
| `method` | string | yes | Contract method name or shortcut |
| `args` | array | yes | Arguments to pass to the contract function |
| `value` | string | no | Native token value in wei (as a string) |
| `categoryId` | string | no | Transaction category ID |

Using `walletId`:

```bash
curl -X POST http://localhost:3000/api/transactions/contract \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "wallet-uuid",
    "contractName": "usdc",
    "chainId": 1,
    "method": "transfer",
    "args": ["0xRecipientAddress", "1000000"],
    "categoryId": "payments"
  }'
```

Using `walletType` (resolves from the user's onboarding profile):

```bash
curl -X POST http://localhost:3000/api/transactions/contract \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletType": "server",
    "contractName": "usdc",
    "chainId": 1,
    "method": "transfer",
    "args": ["0xRecipientAddress", "1000000"]
  }'
```

**Response data:** `Transaction` (with status `"submitted"`)

**Errors:** `Error` if wallet not owned by the user. `OnboardingError` if `walletType` is used and the user is not onboarded. `TransactionError`, `LedgerError`, `ContractExecutionError`, `ContractNotFoundError`, or `WalletError`.

#### `POST /api/transactions/raw`

Submit a raw transaction (direct ETH or data transfer without going through a registered contract). The authenticated user must own the specified wallet. The `userId` is automatically set from the auth context.

As with `POST /api/transactions/contract`, you can identify the wallet by `walletId` (database UUID) or by `walletType` (resolved from the user's onboarding profile). If both are provided, `walletId` takes precedence.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `walletId` | string | no | Database ID of the wallet to use. Required if `walletType` is not provided. |
| `walletType` | `"user"` \| `"server"` \| `"agent"` | no | Wallet type to resolve from the user's profile. Required if `walletId` is not provided. |
| `chainId` | number | yes | EVM chain ID |
| `to` | `0x${string}` | yes | Recipient address |
| `data` | `0x${string}` | no | Encoded calldata |
| `value` | string | no | Native token value in wei (as a string) |
| `categoryId` | string | no | Transaction category ID |

Using `walletId`:

```bash
curl -X POST http://localhost:3000/api/transactions/raw \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "wallet-uuid",
    "chainId": 1,
    "to": "0xRecipientAddress",
    "value": "1000000000000000000"
  }'
```

Using `walletType` (resolves from the user's onboarding profile):

```bash
curl -X POST http://localhost:3000/api/transactions/raw \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletType": "user",
    "chainId": 1,
    "to": "0xRecipientAddress",
    "value": "1000000000000000000"
  }'
```

**Response data:** `Transaction` (with status `"submitted"`)

**Errors:** `Error` if wallet not owned by the user. `OnboardingError` if `walletType` is used and the user is not onboarded. `TransactionError`, `LedgerError`, or `WalletError`.

---

### Categories

#### `GET /api/categories`

List transaction categories visible to the authenticated user: global categories (where `userId` is null) plus the user's own categories.

```bash
curl http://localhost:3000/api/categories \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<TransactionCategory>`

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Payroll",
      "userId": null,
      "description": "Monthly salary payments",
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

#### `GET /api/categories/:id`

Get a category by its database ID. Returns the category if it is global or owned by the authenticated user.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl http://localhost:3000/api/categories/some-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `TransactionCategory`

**Errors:** `Error` if not found or not visible to the authenticated user.

#### `POST /api/categories`

Create a new transaction category. The `userId` is automatically set from the auth context.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Category name |
| `description` | string | no | Human-readable description |

```bash
curl -X POST http://localhost:3000/api/categories \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Payroll",
    "description": "Monthly salary payments"
  }'
```

**Response data:** `TransactionCategory`

#### `PUT /api/categories/:id`

Update a category. The authenticated user must own the category.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `id` | path | string | yes | Category database ID |
| `name` | body | string | no | New name |
| `description` | body | string | no | New description |

```bash
curl -X PUT http://localhost:3000/api/categories/some-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Payroll - Q1", "description": "Q1 salary payments" }'
```

**Response data:** `TransactionCategory`

**Errors:** `Error` if not found or not owned by the authenticated user.

#### `DELETE /api/categories/:id`

Delete a category. The authenticated user must own the category.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X DELETE http://localhost:3000/api/categories/some-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "deleted": true,
    "id": "some-uuid"
  }
}
```

**Errors:** `Error` if not found or not owned by the authenticated user.

---

### Contracts (Read-Only)

Contract connectors are defined in code (see [Adding Contracts](./guides/adding-contracts.md)) and cannot be created or deleted via the API. The following read-only endpoints are available.

#### `GET /api/contracts`

List all registered contract connectors.

```bash
curl http://localhost:3000/api/contracts \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<ContractConnector>`

```json
{
  "success": true,
  "data": [
    {
      "name": "usdc",
      "chainId": 1,
      "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "abi": [ ],
      "methods": {
        "send": { "functionName": "transfer", "description": "Transfer tokens to a recipient address" }
      }
    }
  ]
}
```

#### `GET /api/contracts/:name/:chainId`

Get a specific contract connector.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `name` | path | string | yes |
| `chainId` | path | number | yes |

```bash
curl http://localhost:3000/api/contracts/usdc/1 \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `ContractConnector`

**Errors:** `ContractNotFoundError` if no connector is registered for the name/chain combination.

#### `POST /api/contracts/read`

Read data from a contract (view/pure functions only, no transaction needed).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contractName` | string | yes | Name of a registered contract |
| `chainId` | number | yes | EVM chain ID |
| `method` | string | yes | Function name or shortcut |
| `args` | array | yes | Arguments for the function call |

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

**Response data:**

```json
{
  "success": true,
  "data": {
    "result": "1000000000"
  }
}
```

**Errors:** `ContractNotFoundError` or `ContractExecutionError`.

---

### Onboarding and Profiles

#### `POST /api/onboard`

Onboard the authenticated user. Creates three wallets (user, server, agent) and a `user_profiles` record linking them. This operation is **idempotent** -- if the user is already onboarded, the existing profile and wallets are returned without creating duplicates.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chainId` | number | no | EVM chain ID for wallet context (defaults to `DEFAULT_CHAIN_ID` from the server configuration, which is `1` for Ethereum Mainnet when not set) |

```bash
curl -X POST http://localhost:3000/api/onboard \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "chainId": 1 }'
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "uuid",
      "privyUserId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
      "userWalletId": "wallet-uuid-1",
      "serverWalletId": "wallet-uuid-2",
      "agentWalletId": "wallet-uuid-3",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    },
    "wallets": {
      "user": {
        "id": "wallet-uuid-1",
        "type": "user",
        "privyWalletId": "privy-id-1",
        "ownerId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
        "address": "0x1234...abcd",
        "chainId": null,
        "createdAt": "2025-01-01T00:00:00.000Z"
      },
      "server": {
        "id": "wallet-uuid-2",
        "type": "server",
        "privyWalletId": "privy-id-2",
        "ownerId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
        "address": "0x5678...efgh",
        "chainId": null,
        "createdAt": "2025-01-01T00:00:00.000Z"
      },
      "agent": {
        "id": "wallet-uuid-3",
        "type": "agent",
        "privyWalletId": "privy-id-3",
        "ownerId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
        "address": "0x9abc...ijkl",
        "chainId": null,
        "createdAt": "2025-01-01T00:00:00.000Z"
      }
    }
  }
}
```

**Errors:** `OnboardingError` if wallet creation or profile insertion fails. `WalletError` if Privy wallet creation fails.

#### `GET /api/profile`

Get the authenticated user's profile with all wallet details populated. Returns 400 with `OnboardingError` if the user has not been onboarded.

```bash
curl http://localhost:3000/api/profile \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `UserProfileWithWallets`

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "privyUserId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
    "userWalletId": "wallet-uuid-1",
    "serverWalletId": "wallet-uuid-2",
    "agentWalletId": "wallet-uuid-3",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z",
    "userWallet": { "id": "wallet-uuid-1", "type": "user", "address": "0x1234...abcd", "..." : "..." },
    "serverWallet": { "id": "wallet-uuid-2", "type": "server", "address": "0x5678...efgh", "..." : "..." },
    "agentWallet": { "id": "wallet-uuid-3", "type": "agent", "address": "0x9abc...ijkl", "..." : "..." }
  }
}
```

**Errors:** `OnboardingError` if the user has not been onboarded (message: `"Profile not found for user: ..."`).

#### `GET /api/profile/wallets`

Get just the wallet addresses for the authenticated user. A convenience endpoint for clients that only need addresses.

```bash
curl http://localhost:3000/api/profile/wallets \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "user": "0x1234...abcd",
    "server": "0x5678...efgh",
    "agent": "0x9abc...ijkl"
  }
}
```

**Errors:** `OnboardingError` if the user has not been onboarded.

---

### Recurring Payments

#### `GET /api/recurring-payments`

List the authenticated user's recurring payment schedules, ordered by creation date.

```bash
curl http://localhost:3000/api/recurring-payments \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<RecurringPayment>`

#### `GET /api/recurring-payments/:id`

Get a single recurring payment schedule. Returns the schedule only if the authenticated user owns it.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl http://localhost:3000/api/recurring-payments/some-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `RecurringPayment`

**Errors:** `Error` if not found or not owned by the authenticated user.

#### `POST /api/recurring-payments`

Create a new recurring payment schedule. The authenticated user must own the specified wallet. The `chainId` defaults to the server's `DEFAULT_CHAIN_ID` configuration value when omitted.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `walletId` | string | no | Database ID of the wallet. Required if `walletType` is not provided. |
| `walletType` | `"user"` \| `"server"` \| `"agent"` | yes | Wallet type. Used to resolve the wallet from the user's profile if `walletId` is not provided. |
| `recipientAddress` | string | yes | Destination address for the payment |
| `paymentType` | `"erc20_transfer"` \| `"raw_transfer"` \| `"contract_call"` \| `"offramp"` | yes | Type of payment to execute |
| `amount` | string | yes | Amount in the smallest unit (wei, token units, etc.) |
| `tokenContractName` | string | no | For `erc20_transfer`: the registered contract name |
| `contractName` | string | no | For `contract_call`: the registered contract name |
| `contractMethod` | string | no | For `contract_call`: the method to invoke |
| `contractArgs` | array | no | For `contract_call`: the arguments to pass |
| `chainId` | number | no | EVM chain ID (defaults to `DEFAULT_CHAIN_ID`) |
| `frequency` | string | yes | Schedule interval: `30s`, `5m`, `1h`, `1d`, `7d`, etc. |
| `startDate` | string | no | ISO timestamp for when to begin (defaults to now) |
| `endDate` | string | no | ISO timestamp for when to stop (no end date if omitted) |
| `maxRetries` | number | no | Consecutive failures before auto-pausing (default: 3) |
| `offramp` | object | no | Offramp configuration (required when `paymentType` is `"offramp"`) |
| `offramp.currency` | string | yes* | Fiat currency code (e.g., `"USD"`, `"EUR"`) |
| `offramp.fiatAmount` | string | yes* | Fiat amount as a decimal string (e.g., `"100.50"`) |
| `offramp.provider` | string | yes* | Offramp provider name (`"moonpay"`, `"bridge"`, or `"transak"`) |
| `offramp.destinationId` | string | yes* | Bank account or payment method ID at the provider |
| `offramp.metadata` | object | no | Provider-specific metadata |

*Required when `paymentType` is `"offramp"`.

```bash
curl -X POST http://localhost:3000/api/recurring-payments \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletType": "server",
    "recipientAddress": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "paymentType": "erc20_transfer",
    "amount": "1000000",
    "tokenContractName": "usdc",
    "chainId": 1,
    "frequency": "1d",
    "maxRetries": 5
  }'
```

**Response data:** `RecurringPayment` (HTTP 201)

**Errors:** `Error` if wallet not found or not owned by the user. `RecurringPaymentError` if schedule creation fails.

#### `POST /api/recurring-payments/:id/pause`

Pause an active schedule. The authenticated user must own the schedule.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X POST http://localhost:3000/api/recurring-payments/some-uuid/pause \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `RecurringPayment` (with status `"paused"`)

**Errors:** `Error` if not found or not owned. `RecurringPaymentError` if update fails.

#### `POST /api/recurring-payments/:id/resume`

Resume a paused schedule. Resets consecutive failure count and recalculates next execution time.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X POST http://localhost:3000/api/recurring-payments/some-uuid/resume \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `RecurringPayment` (with status `"active"`)

**Errors:** `Error` if not found or not owned. `RecurringPaymentError` if update fails.

#### `POST /api/recurring-payments/:id/cancel`

Cancel a schedule permanently. The schedule will not be processed again.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X POST http://localhost:3000/api/recurring-payments/some-uuid/cancel \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `RecurringPayment` (with status `"cancelled"`)

**Errors:** `Error` if not found or not owned. `RecurringPaymentError` if update fails.

#### `GET /api/recurring-payments/:id/executions`

Get the execution history for a schedule. The authenticated user must own the schedule.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `id` | path | string | yes | Schedule ID |
| `limit` | query | number | no | Maximum results (default: 50) |

```bash
curl "http://localhost:3000/api/recurring-payments/some-uuid/executions?limit=20" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<RecurringPaymentExecution>`

```json
{
  "success": true,
  "data": [
    {
      "id": "exec-uuid",
      "scheduleId": "some-uuid",
      "transactionId": "tx-uuid",
      "status": "success",
      "error": null,
      "executedAt": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

**Errors:** `Error` if schedule not found or not owned. `RecurringPaymentError` if query fails.

---

### Yield

#### `GET /api/yield/vaults`

List active yield vaults. Optionally filter by chain.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `chainId` | query | number | no | Filter vaults by EVM chain ID |

```bash
curl http://localhost:3000/api/yield/vaults \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<YieldVault>` (only active vaults)

#### `GET /api/yield/vaults/:id`

Get a single vault by its database ID.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl http://localhost:3000/api/yield/vaults/some-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `YieldVault`

**Errors:** `Error` if not found.

#### `POST /api/yield/positions`

Create a new yield position (lock tokens in a vault). Submits a `lockWithYield` transaction via the YieldTimeLock contract and records the position in the database.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `walletId` | string | no | Database ID of the wallet. Required if `walletType` is not provided. |
| `walletType` | `"user"` \| `"server"` \| `"agent"` | yes | Wallet type. Used to resolve the wallet from the user's profile if `walletId` is not provided. |
| `vaultId` | string | yes | Database ID of the yield vault to deposit into |
| `amount` | string | yes | Amount to deposit in the smallest unit (e.g. wei) |
| `unlockTime` | number | yes | Unix timestamp (seconds) when the lock expires |
| `label` | string | no | Human-readable label for this position |
| `chainId` | number | no | EVM chain ID (defaults to `DEFAULT_CHAIN_ID`) |

```bash
curl -X POST http://localhost:3000/api/yield/positions \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletType": "server",
    "vaultId": "vault-uuid",
    "amount": "1000000000",
    "unlockTime": 1750000000,
    "label": "savings"
  }'
```

**Response data:** `YieldPosition` (HTTP 201)

**Errors:** `YieldError` if vault not found, vault inactive, or lock transaction fails.

#### `GET /api/yield/positions`

List the authenticated user's yield positions, ordered by creation date (newest first).

```bash
curl http://localhost:3000/api/yield/positions \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<YieldPosition>`

#### `GET /api/yield/positions/:id`

Get a single position. Returns the position only if the authenticated user owns it.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl http://localhost:3000/api/yield/positions/some-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `YieldPosition`

**Errors:** `Error` if not found or not owned by the authenticated user.

#### `POST /api/yield/positions/:id/withdraw`

Withdraw a matured yield position. Submits a `withdraw` transaction on-chain and marks the position as `"withdrawn"`.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `id` | path | string | yes | Position database ID |
| `walletId` | body | string | no | Wallet to use for the withdraw transaction (defaults to the wallet used when creating the position) |
| `walletType` | body | `"user"` \| `"server"` \| `"agent"` | no | Wallet type (defaults to `"server"`) |

```bash
curl -X POST http://localhost:3000/api/yield/positions/some-uuid/withdraw \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "walletType": "server" }'
```

**Response data:** `YieldPosition` (with status `"withdrawn"`)

**Errors:** `Error` if not found or not owned. `YieldError` if position is not active/matured or withdraw transaction fails.

#### `GET /api/yield/positions/:id/history`

Get yield snapshot history for a position. The authenticated user must own the position.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `id` | path | string | yes | Position database ID |
| `limit` | query | number | no | Maximum results (default: 50) |

```bash
curl "http://localhost:3000/api/yield/positions/some-uuid/history?limit=20" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<YieldSnapshot>`

```json
{
  "success": true,
  "data": [
    {
      "id": "snap-uuid",
      "positionId": "some-uuid",
      "currentAssets": "1050000000",
      "accruedYield": "50000000",
      "estimatedApy": "5.0000",
      "snapshotAt": "2025-01-15T12:00:00.000Z"
    }
  ]
}
```

**Errors:** `Error` if position not found or not owned.

#### `GET /api/yield/portfolio`

Get a portfolio summary for the authenticated user, aggregating across all their positions.

```bash
curl http://localhost:3000/api/yield/portfolio \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `PortfolioSummary`

```json
{
  "success": true,
  "data": {
    "totalPrincipal": "2000000000",
    "totalCurrentValue": "2100000000",
    "totalYield": "100000000",
    "averageApy": "5.0000",
    "positionCount": 2
  }
}
```

---

## Internal API

All `/internal/*` routes require the `X-Admin-Key` header with the value matching the `ADMIN_API_KEY` environment variable. These routes are intended for backend administration and the admin dashboard. They are not user-scoped -- they can access data across all users.

---

### Wallets (Admin)

#### `GET /internal/wallets`

List all wallets across all users, ordered by creation date.

```bash
curl http://localhost:3000/internal/wallets \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `Array<Wallet>`

#### `POST /internal/wallets/server`

Create a new server wallet. No request body required.

```bash
curl -X POST http://localhost:3000/internal/wallets/server \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "address": "0x5678...efgh",
    "type": "server"
  }
}
```

**Errors:** `WalletError` if Privy wallet creation or database persistence fails.

#### `POST /internal/wallets/agent`

Create a new agent wallet.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | yes | Identifier for the agent |

```bash
curl -X POST http://localhost:3000/internal/wallets/agent \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "agentId": "agent-001" }'
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "address": "0x9abc...ijkl",
    "type": "agent"
  }
}
```

**Errors:** `WalletError` if Privy wallet creation or database persistence fails.

---

### Transactions (Admin)

#### `GET /internal/transactions`

List all transactions with pagination. Not scoped to any user.

| Parameter | Location | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `limit` | query | number | 50 | Maximum number of results |
| `offset` | query | number | 0 | Number of results to skip |

```bash
curl "http://localhost:3000/internal/transactions?limit=10&offset=0" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `Array<Transaction>`

#### `GET /internal/transactions/wallet/:walletId`

List all transactions for a specific wallet.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `walletId` | path | string | yes |

```bash
curl http://localhost:3000/internal/transactions/wallet/wallet-uuid \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `Array<Transaction>`

#### `GET /internal/transactions/user/:userId`

List all transactions for a specific user.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `userId` | path | string | yes |

```bash
curl http://localhost:3000/internal/transactions/user/did:privy:cm3x9kf2a00cl14mhbz6t7s92 \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `Array<Transaction>`

#### `PATCH /internal/transactions/:id/confirm`

Mark a transaction as confirmed (typically called by an external confirmation service or webhook).

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `id` | path | string | yes | Transaction database ID |
| `gasUsed` | body | string | no | Gas used (as a string, will be parsed as bigint) |

```bash
curl -X PATCH http://localhost:3000/internal/transactions/some-uuid/confirm \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "gasUsed": "21000" }'
```

**Response data:** `Transaction` (with status `"confirmed"`)

**Errors:** `LedgerError`.

#### `PATCH /internal/transactions/:id/fail`

Mark a transaction as failed.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `id` | path | string | yes | Transaction database ID |
| `error` | body | string | no | Error description (defaults to `"Unknown error"`) |

```bash
curl -X PATCH http://localhost:3000/internal/transactions/some-uuid/fail \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "error": "Transaction reverted: insufficient balance" }'
```

**Response data:** `Transaction` (with status `"failed"`)

**Errors:** `LedgerError`.

---

### Jobs (Admin)

#### `GET /internal/jobs`

List all jobs, ordered by creation date.

```bash
curl http://localhost:3000/internal/jobs \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `Array<Job>`

#### `GET /internal/jobs/:id`

Get a job by its database ID.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl http://localhost:3000/internal/jobs/some-uuid \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `Job`

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Hourly ETH sweep",
    "jobType": "raw_transaction",
    "schedule": "1h",
    "payload": { "walletId": "...", "chainId": 1, "to": "0x...", "value": "..." },
    "status": "pending",
    "lastRunAt": null,
    "nextRunAt": "2025-01-01T01:00:00.000Z",
    "maxRetries": 3,
    "retryCount": 0,
    "error": null,
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  }
}
```

**Errors:** `Error` if not found.

#### `POST /internal/jobs`

Create a new recurring job.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Human-readable job name |
| `jobType` | string | yes | `"contract_transaction"` or `"raw_transaction"` |
| `schedule` | string | yes | Duration string (`30s`, `5m`, `1h`, `1d`) |
| `payload` | object | yes | Parameters for the transaction (varies by jobType) |
| `maxRetries` | number | no | Maximum retry attempts (default: 3) |

**Payload for `contract_transaction`:**

```json
{
  "walletId": "string",
  "walletType": "user | server | agent",
  "contractName": "string",
  "chainId": "number",
  "method": "string",
  "args": ["array"],
  "value": "optional wei string"
}
```

**Payload for `raw_transaction`:**

```json
{
  "walletId": "string",
  "walletType": "user | server | agent",
  "chainId": "number",
  "to": "0x address",
  "data": "optional 0x calldata",
  "value": "optional wei string"
}
```

```bash
curl -X POST http://localhost:3000/internal/jobs \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily USDC payout",
    "jobType": "contract_transaction",
    "schedule": "1d",
    "payload": {
      "walletId": "treasury-id",
      "walletType": "server",
      "contractName": "usdc",
      "chainId": 1,
      "method": "transfer",
      "args": ["0xRecipient", "1000000"]
    },
    "maxRetries": 5
  }'
```

**Response data:** `Job`

**Errors:** `JobberError` if database insert fails.

#### `POST /internal/jobs/:id/cancel`

Cancel a job, preventing it from being processed in future runs.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X POST http://localhost:3000/internal/jobs/some-uuid/cancel \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `Job` (with status `"cancelled"`)

**Errors:** `JobberError` if database update fails.

#### `POST /internal/jobs/process`

Manually trigger processing of all due jobs. Finds jobs with `status = "pending"` and `nextRunAt <= now`, executes them, and reschedules.

```bash
curl -X POST http://localhost:3000/internal/jobs/process \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "processedCount": 2,
    "jobs": [ ]
  }
}
```

**Errors:** `JobberError`, `TransactionError`, or `LedgerError`.

---

### Recurring Payments (Admin)

#### `GET /internal/recurring-payments`

List all recurring payment schedules with pagination. Not scoped to any user.

| Parameter | Location | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `limit` | query | number | 50 | Maximum number of results |
| `offset` | query | number | 0 | Number of results to skip |

```bash
curl "http://localhost:3000/internal/recurring-payments?limit=10&offset=0" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `Array<RecurringPayment>`

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "userId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
      "walletId": "wallet-uuid",
      "walletType": "server",
      "recipientAddress": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      "paymentType": "erc20_transfer",
      "amount": "1000000",
      "tokenContractName": "usdc",
      "contractName": null,
      "contractMethod": null,
      "contractArgs": null,
      "chainId": 1,
      "isOfframp": false,
      "offrampCurrency": null,
      "offrampFiatAmount": null,
      "offrampProvider": null,
      "offrampDestinationId": null,
      "offrampMetadata": null,
      "frequency": "1d",
      "status": "active",
      "startDate": "2025-01-15T10:00:00.000Z",
      "endDate": null,
      "nextExecutionAt": "2025-01-16T10:00:00.000Z",
      "maxRetries": 3,
      "consecutiveFailures": 0,
      "totalExecutions": 5,
      "createdAt": "2025-01-15T10:00:00.000Z",
      "updatedAt": "2025-01-15T10:00:00.000Z"
    }
  ]
}
```

#### `GET /internal/recurring-payments/:id`

Get a single recurring payment schedule by its database ID.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl http://localhost:3000/internal/recurring-payments/some-uuid \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `RecurringPayment`

**Errors:** `Error` if not found.

#### `POST /internal/recurring-payments/:id/execute`

Force-execute a recurring payment schedule immediately, regardless of its next scheduled execution time. The schedule does not need to be in the `active` state.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X POST http://localhost:3000/internal/recurring-payments/some-uuid/execute \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `RecurringPaymentExecution`

```json
{
  "success": true,
  "data": {
    "id": "exec-uuid",
    "scheduleId": "some-uuid",
    "transactionId": "tx-uuid",
    "status": "success",
    "error": null,
    "executedAt": "2025-01-15T14:30:00.000Z"
  }
}
```

**Errors:** `RecurringPaymentError` if the schedule is not found or execution fails.

#### `GET /internal/recurring-payments/:id/executions`

Get the execution history for a schedule.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `id` | path | string | yes | Schedule ID |
| `limit` | query | number | no | Maximum results (default: 50) |

```bash
curl "http://localhost:3000/internal/recurring-payments/some-uuid/executions?limit=20" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `Array<RecurringPaymentExecution>`

#### `POST /internal/recurring-payments/process`

Manually trigger processing of all due recurring payments. Finds schedules with `status = "active"` and `nextExecutionAt <= now`, executes them, and reschedules.

```bash
curl -X POST http://localhost:3000/internal/recurring-payments/process \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "processedCount": 3,
    "executions": [ ]
  }
}
```

**Errors:** `RecurringPaymentError`.

---

### Profiles (Admin)

#### `GET /internal/profiles`

List all user profiles, ordered by creation date.

```bash
curl http://localhost:3000/internal/profiles \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `Array<UserProfile>`

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "privyUserId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
      "userWalletId": "wallet-uuid-1",
      "serverWalletId": "wallet-uuid-2",
      "agentWalletId": "wallet-uuid-3",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

#### `GET /internal/profiles/:privyUserId`

Get a specific user's profile with all wallet details populated.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `privyUserId` | path | string | yes |

```bash
curl http://localhost:3000/internal/profiles/did:privy:cm3x9kf2a00cl14mhbz6t7s92 \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `UserProfileWithWallets` (same shape as `GET /api/profile`)

**Errors:** `OnboardingError` if no profile exists for the given user.

#### `POST /internal/profiles/:privyUserId/onboard`

Admin-triggered onboarding for a specific user. Behaves identically to `POST /api/onboard` but can be called for any user without needing their Privy auth token. Idempotent.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `privyUserId` | path | string | yes | The user's Privy DID |
| `chainId` | body | number | no | EVM chain ID (default: `1`) |

```bash
curl -X POST http://localhost:3000/internal/profiles/did:privy:cm3x9kf2a00cl14mhbz6t7s92/onboard \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "chainId": 1 }'
```

**Response data:** Same shape as `POST /api/onboard` (profile + wallets).

**Errors:** `OnboardingError` or `WalletError`.

---

### Yield (Admin)

#### `GET /internal/yield/vaults`

List all yield vaults, including inactive ones.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `chainId` | query | number | no | Filter vaults by chain ID |

```bash
curl http://localhost:3000/internal/yield/vaults \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `Array<YieldVault>` (including inactive)

#### `POST /internal/yield/vaults`

Add a new yield vault.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `vaultAddress` | string | yes | On-chain vault contract address |
| `chainId` | number | yes | EVM chain ID |
| `name` | string | yes | Human-readable vault name |
| `description` | string | no | Vault description |
| `underlyingToken` | string | no | Underlying token contract address |
| `underlyingSymbol` | string | no | Token symbol (e.g. `"USDC"`) |
| `underlyingDecimals` | number | no | Token decimals (e.g. `6`) |

```bash
curl -X POST http://localhost:3000/internal/yield/vaults \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "vaultAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "chainId": 1,
    "name": "USDC Morpho Vault",
    "underlyingSymbol": "USDC",
    "underlyingDecimals": 6
  }'
```

**Response data:** `YieldVault` (HTTP 201)

**Errors:** `YieldError` if database insert fails.

#### `DELETE /internal/yield/vaults/:id`

Deactivate a vault. Sets `isActive` to `false` -- does not delete the record.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X DELETE http://localhost:3000/internal/yield/vaults/some-uuid \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `YieldVault` (with `isActive: false`)

**Errors:** `YieldError` if update fails.

#### `POST /internal/yield/vaults/sync`

Sync vaults from on-chain data. Reads the vault list from the YieldTimeLock contract and inserts any new vaults not already in the database.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chainId` | number | yes | EVM chain ID to sync from |

```bash
curl -X POST http://localhost:3000/internal/yield/vaults/sync \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "chainId": 1 }'
```

**Response data:** `Array<YieldVault>` (all vaults for the chain after sync)

**Errors:** `YieldError` if chain read or database operations fail.

#### `GET /internal/yield/positions`

List all yield positions across all users with pagination.

| Parameter | Location | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `limit` | query | number | 50 | Maximum results |
| `offset` | query | number | 0 | Number of results to skip |

```bash
curl "http://localhost:3000/internal/yield/positions?limit=10&offset=0" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:** `Array<YieldPosition>`

#### `POST /internal/yield/snapshots/run`

Trigger yield snapshots for all active positions. Reads accrued yield from on-chain, calculates APY, and stores snapshots. Individual position failures are tolerated and do not block other snapshots.

```bash
curl -X POST http://localhost:3000/internal/yield/snapshots/run \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "snapshotCount": 5,
    "snapshots": [ ]
  }
}
```

**Errors:** `YieldError` if listing active positions fails.

---

## Type Reference

### Wallet

```typescript
{
  id: string;
  type: "user" | "server" | "agent";
  privyWalletId: string;
  ownerId: string;
  address: string | null;
  chainId: string | null;
  createdAt: string; // ISO timestamp
}
```

### Transaction

```typescript
{
  id: string;
  walletId: string;
  walletType: "user" | "server" | "agent";
  chainId: string;
  contractId: string | null;
  method: string;
  payload: Record<string, unknown>;
  status: "pending" | "submitted" | "confirmed" | "failed";
  txHash: string | null;
  gasUsed: string | null; // bigint serialized as string
  categoryId: string | null;
  userId: string | null;
  error: string | null;
  createdAt: string; // ISO timestamp
  confirmedAt: string | null; // ISO timestamp
}
```

### TransactionCategory

```typescript
{
  id: string;
  name: string;
  userId: string | null;
  description: string | null;
  createdAt: string; // ISO timestamp
}
```

### Job

```typescript
{
  id: string;
  name: string;
  jobType: string;
  schedule: string;
  payload: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  lastRunAt: string | null; // ISO timestamp
  nextRunAt: string | null; // ISO timestamp
  maxRetries: number;
  retryCount: number;
  error: string | null;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}
```

### UserProfile

```typescript
{
  id: string;
  privyUserId: string;
  userWalletId: string;
  serverWalletId: string;
  agentWalletId: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}
```

### UserProfileWithWallets

```typescript
{
  id: string;
  privyUserId: string;
  userWalletId: string;
  serverWalletId: string;
  agentWalletId: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  userWallet: Wallet;
  serverWallet: Wallet;
  agentWallet: Wallet;
}
```

### ContractConnector

```typescript
{
  name: string;
  chainId: number;
  address: `0x${string}`;
  abi: Abi; // viem Abi type
  methods?: Record<string, {
    functionName: string;
    description?: string;
  }>;
}
```

### RecurringPayment

```typescript
{
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
  startDate: string; // ISO timestamp
  endDate: string | null; // ISO timestamp
  nextExecutionAt: string; // ISO timestamp
  maxRetries: number;
  consecutiveFailures: number;
  totalExecutions: number;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}
```

### RecurringPaymentExecution

```typescript
{
  id: string;
  scheduleId: string;
  transactionId: string | null;
  status: "success" | "failed";
  error: string | null;
  executedAt: string; // ISO timestamp
}
```

### YieldVault

```typescript
{
  id: string;
  vaultAddress: string;
  chainId: number;
  name: string;
  description: string | null;
  underlyingToken: string | null;
  underlyingSymbol: string | null;
  underlyingDecimals: number | null;
  isActive: boolean;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}
```

### YieldPosition

```typescript
{
  id: string;
  userId: string;
  walletId: string;
  vaultId: string;
  onChainLockId: string;
  principalAmount: string; // arbitrary precision
  shares: string; // arbitrary precision
  unlockTime: string; // ISO timestamp
  label: string | null;
  status: "active" | "matured" | "withdrawn" | "emergency";
  transactionId: string | null;
  chainId: number;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}
```

### YieldSnapshot

```typescript
{
  id: string;
  positionId: string;
  currentAssets: string; // arbitrary precision
  accruedYield: string; // arbitrary precision
  estimatedApy: string | null; // e.g. "5.0000"
  snapshotAt: string; // ISO timestamp
}
```

### PortfolioSummary

```typescript
{
  totalPrincipal: string; // arbitrary precision
  totalCurrentValue: string; // arbitrary precision
  totalYield: string; // arbitrary precision
  averageApy: string; // e.g. "5.0000"
  positionCount: number;
}
```
