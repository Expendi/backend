import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createYieldRoutes } from "../../routes/yield.js";
import {
  YieldService,
  YieldError,
} from "../../services/yield/yield-service.js";
import { OnboardingService } from "../../services/onboarding/onboarding-service.js";
import { ConfigService } from "../../config.js";
import type {
  YieldVault,
  YieldPosition,
  YieldSnapshot,
} from "../../db/schema/index.js";

const now = new Date("2025-01-15T12:00:00Z");

function makeFakeVault(overrides?: Partial<YieldVault>): YieldVault {
  return {
    id: "vault-1",
    vaultAddress: "0x1111111111111111111111111111111111111111",
    chainId: 1,
    name: "Test Vault",
    description: "A test vault",
    underlyingToken: "0x2222222222222222222222222222222222222222",
    underlyingSymbol: "USDC",
    underlyingDecimals: 6,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakePosition(overrides?: Partial<YieldPosition>): YieldPosition {
  return {
    id: "pos-1",
    userId: "user-1",
    walletId: "wallet-1",
    vaultId: "vault-1",
    onChainLockId: "1",
    principalAmount: "1000000000",
    shares: "950000000",
    unlockTime: new Date("2025-06-15T12:00:00Z"),
    label: "savings",
    status: "active",
    transactionId: "tx-1",
    chainId: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeSnapshot(overrides?: Partial<YieldSnapshot>): YieldSnapshot {
  return {
    id: "snap-1",
    positionId: "pos-1",
    currentAssets: "1050000000",
    accruedYield: "50000000",
    estimatedApy: "5.0000",
    snapshotAt: now,
    ...overrides,
  };
}

function makePublicTestRuntime(opts?: {
  vaults?: YieldVault[];
  getVault?: YieldVault | null;
  positions?: YieldPosition[];
  getPosition?: YieldPosition | null;
  createPosition?: YieldPosition;
  createPositionFail?: boolean;
  withdrawResult?: YieldPosition;
  withdrawFail?: boolean;
  yieldHistory?: YieldSnapshot[];
  portfolio?: {
    totalPrincipal: string;
    totalCurrentValue: string;
    totalYield: string;
    averageApy: string;
    positionCount: number;
  };
}) {
  const MockYieldLayer = Layer.succeed(YieldService, {
    listVaults: () =>
      Effect.succeed(opts?.vaults ?? [makeFakeVault()]),
    getVault: (id: string) =>
      Effect.succeed(
        opts?.getVault === null
          ? undefined
          : (opts?.getVault ?? makeFakeVault({ id }))
      ),
    addVault: () => Effect.succeed(makeFakeVault()),
    removeVault: () => Effect.succeed(makeFakeVault({ isActive: false })),
    syncVaultsFromChain: () => Effect.succeed([makeFakeVault()]),
    createPosition: () =>
      opts?.createPositionFail
        ? Effect.fail(new YieldError({ message: "create failed" }))
        : Effect.succeed(opts?.createPosition ?? makeFakePosition()),
    getUserPositions: () =>
      Effect.succeed(opts?.positions ?? [makeFakePosition()]),
    getPosition: (id: string) =>
      Effect.succeed(
        opts?.getPosition === null
          ? undefined
          : (opts?.getPosition ?? makeFakePosition({ id }))
      ),
    withdrawPosition: () =>
      opts?.withdrawFail
        ? Effect.fail(new YieldError({ message: "withdraw failed" }))
        : Effect.succeed(
            opts?.withdrawResult ??
              makeFakePosition({ status: "withdrawn" })
          ),
    syncPositionFromChain: () => Effect.succeed(makeFakePosition()),
    snapshotYield: () => Effect.succeed(makeFakeSnapshot()),
    snapshotAllActivePositions: () => Effect.succeed([makeFakeSnapshot()]),
    getYieldHistory: () =>
      Effect.succeed(opts?.yieldHistory ?? [makeFakeSnapshot()]),
    getPortfolioSummary: () =>
      Effect.succeed(
        opts?.portfolio ?? {
          totalPrincipal: "1000000000",
          totalCurrentValue: "1050000000",
          totalYield: "50000000",
          averageApy: "5.0000",
          positionCount: 1,
        }
      ),
    listAllPositions: () => Effect.succeed([makeFakePosition()]),
  });

  const MockOnboardingLayer = Layer.succeed(OnboardingService, {
    onboardUser: () => Effect.succeed({} as any),
    getProfile: () =>
      Effect.succeed({
        id: "profile-1",
        privyUserId: "user-1",
        userWalletId: "wallet-1",
        serverWalletId: "wallet-2",
        agentWalletId: "wallet-3",
        createdAt: now,
        updatedAt: now,
      }),
    getProfileWithWallets: () => Effect.succeed({} as any),
    isOnboarded: () => Effect.succeed(true),
  });

  const MockConfigLayer = Layer.succeed(ConfigService, {
    databaseUrl: "postgres://test",
    privyAppId: "test",
    privyAppSecret: "test",
    coinmarketcapApiKey: "test",
    adminApiKey: "test",
    defaultChainId: 1,
    port: 3000,
  });

  const testLayer = Layer.mergeAll(
    MockYieldLayer,
    MockOnboardingLayer,
    MockConfigLayer
  );

  return ManagedRuntime.make(testLayer);
}

function makePublicApp(runtime: ReturnType<typeof makePublicTestRuntime>) {
  const app = new Hono();
  // Simulate auth by setting userId
  app.use("*", async (c, next) => {
    c.set("userId" as any, "user-1");
    await next();
  });
  app.route("/", createYieldRoutes(runtime as any));
  return app;
}

describe("Yield Routes (Public)", () => {
  describe("GET /vaults", () => {
    it("should return list of active vaults", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/vaults");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should return empty array when no vaults", async () => {
      const runtime = makePublicTestRuntime({ vaults: [] });
      const app = makePublicApp(runtime);

      const res = await app.request("/vaults");
      const body = await res.json();
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("GET /vaults/:id", () => {
    it("should return a vault by id", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/vaults/vault-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when vault not found", async () => {
      const runtime = makePublicTestRuntime({ getVault: null });
      const app = makePublicApp(runtime);

      const res = await app.request("/vaults/nonexistent");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /positions", () => {
    it("should create a new position", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          walletType: "server",
          vaultId: "vault-1",
          amount: "1000000000",
          unlockTime: Math.floor(Date.now() / 1000) + 86400 * 30,
          label: "savings",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should resolve walletId from walletType when walletId not provided", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletType: "user",
          vaultId: "vault-1",
          amount: "1000000000",
          unlockTime: Math.floor(Date.now() / 1000) + 86400 * 30,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when creation fails", async () => {
      const runtime = makePublicTestRuntime({ createPositionFail: true });
      const app = makePublicApp(runtime);

      const res = await app.request("/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          walletType: "server",
          vaultId: "vault-1",
          amount: "1000000000",
          unlockTime: Math.floor(Date.now() / 1000) + 86400 * 30,
        }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("GET /positions", () => {
    it("should return list of user positions", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/positions");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should return empty array when no positions", async () => {
      const runtime = makePublicTestRuntime({ positions: [] });
      const app = makePublicApp(runtime);

      const res = await app.request("/positions");
      const body = await res.json();
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("GET /positions/:id", () => {
    it("should return a position by id", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/positions/pos-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when position not found", async () => {
      const runtime = makePublicTestRuntime({ getPosition: null });
      const app = makePublicApp(runtime);

      const res = await app.request("/positions/nonexistent");
      expect(res.status).toBe(400);

      await runtime.dispose();
    });

    it("should return 400 when position belongs to another user", async () => {
      const runtime = makePublicTestRuntime({
        getPosition: makeFakePosition({ userId: "other-user" }),
      });
      const app = makePublicApp(runtime);

      const res = await app.request("/positions/pos-1");
      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("POST /positions/:id/withdraw", () => {
    it("should withdraw a position", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/positions/pos-1/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletType: "server" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("withdrawn");

      await runtime.dispose();
    });

    it("should return 400 when position not found", async () => {
      const runtime = makePublicTestRuntime({ getPosition: null });
      const app = makePublicApp(runtime);

      const res = await app.request("/positions/nonexistent/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletType: "server" }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });

    it("should return 400 when position belongs to another user", async () => {
      const runtime = makePublicTestRuntime({
        getPosition: makeFakePosition({ userId: "other-user" }),
      });
      const app = makePublicApp(runtime);

      const res = await app.request("/positions/pos-1/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletType: "server" }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("GET /positions/:id/history", () => {
    it("should return yield snapshot history", async () => {
      const runtime = makePublicTestRuntime({
        yieldHistory: [
          makeFakeSnapshot({ id: "snap-1" }),
          makeFakeSnapshot({ id: "snap-2" }),
        ],
      });
      const app = makePublicApp(runtime);

      const res = await app.request("/positions/pos-1/history");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);

      await runtime.dispose();
    });

    it("should return 400 when position not found", async () => {
      const runtime = makePublicTestRuntime({ getPosition: null });
      const app = makePublicApp(runtime);

      const res = await app.request("/positions/nonexistent/history");
      expect(res.status).toBe(400);

      await runtime.dispose();
    });

    it("should return 400 when position belongs to another user", async () => {
      const runtime = makePublicTestRuntime({
        getPosition: makeFakePosition({ userId: "other-user" }),
      });
      const app = makePublicApp(runtime);

      const res = await app.request("/positions/pos-1/history");
      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("GET /portfolio", () => {
    it("should return portfolio summary", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/portfolio");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.totalPrincipal).toBe("1000000000");
      expect(body.data.totalCurrentValue).toBe("1050000000");
      expect(body.data.totalYield).toBe("50000000");
      expect(body.data.positionCount).toBe(1);

      await runtime.dispose();
    });

    it("should return empty portfolio when user has no positions", async () => {
      const runtime = makePublicTestRuntime({
        portfolio: {
          totalPrincipal: "0",
          totalCurrentValue: "0",
          totalYield: "0",
          averageApy: "0",
          positionCount: 0,
        },
      });
      const app = makePublicApp(runtime);

      const res = await app.request("/portfolio");
      const body = await res.json();
      expect(body.data.positionCount).toBe(0);
      expect(body.data.totalPrincipal).toBe("0");

      await runtime.dispose();
    });
  });
});
