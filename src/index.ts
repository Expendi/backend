import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { runtime } from "./runtime.js";
import { PrivyService } from "./services/wallet/privy-layer.js";
import { ConfigService } from "./config.js";
import { privyAuthMiddleware, adminKeyMiddleware } from "./middleware/auth.js";
import type { AuthVariables } from "./middleware/auth.js";
import { createWalletRoutes } from "./routes/wallets.js";
import { createTransactionRoutes } from "./routes/transactions.js";
import { createCategoryRoutes } from "./routes/categories.js";
import { createInternalRoutes } from "./routes/internal.js";
import { createOnboardingRoutes } from "./routes/onboarding.js";
import { createRecurringPaymentRoutes } from "./routes/recurring-payments.js";
import { createYieldRoutes } from "./routes/yield.js";
import {
  createPretiumRoutes,
  createPretiumWebhookRoutes,
} from "./routes/pretium.js";
import { createUniswapRoutes } from "./routes/uniswap.js";
import { createSwapAutomationRoutes } from "./routes/swap-automations.js";
import { createGroupAccountRoutes } from "./routes/group-accounts.js";
import { createSplitExpenseRoutes } from "./routes/split-expenses.js";
import { createGoalSavingsRoutes } from "./routes/goal-savings.js";

// Resolve the Privy client and admin API key from the Effect runtime so
// we can hand them to the Hono middleware layer without requiring Effect
// context on every HTTP request.
const { client: privyClient } = await runtime.runPromise(PrivyService);
const { adminApiKey } = await runtime.runPromise(ConfigService);

const app = new Hono<{ Variables: AuthVariables }>();

app.use("*", cors());
app.use("*", logger());

// ── Unauthenticated routes ─────────────────────────────────────────

app.get("/", (c) =>
  c.json({
    name: "Expendi",
    version: "1.0.0",
    description: "Crypto financial backend",
    endpoints: {
      wallets: "/api/wallets",
      transactions: "/api/transactions",
      categories: "/api/categories",
      onboard: "/api/onboard",
      profile: "/api/profile",
      recurringPayments: "/api/recurring-payments",
      yield: "/api/yield",
      pretium: "/api/pretium",
      onramp: "/api/pretium/onramp",
      uniswap: "/api/uniswap",
      swapAutomations: "/api/swap-automations",
      groups: "/api/groups",
      splitExpenses: "/api/split-expenses",
      goalSavings: "/api/goal-savings",
      webhooks: "/webhooks/pretium",
    },
  })
);

app.get("/health", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString() })
);

// ── Public API routes (Privy auth) ─────────────────────────────────

app.use("/api/*", privyAuthMiddleware(privyClient));

app.route("/api/wallets", createWalletRoutes(runtime));
app.route("/api/transactions", createTransactionRoutes(runtime));
app.route("/api/categories", createCategoryRoutes(runtime));
app.route("/api", createOnboardingRoutes(runtime));
app.route("/api/recurring-payments", createRecurringPaymentRoutes(runtime));
app.route("/api/yield", createYieldRoutes(runtime));
app.route("/api/pretium", createPretiumRoutes(runtime));
app.route("/api/uniswap", createUniswapRoutes(runtime));
app.route("/api/swap-automations", createSwapAutomationRoutes(runtime));
app.route("/api/groups", createGroupAccountRoutes(runtime));
app.route("/api/split-expenses", createSplitExpenseRoutes(runtime));
app.route("/api/goal-savings", createGoalSavingsRoutes(runtime));

// ── Webhook routes (no auth -- called by payment providers) ────────

app.route("/webhooks", createPretiumWebhookRoutes(runtime));

// ── Internal admin routes (API key auth) ───────────────────────────

app.use("/internal/*", adminKeyMiddleware(adminApiKey));

app.route("/internal", createInternalRoutes(runtime));

// ── Start server ───────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3000);

console.log(`Expendi backend starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`Expendi backend running at http://localhost:${port}`);
