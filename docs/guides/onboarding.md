# User Onboarding

The onboarding system provides a single-call setup for new users. One API request creates a complete wallet set (user, server, agent) and a `user_profiles` record that links them together. This is the recommended way to provision wallets for users in Expendi.

## What Happens During Onboarding

When `POST /api/onboard` (or the admin equivalent `POST /internal/profiles/:privyUserId/onboard`) is called, the `OnboardingService` performs the following steps:

1. **Check for existing profile** -- If the user already has a `user_profiles` record, return it immediately (idempotency guarantee).
2. **Create a user wallet** -- A Privy wallet is created and persisted in the `wallets` table with `type = "user"` and `ownerId` set to the user's Privy DID.
3. **Create a server wallet** -- A Privy wallet is created with `type = "server"`. The `ownerId` is then updated from `"system"` to the user's Privy DID so that ownership verification works for transactions.
4. **Create an agent wallet** -- A Privy wallet is created with `type = "agent"` and `agentId = "agent-{privyUserId}"`. The `ownerId` is updated to the user's Privy DID.
5. **Insert a user_profiles record** -- A row is inserted into the `user_profiles` table linking the user to all three wallets.
6. **Return the profile with wallet details** -- The response includes both the profile record and the full wallet objects (with addresses).

## The user_profiles Schema

The `user_profiles` table is defined in `src/db/schema/user-profiles.ts`:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | text | PK, auto-generated UUID | Profile identifier |
| `privy_user_id` | text | NOT NULL, UNIQUE | The user's Privy DID (e.g., `did:privy:cm3x9kf2a00cl14mhbz6t7s92`) |
| `user_wallet_id` | text | NOT NULL, FK -> wallets.id | The user's personal Privy wallet |
| `server_wallet_id` | text | NOT NULL, FK -> wallets.id | Backend-controlled wallet assigned to this user |
| `agent_wallet_id` | text | NOT NULL, FK -> wallets.id | Agent wallet assigned to this user |
| `created_at` | timestamp with timezone | NOT NULL, default now() | When the profile was created |
| `updated_at` | timestamp with timezone | NOT NULL, default now() | Last update time |

The unique constraint on `privy_user_id` ensures one profile per user. The three FK columns each reference the `wallets.id` column, creating a one-to-one relationship between a profile and each of its wallets.

Drizzle ORM relations are defined for convenient joins:

```typescript
export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  userWallet: one(wallets, {
    fields: [userProfiles.userWalletId],
    references: [wallets.id],
    relationName: "userWallet",
  }),
  serverWallet: one(wallets, {
    fields: [userProfiles.serverWalletId],
    references: [wallets.id],
    relationName: "serverWallet",
  }),
  agentWallet: one(wallets, {
    fields: [userProfiles.agentWalletId],
    references: [wallets.id],
    relationName: "agentWallet",
  }),
}));
```

## How to Trigger Onboarding

### Client-side (Public API)

Requires a valid Privy access token. The user's identity is extracted from the token automatically.

```bash
curl -X POST http://localhost:3000/api/onboard \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "chainId": 1 }'
```

The `chainId` parameter is optional and defaults to the server's `DEFAULT_CHAIN_ID` configuration value (which itself defaults to `1` for Ethereum Mainnet when the environment variable is not set). It provides context for wallet creation but does not restrict the wallets to a single chain -- Privy wallets work across all EVM chains.

You can configure the default chain ID globally by setting the `DEFAULT_CHAIN_ID` environment variable in the backend's `.env` file:

```
DEFAULT_CHAIN_ID=137
```

When set to `137`, onboarding calls that omit the `chainId` parameter will use Polygon as the default chain context.

Response:

