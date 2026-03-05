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

## Postman Collection

A ready-to-use Postman collection is available at [`docs/expendi-api.postman_collection.json`](./expendi-api.postman_collection.json). Import it into Postman to get pre-configured requests for every endpoint listed below.

---

## Authentication

Expendi uses two authentication mechanisms:

| Route prefix | Auth method | Header | Description |
|-------------|-------------|--------|-------------|
| `/api/*` | Privy access token | `Authorization: Bearer <token>` | Verifies the user's identity via Privy. The user's DID is extracted and used to scope all operations. |
| `/internal/*` | Admin API key | `X-Admin-Key: <key>` | Static key matching the `ADMIN_API_KEY` environment variable. Used by the admin dashboard and backend services. |
| `/webhooks/*` | None | -- | Payment provider webhook callbacks (e.g., Pretium). No authentication; payloads are validated by the receiving handler. |
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
    "profile": "/api/profile",
    "recurringPayments": "/api/recurring-payments",
    "yield": "/api/yield",
    "pretium": "/api/pretium",
    "onramp": "/api/pretium/onramp",
    "uniswap": "/api/uniswap",
    "swapAutomations": "/api/swap-automations",
    "goalSavings": "/api/goal-savings",
    "webhooks": "/webhooks/pretium"
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
| `sponsor` | boolean | no | Enable Privy gas sponsorship (requires sponsorship policies configured in Privy dashboard) |

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

#### `PUT /api/profile/username`

Claim or update the authenticated user's username. Usernames must be 3-20 characters, lowercase alphanumeric with underscores only (`^[a-z0-9_]+$`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | string | yes | Desired username (3-20 chars, lowercase alphanumeric + underscores) |

```bash
curl -X PUT http://localhost:3000/api/profile/username \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "username": "alice_99" }'
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "privyUserId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
    "username": "alice_99",
    "userWalletId": "wallet-uuid-1",
    "serverWalletId": "wallet-uuid-2",
    "agentWalletId": "wallet-uuid-3",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  }
}
```

**Errors:** `OnboardingError` if username is invalid, already taken, or user is not onboarded.

#### `GET /api/profile/resolve/:username`

Resolve a username to a user ID and wallet address. Useful for sending to users by name instead of raw addresses.

```bash
curl http://localhost:3000/api/profile/resolve/alice_99 \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "username": "alice_99",
    "userId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
    "address": "0x1234...abcd"
  }
}
```

**Errors:** `OnboardingError` if the username does not exist.

---

### Group Accounts

Group accounts are shared wallets managed by an admin, powered by on-chain `GroupAccount` and `GroupAccountFactory` smart contracts on Base. Members can deposit funds, and the admin can pay out to members. Members can be identified by username or wallet address.

#### `POST /api/groups`

Create a new group account. The authenticated user becomes the admin. Members can be specified by username or `0x` wallet address.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Group name |
| `description` | string | no | Optional description |
| `members` | string[] | yes | Member identifiers (usernames or 0x addresses) |

```bash
curl -X POST http://localhost:3000/api/groups \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Team Fund", "members": ["bob", "0x1234...abcd"] }'
```

**Response data (HTTP 201):** `GroupAccount` object.

**Errors:** `GroupAccountError` if creation fails. `OnboardingError` if a username cannot be resolved.

#### `GET /api/groups`

List groups the authenticated user belongs to (as admin or member).

```bash
curl http://localhost:3000/api/groups \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** Array of `GroupAccount` objects.

#### `GET /api/groups/:id`

Get a group with all its members, including usernames and wallet addresses.

```bash
curl http://localhost:3000/api/groups/group-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `GroupWithMembers` object (group + `members` array with `username`, `walletAddress`, `role`).

**Errors:** `GroupAccountError` if group not found.

#### `GET /api/groups/:id/members`

List group members with usernames and wallet addresses.

```bash
curl http://localhost:3000/api/groups/group-uuid/members \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** Array of member objects with `id`, `userId`, `walletAddress`, `role`, `username`, `joinedAt`.

#### `POST /api/groups/:id/members`

Add a member to the group. Admin only.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `member` | string | yes | Username or `0x` wallet address |

```bash
curl -X POST http://localhost:3000/api/groups/group-uuid/members \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "member": "charlie" }'
```

**Response data (HTTP 201):** `GroupAccountMember` object.

**Errors:** `GroupAccountError` if not admin or member cannot be resolved.

#### `DELETE /api/groups/:id/members/:identifier`

Remove a member from the group. Admin only. The `:identifier` can be a username or wallet address.

```bash
curl -X DELETE http://localhost:3000/api/groups/group-uuid/members/charlie \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `{ "removed": true }`

**Errors:** `GroupAccountError` if not admin or member not found.

#### `POST /api/groups/:id/pay`

Admin payout from the group wallet. Supports ETH or ERC-20 token payments.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | string | yes | Recipient username or `0x` address |
| `amount` | string | yes | Amount in smallest unit (wei / token decimals) |
| `token` | string | no | ERC-20 token address. Omit for ETH. |

```bash
curl -X POST http://localhost:3000/api/groups/group-uuid/pay \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "to": "bob", "amount": "1000000", "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }'
```

**Response data:** `{ "transactionId": "tx-uuid" }`

**Errors:** `GroupAccountError` if not admin or pay fails.

#### `POST /api/groups/:id/deposit`

Member deposit into the group wallet. Any group member can deposit.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | string | yes | Amount in smallest unit |
| `token` | string | no | ERC-20 token address. Omit for ETH. |

```bash
curl -X POST http://localhost:3000/api/groups/group-uuid/deposit \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "amount": "500000" }'
```

**Response data:** `{ "transactionId": "tx-uuid" }`

**Errors:** `GroupAccountError` if not a group member or deposit fails.

#### `POST /api/groups/:id/transfer-admin`

