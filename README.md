# Expendi Backend

Crypto financial backend powering the **Exo** wallet. Built with [Hono](https://hono.dev), [Effect](https://effect.website), [Drizzle ORM](https://orm.drizzle.team), and [Glove](https://glove.dterminal.net) for AI agent integration.

## Stack

| Layer | Technology |
|-------|-----------|
| HTTP framework | Hono |
| Functional effects | Effect |
| ORM / migrations | Drizzle (PostgreSQL) |
| Authentication | Privy |
| Blockchain | Viem (Base chain) |
| AI chat | Glove Core (Anthropic, OpenAI, OpenRouter, Gemini, etc.) |
| Background jobs | Trigger.dev |
| WebAuthn | @simplewebauthn/server |

## Getting Started

```bash
# Install dependencies
pnpm install

# Set up environment variables (see .env.example)
cp .env.example .env

# Run database migrations
pnpm db:migrate

# Start development server
pnpm dev
```

The server starts on `http://localhost:3000` by default (override with `PORT`).

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server with hot reload |
| `pnpm build` | Compile TypeScript |
| `pnpm start` | Run compiled output |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Apply Drizzle migrations |
| `pnpm test` | Run Vitest tests |
| `pnpm trigger:dev` | Start Trigger.dev dev server |
| `pnpm trigger:deploy` | Deploy Trigger.dev tasks |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PRIVY_APP_ID` | Yes | Privy application ID |
| `PRIVY_APP_SECRET` | Yes | Privy application secret |
| `ADMIN_API_KEY` | Yes | Key for `/internal/*` admin routes |
| `LLM_PROVIDER` | No | AI provider — `anthropic` (default), `openai`, `openrouter`, `gemini`, etc. |
| `LLM_MODEL` | No | Model ID (e.g. `claude-sonnet-4-20250514`) |
| `LLM_API_KEY` | No | API key for the LLM provider (falls back to provider-specific env var) |
| `LLM_BASE_URL` | No | Custom base URL for OpenAI-compatible providers |
| `LLM_MAX_TOKENS` | No | Max tokens per response (default: 4096) |
| `LLM_FORMAT` | No | SDK format — `openai`, `anthropic`, or `bedrock` |
| `ANTHROPIC_API_KEY` | No | Anthropic API key (used when `LLM_PROVIDER=anthropic`) |
| `WEBAUTHN_RP_ID` | No | WebAuthn relying party ID (e.g. `localhost`) |
| `WEBAUTHN_ORIGIN` | No | WebAuthn origin (e.g. `http://localhost:5173`) |
| `APPROVAL_TOKEN_SECRET` | No | HMAC secret for approval tokens |
| `PRETIUM_API_KEY` | No | Pretium on/offramp provider key |
| `MORPHO_API_URL` | No | Morpho GraphQL endpoint for yield data |
| `TRIGGER_SECRET_KEY` | No | Trigger.dev secret key |

## Authentication

All `/api/*` routes require a **Privy access token** in the `Authorization: Bearer <token>` header. The middleware resolves the authenticated user's `privyUserId` and attaches it to the request context.

`/internal/*` routes require an `X-Admin-Key` header matching `ADMIN_API_KEY`.

`/webhooks/*` routes are unauthenticated (called by payment providers).

## Transaction Approval

Sensitive mutations (transfers, swaps, on/offramp, yield deposits/withdrawals) are gated by optional transaction approval. Users can configure:

- **PIN** — 4-6 digit code, bcrypt-hashed, rate-limited (5 attempts then 15-minute lockout)
- **Passkey** — WebAuthn standard with counter-based replay protection

When enabled, these routes require an `X-Approval-Token` header containing an HMAC-SHA256 signed token (5-minute TTL).

**Protected routes:**
- `POST /api/transactions/*`
- `POST /api/wallets/transfer`
- `POST /api/pretium/onramp`, `POST /api/pretium/offramp`
- `POST /api/yield/positions`, `POST /api/yield/positions/:id/withdraw`
- `POST /api/uniswap/swap`
- `POST /api/groups/:id/pay`, `POST /api/groups/:id/deposit`

## API Reference

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | API info and endpoint directory |
| GET | `/health` | Health check |

### Onboarding & Profile (`/api`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/onboard` | Full onboarding — creates profile + 3 wallets (idempotent) |
| GET | `/api/profile` | Get authenticated user's profile |
| PUT | `/api/profile/username` | Claim or update username |
| GET | `/api/profile/resolve/:username` | Resolve username to wallet address |
| GET | `/api/profile/preferences` | Get user preferences |
| PATCH | `/api/profile/preferences` | Update user preferences (merge) |
| GET | `/api/profile/wallets` | Get user's wallet addresses |

### Wallets (`/api/wallets`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/wallets` | List user's wallets |
| GET | `/api/wallets/balances` | Read on-chain token balances for all wallets |
| GET | `/api/wallets/:id` | Get single wallet |
| POST | `/api/wallets/user` | Create a user wallet |
| POST | `/api/wallets/:id/sign` | Sign a message with wallet |
| POST | `/api/wallets/transfer` | Transfer tokens between wallets (approval required) |

### Transactions (`/api/transactions`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/transactions` | List user's transactions |
| GET | `/api/transactions/:id` | Get transaction details |
| POST | `/api/transactions/contract` | Submit contract transaction (approval required) |
| POST | `/api/transactions/raw` | Submit raw transaction (approval required) |

### Categories (`/api/categories`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/categories` | List global + user's categories |
| GET | `/api/categories/:id` | Get single category |
| POST | `/api/categories` | Create custom category |
| PUT | `/api/categories/:id` | Update category |
| DELETE | `/api/categories/:id` | Delete category |
| GET | `/api/categories/limits` | Get all spending limits |
| GET | `/api/categories/:id/limit` | Get limit for specific category |
| PUT | `/api/categories/:id/limit` | Set/update spending limit |
| DELETE | `/api/categories/:id/limit` | Remove spending limit |
| GET | `/api/categories/spending` | Spending per category for period (default: current month) |
| GET | `/api/categories/spending/daily` | Daily spending breakdown for charts |

### Recurring Payments (`/api/recurring-payments`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/recurring-payments` | List user's schedules |
| GET | `/api/recurring-payments/:id` | Get single schedule |
| POST | `/api/recurring-payments` | Create recurring payment |
| POST | `/api/recurring-payments/:id/pause` | Pause schedule |
| POST | `/api/recurring-payments/:id/resume` | Resume schedule |
| POST | `/api/recurring-payments/:id/cancel` | Cancel schedule |
| GET | `/api/recurring-payments/:id/executions` | Execution history |

### Yield (`/api/yield`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/yield/vaults` | List active vaults (enriched with Morpho APY) |
| GET | `/api/yield/vaults/:id` | Get vault details |
| POST | `/api/yield/positions` | Deposit into vault (approval required) |
| GET | `/api/yield/positions` | List user's positions |
| GET | `/api/yield/positions/:id` | Get single position |
| POST | `/api/yield/positions/:id/withdraw` | Withdraw matured position (approval required) |
| GET | `/api/yield/positions/:id/history` | Yield snapshot history |
| GET | `/api/yield/portfolio` | Portfolio summary (totals, APY) |

### Pretium — On/Offramp (`/api/pretium`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pretium/countries` | List supported countries with currency configs |
| GET | `/api/pretium/countries/:code` | Get payment config for country |
| GET | `/api/pretium/exchange-rate/:currency` | Get exchange rate |
| POST | `/api/pretium/convert/usdc-to-fiat` | Convert USDC to fiat amount |
| POST | `/api/pretium/convert/fiat-to-usdc` | Convert fiat to USDC amount |
| POST | `/api/pretium/validate/phone` | Validate mobile phone number |
| POST | `/api/pretium/validate/bank-account` | Validate bank account |
| GET | `/api/pretium/banks/:country` | List supported banks for country |
| GET | `/api/pretium/settlement-address` | Get USDC settlement address |
| POST | `/api/pretium/offramp` | Initiate offramp (approval required) |
| GET | `/api/pretium/offramp` | List user's offramp transactions |
| GET | `/api/pretium/offramp/:id` | Get offramp status |
| POST | `/api/pretium/offramp/:id/refresh` | Poll for latest status |
| GET | `/api/pretium/onramp/countries` | List onramp-supported countries |
| POST | `/api/pretium/onramp` | Initiate onramp (approval required) |
| GET | `/api/pretium/onramp` | List user's onramp transactions |
| GET | `/api/pretium/onramp/:id` | Get onramp status |
| POST | `/api/pretium/onramp/:id/refresh` | Poll onramp status |

> **Note:** Pretium expects local phone numbers without the country code prefix for mobile network payments.

### Uniswap (`/api/uniswap`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/uniswap/check-approval` | Check if token approval is needed |
| POST | `/api/uniswap/quote` | Get swap quote (does not execute) |
| POST | `/api/uniswap/swap` | Execute swap via Universal Router (approval required) |

### Swap Automations (`/api/swap-automations`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/swap-automations` | List automations |
| GET | `/api/swap-automations/:id` | Get single automation |
| POST | `/api/swap-automations` | Create automation |
| PATCH | `/api/swap-automations/:id` | Update automation |
| POST | `/api/swap-automations/:id/pause` | Pause |
| POST | `/api/swap-automations/:id/resume` | Resume |
| POST | `/api/swap-automations/:id/cancel` | Cancel |
| GET | `/api/swap-automations/:id/executions` | Execution history |

### Group Accounts (`/api/groups`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/groups` | Create group |
| GET | `/api/groups` | List user's groups |
| GET | `/api/groups/:id` | Get group with members |
| GET | `/api/groups/:id/members` | List members |
| POST | `/api/groups/:id/members` | Add member (admin only) |
| DELETE | `/api/groups/:id/members/:identifier` | Remove member (admin only) |
| POST | `/api/groups/:id/pay` | Admin payout (approval required) |
| POST | `/api/groups/:id/deposit` | Member deposit (approval required) |
| POST | `/api/groups/:id/transfer-admin` | Transfer admin role |
| GET | `/api/groups/:id/balance` | Get group balances |

### Split Expenses (`/api/split-expenses`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/split-expenses` | Create split expense |
| GET | `/api/split-expenses` | List user's split expenses |
| GET | `/api/split-expenses/:id` | Get expense with shares |
| POST | `/api/split-expenses/:id/pay` | Pay your share |
| DELETE | `/api/split-expenses/:id` | Cancel expense (creator only) |

### Goal Savings (`/api/goal-savings`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/goal-savings` | List user's goals |
| POST | `/api/goal-savings` | Create savings goal |
| GET | `/api/goal-savings/:id` | Get goal details |
| PATCH | `/api/goal-savings/:id` | Update goal |
| POST | `/api/goal-savings/:id/pause` | Pause goal |
| POST | `/api/goal-savings/:id/resume` | Resume goal |
| POST | `/api/goal-savings/:id/cancel` | Cancel goal |
| POST | `/api/goal-savings/:id/deposit` | Manual deposit |
| GET | `/api/goal-savings/:id/deposits` | List deposits |

### Transaction Approval / Security (`/api/security/approval`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/security/approval` | Get approval settings |
| POST | `/api/security/approval/pin/setup` | Set up PIN |
| POST | `/api/security/approval/pin/change` | Change PIN |
| DELETE | `/api/security/approval/pin` | Remove PIN |
| POST | `/api/security/approval/passkey/register` | Get WebAuthn registration options |
| POST | `/api/security/approval/passkey/register/verify` | Complete passkey registration |
| GET | `/api/security/approval/passkeys` | List registered passkeys |
| DELETE | `/api/security/approval/passkeys/:id` | Remove passkey |
| POST | `/api/security/approval/verify` | Verify PIN/passkey and get approval token |
| DELETE | `/api/security/approval` | Disable transaction approval |

### Chat / AI Agent (`/api/chat`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Stream AI chat via SSE |

**Request body:**
```json
{
  "systemPrompt": "You are a helpful assistant.",
  "messages": [{ "sender": "user", "text": "What's my balance?" }],
  "tools": [
    {
      "name": "get_balances",
      "description": "Get wallet balances",
      "parameters": { "type": "object", "properties": {} }
    }
  ]
}
```

**SSE events:**
- `text_delta` — `{ type: "text_delta", text: "..." }` — streaming text chunk
- `tool_use` — `{ type: "tool_use", id: "...", name: "...", input: {...} }` — tool invocation (client executes)
- `done` — `{ type: "done", message: {...}, tokens_in: N, tokens_out: N }` — stream complete

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhooks/pretium` | Pretium payment status callback |

### Internal Admin (`/internal`)

All internal routes require `X-Admin-Key` header.

<details>
<summary>Expand internal routes</summary>

| Method | Path | Description |
|--------|------|-------------|
| GET | `/internal/wallets` | List all wallets |
| POST | `/internal/wallets/server` | Create server wallet |
| POST | `/internal/wallets/agent` | Create agent wallet |
| GET | `/internal/transactions` | List all transactions |
| GET | `/internal/transactions/wallet/:walletId` | Transactions by wallet |
| GET | `/internal/transactions/user/:userId` | Transactions by user |
| PATCH | `/internal/transactions/:id/confirm` | Confirm transaction |
| PATCH | `/internal/transactions/:id/fail` | Fail transaction |
| GET | `/internal/jobs` | List all jobs |
| GET | `/internal/jobs/:id` | Get job |
| POST | `/internal/jobs` | Create job |
| POST | `/internal/jobs/:id/cancel` | Cancel job |
| POST | `/internal/jobs/process` | Process due jobs |
| GET | `/internal/profiles` | List all profiles |
| GET | `/internal/profiles/:privyUserId` | Get profile |
| POST | `/internal/profiles/:privyUserId/onboard` | Admin-triggered onboarding |
| GET | `/internal/recurring-payments` | List all schedules |
| GET | `/internal/recurring-payments/:id` | Get schedule |
| POST | `/internal/recurring-payments/:id/execute` | Force-execute schedule |
| GET | `/internal/recurring-payments/:id/executions` | Execution history |
| POST | `/internal/recurring-payments/process` | Process due payments |
| GET | `/internal/yield/vaults` | List all vaults (including inactive) |
| POST | `/internal/yield/vaults` | Add vault |
| DELETE | `/internal/yield/vaults/:id` | Deactivate vault |
| POST | `/internal/yield/vaults/sync` | Sync vaults from chain |
| GET | `/internal/yield/positions` | List all positions |
| POST | `/internal/yield/snapshots/run` | Trigger yield snapshot |
| POST | `/internal/goal-savings/process` | Process due goal deposits |

</details>

## Project Structure

```
src/
  index.ts              # Hono app, route registration, middleware
  config.ts             # Effect-based configuration
  runtime.ts            # Effect runtime
  middleware/
    auth.ts             # Privy + admin key middleware
    transaction-approval.ts  # Approval token verification
  routes/               # Route handlers (one file per domain)
  services/             # Business logic (Effect services)
  db/
    schema/             # Drizzle table definitions
    index.ts            # Database connection + Drizzle instance
  trigger/              # Trigger.dev background tasks
docs/
  expendi-api.postman_collection.json
exo/               # React demo application (see exo/README.md)
```

## Postman Collection

Import `docs/expendi-api.postman_collection.json` into Postman. Set these collection variables:

| Variable | Description |
|----------|-------------|
| `baseUrl` | Server URL (default: `http://localhost:3000`) |
| `authToken` | Privy access token for `/api/*` routes |
| `adminApiKey` | Admin key for `/internal/*` routes |

All ID variables (`walletId`, `transactionId`, etc.) are pre-filled with placeholder UUIDs — replace with real values from your environment.