```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "privyUserId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
      "userWalletId": "wallet-uuid-1",
      "serverWalletId": "wallet-uuid-2",
      "agentWalletId": "wallet-uuid-3",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "updatedAt": "2025-01-15T10:30:00.000Z"
    },
    "wallets": {
      "user": {
        "id": "wallet-uuid-1",
        "type": "user",
        "privyWalletId": "privy-wallet-id-1",
        "ownerId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
        "address": "0x1234567890abcdef1234567890abcdef12345678",
        "chainId": null,
        "createdAt": "2025-01-15T10:30:00.000Z"
      },
      "server": {
        "id": "wallet-uuid-2",
        "type": "server",
        "privyWalletId": "privy-wallet-id-2",
        "ownerId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
        "address": "0xabcdef1234567890abcdef1234567890abcdef12",
        "chainId": null,
        "createdAt": "2025-01-15T10:30:00.000Z"
      },
      "agent": {
        "id": "wallet-uuid-3",
        "type": "agent",
        "privyWalletId": "privy-wallet-id-3",
        "ownerId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
        "address": "0x567890abcdef1234567890abcdef1234567890ab",
        "chainId": null,
        "createdAt": "2025-01-15T10:30:00.000Z"
      }
    }
  }
}
```

### Admin-side (Internal API)

Admins can onboard a user without needing their Privy auth token. This is useful for pre-provisioning accounts or onboarding users from a backend process.

```bash
curl -X POST http://localhost:3000/internal/profiles/did:privy:cm3x9kf2a00cl14mhbz6t7s92/onboard \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "chainId": 1 }'
```

The response format is identical to the public endpoint.

## How to Check if a User is Onboarded

Call `GET /api/profile` with a valid Privy token. If the user has been onboarded, their profile with wallet details is returned. If not, the endpoint returns HTTP 400 with an `OnboardingError`:

```bash
curl http://localhost:3000/api/profile \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**User is onboarded** -- HTTP 200:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "privyUserId": "did:privy:cm3x9kf2a00cl14mhbz6t7s92",
    "userWalletId": "wallet-uuid-1",
    "serverWalletId": "wallet-uuid-2",
    "agentWalletId": "wallet-uuid-3",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z",
    "userWallet": { "id": "wallet-uuid-1", "type": "user", "address": "0x1234...", "..." : "..." },
    "serverWallet": { "id": "wallet-uuid-2", "type": "server", "address": "0xabcd...", "..." : "..." },
    "agentWallet": { "id": "wallet-uuid-3", "type": "agent", "address": "0x5678...", "..." : "..." }
  }
}
```

**User is NOT onboarded** -- HTTP 400:

```json
{
  "success": false,
  "error": {
    "_tag": "OnboardingError",
    "message": "Profile not found for user: did:privy:cm3x9kf2a00cl14mhbz6t7s92"
  }
}
```

## How to Reference Wallets by Type in Transactions

After onboarding, you can submit transactions using the `walletType` field instead of passing a `walletId` directly. The system resolves the correct wallet from the user's profile.

Valid `walletType` values: `"user"`, `"server"`, `"agent"`.

### Contract transaction using walletType

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

### Raw transaction using walletType

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

If both `walletId` and `walletType` are provided in the same request, `walletId` takes precedence. If `walletType` is used and the user has not been onboarded, the endpoint returns an `OnboardingError`.

## The Idempotency Guarantee

The `onboardUser` method in `OnboardingService` is idempotent. It checks for an existing profile before creating wallets:

```typescript
// Inside OnboardingServiceLive.onboardUser:
const existing = yield* findProfile(params.privyUserId);
if (existing[0]) {
  return existing[0]; // Return existing profile, no new wallets created
}
```

This means:

- Calling `POST /api/onboard` multiple times for the same user always returns the same profile and wallets.
- No duplicate wallets are created.
- No duplicate profile records are created (the `privy_user_id` column has a unique constraint as an additional safeguard).
- The operation is safe to retry on network failures.

## Integration Example: Frontend Flow

Here is a typical frontend integration using Privy for authentication and Expendi for wallet management.

### 1. User authenticates with Privy

Use the Privy React SDK to authenticate the user. After authentication, you have access to the user's Privy access token.