Transfer admin role to another group member. Current admin only.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `newAdmin` | string | yes | Username or `0x` address of the new admin |

```bash
curl -X POST http://localhost:3000/api/groups/group-uuid/transfer-admin \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "newAdmin": "bob" }'
```

**Response data:** `{ "transferred": true }`

**Errors:** `GroupAccountError` if not admin or new admin not found.

#### `GET /api/groups/:id/balance`

Get the group wallet's ETH and ERC-20 token balances.

| Query Param | Type | Required | Description |
|-------------|------|----------|-------------|
| `tokens` | string | no | Comma-separated ERC-20 token addresses |

```bash
curl "http://localhost:3000/api/groups/group-uuid/balance?tokens=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "eth": "2000000000000000000",
    "tokens": {
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": "10000000"
    }
  }
}
```

**Errors:** `GroupAccountError` if group not found.

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

### Pretium (Offramp & Onramp)

Pretium endpoints enable crypto-to-fiat (offramp) and fiat-to-crypto (onramp) transactions across African countries. Offramp supports all 7 countries (KE, NG, GH, UG, CD, MW, ET) with mobile money and bank transfer payouts. Onramp supports 5 countries (KE, GH, UG, CD, MW) with mobile money payments for receiving stablecoins (USDC, USDT, CUSD) on Base chain.

#### `GET /api/pretium/countries`

List all supported countries with their payment configurations.

```bash
curl http://localhost:3000/api/pretium/countries \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<CountryPaymentConfig>`

```json
{
  "success": true,
  "data": [
    {
      "code": "KE",
      "name": "Kenya",
      "currency": "KES",
      "paymentTypes": ["MOBILE", "BUY_GOODS", "PAYBILL"],
      "mobileNetworks": ["SAFARICOM", "AIRTEL"]
    }
  ]
}
```

#### `GET /api/pretium/countries/:code`

Get the payment configuration for a specific country.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `code` | path | string | yes | ISO 3166-1 alpha-2 country code (e.g., `KE`, `NG`) |

```bash
curl http://localhost:3000/api/pretium/countries/KE \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `CountryPaymentConfig`

**Errors:** `Error` if the country code is not supported.

#### `GET /api/pretium/exchange-rate/:currency`

Get the current USDC-to-fiat exchange rate for a currency.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `currency` | path | string | yes | Fiat currency code (e.g., `KES`, `NGN`, `GHS`) |

```bash
curl http://localhost:3000/api/pretium/exchange-rate/KES \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "currency": "KES",
    "rate": "129.50",
    "updatedAt": "2025-01-15T10:30:00.000Z"
  }
}
```

**Errors:** `Error` if the currency is not supported.

#### `POST /api/pretium/convert/usdc-to-fiat`

Convert a USDC amount to its equivalent fiat value using the current exchange rate.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `usdcAmount` | number | yes | Amount in USDC to convert |
| `currency` | string | yes | Target fiat currency code (e.g., `KES`, `NGN`) |

```bash
curl -X POST http://localhost:3000/api/pretium/convert/usdc-to-fiat \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "usdcAmount": 100,
    "currency": "KES"
  }'
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "usdcAmount": 100,
    "fiatAmount": "12950.00",
    "currency": "KES",
    "exchangeRate": "129.50"
  }
}
```

**Errors:** `Error` if the currency is not supported.

#### `POST /api/pretium/convert/fiat-to-usdc`

Convert a fiat amount to its equivalent USDC value using the current exchange rate.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fiatAmount` | number | yes | Amount in fiat currency to convert |
| `currency` | string | yes | Source fiat currency code (e.g., `KES`, `NGN`) |

```bash
curl -X POST http://localhost:3000/api/pretium/convert/fiat-to-usdc \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fiatAmount": 12950,
    "currency": "KES"
  }'
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "fiatAmount": 12950,
    "usdcAmount": "100.00",
    "currency": "KES",
    "exchangeRate": "129.50"
  }
}
```

**Errors:** `Error` if the currency is not supported.

#### `POST /api/pretium/validate/phone`

Validate a phone number and look up the mobile network operator (MNO) name for a given country and network.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `country` | string | yes | ISO 3166-1 alpha-2 country code |
| `phoneNumber` | string | yes | Phone number to validate |
| `network` | string | yes | Mobile network identifier (e.g., `SAFARICOM`, `MTN`) |

```bash
curl -X POST http://localhost:3000/api/pretium/validate/phone \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "country": "KE",
    "phoneNumber": "+254712345678",
    "network": "SAFARICOM"
  }'
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "valid": true,
    "phoneNumber": "+254712345678",
    "network": "SAFARICOM",
    "networkName": "Safaricom"
  }
}
```

**Errors:** `Error` if the phone number is invalid or the network is not supported in the specified country.

#### `POST /api/pretium/validate/bank-account`

Validate a bank account number and look up the account holder name.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `country` | string | yes | ISO 3166-1 alpha-2 country code (NG, KE) |
| `accountNumber` | string | yes | Bank account number |
| `bankCode` | string | yes | Bank code identifier |

```bash
curl -X POST http://localhost:3000/api/pretium/validate/bank-account \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "country": "NG",
    "accountNumber": "0123456789",
    "bankCode": "058"
  }'
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "valid": true,
    "accountNumber": "0123456789",
    "bankCode": "058",
    "accountName": "John Doe"
  }
}
```

**Errors:** `Error` if the account number or bank code is invalid.

#### `GET /api/pretium/banks/:country`

Get the list of supported banks for a country. Currently available for Nigeria (NG) and Kenya (KE) only.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `country` | path | string | yes | ISO 3166-1 alpha-2 country code (`NG` or `KE`) |

