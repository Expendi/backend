import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createSwapAutomationRoutes } from "../../routes/swap-automations.js";
import {
  SwapAutomationService,
  SwapAutomationError,
} from "../../services/swap-automation/swap-automation-service.js";
import type {
  SwapAutomation,
  SwapAutomationExecution,
} from "../../db/schema/index.js";

const now = new Date("2025-01-15T12:00:00Z");

function makeFakeAutomation(
  overrides?: Partial<SwapAutomation>
): SwapAutomation {
  return {
    id: "sa-1",
    userId: "user-1",
    walletId: "wallet-1",
    walletType: "server",
    tokenIn: "0x4200000000000000000000000000000000000006",
    tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount: "1000000000000000000",
    slippageTolerance: 0.5,
    chainId: 8453,
    indicatorType: "price_above",
    indicatorToken: "ETH",
    thresholdValue: 4000,
    referencePrice: null,
    status: "active",
    maxExecutions: 1,
    totalExecutions: 0,
    consecutiveFailures: 0,
    maxRetries: 3,
    cooldownSeconds: 60,
    lastCheckedAt: null,
    lastTriggeredAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeExecution(
  overrides?: Partial<SwapAutomationExecution>
): SwapAutomationExecution {
  return {
    id: "exec-1",
    automationId: "sa-1",
    transactionId: "tx-1",
    status: "success",
    priceAtExecution: 4100,
    error: null,
    quoteSnapshot: null,
    executedAt: now,
    ...overrides,
  };
}

// ── Public route tests ──────────────────────────────────────────────

function makePublicTestRuntime(opts?: {
  listResult?: SwapAutomation[];
  getResult?: SwapAutomation | null;
  createResult?: SwapAutomation;
  createFail?: boolean;
  updateResult?: SwapAutomation;
  updateFail?: boolean;
  pauseResult?: SwapAutomation;
  resumeResult?: SwapAutomation;
  cancelResult?: SwapAutomation;
  executionHistory?: SwapAutomationExecution[];
}) {
  const MockSwapAutomationLayer = Layer.succeed(SwapAutomationService, {
    createAutomation: () =>
      opts?.createFail
        ? Effect.fail(
            new SwapAutomationError({ message: "create failed" })
          )
        : Effect.succeed(opts?.createResult ?? makeFakeAutomation()),
    getAutomation: (id: string) =>
      Effect.succeed(
        opts?.getResult === null
          ? undefined
          : (opts?.getResult ?? makeFakeAutomation({ id }))
      ),
    listByUser: () =>
      Effect.succeed(opts?.listResult ?? [makeFakeAutomation()]),
    updateAutomation: (_id: string) =>
      opts?.updateFail
        ? Effect.fail(
            new SwapAutomationError({ message: "update failed" })
          )
        : Effect.succeed(
            opts?.updateResult ?? makeFakeAutomation({ id: _id })
          ),
    pauseAutomation: (id: string) =>
      Effect.succeed(
        opts?.pauseResult ?? makeFakeAutomation({ id, status: "paused" })
      ),
    resumeAutomation: (id: string) =>
      Effect.succeed(
        opts?.resumeResult ?? makeFakeAutomation({ id, status: "active" })
      ),
    cancelAutomation: (id: string) =>
      Effect.succeed(
        opts?.cancelResult ??
          makeFakeAutomation({ id, status: "cancelled" })
      ),
    getExecutionHistory: () =>
      Effect.succeed(opts?.executionHistory ?? [makeFakeExecution()]),
    processDueAutomations: () => Effect.succeed([]),
  });

  const testLayer = Layer.mergeAll(MockSwapAutomationLayer);

  return ManagedRuntime.make(testLayer);
}

function makePublicApp(runtime: ReturnType<typeof makePublicTestRuntime>) {
  const app = new Hono();
  // Simulate auth by setting userId
  app.use("*", async (c, next) => {
    c.set("userId" as any, "user-1");
    await next();
  });
  app.route("/", createSwapAutomationRoutes(runtime as any));
  return app;
}

describe("Swap Automation Routes", () => {
  describe("GET /", () => {
    it("should return list of user automations", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should return empty array when no automations", async () => {
      const runtime = makePublicTestRuntime({ listResult: [] });
      const app = makePublicApp(runtime);

      const res = await app.request("/");
      const body = await res.json();
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("GET /:id", () => {
    it("should return an automation by id", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/sa-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when automation not found", async () => {
      const runtime = makePublicTestRuntime({ getResult: null });
      const app = makePublicApp(runtime);

      const res = await app.request("/nonexistent");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /", () => {
    it("should create a new automation", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          walletType: "server",
          tokenIn: "0x4200000000000000000000000000000000000006",
          tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: "1000000000000000000",
          indicatorType: "price_above",
          indicatorToken: "ETH",
          thresholdValue: 4000,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when creation fails", async () => {
      const runtime = makePublicTestRuntime({ createFail: true });
      const app = makePublicApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: "wallet-1",
          walletType: "server",
          tokenIn: "0x4200000000000000000000000000000000000006",
          tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: "1000000000000000000",
          indicatorType: "price_above",
          indicatorToken: "ETH",
          thresholdValue: 4000,
        }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("PATCH /:id", () => {
    it("should update an automation", async () => {
      const runtime = makePublicTestRuntime({
        updateResult: makeFakeAutomation({ thresholdValue: 5000 }),
      });
      const app = makePublicApp(runtime);

      const res = await app.request("/sa-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thresholdValue: 5000,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.thresholdValue).toBe(5000);

      await runtime.dispose();
    });

    it("should return 400 when update fails", async () => {
      const runtime = makePublicTestRuntime({ updateFail: true });
      const app = makePublicApp(runtime);

      const res = await app.request("/sa-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thresholdValue: 5000,
        }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("POST /:id/pause", () => {
    it("should pause an automation", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/sa-1/pause", { method: "POST" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("paused");

      await runtime.dispose();
    });
  });

  describe("POST /:id/resume", () => {
    it("should resume an automation", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/sa-1/resume", { method: "POST" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("active");

      await runtime.dispose();
    });
  });

  describe("POST /:id/cancel", () => {
    it("should cancel an automation", async () => {
      const runtime = makePublicTestRuntime();
      const app = makePublicApp(runtime);

      const res = await app.request("/sa-1/cancel", { method: "POST" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("cancelled");

      await runtime.dispose();
    });
  });

  describe("GET /:id/executions", () => {
    it("should return execution history", async () => {
      const runtime = makePublicTestRuntime({
        executionHistory: [
          makeFakeExecution({ id: "exec-1" }),
          makeFakeExecution({ id: "exec-2" }),
        ],
      });
      const app = makePublicApp(runtime);

      const res = await app.request("/sa-1/executions");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);

      await runtime.dispose();
    });

    it("should return empty array when no executions", async () => {
      const runtime = makePublicTestRuntime({ executionHistory: [] });
      const app = makePublicApp(runtime);

      const res = await app.request("/sa-1/executions");
      const body = await res.json();
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });
});
