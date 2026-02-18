# Admin Dashboard

The Expendi admin dashboard is a Next.js web application that provides a graphical interface for managing wallets, transactions, jobs, contracts, and categories. It communicates with the Expendi backend through the `/internal/*` admin API routes.

## Prerequisites

- Node.js 18+
- pnpm 10+
- The Expendi backend running and accessible (default: `http://localhost:3000`)
- The `ADMIN_API_KEY` environment variable configured in the backend

## Setup

### 1. Install dependencies

```bash
cd admin
pnpm install
```

### 2. Configure environment

Create a `.env.local` file in the `admin/` directory:

```
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_ADMIN_API_KEY=your-admin-api-key
```

The `NEXT_PUBLIC_ADMIN_API_KEY` must match the `ADMIN_API_KEY` value configured in the backend's `.env` file.

### 3. Start the development server

```bash
pnpm dev
```

The dashboard starts at `http://localhost:3001` by default (Next.js will use the next available port if 3000 is taken by the backend).

### 4. Build for production

```bash
pnpm build
pnpm start
```

## Technology Stack

| Concern | Library |
|---------|---------|
| Framework | [Next.js](https://nextjs.org/) with App Router |
| Components | [shadcn/ui](https://ui.shadcn.com/) (Radix UI primitives) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) with dark mode |
| Language | TypeScript |

## Architecture

### API Communication

The dashboard uses an API client module at `admin/src/lib/api.ts` that wraps `fetch` calls to the backend. All requests to `/internal/*` endpoints include the `X-Admin-Key` header automatically.

### Type Safety

Shared TypeScript types are defined in `admin/src/lib/types.ts`, mirroring the backend's data shapes (Wallet, Transaction, Job, TransactionCategory, ContractConnector).

## Pages

### Dashboard (`/`)

The main dashboard page displays an overview of the system:

- Total number of wallets, transactions, and jobs
- Recent transactions with status indicators
- Job processing summary
- Quick-action buttons for common operations

### Wallets (`/wallets`)

Browse and manage all wallets across all users.

**Features:**
- Data table showing all wallets with type, owner, address, and creation date
- Create new server wallets (one click, no parameters needed)
- Create new agent wallets (requires agent ID)
- Filter and search wallets by type, address, or owner

**Backend routes used:**
- `GET /internal/wallets` -- list all wallets
- `POST /internal/wallets/server` -- create server wallet
- `POST /internal/wallets/agent` -- create agent wallet

### Transactions (`/transactions`)

View and manage all transactions across all users.

**Features:**
- Paginated data table with status, wallet, chain, method, and timestamps
- Status badges (pending, submitted, confirmed, failed) with color coding
- Confirm transactions manually (sets status to confirmed with optional gas used)
- Mark transactions as failed with an error message
- Filter by wallet or user

**Backend routes used:**
- `GET /internal/transactions` -- list all transactions
- `GET /internal/transactions/wallet/:walletId` -- filter by wallet
- `GET /internal/transactions/user/:userId` -- filter by user
- `PATCH /internal/transactions/:id/confirm` -- confirm transaction
- `PATCH /internal/transactions/:id/fail` -- fail transaction

### Jobs (`/jobs`)

Create, monitor, and cancel scheduled jobs.

**Features:**
- Data table showing all jobs with name, type, schedule, status, and next run time
- Create new jobs with a form (name, type, schedule, payload, max retries)
- Cancel pending or running jobs
- Trigger immediate processing of all due jobs
- View job execution history and error messages

**Backend routes used:**
- `GET /internal/jobs` -- list all jobs
- `GET /internal/jobs/:id` -- get job details
- `POST /internal/jobs` -- create new job
- `POST /internal/jobs/:id/cancel` -- cancel job
- `POST /internal/jobs/process` -- process due jobs

### Recurring Payments (`/recurring-payments`)

Browse and manage all recurring payment schedules across all users.

**Features:**
- Data table showing all schedules with user, payment type, amount, frequency, status, and next execution time
- Status badges for schedule states (active, paused, cancelled, completed, failed)
- View detailed schedule information including offramp configuration
- Force-execute a schedule immediately (triggers the payment regardless of next scheduled time)
- View execution history for each schedule with success/failure status and linked transaction IDs
- Process all due payments manually (finds active schedules past their next execution time and runs them)
- Registered offramp providers section showing available providers (Moonpay, Bridge, Transak)

**Backend routes used:**
- `GET /internal/recurring-payments` -- list all schedules (paginated)
- `GET /internal/recurring-payments/:id` -- get schedule details
- `POST /internal/recurring-payments/:id/execute` -- force-execute a schedule
- `GET /internal/recurring-payments/:id/executions` -- get execution history
- `POST /internal/recurring-payments/process` -- process all due payments

### Contracts (`/contracts`)

Browse all registered contract connectors. This page is read-only since connectors are defined in code.

**Features:**
- List of all registered connectors with name, chain ID, address, and method shortcuts
- View the full ABI and method aliases for each connector
- Copy contract addresses to clipboard

**Backend routes used:**
- `GET /api/contracts` -- list all connectors (read-only)
- `GET /api/contracts/:name/:chainId` -- get connector details

### Categories (`/categories`)

Manage transaction categories across all users.

**Features:**
- Data table showing all categories with name, user scope, and description
- Create, update, and delete categories

### Profiles (`/profiles`)

Browse and manage user onboarding profiles.

**Features:**
- Data table showing all user profiles with Privy DID, wallet IDs, and creation date
- View a specific user's profile with full wallet details (addresses, types)
- Trigger onboarding for a user who has not yet been onboarded (admin-initiated)
- Quick link to view a user's wallets and transactions

**Backend routes used:**
- `GET /internal/profiles` -- list all user profiles
- `GET /internal/profiles/:privyUserId` -- get a user's profile with wallet details
- `POST /internal/profiles/:privyUserId/onboard` -- onboard a user on their behalf

### Impersonate (`/impersonate`)

View the system from a specific user's perspective for debugging and support.

**Features:**
- Enter a user ID (Privy DID) to view their data
- See the user's wallets, transactions, categories, and onboarding profile
- Look up the user's profile to see their assigned wallet addresses at a glance
- Useful for investigating user-reported issues without needing their auth token

**Backend routes used:**
- `GET /internal/profiles/:privyUserId` -- user's onboarding profile and wallet details
- `GET /internal/transactions/user/:userId` -- user's transactions
- `GET /internal/wallets` -- filtered client-side by owner ID

## Dark Mode

The admin dashboard supports dark mode via Tailwind CSS. The theme preference is detected from the system settings and can be toggled in the UI. All shadcn/ui components are designed to work in both light and dark modes.

## Security Considerations

- The admin dashboard should only be accessible to authorized administrators.
- The `NEXT_PUBLIC_ADMIN_API_KEY` is exposed to the browser (since it is a `NEXT_PUBLIC_` variable). This is acceptable for internal tools but means the admin key should be treated as a browser-visible secret.
- For production deployments, consider placing the admin dashboard behind a VPN, IP allowlist, or additional authentication layer (e.g., HTTP basic auth via a reverse proxy).
- The admin API key grants full access to all backend data and operations. Rotate it regularly and restrict access to the admin dashboard.
