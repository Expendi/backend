import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { WalletService } from "../services/wallet/wallet-service.js";
import { TransactionService } from "../services/transaction/transaction-service.js";
import { LedgerService } from "../services/ledger/ledger-service.js";
import { JobberService } from "../services/jobber/jobber-service.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import { RecurringPaymentService } from "../services/recurring-payment/recurring-payment-service.js";
import { YieldService } from "../services/yield/yield-service.js";
import { GoalSavingsService } from "../services/goal-savings/index.js";
import { AgentAutonomyService } from "../services/agent/index.js";
import { DatabaseService } from "../db/client.js";
import { wallets, userProfiles } from "../db/schema/index.js";

/**
 * Internal admin routes -- protected by X-Admin-Key middleware (applied
 * in index.ts). These routes are NOT exposed to end-users.
 */
export function createInternalRoutes(runtime: AppRuntime) {
  const app = new Hono();

  // ── Wallet admin routes ──────────────────────────────────────────

  // List all wallets (no user filter)
  app.get("/wallets", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const { db } = yield* DatabaseService;
        const results = yield* Effect.tryPromise({
          try: () => db.select().from(wallets).orderBy(wallets.createdAt),
          catch: (error) => new Error(`Failed to list wallets: ${error}`),
        });
        return results;
      }),
      c
    )
  );

  // Create a server wallet
  app.post("/wallets/server", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const walletService = yield* WalletService;
        const wallet = yield* walletService.createServerWallet();
        const address = yield* wallet.getAddress();
        return { address, type: "server" as const };
      }),
      c
    )
  );

  // Create an agent wallet
  app.post("/wallets/agent", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ agentId: string }>(),
          catch: () => new Error("Invalid request body"),
        });
        const walletService = yield* WalletService;
        const wallet = yield* walletService.createAgentWallet(body.agentId);
        const address = yield* wallet.getAddress();
        return { address, type: "agent" as const };
      }),
      c
    )
  );

  // ── Transaction admin routes ─────────────────────────────────────

  // List all transactions (no user filter)
  app.get("/transactions", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const limit = Number(c.req.query("limit") ?? "50");
        const offset = Number(c.req.query("offset") ?? "0");
        const txService = yield* TransactionService;
        return yield* txService.listTransactions(limit, offset);
      }),
      c
    )
  );

  // List transactions by wallet ID
  app.get("/transactions/wallet/:walletId", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const walletId = c.req.param("walletId");
        const ledger = yield* LedgerService;
        return yield* ledger.listByWallet(walletId);
      }),
      c
    )
  );

  // List transactions by user ID
  app.get("/transactions/user/:userId", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.req.param("userId");
        const ledger = yield* LedgerService;
        return yield* ledger.listByUser(userId);
      }),
      c
    )
  );

  // Mark a transaction as confirmed
  app.patch("/transactions/:id/confirm", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ gasUsed?: string }>(),
          catch: () => ({ gasUsed: undefined }),
        });
        const ledger = yield* LedgerService;
        return yield* ledger.markConfirmed(
          id,
          body.gasUsed ? BigInt(body.gasUsed) : undefined
        );
      }),
      c
    )
  );

  // Mark a transaction as failed
  app.patch("/transactions/:id/fail", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ error: string }>(),
          catch: () => ({ error: "Unknown error" }),
        });
        const ledger = yield* LedgerService;
        return yield* ledger.markFailed(id, body.error);
      }),
      c
    )
  );

  // ── Job admin routes ─────────────────────────────────────────────

  // List all jobs
  app.get("/jobs", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const jobber = yield* JobberService;
        return yield* jobber.listJobs();
      }),
      c
    )
  );

  // Get a single job
  app.get("/jobs/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const jobber = yield* JobberService;
        const job = yield* jobber.getJob(id);
        if (!job) {
          return yield* Effect.fail(new Error("Job not found"));
        }
        return job;
      }),
      c
    )
  );

  // Create a job
  app.post("/jobs", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              name: string;
              jobType: string;
              schedule: string;
              payload: Record<string, unknown>;
              maxRetries?: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const jobber = yield* JobberService;
        return yield* jobber.createJob(body);
      }),
      c
    )
  );

  // Cancel a job
  app.post("/jobs/:id/cancel", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const jobber = yield* JobberService;
        return yield* jobber.cancelJob(id);
      }),
      c
    )
  );

  // Process due jobs
  app.post("/jobs/process", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const jobber = yield* JobberService;
        const processed = yield* jobber.processDueJobs();
        return { processedCount: processed.length, jobs: processed };
      }),
      c
    )
  );

  // ── Profile admin routes ──────────────────────────────────────────

  // List all user profiles
  app.get("/profiles", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const { db } = yield* DatabaseService;
        const results = yield* Effect.tryPromise({
          try: () =>
            db.select().from(userProfiles).orderBy(userProfiles.createdAt),
          catch: (error) => new Error(`Failed to list profiles: ${error}`),
        });
        return results;
      }),
      c
    )
  );

  // Get a specific user's profile with wallets
  app.get("/profiles/:privyUserId", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const privyUserId = c.req.param("privyUserId");
        const onboarding = yield* OnboardingService;
        return yield* onboarding.getProfileWithWallets(privyUserId);
      }),
      c
    )
  );

  // Admin-triggered onboarding for a specific user
  app.post("/profiles/:privyUserId/onboard", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const privyUserId = c.req.param("privyUserId");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ chainId?: number }>(),
          catch: () => ({ chainId: undefined }),
        });

        const onboarding = yield* OnboardingService;
        const profile = yield* onboarding.onboardUser({
          privyUserId,
          chainId: body.chainId ?? 1,
        });

        const profileWithWallets =
          yield* onboarding.getProfileWithWallets(privyUserId);

        return {
          profile: {
            id: profileWithWallets.id,
            privyUserId: profileWithWallets.privyUserId,
            userWalletId: profileWithWallets.userWalletId,
            serverWalletId: profileWithWallets.serverWalletId,
            agentWalletId: profileWithWallets.agentWalletId,
            createdAt: profileWithWallets.createdAt,
            updatedAt: profileWithWallets.updatedAt,
          },
          wallets: {
            user: profileWithWallets.userWallet,
            server: profileWithWallets.serverWallet,
            agent: profileWithWallets.agentWallet,
          },
        };
      }),
      c
    )
  );

  // ── Recurring payment admin routes ───────────────────────────────

  // List all recurring payment schedules
  app.get("/recurring-payments", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const limit = Number(c.req.query("limit") ?? "50");
        const offset = Number(c.req.query("offset") ?? "0");
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.listAllSchedules(limit, offset);
      }),
      c
    )
  );

  // Get a single recurring payment schedule
  app.get("/recurring-payments/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const rpService = yield* RecurringPaymentService;
        const schedule = yield* rpService.getSchedule(id);
        if (!schedule) {
          return yield* Effect.fail(new Error("Schedule not found"));
        }
        return schedule;
      }),
      c
    )
  );

  // Force-execute a recurring payment schedule
  app.post("/recurring-payments/:id/execute", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.executeSchedule(id);
      }),
      c
    )
  );

  // Get execution history for a schedule
  app.get("/recurring-payments/:id/executions", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const limit = Number(c.req.query("limit") ?? "50");
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.getExecutionHistory(id, limit);
      }),
      c
    )
  );

  // Process all due recurring payments
  app.post("/recurring-payments/process", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const rpService = yield* RecurringPaymentService;
        const executions = yield* rpService.processDuePayments();
        return { processedCount: executions.length, executions };
      }),
      c
    )
  );

  // ── Yield admin routes ────────────────────────────────────────────

  // List all vaults (including inactive)
  app.get("/yield/vaults", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const chainIdParam = c.req.query("chainId");
        const chainId = chainIdParam ? Number(chainIdParam) : undefined;
        const yieldService = yield* YieldService;
        return yield* yieldService.listVaults(chainId, true);
      }),
      c
    )
  );

  // Add a vault
  app.post("/yield/vaults", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              vaultAddress: string;
              chainId: number;
              name: string;
              description?: string;
              underlyingToken?: string;
              underlyingSymbol?: string;
              underlyingDecimals?: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });
        const yieldService = yield* YieldService;
        return yield* yieldService.addVault(body);
      }),
      c,
      201
    )
  );

  // Deactivate a vault
  app.delete("/yield/vaults/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const yieldService = yield* YieldService;
        return yield* yieldService.removeVault(id);
      }),
      c
    )
  );

  // Sync vaults from chain
  app.post("/yield/vaults/sync", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ chainId: number }>(),
          catch: () => new Error("Invalid request body"),
        });
        const yieldService = yield* YieldService;
        return yield* yieldService.syncVaultsFromChain(body.chainId);
      }),
      c
    )
  );

  // List all positions (all users)
  app.get("/yield/positions", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const limit = Number(c.req.query("limit") ?? "50");
        const offset = Number(c.req.query("offset") ?? "0");
        const yieldService = yield* YieldService;
        return yield* yieldService.listAllPositions(limit, offset);
      }),
      c
    )
  );

  // Trigger yield snapshot for all active positions
  app.post("/yield/snapshots/run", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const yieldService = yield* YieldService;
        const snapshots = yield* yieldService.snapshotAllActivePositions();
        return { snapshotCount: snapshots.length, snapshots };
      }),
      c
    )
  );

  // ── Goal savings admin routes ──────────────────────────────────────

  // Process all due goal savings deposits
  app.post("/goal-savings/process", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const service = yield* GoalSavingsService;
        const deposits = yield* service.processDueDeposits();
        return { processedCount: deposits.length, deposits };
      }),
      c
    )
  );

  // ── Agent autonomy routes ────────────────────────────────────────

  // Process all active mandates (called by cron / Trigger.dev)
  app.post("/agent/process-mandates", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const autonomy = yield* AgentAutonomyService;
        return yield* autonomy.processAllMandates();
      }),
      c
    )
  );

  return app;
}
