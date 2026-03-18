import { describe, it, expect, vi } from "vitest";
import { Effect, Layer } from "effect";
import {
  YieldService,
  YieldServiceLive,
  YieldError,
} from "../../../services/yield/yield-service.js";
import { DatabaseService } from "../../../db/client.js";
import {
  TransactionService,
  TransactionError,
} from "../../../services/transaction/transaction-service.js";
import {
  ContractExecutor,
  ContractExecutionError,
} from "../../../services/contract/contract-executor.js";
import { ContractRegistry } from "../../../services/contract/contract-registry.js";
import { WalletService } from "../../../services/wallet/wallet-service.js";
import { ConfigService } from "../../../config.js";
import type {
  YieldVault,
  YieldPosition,
  YieldSnapshot,
  Transaction,
} from "../../../db/schema/index.js";

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

function makeFakeTx(overrides?: Partial<Transaction>): Transaction {
  return {
    id: "tx-1",
    walletId: "wallet-1",
    walletType: "server",
    chainId: "1",
    contractId: null,
    method: "lockWithYield",
    payload: {},
    status: "submitted",
    txHash: "0xhash",
    gasUsed: null,
    categoryId: null,
    userId: null,
    error: null,
    createdAt: now,
    confirmedAt: null,
    ...overrides,
  };
}