```bash
curl http://localhost:3000/api/pretium/banks/NG \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:**

```json
{
  "success": true,
  "data": [
    {
      "bankCode": "058",
      "bankName": "Guaranty Trust Bank"
    },
    {
      "bankCode": "033",
      "bankName": "United Bank for Africa"
    }
  ]
}
```

**Errors:** `Error` if the country does not support bank transfers.

#### `GET /api/pretium/settlement-address`

Get the USDC deposit address where funds should be sent before initiating an offramp disbursement.

```bash
curl http://localhost:3000/api/pretium/settlement-address \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "address": "0x1234567890abcdef1234567890abcdef12345678",
    "network": "ethereum",
    "token": "USDC"
  }
}
```

#### `POST /api/pretium/offramp`

Initiate an offramp disbursement. Sends USDC to the Pretium settlement address and triggers a fiat payout to the specified mobile money or bank account.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `country` | string | yes | ISO 3166-1 alpha-2 country code |
| `walletId` | string | yes | Database ID of the wallet to debit |
| `usdcAmount` | number | yes | Amount of USDC to offramp. The amount sent to Pretium is floored to an integer. |
| `phoneNumber` | string | yes | Recipient phone number for mobile money payouts |
| `mobileNetwork` | string | yes | Mobile network identifier (e.g., `SAFARICOM`, `MTN`). Sent to Pretium for all Kenya payment types (`MOBILE`, `BUY_GOODS`, `PAYBILL`), not only `MOBILE`. |
| `transactionHash` | string | yes | On-chain transaction hash of the USDC transfer to the settlement address |
| `paymentType` | string | no | Payment method: `MOBILE`, `BUY_GOODS`, `PAYBILL`, or `BANK_TRANSFER` (defaults to `MOBILE`) |
| `accountNumber` | string | no | Bank account number (required for `BANK_TRANSFER`) |
| `accountName` | string | no | Bank account holder name |
| `bankAccount` | string | no | Bank account identifier |
| `bankCode` | string | no | Bank code (required for `BANK_TRANSFER`) |
| `bankName` | string | no | Bank name |
| `callbackUrl` | string | no | URL to receive payment status webhooks |
| `fee` | number | no | Fee amount in USDC |

```bash
curl -X POST http://localhost:3000/api/pretium/offramp \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "country": "KE",
    "walletId": "wallet-uuid",
    "usdcAmount": 100,
    "phoneNumber": "+254712345678",
    "mobileNetwork": "SAFARICOM",
    "transactionHash": "0xabc123def456789...",
    "paymentType": "MOBILE"
  }'
```

**Response data:** `PretiumTransaction`

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "userId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
    "walletId": "wallet-uuid",
    "countryCode": "KE",
    "fiatCurrency": "KES",
    "usdcAmount": "100.000000",
    "fiatAmount": "12950.00",
    "exchangeRate": "129.50",
    "fee": null,
    "paymentType": "MOBILE",
    "status": "pending",
    "onChainTxHash": "0xabc123def456789...",
    "pretiumTransactionCode": null,
    "pretiumReceiptNumber": null,
    "phoneNumber": "+254712345678",
    "mobileNetwork": "SAFARICOM",
    "accountNumber": null,
    "bankCode": null,
    "bankName": null,
    "accountName": null,
    "failureReason": null,
    "callbackUrl": null,
    "metadata": null,
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z",
    "completedAt": null
  }
}
```

**Errors:** `Error` if wallet not found, country not supported, or Pretium API call fails.

#### `GET /api/pretium/offramp`

List the authenticated user's offramp transactions with pagination.

| Parameter | Location | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `limit` | query | number | 50 | Maximum number of results |
| `offset` | query | number | 0 | Number of results to skip |

```bash
curl "http://localhost:3000/api/pretium/offramp?limit=10&offset=0" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<PretiumTransaction>`

#### `GET /api/pretium/offramp/:id`

Get a specific offramp transaction by its database ID. Returns the transaction only if the authenticated user owns it.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl http://localhost:3000/api/pretium/offramp/some-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `PretiumTransaction`

**Errors:** `Error` if not found or not owned by the authenticated user.

#### `POST /api/pretium/offramp/:id/refresh`

Poll the Pretium API for the latest status of an offramp transaction and update the local record.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X POST http://localhost:3000/api/pretium/offramp/some-uuid/refresh \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `PretiumTransaction` (with updated status from Pretium)

**Errors:** `Error` if not found or not owned by the authenticated user. `Error` if the Pretium API call fails.

#### `GET /api/pretium/onramp/countries`

List countries that support onramp (fiat → stablecoin) transactions.

```bash
curl http://localhost:3000/api/pretium/onramp/countries \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<OnrampCountryConfig>`

```json
{
  "success": true,
  "data": [
    {
      "code": "KE",
      "name": "Kenya",
      "currency": "KES",
      "mobileNetworks": ["SAFARICOM", "AIRTEL"]
    },
    {
      "code": "GH",
      "name": "Ghana",
      "currency": "GHS",
      "mobileNetworks": ["MTN", "VODAFONE", "AIRTELTIGO"]
    }
  ]
}
```

#### `POST /api/pretium/onramp`

Initiate a fiat-to-stablecoin onramp. The user pays via mobile money and receives stablecoins at the specified wallet address on Base chain.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `country` | string | yes | ISO 3166-1 alpha-2 country code (KE, GH, UG, CD, MW) |
| `walletId` | string | yes | Database ID of the wallet to credit |
| `fiatAmount` | number | yes | Amount of fiat currency to pay |
| `phoneNumber` | string | yes | Payer's phone number for mobile money |
| `mobileNetwork` | string | yes | Mobile network identifier (e.g., `SAFARICOM`, `MTN`) |
| `asset` | string | yes | Stablecoin to receive: `USDC`, `USDT`, or `CUSD` |
| `address` | string | yes | Wallet address to receive stablecoins |
| `fee` | number | no | Fee amount in fiat currency |
| `callbackUrl` | string | no | URL to receive webhook callbacks (auto-generated from `SERVER_BASE_URL` if not provided) |