```typescript
import { usePrivy } from "@privy-io/react-auth";

function App() {
  const { login, authenticated, getAccessToken } = usePrivy();

  // User clicks "Log In" -> Privy handles authentication
  // After login, `authenticated` is true and `getAccessToken()` returns a valid token
}
```

### 2. Onboard the user

After authentication, call `POST /api/onboard` to create the user's wallets and profile. This should be called once during the first login -- but since it is idempotent, it is safe to call on every login.

```typescript
async function onboardUser() {
  const token = await getAccessToken();

  const response = await fetch("http://localhost:3000/api/onboard", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chainId: 1 }),
  });

  const result = await response.json();

  if (result.success) {
    // result.data.profile contains the profile record
    // result.data.wallets.user contains the user wallet details
    // result.data.wallets.server contains the server wallet details
    // result.data.wallets.agent contains the agent wallet details
    return result.data;
  } else {
    throw new Error(result.error.message);
  }
}
```

### 3. Fetch wallet addresses

To display wallet addresses in the UI, use the convenience endpoint:

```typescript
async function getWalletAddresses() {
  const token = await getAccessToken();

  const response = await fetch("http://localhost:3000/api/profile/wallets", {
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  const result = await response.json();
  // result.data = { user: "0x...", server: "0x...", agent: "0x..." }
  return result.data;
}
```

### 4. Submit transactions using walletType

Once onboarded, the user can submit transactions without knowing wallet UUIDs:

```typescript
async function sendUSDC(recipientAddress: string, amount: string) {
  const token = await getAccessToken();

  const response = await fetch("http://localhost:3000/api/transactions/contract", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      walletType: "user",
      contractName: "usdc",
      chainId: 1,
      method: "transfer",
      args: [recipientAddress, amount],
    }),
  });

  const result = await response.json();
  return result.data; // Transaction object with status "submitted"
}
```

## OnboardingService API

The `OnboardingService` Effect service exposes four methods:

| Method | Signature | Description |
|--------|-----------|-------------|
| `onboardUser` | `(params: { privyUserId: string; chainId: number }) => Effect<UserProfile, OnboardingError \| WalletError>` | Creates wallets and profile. Idempotent. |
| `getProfile` | `(privyUserId: string) => Effect<UserProfile, OnboardingError>` | Returns the profile record (without wallet details). Fails if not onboarded. |
| `getProfileWithWallets` | `(privyUserId: string) => Effect<UserProfileWithWallets, OnboardingError>` | Returns the profile with all three wallet objects populated. Fails if not onboarded. |
| `isOnboarded` | `(privyUserId: string) => Effect<boolean, OnboardingError>` | Returns `true` if the user has a profile, `false` otherwise. |

The `OnboardingServiceLive` layer requires `WalletService` and `DatabaseService`:

```typescript
export const OnboardingServiceLive: Layer.Layer<
  OnboardingService,
  never,
  WalletService | DatabaseService
> = Layer.effect(OnboardingService, /* ... */);
```

In the `MainLayer` composition (`src/layers/main.ts`):

```typescript
const OnboardingServiceLayer = OnboardingServiceLive.pipe(
  Layer.provide(WalletServiceLayer),
  Layer.provide(DatabaseLayer)
);
```

## Error Handling

All onboarding operations can fail with an `OnboardingError`:

```typescript
export class OnboardingError extends Data.TaggedError("OnboardingError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
```

Common failure scenarios:

- **Profile not found** -- `getProfile` or `getProfileWithWallets` called for a user who has not been onboarded.
- **Wallet creation failure** -- Privy API is unreachable or returns an error during `onboardUser`.
- **Database failure** -- Profile or wallet record insertion fails.
- **Missing wallet records** -- A wallet record referenced by the profile no longer exists in the database.

All errors surface to the HTTP client as:

```json
{
  "success": false,
  "error": {
    "_tag": "OnboardingError",
    "message": "Profile not found for user: did:privy:..."
  }
}
```
