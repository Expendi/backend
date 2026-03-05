# Expendi Backend Documentation

Expendi is a crypto financial backend that provides unified wallet management, smart contract interaction, transaction ledgering, scheduled jobs, and reactive condition monitoring -- all built on [Effect-TS](https://effect.website/) for type-safe dependency injection and error handling, [Hono](https://hono.dev/) for HTTP routing, and [Drizzle ORM](https://orm.drizzle.team/) for PostgreSQL access.

## What Expendi Does

- **Wallet abstraction** -- Create and manage user, server, and agent wallets through [Privy](https://www.privy.io/), with a single interface for signing and sending transactions regardless of wallet type. Sponsored transactions automatically resolve their on-chain transaction hash by polling Privy's transactions API.
- **Contract registry** -- Code-defined smart contract connectors (with ABI and method shortcuts) loaded at startup from the `src/connectors/` directory. Execute read/write calls against them on any supported EVM chain.
- **Transaction ledger** -- Every on-chain action is recorded as an intent, then tracked through pending, submitted, confirmed, and failed states.
- **User onboarding** -- A single API call (`POST /api/onboard`) creates a complete wallet set (user, server, agent) and a `user_profiles` record linking them. The operation is idempotent -- calling it again for the same user returns the existing profile. Profiles can also be created by admins via `POST /internal/profiles/:privyUserId/onboard`.
- **Recurring payments** -- A full recurring payment system with schedules, execution history, and multiple payment types (`erc20_transfer`, `raw_transfer`, `contract_call`, `offramp`). Users create schedules through the public API; admins can list all schedules, force-execute them, and process due payments through internal routes. Schedules support configurable frequency, retry limits, start/end dates, and automatic pause on consecutive failures.
- **Offramp adapter system** -- A pluggable adapter pattern for fiat off-ramp providers (Moonpay, Bridge, Transak). The `OfframpAdapterRegistry` service resolves provider adapters by name and exposes a unified interface for initiating conversions, checking status, estimating fees, and fetching deposit addresses. Recurring payments with `paymentType: "offramp"` automatically invoke the configured provider adapter.
- **Chain configuration** -- The `DEFAULT_CHAIN_ID` environment variable (defaults to `1`) sets the fallback chain for transaction and onboarding routes. The `chainId` parameter is now optional in `POST /api/transactions/contract`, `POST /api/transactions/raw`, `POST /api/onboard`, and recurring payment creation -- when omitted, the value from `ConfigService.defaultChainId` is used. Contract connectors use the `expandMultiChain` helper to define addresses for multiple chains from a single definition.
- **Scheduled jobs (Jobber)** -- Create recurring jobs that fire contract or raw transactions on a configurable schedule with automatic retry.
- **Reactive monitoring (Heartbeat)** -- Register conditions (balance thresholds, price triggers, block events) that are checked on a polling loop and automatically execute actions when triggered.
- **Data adapters** -- Pluggable external data sources (currently CoinMarketCap) for market prices consumed by Heartbeat and available to the rest of the system.
- **Goal savings** -- Define savings goals with target amounts and optional recurring deposits into yield pools. Each deposit creates a yield position via the YieldTimeLock contract. Track progress toward the target; the goal is automatically marked completed when the accumulated amount reaches the target.
- **Authentication** -- Public API routes are protected by Privy auth tokens, internal/admin routes are protected by an API key, and all operations enforce ownership.
- **Admin dashboard** -- A Next.js admin panel in the `admin/` directory for managing wallets, transactions, jobs, contracts, categories, recurring payments, and offramp providers.

## Quick Start

### Prerequisites

- Node.js 18+ (ES2022 target)
- pnpm 10+
- PostgreSQL 14+
- A [Privy](https://www.privy.io/) account (app ID and secret)
- A [CoinMarketCap](https://coinmarketcap.com/api/) API key

### 1. Clone and install

```bash
pnpm install
```

### 2. Configure environment

Copy the example and fill in your credentials:

```bash
cp .env.example .env
```

```
DATABASE_URL=postgresql://user:password@localhost:5432/expendi
PRIVY_APP_ID=your-privy-app-id
PRIVY_APP_SECRET=your-privy-app-secret
COINMARKETCAP_API_KEY=your-coinmarketcap-api-key
ADMIN_API_KEY=your-admin-api-key
DEFAULT_CHAIN_ID=1
PORT=3000
```

The `ADMIN_API_KEY` is a secret string you choose. It is used to authenticate requests to the `/internal/*` admin routes and the admin dashboard. `DEFAULT_CHAIN_ID` sets the default EVM chain for transactions and onboarding when no `chainId` is provided (defaults to `1` for Ethereum Mainnet).

### 3. Run database migrations

```bash
pnpm db:generate   # Generate migration SQL from the Drizzle schema
pnpm db:migrate    # Apply migrations to your database
```

### 4. Start the development server

```bash
pnpm dev
```

The server starts at `http://localhost:3000`. To onboard a user (create their wallet set and profile), call `POST /api/onboard` with a valid Privy auth token. See the [Onboarding Guide](./guides/onboarding.md) for the full flow.

Hit the root endpoint to confirm the server is running:

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
    "goalSavings": "/api/goal-savings"
  }
}
```

### 5. Run tests

```bash
pnpm test
```

Tests use [Vitest](https://vitest.dev/) and are located in `src/__tests__/`.

### 6. Build for production

```bash
pnpm build
pnpm start
```

### 7. Start the admin dashboard (optional)

```bash
cd admin
pnpm install
pnpm dev
```

The admin dashboard starts at `http://localhost:3001` by default. See the [Admin Dashboard Guide](./guides/admin-dashboard.md) for setup details.

## Authentication

Expendi uses a two-tier authentication model:

- **Public API (`/api/*`)** -- Requires a Privy access token via the `Authorization: Bearer <token>` header. All operations are scoped to the authenticated user. Users can only access their own wallets, transactions, and categories.
- **Internal API (`/internal/*`)** -- Requires the `X-Admin-Key` header with the value of the `ADMIN_API_KEY` environment variable. These routes are for backend administration and the admin dashboard.
- **Unauthenticated routes** -- `GET /` and `GET /health` require no authentication.

See the [API Reference](./api-reference.md) for full details on every endpoint.

## Architecture at a Glance

Expendi uses Effect-TS layers as its dependency injection system. Every service declares what it provides and what it requires. The `MainLayer` in `src/layers/main.ts` wires everything together into a single dependency graph that is handed to the Hono HTTP layer at startup.

```
Hono Routes
    |
    +-- privyAuthMiddleware    (public /api/* routes)
    +-- adminKeyMiddleware     (internal /internal/* routes)
    |
    v
runEffect(runtime, effect, c)   <-- bridges Hono context to Effect world
    |
    v
ManagedRuntime<MainLayer>
    |
    +-- ConfigService            (env vars, including ADMIN_API_KEY, DEFAULT_CHAIN_ID)
    +-- DatabaseService          (Drizzle + pg pool)
    +-- PrivyService             (Privy SDK client)
    +-- WalletService            (create/get wallets via Privy + DB)
    +-- WalletResolver           (resolve wallet ref -> WalletInstance)
    +-- ContractRegistry         (in-memory store, pre-loaded from src/connectors/)
    +-- ContractExecutor         (encode + send contract calls via viem)
    +-- LedgerService            (transaction intent CRUD)
    +-- TransactionService       (orchestrates ledger + executor + wallet)
    +-- AdapterService           (CoinMarketCap price data)
    +-- JobberService            (scheduled recurring jobs)
    +-- HeartbeatService         (reactive condition monitoring)
    +-- OnboardingService        (user onboarding + profile management)
    +-- RecurringPaymentService  (recurring payment schedules + execution)
    +-- OfframpAdapterRegistry   (offramp provider adapters: Moonpay, Bridge, Transak)
    +-- GoalSavingsService     (savings goals + automated deposits into yield)
```

See [Architecture Deep Dive](./architecture.md) for the full dependency graph, error handling strategy, and database schema.

## Admin Dashboard

The `admin/` directory contains a Next.js application that provides a web-based admin interface for Expendi. It communicates with the backend via the `/internal/*` routes using the `X-Admin-Key` header.

Dashboard pages include:

- **Dashboard** -- Overview stats and recent activity
- **Wallets** -- Create and browse all wallets (user, server, agent)
- **Transactions** -- View and manage all transactions across all users
- **Jobs** -- Create, monitor, and cancel scheduled jobs
- **Recurring Payments** -- Browse all recurring payment schedules, view execution history, force-execute schedules, and see registered offramp providers
- **Contracts** -- Browse registered contract connectors
- **Categories** -- Manage transaction categories
- **Profiles** -- Browse user profiles, view associated wallets, trigger admin onboarding
- **Impersonate** -- View the system as a specific user for debugging

See the [Admin Dashboard Guide](./guides/admin-dashboard.md) for full setup and usage instructions.

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture Deep Dive](./architecture.md) | Effect layer system, dependency graph, auth middleware, error handling, database schema |
| [API Reference](./api-reference.md) | Every route with method, path, auth requirements, request/response shapes, curl examples |
| [Adding Contracts](./guides/adding-contracts.md) | How to define code-based contract connectors in `src/connectors/` |
| [Adding Adapters](./guides/adding-adapters.md) | How to build new external data adapters |
| [User Onboarding](./guides/onboarding.md) | Onboarding flow, user_profiles schema, idempotency, walletType convenience, integration example |
| [Working with Wallets](./guides/adding-wallets.md) | Wallet types, creation (public vs internal), resolution, signing |
| [Jobs and Heartbeat](./guides/jobs-and-heartbeat.md) | Scheduled jobs (admin-only), reactive conditions, when to use each |
| [Admin Dashboard](./guides/admin-dashboard.md) | Setting up and using the Next.js admin panel |

## Tech Stack

| Concern | Library |
|---------|---------|
| Runtime & DI | [Effect-TS](https://effect.website/) 3.x |
| HTTP | [Hono](https://hono.dev/) 4.x |
| Database | [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL via `pg` |
| Wallet infra | [Privy](https://www.privy.io/) server SDK |
| Blockchain | [viem](https://viem.sh/) (encoding, public client reads, chain definitions) |
| Market data | [CoinMarketCap](https://coinmarketcap.com/api/) REST API |
| Validation | [Zod](https://zod.dev/) 4.x |
| Testing | [Vitest](https://vitest.dev/) 4.x |
| Admin UI | [Next.js](https://nextjs.org/) + [shadcn/ui](https://ui.shadcn.com/) + [Tailwind CSS](https://tailwindcss.com/) |

## Project Structure

```
src/
  index.ts                          # Hono app, middleware, route mounting
  config.ts                         # ConfigService (reads env vars via Effect Config)
  middleware/
    auth.ts                         # privyAuthMiddleware + adminKeyMiddleware
  connectors/
    index.ts                        # Aggregates all connectors, docs on adding new ones
    erc20.ts                        # USDC + USDT connectors (multi-chain via expandMultiChain)
    erc721.ts                       # BAYC connector (Ethereum)
  layers/
    main.ts                         # MainLayer -- wires all services together
  db/
    client.ts                       # DatabaseService (Drizzle + pg.Pool)
    schema/
      enums.ts                      # Postgres enums (wallet_type, transaction_status, job_status, recurring_payment_status, etc.)
      wallets.ts                    # wallets table
      user-profiles.ts              # user_profiles table (onboarding)
      transactions.ts               # transactions table
      transaction-categories.ts     # transaction_categories table
      jobs.ts                       # jobs table
      recurring-payments.ts         # recurring_payments + recurring_payment_executions tables
      goal-savings.ts              # goal_savings + goal_savings_deposits tables
      index.ts                      # re-exports all schema
  routes/
    effect-handler.ts               # runEffect bridge + AppRuntime type
    wallets.ts                      # /api/wallets routes (public, user-scoped)
    transactions.ts                 # /api/transactions routes (public, user-scoped)
    categories.ts                   # /api/categories routes (public, user-scoped)
    onboarding.ts                   # /api/onboard + /api/profile routes (public, user-scoped)
    recurring-payments.ts           # /api/recurring-payments routes (public, user-scoped)
    goal-savings.ts               # /api/goal-savings routes (public, user-scoped)
    internal.ts                     # /internal/* routes (admin-only, includes profile + recurring payment admin)
  services/
    wallet/
      wallet-service.ts             # WalletService interface + WalletInstance type
      wallet-service-live.ts        # WalletServiceLive layer (Privy + DB)
      wallet-resolver.ts            # WalletResolver (ref -> instance)
      privy-layer.ts                # PrivyService (Privy client init)
      user-wallet.ts                # createUserWalletInstance
      server-wallet.ts              # createServerWalletInstance
      agent-wallet.ts               # createAgentWalletInstance
      resolve-tx-hash.ts            # Resolves sponsored tx transaction_id to on-chain hash via Privy
    contract/
      types.ts                      # ContractConnector, MultiChainConnectorDef, expandMultiChain
      contract-registry.ts          # ContractRegistry (in-memory store)
      contract-executor.ts          # ContractExecutor (encode + send via viem)
    ledger/
      ledger-service.ts             # LedgerService (transaction CRUD)
    transaction/
      transaction-service.ts        # TransactionService (orchestration)
    jobber/
      jobber-service.ts             # JobberService (scheduled jobs)
    heartbeat/
      heartbeat-service.ts          # HeartbeatService (reactive conditions)
    onboarding/
      onboarding-service.ts         # OnboardingService (user onboarding + profile CRUD)
    recurring-payment/
      recurring-payment-service.ts  # RecurringPaymentService (schedules, execution, processing)
    offramp/
      offramp-adapter.ts            # OfframpAdapter interface + types
      offramp-registry.ts           # OfframpAdapterRegistry (resolves provider adapters)
      adapters/
        moonpay.ts                  # Moonpay offramp adapter
        bridge.ts                   # Bridge offramp adapter
        transak.ts                  # Transak offramp adapter
        index.ts                    # Re-exports all adapters
    goal-savings/
      goal-savings-service.ts     # GoalSavingsService (savings goals, deposits, automation)
      index.ts                    # Re-exports
    adapters/
      adapter-service.ts            # AdapterService interface
      coinmarketcap.ts              # CoinMarketCapAdapterLive
admin/
  src/
    app/
      page.tsx                      # Dashboard overview
      layout.tsx                    # Root layout with sidebar
      wallets/                      # Wallet management page
      transactions/                 # Transaction management page
      jobs/                         # Job management page
      recurring-payments/           # Recurring payments management page
      contracts/                    # Contract browser page
      categories/                   # Category management page
      impersonate/                  # User impersonation page
    lib/
      api.ts                        # API client for /internal/* routes
      types.ts                      # Shared TypeScript types
    components/                     # shadcn/ui + custom components
```