```bash
curl -X POST http://localhost:3000/api/pretium/onramp \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "country": "KE",
    "walletId": "wallet-uuid",
    "fiatAmount": 5000,
    "phoneNumber": "+254712345678",
    "mobileNetwork": "SAFARICOM",
    "asset": "USDC",
    "address": "0x1234567890abcdef1234567890abcdef12345678"
  }'
```

**Response data:** `{ transaction: PretiumTransaction, pretiumResponse: object }`

```json
{
  "success": true,
  "data": {
    "transaction": {
      "id": "uuid",
      "userId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
      "walletId": "wallet-uuid",
      "countryCode": "KE",
      "fiatCurrency": "KES",
      "usdcAmount": "38.61",
      "fiatAmount": "5000",
      "exchangeRate": "129.50",
      "fee": "0",
      "paymentType": "MOBILE",
      "status": "pending",
      "direction": "onramp",
      "asset": "USDC",
      "recipientAddress": "0x1234567890abcdef1234567890abcdef12345678",
      "onChainTxHash": null,
      "pretiumTransactionCode": "PTX-789012",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "updatedAt": "2025-01-15T10:30:00.000Z"
    },
    "pretiumResponse": { }
  }
}
```

**Errors:** `Error` if country does not support onramp, asset is not supported, or Pretium API call fails.

#### `GET /api/pretium/onramp`

List the authenticated user's onramp transactions with pagination.

| Parameter | Location | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `limit` | query | number | 50 | Maximum number of results |
| `offset` | query | number | 0 | Number of results to skip |

```bash
curl "http://localhost:3000/api/pretium/onramp?limit=10&offset=0" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<PretiumTransaction>` (filtered to `direction = "onramp"`)

#### `GET /api/pretium/onramp/:id`

Get a specific onramp transaction by its database ID. Returns the transaction only if the authenticated user owns it.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl http://localhost:3000/api/pretium/onramp/some-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `PretiumTransaction`

**Errors:** `Error` if not found or not owned by the authenticated user.

#### `POST /api/pretium/onramp/:id/refresh`

Poll the Pretium API for the latest status of an onramp transaction and update the local record.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X POST http://localhost:3000/api/pretium/onramp/some-uuid/refresh \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `PretiumTransaction` (with updated status from Pretium)

**Errors:** `Error` if not found or not owned by the authenticated user. `Error` if the Pretium API call fails.

---

### Uniswap Swaps

