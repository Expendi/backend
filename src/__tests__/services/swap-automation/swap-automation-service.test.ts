import { describe, it, expect, vi } from "vitest";
import { Effect, Layer } from "effect";
import {
  SwapAutomationService,
  SwapAutomationServiceLive,
  SwapAutomationError,
} from "../../../services/swap-automation/swap-automation-service.js";
import { DatabaseService } from "../../../db/client.js";
import {
  TransactionService,
  TransactionError,
} from "../../../services/transaction/transaction-service.js";
import {
  UniswapService,
  UniswapError,
} from "../../../services/uniswap/uniswap-service.js";
import {
  AdapterService,
  AdapterError,
} from "../../../services/adapters/adapter-service.js";
import { WalletService, WalletError } from "../../../services/wallet/wallet-service.js";
import { ConfigService } from "../../../config.js";
import type {
  SwapAutomation,
  SwapAutomationExecution,
  Transaction,
} from "../../../db/schema/index.js";

const now = new Date("2025-01-15T12:00:00Z");

function makeFakeAutomation(
  overrides?: Partial<SwapAutomation>
): SwapAutomation {
  return {
    id: "sa-1",
    userId: "user-1",
    walletId: "wallet-1",
    walletType: "server",
    tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenOut: "0x4200000000000000000000000000000000000006",
    amount: "1000000",
    slippageTolerance: 0.5,
    chainId: 8453,
    indicatorType: "price_above",
    indicatorToken: "ETH",
    thresholdValue: 4000,
    referencePrice: null,
    status: "active",
    maxExecutions: 1,
    maxExecutionsPerDay: null,
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

function makeFakeTx(overrides?: Partial<Transaction>): Transaction {
  return {
    id: "tx-1",
    walletId: "wallet-1",
    walletType: "server",
    chainId: "8453",
    contractId: null,
    method: "swap",
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
    : vi.fn().mockResolvedValue(opts?.insertResult ?? [makeFakeAutomation()]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturning = opts?.updateThrows
    ? vi.fn().mockRejectedValue(opts.updateThrows)
    : vi.fn().mockResolvedValue(
        opts?.updateResult ?? [makeFakeAutomation({ status: "paused" })]
      );
  const updateWhere = vi.fn().mockImplementation(() => {
    const promise = opts?.updateThrows
      ? Promise.reject(opts.updateThrows)
      : Promise.resolve([makeFakeAutomation()]);
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
  submitRawFail?: boolean;
  adapterGetPriceFail?: boolean;
  adapterGetPricesFail?: boolean;
  priceResult?: { symbol: string; price: number };
  pricesResult?: Array<{ symbol: string; price: number }>;
}) {
  const mockDb = makeMockDb(opts?.dbOpts);

  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: mockDb as any,
    pool: {} as any,
  });

  const MockTxServiceLayer = Layer.succeed(TransactionService, {
    submitContractTransaction: () => Effect.succeed(makeFakeTx()),
    submitRawTransaction: () =>
      opts?.submitRawFail
        ? Effect.fail(new TransactionError({ message: "raw tx failed" }))
        : Effect.succeed(makeFakeTx()),
    getTransaction: () => Effect.succeed(makeFakeTx()),
    listTransactions: () => Effect.succeed([makeFakeTx()]),
  });

  const MockUniswapLayer = Layer.succeed(UniswapService, {
    checkApproval: () =>
      Effect.succeed({ approval: null }),
    getQuote: () =>
      Effect.succeed({
        routing: "CLASSIC",
        quote: {
          input: { token: "0xUSC", amount: "1000000" },
          output: { token: "0xWETH", amount: "500000000000000" },
          slippage: 0.5,
          gasFee: "21000",
          gasFeeUSD: "0.05",
          gasUseEstimate: "150000",
        },
      }),
    getSwapTransaction: () =>
      Effect.succeed({
        to: "0xRouter",
        from: "0xWallet",
        data: "0xcalldata",
        value: "0",
        chainId: 8453,
      }),
  });

  const defaultPrice = opts?.priceResult ?? { symbol: "ETH", price: 4100 };
  const MockAdapterLayer = Layer.succeed(AdapterService, {
    getPrice: () =>
      opts?.adapterGetPriceFail
        ? Effect.fail(
            new AdapterError({
              message: "price fetch failed",
              source: "coinmarketcap",
            })
          )
        : Effect.succeed({
            ...defaultPrice,
            percentChange24h: 2.5,
            marketCap: 500000000000,
            volume24h: 20000000000,
            lastUpdated: now.toISOString(),
          }),
    getPrices: () =>
      opts?.adapterGetPricesFail
        ? Effect.fail(
            new AdapterError({
              message: "prices fetch failed",
              source: "coinmarketcap",
            })
          )
        : Effect.succeed(
            (opts?.pricesResult ?? [defaultPrice]).map((p) => ({
              ...p,
              percentChange24h: 2.5,
              marketCap: 500000000000,
              volume24h: 20000000000,
              lastUpdated: now.toISOString(),
            }))
          ),
  });

  const MockWalletServiceLayer = Layer.succeed(WalletService, {
    createUserWallet: () => Effect.succeed({} as any),
    createServerWallet: () => Effect.succeed({} as any),
    createAgentWallet: () => Effect.succeed({} as any),
    getWallet: () =>
      Effect.succeed({
        getAddress: () => Effect.succeed("0xWalletAddress" as `0x${string}`),
        sign: () => Effect.succeed("0xSignature" as `0x${string}`),
        sendTransaction: () => Effect.succeed("0xTxHash" as `0x${string}`),
      }),
  });

  const MockConfigLayer = Layer.succeed(ConfigService, {
    databaseUrl: "postgres://test",
    privyAppId: "test",
    privyAppSecret: "test",
    coinmarketcapApiKey: "test",
    adminApiKey: "test",
    defaultChainId: 8453,
    port: 3000,
  });

  return {
    layer: SwapAutomationServiceLive.pipe(
      Layer.provide(MockDbLayer),
      Layer.provide(MockTxServiceLayer),
      Layer.provide(MockUniswapLayer),
      Layer.provide(MockAdapterLayer),
      Layer.provide(MockWalletServiceLayer),
      Layer.provide(MockConfigLayer)
    ),
  };
}

describe("SwapAutomationService", () => {
  describe("createAutomation", () => {
    it("should create an automation with correct defaults", async () => {
      const { layer } = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.createAutomation({
            userId: "user-1",
            walletId: "wallet-1",
            walletType: "server",
            tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            tokenOut: "0x4200000000000000000000000000000000000006",
            amount: "1000000",
            indicatorType: "price_above",
            indicatorToken: "ETH",
            thresholdValue: 4000,
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.id).toBe("sa-1");
      expect(result.userId).toBe("user-1");
    });

    it("should fetch reference price for percent_change_up indicator", async () => {
      const automationWithRef = makeFakeAutomation({
        indicatorType: "percent_change_up",
        referencePrice: 3500,
      });
      const { layer } = makeTestLayers({
        dbOpts: { insertResult: [automationWithRef] },
        priceResult: { symbol: "ETH", price: 3500 },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.createAutomation({
            userId: "user-1",
            walletId: "wallet-1",
            walletType: "server",
            tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            tokenOut: "0x4200000000000000000000000000000000000006",
            amount: "1000000",
            indicatorType: "percent_change_up",
            indicatorToken: "ETH",
            thresholdValue: 10,
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.indicatorType).toBe("percent_change_up");
      expect(result.referencePrice).toBe(3500);
    });

    it("should fail with SwapAutomationError when DB insert fails", async () => {
      const { layer } = makeTestLayers({
        dbOpts: { insertThrows: new Error("DB write failed") },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service
            .createAutomation({
              userId: "user-1",
              walletId: "wallet-1",
              walletType: "server",
              tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              tokenOut: "0x4200000000000000000000000000000000000006",
              amount: "1000000",
              indicatorType: "price_above",
              indicatorToken: "ETH",
              thresholdValue: 4000,
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
        expect(result.e).toBeInstanceOf(SwapAutomationError);
      }
    });

    it("should fail when adapter price fetch fails for percent_change type", async () => {
      const { layer } = makeTestLayers({
        adapterGetPriceFail: true,
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service
            .createAutomation({
              userId: "user-1",
              walletId: "wallet-1",
              walletType: "server",
              tokenIn: "0xUSDC",
              tokenOut: "0xWETH",
              amount: "1000000",
              indicatorType: "percent_change_down",
              indicatorToken: "ETH",
              thresholdValue: 5,
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

    it("should accept custom maxRetries and chainId", async () => {
      const customAutomation = makeFakeAutomation({
        maxRetries: 10,
        chainId: 1,
      });
      const { layer } = makeTestLayers({
        dbOpts: { insertResult: [customAutomation] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.createAutomation({
            userId: "user-1",
            walletId: "wallet-1",
            walletType: "agent",
            tokenIn: "0xUSDC",
            tokenOut: "0xWETH",
            amount: "1000000",
            indicatorType: "price_above",
            indicatorToken: "ETH",
            thresholdValue: 4000,
            chainId: 1,
            maxRetries: 10,
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.maxRetries).toBe(10);
      expect(result.chainId).toBe(1);
    });
  });

  describe("getAutomation", () => {
    it("should return an automation when found", async () => {
      const automation = makeFakeAutomation();
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: [automation] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.getAutomation("sa-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeDefined();
      expect(result!.id).toBe("sa-1");
    });

    it("should return undefined when automation not found", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.getAutomation("nonexistent");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeUndefined();
    });
  });

  describe("listByUser", () => {
    it("should list automations for a user", async () => {
      const automations = [
        makeFakeAutomation({ id: "sa-1" }),
        makeFakeAutomation({ id: "sa-2" }),
      ];
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: automations },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.listByUser("user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });

    it("should return empty array when user has no automations", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.listByUser("user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });

  describe("pauseAutomation", () => {
    it("should pause an automation", async () => {
      const pausedAutomation = makeFakeAutomation({ status: "paused" });
      const { layer } = makeTestLayers({
        dbOpts: { updateResult: [pausedAutomation] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.pauseAutomation("sa-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("paused");
    });

    it("should fail with SwapAutomationError when DB update fails", async () => {
      const { layer } = makeTestLayers({
        dbOpts: { updateThrows: new Error("DB error") },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.pauseAutomation("sa-1").pipe(
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

  describe("resumeAutomation", () => {
    it("should resume a paused automation", async () => {
      const resumedAutomation = makeFakeAutomation({
        status: "active",
        consecutiveFailures: 0,
      });
      const { layer } = makeTestLayers({
        dbOpts: { updateResult: [resumedAutomation] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.resumeAutomation("sa-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("active");
      expect(result.consecutiveFailures).toBe(0);
    });
  });

  describe("cancelAutomation", () => {
    it("should cancel an automation", async () => {
      const cancelledAutomation = makeFakeAutomation({ status: "cancelled" });
      const { layer } = makeTestLayers({
        dbOpts: { updateResult: [cancelledAutomation] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.cancelAutomation("sa-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("cancelled");
    });
  });

  describe("updateAutomation", () => {
    it("should update automation fields", async () => {
      const updatedAutomation = makeFakeAutomation({
        thresholdValue: 5000,
        amount: "2000000",
      });
      const { layer } = makeTestLayers({
        dbOpts: { updateResult: [updatedAutomation] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.updateAutomation("sa-1", {
            thresholdValue: 5000,
            amount: "2000000",
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.thresholdValue).toBe(5000);
      expect(result.amount).toBe("2000000");
    });
  });

  describe("getExecutionHistory", () => {
    it("should return execution history for an automation", async () => {
      const executions = [
        makeFakeExecution({ id: "exec-1" }),
        makeFakeExecution({ id: "exec-2" }),
      ];
      const mockDb = makeMockDb();
      const selectLimit = vi.fn().mockResolvedValue(executions);
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
        submitContractTransaction: () => Effect.succeed(makeFakeTx()),
        submitRawTransaction: () => Effect.succeed(makeFakeTx()),
        getTransaction: () => Effect.succeed(makeFakeTx()),
        listTransactions: () => Effect.succeed([makeFakeTx()]),
      });
      const MockUniswapLayer = Layer.succeed(UniswapService, {
        checkApproval: () => Effect.succeed({ approval: null }),
        getQuote: () => Effect.succeed({} as any),
        getSwapTransaction: () => Effect.succeed({} as any),
      });
      const MockAdapterLayer = Layer.succeed(AdapterService, {
        getPrice: () => Effect.succeed({} as any),
        getPrices: () => Effect.succeed([]),
      });
      const MockWalletServiceLayer = Layer.succeed(WalletService, {
        createUserWallet: () => Effect.succeed({} as any),
        createServerWallet: () => Effect.succeed({} as any),
        createAgentWallet: () => Effect.succeed({} as any),
        getWallet: () => Effect.succeed({} as any),
      });
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 8453,
        port: 3000,
      });

      const layer = SwapAutomationServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockUniswapLayer),
        Layer.provide(MockAdapterLayer),
        Layer.provide(MockWalletServiceLayer),
        Layer.provide(MockConfigLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.getExecutionHistory("sa-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });

    it("should return empty array when no executions", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.getExecutionHistory("sa-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });

  describe("processDueAutomations", () => {
    it("should return empty array when no active automations", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.processDueAutomations();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });

    it("should process due automation when condition is met", async () => {
      const dueAutomation = makeFakeAutomation({
        status: "active",
        indicatorType: "price_above",
        thresholdValue: 4000,
        lastCheckedAt: null,
      });
      const mockDb = makeMockDb({
        selectResult: [dueAutomation],
        insertResult: [makeFakeExecution()],
      });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });
      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction: () => Effect.succeed(makeFakeTx()),
        submitRawTransaction: () => Effect.succeed(makeFakeTx()),
        getTransaction: () => Effect.succeed(makeFakeTx()),
        listTransactions: () => Effect.succeed([makeFakeTx()]),
      });
      const MockUniswapLayer = Layer.succeed(UniswapService, {
        checkApproval: () => Effect.succeed({ approval: null }),
        getQuote: () =>
          Effect.succeed({
            routing: "CLASSIC",
            quote: {
              input: { token: "0xUSC", amount: "1000000" },
              output: { token: "0xWETH", amount: "500000000000000" },
              slippage: 0.5,
              gasFee: "21000",
              gasFeeUSD: "0.05",
              gasUseEstimate: "150000",
            },
          }),
        getSwapTransaction: () =>
          Effect.succeed({
            to: "0xRouter",
            from: "0xWallet",
            data: "0xcalldata",
            value: "0",
            chainId: 8453,
          }),
      });
      const MockAdapterLayer = Layer.succeed(AdapterService, {
        getPrice: () =>
          Effect.succeed({
            symbol: "ETH",
            price: 4100,
            percentChange24h: 2.5,
            marketCap: 500000000000,
            volume24h: 20000000000,
            lastUpdated: now.toISOString(),
          }),
        getPrices: () =>
          Effect.succeed([
            {
              symbol: "ETH",
              price: 4100,
              percentChange24h: 2.5,
              marketCap: 500000000000,
              volume24h: 20000000000,
              lastUpdated: now.toISOString(),
            },
          ]),
      });
      const MockWalletServiceLayer = Layer.succeed(WalletService, {
        createUserWallet: () => Effect.succeed({} as any),
        createServerWallet: () => Effect.succeed({} as any),
        createAgentWallet: () => Effect.succeed({} as any),
        getWallet: () =>
          Effect.succeed({
            getAddress: () =>
              Effect.succeed("0xWalletAddress" as `0x${string}`),
            sign: () => Effect.succeed("0xSig" as `0x${string}`),
            sendTransaction: () => Effect.succeed("0xTxH" as `0x${string}`),
          }),
      });
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 8453,
        port: 3000,
      });

      const layer = SwapAutomationServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockUniswapLayer),
        Layer.provide(MockAdapterLayer),
        Layer.provide(MockWalletServiceLayer),
        Layer.provide(MockConfigLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.processDueAutomations();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe("success");
    });

    it("should skip automation when condition is not met", async () => {
      // price_above 5000, but current price is 4100 → condition not met
      const dueAutomation = makeFakeAutomation({
        status: "active",
        indicatorType: "price_above",
        thresholdValue: 5000,
        lastCheckedAt: null,
      });

      const { layer } = makeTestLayers({
        dbOpts: { selectResult: [dueAutomation] },
        pricesResult: [{ symbol: "ETH", price: 4100 }],
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.processDueAutomations();
        }).pipe(Effect.provide(layer))
      );

      // No executions should be recorded — condition wasn't met
      expect(result).toEqual([]);
    });

    it("should skip automation when daily execution limit is reached", async () => {
      // Automation with maxExecutionsPerDay = 2, condition is met, but already hit 2 today
      const dueAutomation = makeFakeAutomation({
        status: "active",
        indicatorType: "price_above",
        thresholdValue: 4000,
        maxExecutions: 100,
        maxExecutionsPerDay: 2,
        lastCheckedAt: null,
      });

      // Mock DB: select returns active automations, but the count query returns 2
      const mockDb = makeMockDb({
        selectResult: [dueAutomation],
        insertResult: [makeFakeExecution()],
      });

      // Override select to handle both the active automations query and the count query
      let selectCallCount = 0;
      const originalSelect = mockDb.select;
      mockDb.select = vi.fn().mockImplementation((...args: unknown[]) => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // First call: fetch active automations
          return originalSelect(...args);
        }
        // Second call: count today's executions — return count = 2 (at daily limit)
        const countResult = [{ count: 2 }];
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(countResult),
          }),
        };
      });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });
      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction: () => Effect.succeed(makeFakeTx()),
        submitRawTransaction: () => Effect.succeed(makeFakeTx()),
        getTransaction: () => Effect.succeed(makeFakeTx()),
        listTransactions: () => Effect.succeed([makeFakeTx()]),
      });
      const MockUniswapLayer = Layer.succeed(UniswapService, {
        checkApproval: () => Effect.succeed({ approval: null }),
        getQuote: () => Effect.succeed({} as any),
        getSwapTransaction: () => Effect.succeed({} as any),
      });
      const MockAdapterLayer = Layer.succeed(AdapterService, {
        getPrice: () => Effect.succeed({} as any),
        getPrices: () =>
          Effect.succeed([
            {
              symbol: "ETH",
              price: 4100,
              percentChange24h: 2.5,
              marketCap: 500000000000,
              volume24h: 20000000000,
              lastUpdated: now.toISOString(),
            },
          ]),
      });
      const MockWalletServiceLayer = Layer.succeed(WalletService, {
        createUserWallet: () => Effect.succeed({} as any),
        createServerWallet: () => Effect.succeed({} as any),
        createAgentWallet: () => Effect.succeed({} as any),
        getWallet: () => Effect.succeed({} as any),
      });
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 8453,
        port: 3000,
      });

      const layer = SwapAutomationServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockUniswapLayer),
        Layer.provide(MockAdapterLayer),
        Layer.provide(MockWalletServiceLayer),
        Layer.provide(MockConfigLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.processDueAutomations();
        }).pipe(Effect.provide(layer))
      );

      // No executions — daily limit was reached
      expect(result).toEqual([]);
    });

    it("should execute automation when daily limit is not yet reached", async () => {
      // Automation with maxExecutionsPerDay = 3, condition is met, only 1 execution today
      const dueAutomation = makeFakeAutomation({
        status: "active",
        indicatorType: "price_above",
        thresholdValue: 4000,
        maxExecutions: 100,
        maxExecutionsPerDay: 3,
        lastCheckedAt: null,
      });

      const mockDb = makeMockDb({
        selectResult: [dueAutomation],
        insertResult: [makeFakeExecution()],
      });

      let selectCallCount = 0;
      const originalSelect = mockDb.select;
      mockDb.select = vi.fn().mockImplementation((...args: unknown[]) => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return originalSelect(...args);
        }
        // Count query returns 1 (below daily limit of 3)
        const countResult = [{ count: 1 }];
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(countResult),
          }),
        };
      });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });
      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction: () => Effect.succeed(makeFakeTx()),
        submitRawTransaction: () => Effect.succeed(makeFakeTx()),
        getTransaction: () => Effect.succeed(makeFakeTx()),
        listTransactions: () => Effect.succeed([makeFakeTx()]),
      });
      const MockUniswapLayer = Layer.succeed(UniswapService, {
        checkApproval: () => Effect.succeed({ approval: null }),
        getQuote: () =>
          Effect.succeed({
            routing: "CLASSIC",
            quote: {
              input: { token: "0xUSC", amount: "1000000" },
              output: { token: "0xWETH", amount: "500000000000000" },
              slippage: 0.5,
              gasFee: "21000",
              gasFeeUSD: "0.05",
              gasUseEstimate: "150000",
            },
          }),
        getSwapTransaction: () =>
          Effect.succeed({
            to: "0xRouter",
            from: "0xWallet",
            data: "0xcalldata",
            value: "0",
            chainId: 8453,
          }),
      });
      const MockAdapterLayer = Layer.succeed(AdapterService, {
        getPrice: () => Effect.succeed({} as any),
        getPrices: () =>
          Effect.succeed([
            {
              symbol: "ETH",
              price: 4100,
              percentChange24h: 2.5,
              marketCap: 500000000000,
              volume24h: 20000000000,
              lastUpdated: now.toISOString(),
            },
          ]),
      });
      const MockWalletServiceLayer = Layer.succeed(WalletService, {
        createUserWallet: () => Effect.succeed({} as any),
        createServerWallet: () => Effect.succeed({} as any),
        createAgentWallet: () => Effect.succeed({} as any),
        getWallet: () =>
          Effect.succeed({
            getAddress: () =>
              Effect.succeed("0xWalletAddress" as `0x${string}`),
            sign: () => Effect.succeed("0xSig" as `0x${string}`),
            sendTransaction: () => Effect.succeed("0xTxH" as `0x${string}`),
          }),
      });
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 8453,
        port: 3000,
      });

      const layer = SwapAutomationServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockUniswapLayer),
        Layer.provide(MockAdapterLayer),
        Layer.provide(MockWalletServiceLayer),
        Layer.provide(MockConfigLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.processDueAutomations();
        }).pipe(Effect.provide(layer))
      );

      // Should execute since daily limit not reached
      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe("success");
    });

    it("should not check daily limit when maxExecutionsPerDay is null", async () => {
      // Automation without daily limit (maxExecutionsPerDay = null) — should execute normally
      const dueAutomation = makeFakeAutomation({
        status: "active",
        indicatorType: "price_above",
        thresholdValue: 4000,
        maxExecutions: 100,
        maxExecutionsPerDay: null,
        lastCheckedAt: null,
      });
      const mockDb = makeMockDb({
        selectResult: [dueAutomation],
        insertResult: [makeFakeExecution()],
      });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });
      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction: () => Effect.succeed(makeFakeTx()),
        submitRawTransaction: () => Effect.succeed(makeFakeTx()),
        getTransaction: () => Effect.succeed(makeFakeTx()),
        listTransactions: () => Effect.succeed([makeFakeTx()]),
      });
      const MockUniswapLayer = Layer.succeed(UniswapService, {
        checkApproval: () => Effect.succeed({ approval: null }),
        getQuote: () =>
          Effect.succeed({
            routing: "CLASSIC",
            quote: {
              input: { token: "0xUSC", amount: "1000000" },
              output: { token: "0xWETH", amount: "500000000000000" },
              slippage: 0.5,
              gasFee: "21000",
              gasFeeUSD: "0.05",
              gasUseEstimate: "150000",
            },
          }),
        getSwapTransaction: () =>
          Effect.succeed({
            to: "0xRouter",
            from: "0xWallet",
            data: "0xcalldata",
            value: "0",
            chainId: 8453,
          }),
      });
      const MockAdapterLayer = Layer.succeed(AdapterService, {
        getPrice: () => Effect.succeed({} as any),
        getPrices: () =>
          Effect.succeed([
            {
              symbol: "ETH",
              price: 4100,
              percentChange24h: 2.5,
              marketCap: 500000000000,
              volume24h: 20000000000,
              lastUpdated: now.toISOString(),
            },
          ]),
      });
      const MockWalletServiceLayer = Layer.succeed(WalletService, {
        createUserWallet: () => Effect.succeed({} as any),
        createServerWallet: () => Effect.succeed({} as any),
        createAgentWallet: () => Effect.succeed({} as any),
        getWallet: () =>
          Effect.succeed({
            getAddress: () =>
              Effect.succeed("0xWalletAddress" as `0x${string}`),
            sign: () => Effect.succeed("0xSig" as `0x${string}`),
            sendTransaction: () => Effect.succeed("0xTxH" as `0x${string}`),
          }),
      });
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 8453,
        port: 3000,
      });

      const layer = SwapAutomationServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockUniswapLayer),
        Layer.provide(MockAdapterLayer),
        Layer.provide(MockWalletServiceLayer),
        Layer.provide(MockConfigLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.processDueAutomations();
        }).pipe(Effect.provide(layer))
      );

      // Should execute normally — no daily limit set
      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe("success");
    });

    it("should skip automation still in cooldown", async () => {
      const recentlyChecked = makeFakeAutomation({
        status: "active",
        cooldownSeconds: 300,
        lastCheckedAt: new Date(), // just checked
      });
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: [recentlyChecked] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SwapAutomationService;
          return yield* service.processDueAutomations();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });
});
