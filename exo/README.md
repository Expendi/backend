# Exo Demo App

React demo application for the Exo wallet — an AI-powered crypto wallet with dual-mode interaction (traditional UI + AI agent chat).

Built with React 19, React Router, [Glove React](https://glove.dterminal.net) for AI agent integration, and [Privy](https://privy.io) for authentication.

## Getting Started

```bash
cd exo

# Install dependencies
pnpm install

# Start dev server
pnpm dev
```

The app runs on `http://localhost:5173` by default and connects to the backend at the URL configured in `vite.config.ts` (proxied to `http://localhost:3000`).

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | Production build |

## Architecture

### Provider Stack

The app wraps the component tree in several context providers:

```
BrowserRouter
  └─ AuthProvider          (Privy auth + profile state)
      └─ GloveProvider     (AI agent — Glove React)
          └─ ApprovalProvider      (PIN/passkey transaction approval prompts)
              └─ PreferencesProvider  (user preferences — theme, defaults)
                  └─ DashboardProvider     (shared dashboard state)
                      └─ ChatActionsProvider  (routes chat tool calls to backend API)
                          └─ AppShell + Routes
```

### Dual-Mode Design

**Wallet Mode** — Traditional UI pages for direct interaction. Users navigate between pages to manage their wallets, view transactions, swap tokens, etc.

**Agent Mode** — AI chat interface at `/agent`. The AI agent uses Glove tools to perform the same operations through natural conversation. The agent shows confirmation UIs (via `pushAndWait`) for approvals, but does not render data cards — data is returned as text in the conversation.

### Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | WalletHomePage | Main dashboard — balances, recent activity |
| `/agent` | AgentPage | AI chat interface |
| `/activity` | ActivityPage | Transaction history |
| `/receive` | ReceivePage | Wallet address + QR code |
| `/settings` | SettingsPage | Profile and preferences |
| `/buy` | BuyPage | On-ramp (fiat to crypto via Pretium) |
| `/swap` | SwapPage | Token swap (Uniswap) |
| `/earn` | EarnPage | Yield vaults (Morpho) |
| `/recurring` | RecurringPaymentsPage | Recurring payment schedules |
| `/goals` | GoalsPage | Savings goals |
| `/categories` | CategoriesPage | Spending categories and limits |
| `/transfer` | TransferPage | Inter-wallet transfers |

### AI Agent Tools

All tools are defined in `src/tools/` as Glove `ToolConfig` objects. Each tool calls the backend API and returns structured data to the AI model.

| Module | Tools | Description |
|--------|-------|-------------|
| `data` | Market data, pricing | Token prices and market info |
| `profile` | Profile operations | Get/update user profile |
| `wallets` | Wallet management | List wallets, check balances, transfer |
| `transactions` | Transaction history | List and inspect transactions |
| `categories` | Category management | Limits, spending analysis |
| `recurring` | Recurring payments | Create, list, manage schedules |
| `yield` | Yield vaults | List vaults, deposit, withdraw |
| `pretium` | On/offramp | Fiat conversion, onramp, offramp |
| `swap` | Token swaps | Quote and execute Uniswap swaps |
| `groups` | Group accounts | Create groups, manage members, pay |
| `savings` | Goal savings | Create goals, deposit, track progress |
| `security` | PIN/passkey setup | Configure transaction approval |

Tools that trigger mutations (transfers, swaps, deposits) use the `ApprovalContext` to prompt the user for PIN/passkey verification before executing.

### Key Libraries

| Package | Purpose |
|---------|---------|
| `glove-react` | AI agent hooks (`useGlove`), `GloveProvider`, `defineTool`, tool display stack |
| `glove-core` | Core agent runtime (dependency of glove-react) |
| `@privy-io/react-auth` | Wallet authentication |
| `@simplewebauthn/browser` | Passkey (WebAuthn) client-side operations |
| `react-router-dom` | Client-side routing |
| `recharts` | Charts for spending/activity data |
| `zod` | Schema validation for tool inputs |

### Glove Integration

The Glove client is configured in `src/lib/glove-client.ts`:

- **Endpoint:** `/api/chat` (proxied to the backend)
- **System prompt:** Instructs the agent on available tools and wallet operations
- **Tools:** All tools from `src/tools/index.ts` are registered

The backend's `/api/chat` route accepts the system prompt, messages, and serialized tool schemas, then streams SSE events back to the Glove client. Tools execute client-side — the backend only handles the LLM conversation loop.

### Styling

CSS is organized in `src/styles/`:

| File | Purpose |
|------|---------|
| `exo-tokens.css` | Design tokens (CSS custom properties) — colors, fonts, spacing |
| `components.css` | Shared component styles — buttons, cards, inputs |
| `layout.css` | Layout system — grid, flexbox utilities |
| `pages.css` | Page-specific styles |
| `app-shell.css` | App shell — sidebar, navigation |
| `chat.css` | Agent chat interface |
| `wallet-home.css` | Wallet home dashboard |
| `send-modal.css` | Send/transfer modal |
| `pin-prompt.css` | PIN entry prompt |
| `security-settings.css` | Security settings page |

Supports light and dark themes via CSS custom properties.

## Project Structure

```
exo/
  src/
    App.tsx                 # Routes and provider stack
    main.tsx                # Entry point
    components/             # Shared UI components
      AppShell.tsx          # Layout shell with sidebar + nav
      ApprovalPrompt.tsx    # PIN/passkey approval modal
      SendModal.tsx         # Transfer modal
      Sidebar.tsx           # Navigation sidebar
      ...
    context/                # React context providers
      AuthContext.tsx        # Privy auth + profile
      ApprovalContext.tsx    # Transaction approval flow
      DashboardContext.tsx   # Dashboard state
      ChatActionsContext.tsx # Tool call routing
      PreferencesContext.tsx # User preferences
    hooks/                  # Custom hooks
      useApi.ts             # API fetch wrapper
      useApproval.ts        # Approval flow hook
      useProfile.ts         # Profile data hook
    lib/
      api.ts                # HTTP client for backend
      glove-client.ts       # Glove client configuration
      constants.ts          # App constants
      types.ts              # Shared TypeScript types
    pages/                  # Route page components
    tools/                  # Glove agent tools (one file per domain)
      index.ts              # Tool registry — exports allTools
      api.ts                # Shared API fetcher + approval handler
      ...
    styles/                 # CSS files
  vite.config.ts            # Vite config with API proxy
  tsconfig.json
```