Token swap endpoints powered by the [Uniswap Trading API](https://trade-api.gateway.uniswap.org/v1). All swaps execute on Base (chain ID 8453). The route handler resolves the wallet address from the database, calls the Uniswap Trading API, and submits resulting transactions through the existing `TransactionService` ledger.

#### Base chain token addresses

| Token | Address |
|-------|---------|
| ETH | `0x0000000000000000000000000000000000000000` |
| WETH | `0x4200000000000000000000000000000000000006` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| USDbC | `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6Ca` |

#### `POST /api/uniswap/check-approval`

Check whether a token approval transaction is required before swapping. If the token already has sufficient allowance for the Uniswap router, `approval` will be `null`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `walletId` | string | yes | Database ID of the wallet performing the swap |
| `tokenIn` | `0x${string}` | yes | Address of the token to sell |
| `amount` | string | yes | Amount in the token's smallest unit (e.g. `"1000000"` for 1 USDC) |

```bash
curl -X POST http://localhost:3000/api/uniswap/check-approval \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "wallet-uuid",
    "tokenIn": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000000"
  }'
```

**Response data:** `ApprovalResult`

When approval is needed:

```json
{
  "success": true,
  "data": {
    "approval": {
      "to": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "from": "0xYourWalletAddress",
      "data": "0x095ea7b3...",
      "value": "0",
      "chainId": 8453
    }
  }
}
```

When no approval is needed (sufficient allowance already exists):

```json
{
  "success": true,
  "data": {
    "approval": null
  }
}
```

**Errors:** `Error` if wallet not found. `UniswapError` if the Uniswap API call fails.

#### `POST /api/uniswap/quote`

Get a swap quote without executing. Returns routing information, expected input/output amounts, and estimated gas fees. The quote is fetched from the Uniswap Trading API using the `BEST_PRICE` routing preference.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `walletId` | string | yes | Database ID of the wallet performing the swap |
| `tokenIn` | `0x${string}` | yes | Address of the token to sell |
| `tokenOut` | `0x${string}` | yes | Address of the token to buy |
| `amount` | string | yes | Amount in the token's smallest unit |
| `type` | `"EXACT_INPUT"` \| `"EXACT_OUTPUT"` | no | Quote type (default: `"EXACT_INPUT"`) |
| `slippageTolerance` | number | no | Slippage tolerance as a percentage (default: `0.5`) |

```bash
curl -X POST http://localhost:3000/api/uniswap/quote \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "wallet-uuid",
    "tokenIn": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "tokenOut": "0x4200000000000000000000000000000000000006",
    "amount": "1000000",
    "type": "EXACT_INPUT",
    "slippageTolerance": 0.5
  }'
```

**Response data:** `QuoteResponse`

```json
{
  "success": true,
  "data": {
    "routing": "CLASSIC",
    "quote": {
      "input": {
        "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "amount": "1000000"
      },
      "output": {
        "token": "0x4200000000000000000000000000000000000006",
        "amount": "312500000000000"
      },
      "slippage": 0.5,
      "gasFee": "150000000000000",
      "gasFeeUSD": "0.01",
      "gasUseEstimate": "150000"
    }
  }
}
```

**Errors:** `Error` if wallet not found. `UniswapError` if the Uniswap API call fails.

#### `POST /api/uniswap/swap`

Execute a full swap. This endpoint orchestrates the complete flow:

1. Resolve the wallet address from the database using `walletId`.
2. Check if a token approval is needed via the Uniswap `/check_approval` endpoint.
3. If approval is needed, submit the approval transaction through `TransactionService.submitRawTransaction` and record it in the ledger.
4. Get a fresh quote from the Uniswap `/quote` endpoint.
5. Get the swap calldata from the Uniswap `/swap` endpoint.
6. Submit the swap transaction through `TransactionService.submitRawTransaction` and record it in the ledger.

Both the approval and swap transactions are recorded in the `transactions` table with `chainId = 8453` and `method = "raw_transfer"`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `walletId` | string | yes | Database ID of the wallet performing the swap |
| `tokenIn` | `0x${string}` | yes | Address of the token to sell |
| `tokenOut` | `0x${string}` | yes | Address of the token to buy |
| `amount` | string | yes | Amount in the token's smallest unit |
| `type` | `"EXACT_INPUT"` \| `"EXACT_OUTPUT"` | no | Quote type (default: `"EXACT_INPUT"`) |
| `slippageTolerance` | number | no | Slippage tolerance as a percentage (default: `0.5`) |

```bash
curl -X POST http://localhost:3000/api/uniswap/swap \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "wallet-uuid",
    "tokenIn": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "tokenOut": "0x4200000000000000000000000000000000000006",
    "amount": "1000000",
    "type": "EXACT_INPUT",
    "slippageTolerance": 0.5
  }'
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "approvalTxId": "uuid-or-omitted-if-not-needed",
    "swapTxId": "uuid",
    "swapTxHash": "0xabc123...",
    "quote": {
      "routing": "CLASSIC",
      "input": {
        "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "amount": "1000000"
      },
      "output": {
        "token": "0x4200000000000000000000000000000000000006",
        "amount": "312500000000000"
      },
      "gasFeeUSD": "0.01"
    }
  }
}
```

The `approvalTxId` field is only present when a token approval was required and submitted. If the token already had sufficient allowance, this field is omitted.

**Errors:** `Error` if wallet not found or not owned by the user. `UniswapError` if any Uniswap API call fails (approval check, quote, or swap). `TransactionError`, `LedgerError`, or `WalletError` if transaction submission fails.

---

### Swap Automations

Indicator-based swap automation endpoints. Users define conditional swaps that execute automatically when price conditions are met, evaluated every minute by a Trigger.dev cron task. Swaps execute on Base (chain ID 8453) via the Uniswap Trading API.

#### Indicator types

| Type | Condition | Description |
|------|-----------|-------------|
| `price_above` | `currentPrice >= threshold` | Triggers when token price rises to or above the threshold (USD) |
| `price_below` | `currentPrice <= threshold` | Triggers when token price drops to or at the threshold (USD) |
| `percent_change_up` | `% increase >= threshold` | Triggers when price increases by at least threshold% from reference price |
| `percent_change_down` | `% decrease >= threshold` | Triggers when price decreases by at least threshold% from reference price |

#### `GET /api/swap-automations`

List the authenticated user's swap automations, ordered by creation date.

```bash
curl http://localhost:3000/api/swap-automations \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<SwapAutomation>`

#### `GET /api/swap-automations/:id`

Get a single swap automation. Returns the automation only if the authenticated user owns it.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl http://localhost:3000/api/swap-automations/some-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `SwapAutomation`

**Errors:** `Error` if not found or not owned by the authenticated user.

#### `POST /api/swap-automations`

Create a new swap automation. The authenticated user must own the specified wallet. The automation will be evaluated every minute by the `process-swap-automations` cron task.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `walletId` | string | yes | Database ID of the wallet performing the swap |
| `walletType` | `"server"` \| `"agent"` | yes | Wallet type |
| `tokenIn` | string | yes | Address of the token to sell |
| `tokenOut` | string | yes | Address of the token to buy |
| `amount` | string | yes | Amount in the token's smallest unit |
| `indicatorType` | string | yes | One of `price_above`, `price_below`, `percent_change_up`, `percent_change_down` |
| `indicatorToken` | string | yes | Token symbol or address to monitor (e.g., `"ETH"`, `"BTC"`) |
| `thresholdValue` | number | yes | Threshold for the indicator condition |
| `slippageTolerance` | number | no | Slippage tolerance as a percentage (default: `0.5`) |
| `chainId` | number | no | EVM chain ID (default: `8453`) |
| `maxExecutions` | number | no | Maximum times the automation can trigger (default: `1`) |
| `maxExecutionsPerDay` | number | no | Maximum times the automation can trigger per calendar day UTC (default: `null` — no daily limit) |
| `cooldownSeconds` | number | no | Minimum seconds between executions (default: `60`) |
| `maxRetries` | number | no | Consecutive failures before auto-pausing (default: `3`) |

```bash
curl -X POST http://localhost:3000/api/swap-automations \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "wallet-uuid",
    "walletType": "server",
    "tokenIn": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "tokenOut": "0x4200000000000000000000000000000000000006",
    "amount": "1000000",
    "indicatorType": "price_above",
    "indicatorToken": "ETH",
    "thresholdValue": 4000,
    "slippageTolerance": 0.5,
    "maxExecutions": 1,
    "maxExecutionsPerDay": 3,
    "cooldownSeconds": 60,
    "maxRetries": 3
  }'
```

**Response data:** `SwapAutomation` (HTTP 201)

**Errors:** `Error` if wallet not found or not owned by the user. `SwapAutomationError` if automation creation fails.

#### `PATCH /api/swap-automations/:id`

Update an existing swap automation. The authenticated user must own the automation. Only the fields provided will be updated.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `thresholdValue` | number | no | New threshold for the indicator condition |
| `amount` | string | no | New amount in the token's smallest unit |
| `slippageTolerance` | number | no | New slippage tolerance as a percentage |
| `maxExecutions` | number | no | New maximum execution count |
| `maxExecutionsPerDay` | number \| null | no | New daily execution limit (`null` to remove) |
| `cooldownSeconds` | number | no | New minimum seconds between executions |
| `maxRetries` | number | no | New consecutive failure limit |

```bash
curl -X PATCH http://localhost:3000/api/swap-automations/some-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "thresholdValue": 4500,
    "maxExecutions": 5
  }'
```

**Response data:** `SwapAutomation`

**Errors:** `Error` if not found or not owned. `SwapAutomationError` if update fails.

#### `POST /api/swap-automations/:id/pause`

Pause an active swap automation. The authenticated user must own the automation.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X POST http://localhost:3000/api/swap-automations/some-uuid/pause \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `SwapAutomation` (with status `"paused"`)

**Errors:** `Error` if not found or not owned. `SwapAutomationError` if update fails.

#### `POST /api/swap-automations/:id/resume`

Resume a paused swap automation. Resets consecutive failure count.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X POST http://localhost:3000/api/swap-automations/some-uuid/resume \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `SwapAutomation` (with status `"active"`)

**Errors:** `Error` if not found or not owned. `SwapAutomationError` if update fails.

#### `POST /api/swap-automations/:id/cancel`

Cancel a swap automation permanently. The automation will not be evaluated again.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X POST http://localhost:3000/api/swap-automations/some-uuid/cancel \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `SwapAutomation` (with status `"cancelled"`)

**Errors:** `Error` if not found or not owned. `SwapAutomationError` if update fails.

#### `GET /api/swap-automations/:id/executions`

Get the execution history for a swap automation. The authenticated user must own the automation.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `id` | path | string | yes | Automation ID |
| `limit` | query | number | no | Maximum results (default: 50) |

```bash
curl "http://localhost:3000/api/swap-automations/some-uuid/executions?limit=20" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<SwapAutomationExecution>`

```json
{
  "success": true,
  "data": [
    {
      "id": "exec-uuid",
      "automationId": "some-uuid",
      "transactionId": "tx-uuid",
      "status": "success",
      "priceAtExecution": 4050.25,
      "error": null,
      "quoteSnapshot": {
        "routing": "CLASSIC",
        "input": { "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "amount": "1000000" },
        "output": { "token": "0x4200000000000000000000000000000000000006", "amount": "312500000000000" }
      },
      "executedAt": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

**Errors:** `Error` if automation not found or not owned. `SwapAutomationError` if query fails.

---

### Goal Savings

#### `GET /api/goal-savings`

List the authenticated user's savings goals, ordered by creation date.

```bash
curl http://localhost:3000/api/goal-savings \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<GoalSaving>`

#### `POST /api/goal-savings`

Create a new savings goal. Automation fields (`walletId`, `vaultId`, `depositAmount`, `frequency`) are all-or-nothing: provide all of them to enable automated deposits, or omit all for manual-only savings.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Goal name (e.g. `"House Fund"`) |
| `description` | string | no | Human-readable description |
| `targetAmount` | string | yes | Target amount as a string bigint (e.g. `"1000000000"`) |
| `tokenAddress` | string | yes | ERC-20 token contract address |
| `tokenSymbol` | string | yes | Token symbol (e.g. `"USDC"`) |
| `tokenDecimals` | number | yes | Token decimals (e.g. `6`) |
| `walletId` | string | no | Server wallet database ID (resolved from profile if omitted) |
| `walletType` | string | no | `"server"` or `"agent"` |
| `vaultId` | string | no | Yield vault database ID for deposits |
| `chainId` | number | no | EVM chain ID (defaults to `DEFAULT_CHAIN_ID`) |
| `depositAmount` | string | no | Per-deposit amount for automation (e.g. `"50000000"`) |
| `unlockTimeOffsetSeconds` | number | no | Seconds added to deposit time to compute lock expiry |
| `frequency` | string | no | Deposit interval: `"1d"`, `"7d"`, etc. (`null` = manual only) |
| `startDate` | string | no | ISO timestamp for when automated deposits begin |
| `endDate` | string | no | ISO timestamp for when automated deposits stop |
| `maxRetries` | number | no | Consecutive failures before auto-pausing (default: 3) |

```bash
curl -X POST http://localhost:3000/api/goal-savings \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "House Fund",
    "targetAmount": "1000000000",
    "tokenAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "tokenSymbol": "USDC",
    "tokenDecimals": 6,
    "walletId": "wallet-uuid",
    "walletType": "server",
    "vaultId": "vault-uuid",
    "depositAmount": "50000000",
    "frequency": "7d"
  }'
```

**Response data:** `GoalSaving` (HTTP 201)

**Errors:** `Error` if wallet not found or not owned. `GoalSavingsError` if creation fails.

#### `GET /api/goal-savings/:id`

Get a single savings goal. The authenticated user must own the goal.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl http://localhost:3000/api/goal-savings/goal-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `GoalSaving`

**Errors:** `Error` if not found or not owned by the authenticated user.

#### `PATCH /api/goal-savings/:id`

Update goal fields. If `frequency` changes, `nextDepositAt` is automatically recalculated.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | no | Updated goal name |
| `description` | string | no | Updated description |
| `depositAmount` | string | no | Updated per-deposit amount |
| `frequency` | string | no | Updated interval (triggers `nextDepositAt` recalculation) |
| `endDate` | string | no | Updated end date |
| `maxRetries` | number | no | Updated max retries |

```bash
curl -X PATCH http://localhost:3000/api/goal-savings/goal-uuid \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "depositAmount": "100000000",
    "frequency": "1d"
  }'
```

**Response data:** `GoalSaving`

**Errors:** `Error` if not found or not owned. `GoalSavingsError` if update fails.

#### `POST /api/goal-savings/:id/pause`

Pause an active goal. Automated deposits stop until resumed.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X POST http://localhost:3000/api/goal-savings/goal-uuid/pause \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `GoalSaving` (with status `"paused"`)

**Errors:** `Error` if not found or not owned. `GoalSavingsError` if update fails.

#### `POST /api/goal-savings/:id/resume`

Resume a paused goal. Resets `consecutiveFailures` to zero and recalculates `nextDepositAt`.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X POST http://localhost:3000/api/goal-savings/goal-uuid/resume \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `GoalSaving` (with status `"active"`)

**Errors:** `Error` if not found or not owned. `GoalSavingsError` if update fails.

#### `POST /api/goal-savings/:id/cancel`

Cancel a goal permanently. Existing yield positions remain untouched; no further automated deposits will occur.

| Parameter | Location | Type | Required |
|-----------|----------|------|----------|
| `id` | path | string | yes |

```bash
curl -X POST http://localhost:3000/api/goal-savings/goal-uuid/cancel \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `GoalSaving` (with status `"cancelled"`)

**Errors:** `Error` if not found or not owned. `GoalSavingsError` if update fails.

#### `POST /api/goal-savings/:id/deposit`

Make a manual deposit into a savings goal. Creates a yield position in the configured (or specified) vault.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | string | yes | Deposit amount in the smallest unit (e.g. `"50000000"`) |
| `walletId` | string | no | Wallet database ID (falls back to goal's `walletId`, then profile) |
| `walletType` | string | no | `"server"` or `"agent"` |
| `vaultId` | string | no | Yield vault ID (falls back to goal's `vaultId`) |
| `chainId` | number | no | EVM chain ID (defaults to `DEFAULT_CHAIN_ID`) |
| `unlockTimeOffsetSeconds` | number | no | Seconds added to deposit time for lock expiry |

```bash
curl -X POST http://localhost:3000/api/goal-savings/goal-uuid/deposit \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "50000000"
  }'
