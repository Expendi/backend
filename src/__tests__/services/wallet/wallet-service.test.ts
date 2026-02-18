import { describe, it, expect, vi } from "vitest";
import { Effect, Layer } from "effect";
import {
  WalletService,
  WalletError,
  type WalletInstance,
} from "../../../services/wallet/wallet-service.js";
import { WalletServiceLive } from "../../../services/wallet/wallet-service-live.js";
import { PrivyService } from "../../../services/wallet/privy-layer.js";
import { DatabaseService } from "../../../db/client.js";

// Mock Privy client
function makeMockPrivyClient(overrides?: {
  createResult?: { id: string; address: string };
  createThrows?: Error;
  getResult?: { address: string };
  getThrows?: Error;
  rpcResult?: { data: { signature: string; hash: string } };
  rpcThrows?: Error;
}) {
  const createFn = overrides?.createThrows
    ? vi.fn().mockRejectedValue(overrides.createThrows)
    : vi.fn().mockResolvedValue(
        overrides?.createResult ?? {
          id: "privy-wallet-123",
          address: "0xabc123abc123abc123abc123abc123abc123abc1",
        }
      );

  const getFn = overrides?.getThrows
    ? vi.fn().mockRejectedValue(overrides.getThrows)
    : vi.fn().mockResolvedValue(
        overrides?.getResult ?? {
          address: "0xabc123abc123abc123abc123abc123abc123abc1",
        }
      );

  const rpcFn = overrides?.rpcThrows
    ? vi.fn().mockRejectedValue(overrides.rpcThrows)
    : vi.fn().mockResolvedValue(
        overrides?.rpcResult ?? {
          data: {
            signature: "0xsig123",
            hash: "0xhash123hash123hash123hash123hash123hash123hash123hash123hash123hash1",
          },
        }
      );

  return {
    wallets: () => ({
      create: createFn,
      get: getFn,
      rpc: rpcFn,
    }),
    _mocks: { createFn, getFn, rpcFn },
  };
}

// Mock database - must return thenables for drizzle query builders
function makeMockDb(overrides?: {
  insertThrows?: Error;
  selectResult?: unknown[];
}) {
  // For insert: db.insert(table).values(data) needs to be thenable (a Promise)
  const valuesFn = overrides?.insertThrows
    ? vi.fn().mockReturnValue(Promise.reject(overrides.insertThrows))
    : vi.fn().mockReturnValue(Promise.resolve());

  const insertFn = vi.fn().mockReturnValue({ values: valuesFn });

  // For select: db.select({...}).from(table).where(eq).limit(1)
  const limitFn = vi.fn().mockResolvedValue(overrides?.selectResult ?? [{ ownerId: "agent-1" }]);
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn = vi.fn().mockReturnValue({
    where: whereFn,
    orderBy: vi.fn().mockResolvedValue([]),
  });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  return {
    insert: insertFn,
    select: selectFn,
    _mocks: { insertFn, valuesFn, selectFn, limitFn },
  };
}

function makeTestLayers(opts?: {
  privyOverrides?: Parameters<typeof makeMockPrivyClient>[0];
  dbOverrides?: Parameters<typeof makeMockDb>[0];
}) {
  const mockPrivy = makeMockPrivyClient(opts?.privyOverrides);
  const mockDb = makeMockDb(opts?.dbOverrides);

  const MockPrivyLayer = Layer.succeed(PrivyService, {
    client: mockPrivy as any,
  });

  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: mockDb as any,
    pool: {} as any,
  });

  return {
    layer: WalletServiceLive.pipe(
      Layer.provide(MockPrivyLayer),
      Layer.provide(MockDbLayer)
    ),
    mocks: {
      privy: mockPrivy._mocks,
      db: mockDb._mocks,
    },
  };
}

describe("WalletServiceLive", () => {
  describe("createUserWallet", () => {
    it("should create a wallet via Privy and persist it to DB", async () => {
      const { layer, mocks } = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* WalletService;
          const wallet = yield* service.createUserWallet("user-1");
          const address = yield* wallet.getAddress();
          return address;
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBe("0xabc123abc123abc123abc123abc123abc123abc1");
      expect(mocks.privy.createFn).toHaveBeenCalledWith({
        chain_type: "ethereum",
      });
      expect(mocks.db.insertFn).toHaveBeenCalled();
    });

    it("should fail with WalletError when Privy creation fails", async () => {
      const { layer } = makeTestLayers({
        privyOverrides: { createThrows: new Error("Privy down") },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* WalletService;
          return yield* service.createUserWallet("user-1").pipe(
            Effect.matchEffect({
              onSuccess: () => Effect.succeed({ tag: "ok" as const }),
              onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
            })
          );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(WalletError);
        expect((result.e as WalletError).message).toContain("Failed to create user wallet");
      }
    });

    it("should fail with WalletError when DB insert fails", async () => {
      const { layer } = makeTestLayers({
        dbOverrides: { insertThrows: new Error("DB connection lost") },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* WalletService;
          return yield* service.createUserWallet("user-1").pipe(
            Effect.matchEffect({
              onSuccess: () => Effect.succeed({ tag: "ok" as const }),
              onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
            })
          );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(WalletError);
        expect((result.e as WalletError).message).toContain("Failed to persist user wallet");
      }
    });
  });

  describe("createServerWallet", () => {
    it("should create a server wallet with ownerId system", async () => {
      const { layer, mocks } = makeTestLayers();

      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* WalletService;
          const wallet = yield* service.createServerWallet();
          return yield* wallet.getAddress();
        }).pipe(Effect.provide(layer))
      );

      expect(mocks.privy.createFn).toHaveBeenCalled();
      expect(mocks.db.insertFn).toHaveBeenCalled();
    });
  });

  describe("createAgentWallet", () => {
    it("should create an agent wallet with specified agentId", async () => {
      const { layer, mocks } = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* WalletService;
          const wallet = yield* service.createAgentWallet("agent-42");
          return yield* wallet.getAddress();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBe("0xabc123abc123abc123abc123abc123abc123abc1");
      expect(mocks.privy.createFn).toHaveBeenCalled();
    });
  });

  describe("getWallet", () => {
    it("should return a user wallet instance for type user", async () => {
      const { layer } = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* WalletService;
          const wallet = yield* service.getWallet("privy-id-1", "user");
          return yield* wallet.getAddress();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBe("0xabc123abc123abc123abc123abc123abc123abc1");
    });

    it("should return a server wallet instance for type server", async () => {
      const { layer } = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* WalletService;
          const wallet = yield* service.getWallet("privy-id-1", "server");
          return yield* wallet.getAddress();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBe("0xabc123abc123abc123abc123abc123abc123abc1");
    });

    it("should return an agent wallet instance for type agent with DB lookup", async () => {
      const { layer } = makeTestLayers({
        dbOverrides: { selectResult: [{ ownerId: "agent-owner-1" }] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* WalletService;
          const wallet = yield* service.getWallet("privy-id-1", "agent");
          return yield* wallet.getAddress();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBe("0xabc123abc123abc123abc123abc123abc123abc1");
    });

    it("should fail when agent wallet record not found in DB", async () => {
      const { layer } = makeTestLayers({
        dbOverrides: { selectResult: [] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* WalletService;
          return yield* service.getWallet("privy-bad", "agent").pipe(
            Effect.matchEffect({
              onSuccess: () => Effect.succeed({ tag: "ok" as const }),
              onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
            })
          );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(WalletError);
        expect((result.e as WalletError).message).toContain("No wallet record found");
      }
    });
  });
});
