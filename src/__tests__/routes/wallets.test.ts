import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createWalletRoutes } from "../../routes/wallets.js";
import {
  WalletService,
  WalletError,
} from "../../services/wallet/wallet-service.js";
import { WalletResolver } from "../../services/wallet/wallet-resolver.js";
import { DatabaseService } from "../../db/client.js";
import type { AuthVariables } from "../../middleware/auth.js";

const TEST_USER_ID = "test-user-123";

const fakeWallet = {
  id: "wallet-1",
  type: "user" as const,
  privyWalletId: "privy-1",
  ownerId: TEST_USER_ID,
  address: "0xabc123abc123abc123abc123abc123abc123abc1",
  chainId: null,
  createdAt: new Date("2025-01-15T12:00:00Z"),
};

function makeTestRuntime(opts?: {
  listWallets?: typeof fakeWallet[];
  getWalletResult?: typeof fakeWallet | null;
  createFail?: boolean;
  signResult?: string;
  signFail?: boolean;
}) {
  // Mock DB for direct queries in wallet routes.
  // GET / uses: db.select().from(wallets).where(eq(...)).orderBy(...)
  // GET /:id uses: db.select().from(wallets).where(and(...))
  // POST /:id/sign uses: db.select().from(wallets).where(and(...))
  const listData = opts?.listWallets ?? [fakeWallet];
  const getResultArray =
    opts?.getWalletResult === null ? [] : [opts?.getWalletResult ?? fakeWallet];

  const selectOrderBy = vi.fn().mockResolvedValue(listData);
  const selectWhere = vi.fn().mockImplementation(() => {
    // Return a thenable that also supports chaining .orderBy()
    const promise = Promise.resolve(getResultArray);
    return Object.assign(promise, { orderBy: selectOrderBy });
  });
  const selectFrom = vi.fn().mockReturnValue({
    where: selectWhere,
    orderBy: selectOrderBy,
  });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: { select: selectFn } as any,
    pool: {} as any,
  });

  const MockWalletServiceLayer = Layer.succeed(WalletService, {
    createUserWallet: () =>
      opts?.createFail
        ? Effect.fail(new WalletError({ message: "Create failed" }))
        : Effect.succeed({
            getAddress: () => Effect.succeed("0xuser1234" as `0x${string}`),
            sign: () => Effect.succeed("0xsig" as `0x${string}`),
            sendTransaction: () => Effect.succeed("0xhash" as `0x${string}`),
          }),
    createServerWallet: () =>
      Effect.succeed({
        getAddress: () => Effect.succeed("0xserver1234" as `0x${string}`),
        sign: () => Effect.succeed("0xsig" as `0x${string}`),
        sendTransaction: () => Effect.succeed("0xhash" as `0x${string}`),
      }),
    createAgentWallet: () =>
      Effect.succeed({
        getAddress: () => Effect.succeed("0xagent1234" as `0x${string}`),
        sign: () => Effect.succeed("0xsig" as `0x${string}`),
        sendTransaction: () => Effect.succeed("0xhash" as `0x${string}`),
      }),
    getWallet: () =>
      Effect.succeed({
        getAddress: () => Effect.succeed("0xresolved" as `0x${string}`),
        sign: () =>
          opts?.signFail
            ? Effect.fail(new WalletError({ message: "Sign failed" }))
            : Effect.succeed((opts?.signResult ?? "0xsig123") as `0x${string}`),
        sendTransaction: () => Effect.succeed("0xhash" as `0x${string}`),
      }),
  });

  const MockResolverLayer = Layer.succeed(WalletResolver, {
    resolve: (_ref) =>
      Effect.succeed({
        getAddress: () => Effect.succeed("0xresolved" as `0x${string}`),
        sign: () =>
          opts?.signFail
            ? Effect.fail(new WalletError({ message: "Sign failed" }))
            : Effect.succeed((opts?.signResult ?? "0xsig123") as `0x${string}`),
        sendTransaction: () => Effect.succeed("0xhash" as `0x${string}`),
      }),
  });

  const testLayer = Layer.mergeAll(
    MockDbLayer,
    MockWalletServiceLayer,
    MockResolverLayer
  );

  return ManagedRuntime.make(testLayer);
}

/**
 * Creates a test Hono app with auth middleware that sets userId,
 * then mounts the wallet routes.
 */
function makeApp(runtime: ReturnType<typeof makeTestRuntime>) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", TEST_USER_ID);
    await next();
  });
  app.route("/", createWalletRoutes(runtime as any));
  return app;
}

describe("Wallet Routes", () => {
  describe("GET /", () => {
    it("should return list of wallets", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      await runtime.dispose();
    });

    it("should return empty array when no wallets exist", async () => {
      const runtime = makeTestRuntime({ listWallets: [] });
      const app = makeApp(runtime);

      const res = await app.request("/");
      const body = await res.json();
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("GET /:id", () => {
    it("should return a wallet by id", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/wallet-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("wallet-1");

      await runtime.dispose();
    });

    it("should return 400 when wallet not found", async () => {
      const runtime = makeTestRuntime({ getWalletResult: null });
      const app = makeApp(runtime);

      const res = await app.request("/nonexistent");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /user", () => {
    it("should create a user wallet and return address", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.address).toBe("0xuser1234");
      expect(body.data.type).toBe("user");

      await runtime.dispose();
    });

    it("should return 400 when creation fails", async () => {
      const runtime = makeTestRuntime({ createFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /:id/sign", () => {
    it("should sign a message and return signature", async () => {
      const runtime = makeTestRuntime({ signResult: "0xmysig" });
      const app = makeApp(runtime);

      const res = await app.request("/wallet-1/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello world" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.signature).toBe("0xmysig");

      await runtime.dispose();
    });

    it("should return 400 when wallet not found for signing", async () => {
      const runtime = makeTestRuntime({ getWalletResult: null });
      const app = makeApp(runtime);

      const res = await app.request("/nonexistent/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });
});