```

**Response data:** `GoalSavingsDeposit` (HTTP 201)

**Errors:** `Error` if goal not found or not owned. `GoalSavingsError` if deposit fails.

#### `GET /api/goal-savings/:id/deposits`

List deposits for a savings goal. The authenticated user must own the goal.

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `id` | path | string | yes | Goal ID |
| `limit` | query | number | no | Maximum results (default: 50) |

```bash
curl "http://localhost:3000/api/goal-savings/goal-uuid/deposits?limit=20" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**Response data:** `Array<GoalSavingsDeposit>`

```json
{
  "success": true,
  "data": [
    {
      "id": "deposit-uuid",
      "goalId": "goal-uuid",
      "yieldPositionId": "position-uuid",
      "amount": "50000000",
      "depositType": "manual",
      "status": "confirmed",
      "error": null,
      "depositedAt": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

**Errors:** `Error` if goal not found or not owned. `GoalSavingsError` if query fails.

---

### Webhooks

#### `POST /webhooks/pretium`

Receives payment callbacks from Pretium. No authentication required. Handles two callback types:

**1. Status update callback** (offramp + onramp payment collection):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transaction_code` | string | yes | Pretium transaction identifier |
| `status` | string | yes | Payment status (`completed`, `failed`, `reversed`) |
| `receipt_number` | string | no | Payment receipt number (on success) |
| `failure_reason` | string | no | Reason for failure (on failure) |
| `amount` | number | no | Disbursed/collected amount |
| `currency_code` | string | no | Currency code |