function makeMockDb(opts?: {
  insertResult?: unknown[];
  insertThrows?: Error;
  selectResult?: unknown[];
  selectThrows?: Error;
  updateResult?: unknown[];
  updateThrows?: Error;
}) {
  const insertReturning = opts?.insertThrows
    ? vi.fn().mockRejectedValue(opts.insertThrows)
    : vi.fn().mockResolvedValue(opts?.insertResult ?? [makeFakeVault()]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturning = opts?.updateThrows
    ? vi.fn().mockRejectedValue(opts.updateThrows)
    : vi.fn().mockResolvedValue(
        opts?.updateResult ?? [makeFakeVault({ isActive: false })]
      );
  const updateWhere = vi.fn().mockImplementation(() => {
    const promise = opts?.updateThrows
      ? Promise.reject(opts.updateThrows)
      : Promise.resolve([makeFakeVault()]);
    (promise as any).returning = updateReturning;
    return promise;
  });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  const defaultResult = opts?.selectResult ?? [];
  const makeResolvedOrThrown = () =>
    opts?.selectThrows
      ? vi.fn().mockRejectedValue(opts.selectThrows)
      : vi.fn().mockResolvedValue(defaultResult);

  const selectLimit = makeResolvedOrThrown();
  const selectOrderByFromWhere = vi.fn().mockImplementation(() => {
    const promise = opts?.selectThrows
      ? Promise.reject(opts.selectThrows)
      : Promise.resolve(defaultResult);
    (promise as any).limit = selectLimit;
    return promise;
  });
  const selectWhere = vi.fn().mockImplementation(() => {
    const promise = opts?.selectThrows
      ? Promise.reject(opts.selectThrows)
      : Promise.resolve(defaultResult);
    (promise as any).orderBy = selectOrderByFromWhere;
    (promise as any).limit = selectLimit;
    return promise;
  });
  const selectOrderBy = vi.fn().mockReturnValue({
    limit: vi.fn().mockReturnValue({
      offset: makeResolvedOrThrown(),
    }),
  });
  const selectFrom = vi.fn().mockReturnValue({
    where: selectWhere,
    orderBy: selectOrderBy,
  });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  return {
    insert: insertFn,
    update: updateFn,
    select: selectFn,
  };
}

function makeTestLayers(opts?: {
  dbOpts?: Parameters<typeof makeMockDb>[0];
  submitContractFail?: boolean;
  readContractResult?: unknown;
  readContractFail?: boolean;
}) {
  const mockDb = makeMockDb(opts?.dbOpts);

  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: mockDb as any,
    pool: {} as any,
  });

  const MockTxServiceLayer = Layer.succeed(TransactionService, {
    submitContractTransaction: () =>
      opts?.submitContractFail
        ? Effect.fail(new TransactionError({ message: "contract tx failed" }))
        : Effect.succeed(makeFakeTx({ txHash: null })),
    submitRawTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
    getTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
    listTransactions: () => Effect.succeed([makeFakeTx({ txHash: null })]),
  });

  const MockContractExecutorLayer = Layer.succeed(ContractExecutor, {
    execute: () =>
      Effect.succeed({
        txHash: "0xhash" as `0x${string}`,
        contractName: "yield-timelock",
        method: "test",
        chainId: 1,
      }),
    readContract: () =>
      opts?.readContractFail
        ? Effect.fail(
            new ContractExecutionError({ message: "read failed" })
          )
        : Effect.succeed(opts?.readContractResult ?? { depositor: "0x1111" }),
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

  const MockContractRegistryLayer = Layer.succeed(ContractRegistry, {
    register: () => Effect.void,
    get: () => Effect.succeed({} as any),
    list: () => Effect.succeed([]),
    remove: () => Effect.succeed(true),
  });

  const MockWalletServiceLayer = Layer.succeed(WalletService, {
    createUserWallet: () => Effect.succeed({} as any),
    createServerWallet: () => Effect.succeed({} as any),
    createAgentWallet: () => Effect.succeed({} as any),
    getWallet: () => Effect.succeed({
      getAddress: () => Effect.succeed("0x1111" as `0x${string}`),
      sign: () => Effect.succeed("0xsig" as `0x${string}`),
      sendTransaction: () => Effect.succeed("0xhash" as `0x${string}`),
    }),
  });

  return {
    layer: YieldServiceLive.pipe(
      Layer.provide(MockDbLayer),
      Layer.provide(MockTxServiceLayer),
      Layer.provide(MockContractExecutorLayer),
      Layer.provide(MockContractRegistryLayer),
      Layer.provide(MockWalletServiceLayer),
      Layer.provide(MockConfigLayer)
    ),
  };
}

describe("YieldService", () => {
  describe("listVaults", () => {
    it("should list active vaults", async () => {
      const vaults = [makeFakeVault({ id: "v-1" }), makeFakeVault({ id: "v-2" })];
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: vaults },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.listVaults();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });

    it("should return empty array when no vaults", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.listVaults();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });

  describe("getVault", () => {
    it("should return a vault when found", async () => {
      const vault = makeFakeVault();
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: [vault] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.getVault("vault-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeDefined();
      expect(result!.id).toBe("vault-1");
    });

    it("should return undefined when vault not found", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.getVault("nonexistent");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeUndefined();
    });
  });

  describe("addVault", () => {
    it("should create a new vault", async () => {
      const vault = makeFakeVault();
      const { layer } = makeTestLayers({
        dbOpts: { insertResult: [vault] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.addVault({
            vaultAddress: "0x1111111111111111111111111111111111111111",
            chainId: 1,
            name: "Test Vault",
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.id).toBe("vault-1");
      expect(result.name).toBe("Test Vault");
    });

    it("should fail with YieldError when DB insert fails", async () => {
      const { layer } = makeTestLayers({
        dbOpts: { insertThrows: new Error("DB write failed") },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService
            .addVault({
              vaultAddress: "0x1111111111111111111111111111111111111111",
              chainId: 1,
              name: "Test Vault",
            })
            .pipe(
              Effect.matchEffect({
                onSuccess: () => Effect.succeed({ tag: "ok" as const }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(YieldError);
      }
    });
  });

  describe("removeVault", () => {
    it("should deactivate a vault", async () => {
      const deactivated = makeFakeVault({ isActive: false });
      const { layer } = makeTestLayers({
        dbOpts: { updateResult: [deactivated] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.removeVault("vault-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.isActive).toBe(false);
    });
  });

  describe("createPosition", () => {
    it("should create a position after submitting lock transaction", async () => {
      const vault = makeFakeVault();
      const position = makeFakePosition();
      const { layer } = makeTestLayers({
        dbOpts: {
          selectResult: [vault],
          insertResult: [position],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.createPosition({
            userId: "user-1",
            walletId: "wallet-1",
            walletType: "server",
            vaultId: "vault-1",
            amount: "1000000000",
            unlockTime: Math.floor(Date.now() / 1000) + 86400 * 30,
            label: "savings",
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.id).toBe("pos-1");
      expect(result.userId).toBe("user-1");
    });

    it("should fail when vault not found", async () => {
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: [] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService
            .createPosition({
              userId: "user-1",
              walletId: "wallet-1",
              walletType: "server",
              vaultId: "nonexistent",
              amount: "1000000000",
              unlockTime: Math.floor(Date.now() / 1000) + 86400 * 30,
            })
            .pipe(
              Effect.matchEffect({
                onSuccess: () => Effect.succeed({ tag: "ok" as const }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
    });

    it("should fail when vault is inactive", async () => {
      const inactiveVault = makeFakeVault({ isActive: false });
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: [inactiveVault] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService
            .createPosition({
              userId: "user-1",
              walletId: "wallet-1",
              walletType: "server",
              vaultId: "vault-1",
              amount: "1000000000",
              unlockTime: Math.floor(Date.now() / 1000) + 86400 * 30,
            })
            .pipe(
              Effect.matchEffect({
                onSuccess: () => Effect.succeed({ tag: "ok" as const }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
    });

    it("should fail when contract transaction fails", async () => {
      const vault = makeFakeVault();
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: [vault] },
        submitContractFail: true,
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService
            .createPosition({
              userId: "user-1",
              walletId: "wallet-1",
              walletType: "server",
              vaultId: "vault-1",
              amount: "1000000000",
              unlockTime: Math.floor(Date.now() / 1000) + 86400 * 30,
            })
            .pipe(
              Effect.matchEffect({
                onSuccess: () => Effect.succeed({ tag: "ok" as const }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
    });
  });

  describe("getUserPositions", () => {
    it("should list positions for a user", async () => {
      const positions = [
        makeFakePosition({ id: "pos-1" }),
        makeFakePosition({ id: "pos-2" }),
      ];
      // Override to handle the desc orderBy chain
      const mockDb = makeMockDb();
      const selectOrderBy = vi.fn().mockResolvedValue(positions);
      const selectWhere = vi.fn().mockReturnValue({
        orderBy: selectOrderBy,
      });
      const selectFrom = vi.fn().mockReturnValue({
        where: selectWhere,
        orderBy: selectOrderBy,
      });
      mockDb.select = vi.fn().mockReturnValue({ from: selectFrom });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });
      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        submitRawTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        getTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        listTransactions: () => Effect.succeed([makeFakeTx({ txHash: null })]),
      });
      const MockContractExecutorLayer = Layer.succeed(ContractExecutor, {
        execute: () =>
          Effect.succeed({
            txHash: "0xhash" as `0x${string}`,
            contractName: "yield-timelock",
            method: "test",
            chainId: 1,
          }),
        readContract: () => Effect.succeed({ depositor: "0x1111" }),
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

      const MockContractRegistryLayer = Layer.succeed(ContractRegistry, {
        register: () => Effect.void,
        get: () => Effect.succeed({} as any),
        list: () => Effect.succeed([]),
        remove: () => Effect.succeed(true),
      });
      const MockWalletServiceLayer = Layer.succeed(WalletService, {
        createUserWallet: () => Effect.succeed({} as any),
        createServerWallet: () => Effect.succeed({} as any),
        createAgentWallet: () => Effect.succeed({} as any),
        getWallet: () => Effect.succeed({
          getAddress: () => Effect.succeed("0x1111" as `0x${string}`),
          sign: () => Effect.succeed("0xsig" as `0x${string}`),
          sendTransaction: () => Effect.succeed("0xhash" as `0x${string}`),
        }),
      });

      const layer = YieldServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockContractExecutorLayer),
        Layer.provide(MockContractRegistryLayer),
        Layer.provide(MockWalletServiceLayer),
        Layer.provide(MockConfigLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.getUserPositions("user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });

    it("should return empty array when user has no positions", async () => {
      const mockDb = makeMockDb();
      const selectOrderBy = vi.fn().mockResolvedValue([]);
      const selectWhere = vi.fn().mockReturnValue({
        orderBy: selectOrderBy,
      });
      const selectFrom = vi.fn().mockReturnValue({
        where: selectWhere,
        orderBy: selectOrderBy,
      });
      mockDb.select = vi.fn().mockReturnValue({ from: selectFrom });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });
      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        submitRawTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        getTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        listTransactions: () => Effect.succeed([makeFakeTx({ txHash: null })]),
      });
      const MockContractExecutorLayer = Layer.succeed(ContractExecutor, {
        execute: () =>
          Effect.succeed({
            txHash: "0xhash" as `0x${string}`,
            contractName: "yield-timelock",
            method: "test",
            chainId: 1,
          }),
        readContract: () => Effect.succeed({ depositor: "0x1111" }),
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

      const MockContractRegistryLayer = Layer.succeed(ContractRegistry, {
        register: () => Effect.void,
        get: () => Effect.succeed({} as any),
        list: () => Effect.succeed([]),
        remove: () => Effect.succeed(true),
      });
      const MockWalletServiceLayer = Layer.succeed(WalletService, {
        createUserWallet: () => Effect.succeed({} as any),
        createServerWallet: () => Effect.succeed({} as any),
        createAgentWallet: () => Effect.succeed({} as any),
        getWallet: () => Effect.succeed({
          getAddress: () => Effect.succeed("0x1111" as `0x${string}`),
          sign: () => Effect.succeed("0xsig" as `0x${string}`),
          sendTransaction: () => Effect.succeed("0xhash" as `0x${string}`),
        }),
      });

      const layer = YieldServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockContractExecutorLayer),
        Layer.provide(MockContractRegistryLayer),
        Layer.provide(MockWalletServiceLayer),
        Layer.provide(MockConfigLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.getUserPositions("user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });

  describe("getPosition", () => {
    it("should return a position when found", async () => {
      const position = makeFakePosition();
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: [position] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.getPosition("pos-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeDefined();
      expect(result!.id).toBe("pos-1");
    });

    it("should return undefined when position not found", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.getPosition("nonexistent");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeUndefined();
    });
  });

  describe("withdrawPosition", () => {
    it("should withdraw an active position", async () => {
      const position = makeFakePosition({ status: "active" });
      const withdrawn = makeFakePosition({ status: "withdrawn" });
      const { layer } = makeTestLayers({
        dbOpts: {
          selectResult: [position],
          updateResult: [withdrawn],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.withdrawPosition(
            "pos-1",
            "wallet-1",
            "server"
          );
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("withdrawn");
    });

    it("should fail when position not found", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService
            .withdrawPosition("nonexistent", "wallet-1", "server")
            .pipe(
              Effect.matchEffect({
                onSuccess: () => Effect.succeed({ tag: "ok" as const }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
    });

    it("should fail when position already withdrawn", async () => {
      const withdrawn = makeFakePosition({ status: "withdrawn" });
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: [withdrawn] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService
            .withdrawPosition("pos-1", "wallet-1", "server")
            .pipe(
              Effect.matchEffect({
                onSuccess: () => Effect.succeed({ tag: "ok" as const }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
    });
  });

  describe("snapshotYield", () => {
    it("should create a yield snapshot for a position", async () => {
      const position = makeFakePosition();
      const snapshot = makeFakeSnapshot();
      const { layer } = makeTestLayers({
        dbOpts: {
          selectResult: [position],
          insertResult: [snapshot],
        },
        readContractResult: [50000000n, 1050000000n],
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.snapshotYield("pos-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.id).toBe("snap-1");
      expect(result.positionId).toBe("pos-1");
    });

    it("should fail when position not found", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.snapshotYield("nonexistent").pipe(
            Effect.matchEffect({
              onSuccess: () => Effect.succeed({ tag: "ok" as const }),
              onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
            })
          );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
    });

    it("should fail when chain read fails", async () => {
      const position = makeFakePosition();
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: [position] },
        readContractFail: true,
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.snapshotYield("pos-1").pipe(
            Effect.matchEffect({
              onSuccess: () => Effect.succeed({ tag: "ok" as const }),
              onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
            })
          );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
    });
  });

  describe("snapshotAllActivePositions", () => {
    it("should return empty array when no active positions", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.snapshotAllActivePositions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });

    it("should snapshot active positions and tolerate failures", async () => {
      const position = makeFakePosition();
      const snapshot = makeFakeSnapshot();
      const { layer } = makeTestLayers({
        dbOpts: {
          selectResult: [position],
          insertResult: [snapshot],
        },
        readContractResult: [50000000n, 1050000000n],
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.snapshotAllActivePositions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
    });
  });

  describe("getYieldHistory", () => {
    it("should return yield snapshots for a position", async () => {
      const snapshots = [
        makeFakeSnapshot({ id: "snap-1" }),
        makeFakeSnapshot({ id: "snap-2" }),
      ];
      const mockDb = makeMockDb();
      const selectLimit = vi.fn().mockResolvedValue(snapshots);
      const selectOrderBy = vi.fn().mockReturnValue({ limit: selectLimit });
      const selectWhere = vi.fn().mockReturnValue({
        orderBy: selectOrderBy,
      });
      const selectFrom = vi.fn().mockReturnValue({
        where: selectWhere,
        orderBy: selectOrderBy,
      });
      mockDb.select = vi.fn().mockReturnValue({ from: selectFrom });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });
      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        submitRawTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        getTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        listTransactions: () => Effect.succeed([makeFakeTx({ txHash: null })]),
      });
      const MockContractExecutorLayer = Layer.succeed(ContractExecutor, {
        execute: () =>
          Effect.succeed({
            txHash: "0xhash" as `0x${string}`,
            contractName: "yield-timelock",
            method: "test",
            chainId: 1,
          }),
        readContract: () => Effect.succeed({ depositor: "0x1111" }),
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

      const MockContractRegistryLayer = Layer.succeed(ContractRegistry, {
        register: () => Effect.void,
        get: () => Effect.succeed({} as any),
        list: () => Effect.succeed([]),
        remove: () => Effect.succeed(true),
      });
      const MockWalletServiceLayer = Layer.succeed(WalletService, {
        createUserWallet: () => Effect.succeed({} as any),
        createServerWallet: () => Effect.succeed({} as any),
        createAgentWallet: () => Effect.succeed({} as any),
        getWallet: () => Effect.succeed({
          getAddress: () => Effect.succeed("0x1111" as `0x${string}`),
          sign: () => Effect.succeed("0xsig" as `0x${string}`),
          sendTransaction: () => Effect.succeed("0xhash" as `0x${string}`),
        }),
      });

      const layer = YieldServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockContractExecutorLayer),
        Layer.provide(MockContractRegistryLayer),
        Layer.provide(MockWalletServiceLayer),
        Layer.provide(MockConfigLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.getYieldHistory("pos-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });

    it("should return empty array when no snapshots", async () => {
      const mockDb = makeMockDb();
      const selectLimit = vi.fn().mockResolvedValue([]);
      const selectOrderBy = vi.fn().mockReturnValue({ limit: selectLimit });
      const selectWhere = vi.fn().mockReturnValue({
        orderBy: selectOrderBy,
      });
      const selectFrom = vi.fn().mockReturnValue({
        where: selectWhere,
        orderBy: selectOrderBy,
      });
      mockDb.select = vi.fn().mockReturnValue({ from: selectFrom });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });
      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        submitRawTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        getTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        listTransactions: () => Effect.succeed([makeFakeTx({ txHash: null })]),
      });
      const MockContractExecutorLayer = Layer.succeed(ContractExecutor, {
        execute: () =>
          Effect.succeed({
            txHash: "0xhash" as `0x${string}`,
            contractName: "yield-timelock",
            method: "test",
            chainId: 1,
          }),
        readContract: () => Effect.succeed({ depositor: "0x1111" }),
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

      const MockContractRegistryLayer = Layer.succeed(ContractRegistry, {
        register: () => Effect.void,
        get: () => Effect.succeed({} as any),
        list: () => Effect.succeed([]),
        remove: () => Effect.succeed(true),
      });
      const MockWalletServiceLayer = Layer.succeed(WalletService, {
        createUserWallet: () => Effect.succeed({} as any),
        createServerWallet: () => Effect.succeed({} as any),
        createAgentWallet: () => Effect.succeed({} as any),
        getWallet: () => Effect.succeed({
          getAddress: () => Effect.succeed("0x1111" as `0x${string}`),
          sign: () => Effect.succeed("0xsig" as `0x${string}`),
          sendTransaction: () => Effect.succeed("0xhash" as `0x${string}`),
        }),
      });

      const layer = YieldServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockContractExecutorLayer),
        Layer.provide(MockContractRegistryLayer),
        Layer.provide(MockWalletServiceLayer),
        Layer.provide(MockConfigLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.getYieldHistory("pos-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });

  describe("getPortfolioSummary", () => {
    it("should return empty portfolio when user has no positions", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.getPortfolioSummary("user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.positionCount).toBe(0);
      expect(result.totalPrincipal).toBe("0");
      expect(result.totalCurrentValue).toBe("0");
      expect(result.totalYield).toBe("0");
      expect(result.averageApy).toBe("0");
    });
  });

  describe("listAllPositions", () => {
    it("should list all positions with pagination", async () => {
      const positions = [
        makeFakePosition({ id: "pos-1" }),
        makeFakePosition({ id: "pos-2" }),
      ];
      // Need to handle the desc orderBy + limit + offset chain
      const mockDb = makeMockDb();
      const selectOffset = vi.fn().mockResolvedValue(positions);
      const selectLimit = vi.fn().mockReturnValue({ offset: selectOffset });
      const selectOrderBy = vi.fn().mockReturnValue({ limit: selectLimit });
      const selectFrom = vi.fn().mockReturnValue({
        where: vi.fn(),
        orderBy: selectOrderBy,
      });
      mockDb.select = vi.fn().mockReturnValue({ from: selectFrom });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });
      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        submitRawTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        getTransaction: () => Effect.succeed(makeFakeTx({ txHash: null })),
        listTransactions: () => Effect.succeed([makeFakeTx({ txHash: null })]),
      });
      const MockContractExecutorLayer = Layer.succeed(ContractExecutor, {
        execute: () =>
          Effect.succeed({
            txHash: "0xhash" as `0x${string}`,
            contractName: "yield-timelock",
            method: "test",
            chainId: 1,
          }),
        readContract: () => Effect.succeed({ depositor: "0x1111" }),
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

      const MockContractRegistryLayer = Layer.succeed(ContractRegistry, {
        register: () => Effect.void,
        get: () => Effect.succeed({} as any),
        list: () => Effect.succeed([]),
        remove: () => Effect.succeed(true),
      });
      const MockWalletServiceLayer = Layer.succeed(WalletService, {
        createUserWallet: () => Effect.succeed({} as any),
        createServerWallet: () => Effect.succeed({} as any),
        createAgentWallet: () => Effect.succeed({} as any),
        getWallet: () => Effect.succeed({
          getAddress: () => Effect.succeed("0x1111" as `0x${string}`),
          sign: () => Effect.succeed("0xsig" as `0x${string}`),
          sendTransaction: () => Effect.succeed("0xhash" as `0x${string}`),
        }),
      });

      const layer = YieldServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockContractExecutorLayer),
        Layer.provide(MockContractRegistryLayer),
        Layer.provide(MockWalletServiceLayer),
        Layer.provide(MockConfigLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const yieldService = yield* YieldService;
          return yield* yieldService.listAllPositions(50, 0);
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });
  });
});