For **offramp**, a `completed` status marks the transaction as done. For **onramp**, a `completed` status means the mobile money payment was collected — the transaction moves to `processing` and waits for the asset release callback.

```bash
curl -X POST http://localhost:3000/webhooks/pretium \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_code": "PTX-123456",
    "status": "completed",
    "receipt_number": "RCP-789012",
    "amount": 12950,
    "currency_code": "KES"
  }'
```

**2. Asset release callback** (onramp only):

Sent after the user's mobile money payment is confirmed and stablecoins have been released to their wallet.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transaction_code` | string | yes | Pretium transaction identifier |
| `is_released` | boolean | yes | Always `true` for this callback type |
| `transaction_hash` | string | yes | On-chain transaction hash of stablecoin delivery |

```bash
curl -X POST http://localhost:3000/webhooks/pretium \
  -H "Content-Type: application/json" \
  -d '{
    "is_released": true,
    "transaction_code": "PTX-123456",
    "transaction_hash": "0xabc123def456789012345678901234567890abcdef1234567890abcdef12345678"
  }'
```

**Response data (both types):**

```json
{
  "success": true,
  "data": {
    "received": true,
    "matched": true,
    "type": "status_update",
    "transaction": { }
  }
}
```

**Errors:** Returns HTTP 200 even if the transaction code is not found (`matched: false`), to prevent webhook retries from Pretium.

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

### Goal Savings (Admin)

#### `POST /internal/goal-savings/process`

Process all due automated goal savings deposits. Finds active goals with `frequency` set and `nextDepositAt <= now`, executes deposits via the yield system, handles retry logic, and auto-pauses goals that exceed `maxRetries` consecutive failures.

```bash
curl -X POST http://localhost:3000/internal/goal-savings/process \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

**Response data:**

```json
{
  "success": true,
  "data": {
    "processedCount": 3,
    "deposits": [
      {
        "id": "deposit-uuid",
        "goalId": "goal-uuid",
        "yieldPositionId": "position-uuid",
        "amount": "50000000",
        "depositType": "automated",
        "status": "confirmed",
        "error": null,
        "depositedAt": "2025-01-15T10:30:00.000Z"
      }
    ]
  }
}
```

**Errors:** `GoalSavingsError` if processing fails.

---

## Scheduled Tasks (Trigger.dev)

Five background processing pipelines run automatically via [Trigger.dev](https://trigger.dev) scheduled tasks. These tasks call the same Effect service methods that the internal admin endpoints use, but without requiring an HTTP request.

| Task | Schedule | Service method | What it does |
|------|----------|----------------|-------------|
| `process-due-jobs` | Every 1 minute | `JobberService.processDueJobs()` | Finds pending jobs with `nextRunAt <= now`, executes them, and reschedules. |
| `process-due-payments` | Every 5 minutes | `RecurringPaymentService.processDuePayments()` | Finds active recurring payment schedules with `nextExecutionAt <= now`, executes each, records results, and reschedules. |
| `snapshot-yield-positions` | Every hour (on the hour) | `YieldService.snapshotAllActivePositions()` | Reads accrued yield from on-chain for all active positions, calculates APY, and stores snapshots. |
| `process-swap-automations` | Every 1 minute | `SwapAutomationService.processDueAutomations()` | Evaluates all active swap automations: fetches prices from CoinMarketCap, checks indicator conditions, verifies wallet balances, and executes Uniswap swaps when conditions are met. |
| `process-due-goal-deposits` | Every 5 minutes | `GoalSavingsService.processDueDeposits()` | Finds active goals with frequency set and nextDepositAt <= now, creates yield positions for each, updates accumulation, pauses on consecutive failures. |

### Manual trigger endpoints

The scheduled tasks do not replace the existing internal admin endpoints. These endpoints remain available as manual fallbacks and are useful for debugging or forcing an immediate run:

| Task | Manual endpoint |
|------|----------------|
| `process-due-jobs` | `POST /internal/jobs/process` |
| `process-due-payments` | `POST /internal/recurring-payments/process` |
| `snapshot-yield-positions` | `POST /internal/yield/snapshots/run` |
| `process-due-goal-deposits` | `POST /internal/goal-savings/process` |

All manual endpoints require the `X-Admin-Key` header. See the corresponding sections under [Internal API](#internal-api) for request and response details.

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

> **Note:** The `txHash` field always contains a real on-chain transaction hash. For sponsored (gasless) transactions, the system automatically resolves the user operation hash to the actual on-chain transaction hash by polling the Privy API. This is transparent to the API consumer.

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
  txHash: string | null; // always an on-chain tx hash, never a user operation hash
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

### ApprovalResult

```typescript
{
  approval: {
    to: string;
    from: string;
    data: string;
    value: string;
    chainId: number;
  } | null;
}
```

### QuoteResponse

```typescript
{
  routing: string;
  quote: {
    input: { token: string; amount: string };
    output: { token: string; amount: string };
    slippage: number;
    gasFee: string;
    gasFeeUSD: string;
    gasUseEstimate: string;
  };
  permitData?: Record<string, unknown> | null;
}
```

### UniswapSwapResult

```typescript
{
  approvalTxId?: string;      // only present when approval was needed
  swapTxId: string;
  swapTxHash: string | null;
  quote: {
    routing: string;
    input: { token: string; amount: string };
    output: { token: string; amount: string };
    gasFeeUSD: string;
  };
}
```

### PretiumTransaction

```typescript
{
  id: string;
  userId: string;
  walletId: string;
  countryCode: string;
  fiatCurrency: string;
  usdcAmount: string;
  fiatAmount: string;
  exchangeRate: string;
  fee: string | null;
  paymentType: "MOBILE" | "BUY_GOODS" | "PAYBILL" | "BANK_TRANSFER";
  status: "pending" | "processing" | "completed" | "failed" | "reversed";
  onChainTxHash: string | null;
  direction: "onramp" | "offramp";
  asset: string | null;
  recipientAddress: string | null;
  pretiumTransactionCode: string | null;
  pretiumReceiptNumber: string | null;
  phoneNumber: string | null;
  mobileNetwork: string | null;
  accountNumber: string | null;
  bankCode: string | null;
  bankName: string | null;
  accountName: string | null;
  failureReason: string | null;
  callbackUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  completedAt: string | null; // ISO timestamp
}
```

### SwapAutomation

```typescript
{
  id: string;
  userId: string;
  walletId: string;
  walletType: "server" | "agent";
  tokenIn: string;
  tokenOut: string;
  amount: string;
  slippageTolerance: number;
  chainId: number;
  indicatorType: "price_above" | "price_below" | "percent_change_up" | "percent_change_down";
  indicatorToken: string;
  thresholdValue: number;
  referencePrice: number | null;
  status: "active" | "paused" | "cancelled" | "triggered" | "failed";
  maxExecutions: number;
  maxExecutionsPerDay: number | null;
  totalExecutions: number;
  consecutiveFailures: number;
  maxRetries: number;
  cooldownSeconds: number;
  lastCheckedAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### SwapAutomationExecution

```typescript
{
  id: string;
  automationId: string;
  transactionId: string | null;
  status: "success" | "failed" | "skipped";
  priceAtExecution: number | null;
  error: string | null;
  quoteSnapshot: Record<string, unknown> | null;
  executedAt: string;
}
```

### GroupAccount

```typescript
{
  id: string;
  groupAddress: string;       // On-chain GroupAccount contract address
  adminUserId: string;        // Privy user ID of admin
  name: string;
  description: string | null;
  chainId: number;            // Default 8453 (Base)
  transactionId: string | null; // createGroup tx reference
  createdAt: string;
  updatedAt: string;
}
```

### GroupAccountMember

```typescript
{
  id: string;
  groupId: string;
  userId: string;             // Privy user ID
  walletAddress: string;      // Member's wallet address
  role: "admin" | "member";
  joinedAt: string;
}
```

### GroupWithMembers

```typescript
GroupAccount & {
  members: (GroupAccountMember & { username: string | null })[];
}
```

### GoalSaving

```typescript
{
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

### GoalSavingsDeposit

```typescript
{
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
