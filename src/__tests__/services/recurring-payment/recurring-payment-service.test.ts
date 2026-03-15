import { describe, it, expect, vi } from "vitest";
import { Effect, Layer } from "effect";
import {
  RecurringPaymentService,
  RecurringPaymentServiceLive,
  RecurringPaymentError,
} from "../../../services/recurring-payment/recurring-payment-service.js";
import { DatabaseService } from "../../../db/client.js";
import {
  TransactionService,
  TransactionError,
} from "../../../services/transaction/transaction-service.js";
import { ConfigService } from "../../../config.js";
import { OfframpAdapterRegistryLive } from "../../../services/offramp/index.js";
import {
  PretiumService,
  PretiumError,
  SETTLEMENT_ADDRESS,
  SUPPORTED_COUNTRIES,
} from "../../../services/pretium/pretium-service.js";
import { ExchangeRateService } from "../../../services/pretium/exchange-rate-service.js";
import type {
  RecurringPayment,
  RecurringPaymentExecution,
  Transaction,
} from "../../../db/schema/index.js";

const now = new Date("2025-01-15T12:00:00Z");

function makeFakeSchedule(
  overrides?: Partial<RecurringPayment>
): RecurringPayment {
  return {
    id: "rp-1",
    userId: "user-1",
    walletId: "wallet-1",
    walletType: "server",
    recipientAddress: "0x0000000000000000000000000000000000000001",
    paymentType: "raw_transfer",
    amount: "1000000000000000000",
    tokenContractName: null,
    contractName: null,
    contractMethod: null,
    contractArgs: null,
    chainId: 1,
    frequency: "1d",
    status: "active",
    startDate: now,
    endDate: null,
    nextExecutionAt: new Date(Date.now() - 60000), // due
    maxRetries: 3,
    consecutiveFailures: 0,
    totalExecutions: 0,
    isOfframp: false,
    offrampCurrency: null,
    offrampFiatAmount: null,
    offrampProvider: null,
    offrampDestinationId: null,
    offrampMetadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeExecution(
  overrides?: Partial<RecurringPaymentExecution>
): RecurringPaymentExecution {
  return {
    id: "exec-1",
    scheduleId: "rp-1",
    transactionId: "tx-1",
    status: "success",
    error: null,
    executedAt: now,
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
    method: "raw_transfer",
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
  // insert: db.insert(table).values(data).returning()
  const insertReturning = opts?.insertThrows
    ? vi.fn().mockRejectedValue(opts.insertThrows)
    : vi.fn().mockResolvedValue(opts?.insertResult ?? [makeFakeSchedule()]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  // update: db.update(table).set(data).where(eq).returning()
  const updateReturning = opts?.updateThrows
    ? vi.fn().mockRejectedValue(opts.updateThrows)
    : vi.fn().mockResolvedValue(
        opts?.updateResult ?? [makeFakeSchedule({ status: "paused" })]
      );
  const updateWhere = vi.fn().mockImplementation(() => {
    const promise = opts?.updateThrows
      ? Promise.reject(opts.updateThrows)
      : Promise.resolve([makeFakeSchedule()]);
    (promise as any).returning = updateReturning;
    return promise;
  });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  // select: supports multiple chaining patterns:
  // .where(eq) -> resolves directly (getSchedule)
  // .where(eq).orderBy(col) -> resolves (listSchedulesByUser)
  // .where(eq).orderBy(col).limit(n) -> resolves (getExecutionHistory)
  // .orderBy(col).limit(n).offset(n) -> resolves (listAllSchedules)
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
  submitContractFail?: boolean;
  submitRawFail?: boolean;
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
        : Effect.succeed(makeFakeTx()),
    submitRawTransaction: () =>
      opts?.submitRawFail
        ? Effect.fail(new TransactionError({ message: "raw tx failed" }))
        : Effect.succeed(makeFakeTx()),
    getTransaction: () => Effect.succeed(makeFakeTx()),
    listTransactions: () => Effect.succeed([makeFakeTx()]),
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

  const MockPretiumLayer = Layer.succeed(PretiumService, {
    disburse: () => Effect.succeed({} as any),
    getTransactionStatus: () => Effect.succeed({} as any),
    validatePhoneWithMno: () => Effect.succeed({} as any),
    validateBankAccount: () => Effect.succeed({} as any),
  } as any);

  const MockExchangeRateLayer = Layer.succeed(ExchangeRateService, {
    getExchangeRate: () => Effect.succeed({} as any),
    convertUsdcToFiat: () => Effect.succeed({} as any),
    convertFiatToUsdc: () => Effect.succeed({} as any),
    clearCache: () => Effect.succeed(undefined),
  });

  return {
    layer: RecurringPaymentServiceLive.pipe(
      Layer.provide(MockDbLayer),
      Layer.provide(MockTxServiceLayer),
      Layer.provide(MockConfigLayer),
      Layer.provide(OfframpAdapterRegistryLive),
      Layer.provide(MockPretiumLayer),
      Layer.provide(MockExchangeRateLayer)
    ),
  };
}

describe("RecurringPaymentService", () => {
  describe("createSchedule", () => {
    it("should create a schedule with correct defaults", async () => {
      const { layer } = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.createSchedule({
            userId: "user-1",
            walletId: "wallet-1",
            walletType: "server",
            recipientAddress: "0x0000000000000000000000000000000000000001",
            paymentType: "raw_transfer",
            amount: "1000000000000000000",
            frequency: "1d",
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.id).toBe("rp-1");
      expect(result.userId).toBe("user-1");
    });

    it("should fail with RecurringPaymentError when DB insert fails", async () => {
      const { layer } = makeTestLayers({
        dbOpts: { insertThrows: new Error("DB write failed") },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService
            .createSchedule({
              userId: "user-1",
              walletId: "wallet-1",
              walletType: "server",
              recipientAddress: "0x0000000000000000000000000000000000000001",
              paymentType: "raw_transfer",
              amount: "1000000000000000000",
              frequency: "1d",
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
        expect(result.e).toBeInstanceOf(RecurringPaymentError);
      }
    });

    it("should accept custom maxRetries and chainId", async () => {
      const customSchedule = makeFakeSchedule({
        maxRetries: 10,
        chainId: 137,
      });
      const { layer } = makeTestLayers({
        dbOpts: { insertResult: [customSchedule] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.createSchedule({
            userId: "user-1",
            walletId: "wallet-1",
            walletType: "server",
            recipientAddress: "0x0000000000000000000000000000000000000001",
            paymentType: "raw_transfer",
            amount: "1000000000000000000",
            frequency: "1d",
            chainId: 137,
            maxRetries: 10,
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.maxRetries).toBe(10);
      expect(result.chainId).toBe(137);
    });
  });

  describe("getSchedule", () => {
    it("should return a schedule when found", async () => {
      const schedule = makeFakeSchedule();
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: [schedule] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.getSchedule("rp-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeDefined();
      expect(result!.id).toBe("rp-1");
    });

    it("should return undefined when schedule not found", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.getSchedule("nonexistent");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeUndefined();
    });
  });

  describe("listSchedulesByUser", () => {
    it("should list schedules for a user", async () => {
      const schedules = [
        makeFakeSchedule({ id: "rp-1" }),
        makeFakeSchedule({ id: "rp-2" }),
      ];
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: schedules },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.listSchedulesByUser("user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });

    it("should return empty array when user has no schedules", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.listSchedulesByUser("user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });

  describe("pauseSchedule", () => {
    it("should pause a schedule", async () => {
      const pausedSchedule = makeFakeSchedule({ status: "paused" });
      const { layer } = makeTestLayers({
        dbOpts: { updateResult: [pausedSchedule] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.pauseSchedule("rp-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("paused");
    });

    it("should fail with RecurringPaymentError when DB update fails", async () => {
      const { layer } = makeTestLayers({
        dbOpts: { updateThrows: new Error("DB error") },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.pauseSchedule("rp-1").pipe(
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

  describe("resumeSchedule", () => {
    it("should resume a paused schedule", async () => {
      const pausedSchedule = makeFakeSchedule({ status: "paused" });
      const resumedSchedule = makeFakeSchedule({
        status: "active",
        consecutiveFailures: 0,
      });
      const { layer } = makeTestLayers({
        dbOpts: {
          selectResult: [pausedSchedule],
          updateResult: [resumedSchedule],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.resumeSchedule("rp-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("active");
      expect(result.consecutiveFailures).toBe(0);
    });

    it("should fail when schedule not found", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.resumeSchedule("nonexistent").pipe(
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

  describe("cancelSchedule", () => {
    it("should cancel a schedule", async () => {
      const cancelledSchedule = makeFakeSchedule({ status: "cancelled" });
      const { layer } = makeTestLayers({
        dbOpts: { updateResult: [cancelledSchedule] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.cancelSchedule("rp-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("cancelled");
    });
  });

  describe("getExecutionHistory", () => {
    it("should return execution history for a schedule", async () => {
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
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 1,
        port: 3000,
      });

      const layer = RecurringPaymentServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockConfigLayer),
        Layer.provide(OfframpAdapterRegistryLive),
        Layer.provide(Layer.succeed(PretiumService, { disburse: () => Effect.succeed({} as any), getTransactionStatus: () => Effect.succeed({} as any), validatePhoneWithMno: () => Effect.succeed({} as any), validateBankAccount: () => Effect.succeed({} as any) } as any)),
        Layer.provide(Layer.succeed(ExchangeRateService, { getExchangeRate: () => Effect.succeed({} as any), convertUsdcToFiat: () => Effect.succeed({} as any), convertFiatToUsdc: () => Effect.succeed({} as any), clearCache: () => Effect.succeed(undefined) }))
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.getExecutionHistory("rp-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });

    it("should return empty array when no executions", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.getExecutionHistory("rp-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });

  describe("processDuePayments", () => {
    it("should return empty array when no due schedules", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.processDuePayments();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });

    it("should process due raw_transfer schedules", async () => {
      const dueSchedule = makeFakeSchedule({
        paymentType: "raw_transfer",
        status: "active",
      });
      // First select returns the due schedules, then subsequent selects for updates
      const mockDb = makeMockDb({
        selectResult: [dueSchedule],
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
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 1,
        port: 3000,
      });

      const layer = RecurringPaymentServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockConfigLayer),
        Layer.provide(OfframpAdapterRegistryLive),
        Layer.provide(Layer.succeed(PretiumService, { disburse: () => Effect.succeed({} as any), getTransactionStatus: () => Effect.succeed({} as any), validatePhoneWithMno: () => Effect.succeed({} as any), validateBankAccount: () => Effect.succeed({} as any) } as any)),
        Layer.provide(Layer.succeed(ExchangeRateService, { getExchangeRate: () => Effect.succeed({} as any), convertUsdcToFiat: () => Effect.succeed({} as any), convertFiatToUsdc: () => Effect.succeed({} as any), clearCache: () => Effect.succeed(undefined) }))
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.processDuePayments();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe("success");
    });

    it("should process due erc20_transfer schedules", async () => {
      const dueSchedule = makeFakeSchedule({
        paymentType: "erc20_transfer",
        tokenContractName: "USDC",
        status: "active",
      });

      const mockDb = makeMockDb({
        selectResult: [dueSchedule],
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
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 1,
        port: 3000,
      });

      const layer = RecurringPaymentServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockConfigLayer),
        Layer.provide(OfframpAdapterRegistryLive),
        Layer.provide(Layer.succeed(PretiumService, { disburse: () => Effect.succeed({} as any), getTransactionStatus: () => Effect.succeed({} as any), validatePhoneWithMno: () => Effect.succeed({} as any), validateBankAccount: () => Effect.succeed({} as any) } as any)),
        Layer.provide(Layer.succeed(ExchangeRateService, { getExchangeRate: () => Effect.succeed({} as any), convertUsdcToFiat: () => Effect.succeed({} as any), convertFiatToUsdc: () => Effect.succeed({} as any), clearCache: () => Effect.succeed(undefined) }))
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.processDuePayments();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
    });

    it("should record failed execution when transaction fails", async () => {
      const dueSchedule = makeFakeSchedule({
        paymentType: "raw_transfer",
        status: "active",
      });
      const failedExecution = makeFakeExecution({
        status: "failed",
        error: "raw tx failed",
      });

      const mockDb = makeMockDb({
        selectResult: [dueSchedule],
        insertResult: [failedExecution],
      });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });
      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction: () =>
          Effect.fail(new TransactionError({ message: "contract tx failed" })),
        submitRawTransaction: () =>
          Effect.fail(new TransactionError({ message: "raw tx failed" })),
        getTransaction: () => Effect.succeed(makeFakeTx()),
        listTransactions: () => Effect.succeed([makeFakeTx()]),
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

      const layer = RecurringPaymentServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockConfigLayer),
        Layer.provide(OfframpAdapterRegistryLive),
        Layer.provide(Layer.succeed(PretiumService, { disburse: () => Effect.succeed({} as any), getTransactionStatus: () => Effect.succeed({} as any), validatePhoneWithMno: () => Effect.succeed({} as any), validateBankAccount: () => Effect.succeed({} as any) } as any)),
        Layer.provide(Layer.succeed(ExchangeRateService, { getExchangeRate: () => Effect.succeed({} as any), convertUsdcToFiat: () => Effect.succeed({} as any), convertFiatToUsdc: () => Effect.succeed({} as any), clearCache: () => Effect.succeed(undefined) }))
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.processDuePayments();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe("failed");
    });

    it("should process Pretium offramp schedule with USDC-denominated amount", async () => {
      const dueSchedule = makeFakeSchedule({
        paymentType: "offramp",
        isOfframp: true,
        offrampProvider: "pretium",
        tokenContractName: "usdc",
        amount: "10",
        offrampMetadata: {
          country: "KE",
          phoneNumber: "254712345678",
          mobileNetwork: "Safaricom",
        },
      });

      const mockDb = makeMockDb({
        selectResult: [dueSchedule],
        insertResult: [makeFakeExecution()],
      });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });

      const submitContractTransaction = vi.fn().mockReturnValue(
        Effect.succeed(makeFakeTx({ txHash: "0xofframphash" }))
      );
      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction,
        submitRawTransaction: () => Effect.succeed(makeFakeTx()),
        getTransaction: () => Effect.succeed(makeFakeTx()),
        listTransactions: () => Effect.succeed([makeFakeTx()]),
      });
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 1,
        port: 3000,
        serverBaseUrl: "http://localhost:3000",
      } as any);

      const convertUsdcToFiat = vi.fn().mockReturnValue(
        Effect.succeed({ amount: 1292.5, exchangeRate: 129.25 })
      );
      const disburseMock = vi.fn().mockReturnValue(
        Effect.succeed({
          data: {
            transaction_code: "TXN123",
            status: "pending",
          },
        })
      );

      const MockPretiumLayer = Layer.succeed(PretiumService, {
        disburse: disburseMock,
        getTransactionStatus: () => Effect.succeed({} as any),
        validatePhoneWithMno: () => Effect.succeed({} as any),
        validateBankAccount: () => Effect.succeed({} as any),
        getSupportedCountries: () => SUPPORTED_COUNTRIES,
        getSettlementAddress: () => SETTLEMENT_ADDRESS,
        getCountryPaymentConfig: () => undefined,
        isCountrySupported: () => true,
      } as any);
      const MockExchangeRateLayer = Layer.succeed(ExchangeRateService, {
        getExchangeRate: () => Effect.succeed({} as any),
        convertUsdcToFiat,
        convertFiatToUsdc: () => Effect.succeed({} as any),
        clearCache: () => Effect.succeed(undefined),
      });

      const layer = RecurringPaymentServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockConfigLayer),
        Layer.provide(OfframpAdapterRegistryLive),
        Layer.provide(MockPretiumLayer),
        Layer.provide(MockExchangeRateLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.processDuePayments();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe("success");
      // Should have called convertUsdcToFiat (not convertFiatToUsdc)
      expect(convertUsdcToFiat).toHaveBeenCalledWith(10, "KES");
      // Should have called submitContractTransaction to send USDC to settlement
      expect(submitContractTransaction).toHaveBeenCalled();
      const txCallArgs = submitContractTransaction.mock.calls[0][0];
      expect(txCallArgs.method).toBe("send");
      expect(txCallArgs.args[0]).toBe(SETTLEMENT_ADDRESS);
      // Should have called pretium.disburse with converted fiat amount
      expect(disburseMock).toHaveBeenCalled();
      const disburseArgs = disburseMock.mock.calls[0][0];
      expect(disburseArgs.country).toBe("KE");
      expect(disburseArgs.amount).toBe(1292.5);
      expect(disburseArgs.phoneNumber).toBe("254712345678");
      expect(disburseArgs.mobileNetwork).toBe("Safaricom");
      // Should have updated offrampMetadata via db.update
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("should process Pretium offramp schedule with fiat-denominated amount", async () => {
      const dueSchedule = makeFakeSchedule({
        paymentType: "offramp",
        isOfframp: true,
        offrampProvider: "pretium",
        tokenContractName: "usdc",
        amount: "0",
        offrampFiatAmount: "12925",
        offrampMetadata: {
          country: "KE",
          phoneNumber: "254712345678",
          mobileNetwork: "Safaricom",
          amountInFiat: true,
        },
      });

      const mockDb = makeMockDb({
        selectResult: [dueSchedule],
        insertResult: [makeFakeExecution()],
      });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });

      const convertFiatToUsdc = vi.fn().mockReturnValue(
        Effect.succeed({ amount: 100, exchangeRate: 129.25 })
      );
      const disburseMock = vi.fn().mockReturnValue(
        Effect.succeed({
          data: {
            transaction_code: "TXN456",
            status: "pending",
          },
        })
      );
      const submitContractTransaction = vi.fn().mockReturnValue(
        Effect.succeed(makeFakeTx({ txHash: "0xfiathash" }))
      );

      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction,
        submitRawTransaction: () => Effect.succeed(makeFakeTx()),
        getTransaction: () => Effect.succeed(makeFakeTx()),
        listTransactions: () => Effect.succeed([makeFakeTx()]),
      });
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 1,
        port: 3000,
        serverBaseUrl: "http://localhost:3000",
      } as any);
      const MockPretiumLayer = Layer.succeed(PretiumService, {
        disburse: disburseMock,
        getTransactionStatus: () => Effect.succeed({} as any),
        validatePhoneWithMno: () => Effect.succeed({} as any),
        validateBankAccount: () => Effect.succeed({} as any),
        getSupportedCountries: () => SUPPORTED_COUNTRIES,
        getSettlementAddress: () => SETTLEMENT_ADDRESS,
        getCountryPaymentConfig: () => undefined,
        isCountrySupported: () => true,
      } as any);
      const MockExchangeRateLayer = Layer.succeed(ExchangeRateService, {
        getExchangeRate: () => Effect.succeed({} as any),
        convertUsdcToFiat: () => Effect.succeed({} as any),
        convertFiatToUsdc,
        clearCache: () => Effect.succeed(undefined),
      });

      const layer = RecurringPaymentServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockConfigLayer),
        Layer.provide(OfframpAdapterRegistryLive),
        Layer.provide(MockPretiumLayer),
        Layer.provide(MockExchangeRateLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.processDuePayments();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe("success");
      // Should have called convertFiatToUsdc (not convertUsdcToFiat)
      expect(convertFiatToUsdc).toHaveBeenCalledWith(12925, "KES");
      // Should have called disburse with the fiat amount
      expect(disburseMock).toHaveBeenCalled();
      const disburseArgs = disburseMock.mock.calls[0][0];
      expect(disburseArgs.amount).toBe(12925);
    });

    it("should fail Pretium offramp when metadata is missing required fields", async () => {
      const dueSchedule = makeFakeSchedule({
        paymentType: "offramp",
        isOfframp: true,
        offrampProvider: "pretium",
        amount: "10",
        offrampMetadata: {
          // Missing country, phoneNumber, mobileNetwork
        },
      });
      const failedExecution = makeFakeExecution({
        status: "failed",
        error: "missing required metadata",
      });

      const mockDb = makeMockDb({
        selectResult: [dueSchedule],
        insertResult: [failedExecution],
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
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 1,
        port: 3000,
        serverBaseUrl: "http://localhost:3000",
      } as any);
      const MockPretiumLayer = Layer.succeed(PretiumService, {
        disburse: () => Effect.succeed({} as any),
        getTransactionStatus: () => Effect.succeed({} as any),
        validatePhoneWithMno: () => Effect.succeed({} as any),
        validateBankAccount: () => Effect.succeed({} as any),
        getSupportedCountries: () => SUPPORTED_COUNTRIES,
        getSettlementAddress: () => SETTLEMENT_ADDRESS,
        getCountryPaymentConfig: () => undefined,
        isCountrySupported: () => true,
      } as any);
      const MockExchangeRateLayer = Layer.succeed(ExchangeRateService, {
        getExchangeRate: () => Effect.succeed({} as any),
        convertUsdcToFiat: () => Effect.succeed({} as any),
        convertFiatToUsdc: () => Effect.succeed({} as any),
        clearCache: () => Effect.succeed(undefined),
      });

      const layer = RecurringPaymentServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockConfigLayer),
        Layer.provide(OfframpAdapterRegistryLive),
        Layer.provide(MockPretiumLayer),
        Layer.provide(MockExchangeRateLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.processDuePayments();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe("failed");
    });

    it("should fail Pretium offramp when country is unsupported", async () => {
      const dueSchedule = makeFakeSchedule({
        paymentType: "offramp",
        isOfframp: true,
        offrampProvider: "pretium",
        amount: "10",
        offrampMetadata: {
          country: "XX",
          phoneNumber: "254712345678",
          mobileNetwork: "Safaricom",
        },
      });
      const failedExecution = makeFakeExecution({
        status: "failed",
        error: "Country XX is not supported by Pretium",
      });

      const mockDb = makeMockDb({
        selectResult: [dueSchedule],
        insertResult: [failedExecution],
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
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 1,
        port: 3000,
        serverBaseUrl: "http://localhost:3000",
      } as any);
      const MockPretiumLayer = Layer.succeed(PretiumService, {
        disburse: () => Effect.succeed({} as any),
        getTransactionStatus: () => Effect.succeed({} as any),
        validatePhoneWithMno: () => Effect.succeed({} as any),
        validateBankAccount: () => Effect.succeed({} as any),
        getSupportedCountries: () => SUPPORTED_COUNTRIES,
        getSettlementAddress: () => SETTLEMENT_ADDRESS,
        getCountryPaymentConfig: () => undefined,
        isCountrySupported: () => false,
      } as any);
      const MockExchangeRateLayer = Layer.succeed(ExchangeRateService, {
        getExchangeRate: () => Effect.succeed({} as any),
        convertUsdcToFiat: () => Effect.succeed({} as any),
        convertFiatToUsdc: () => Effect.succeed({} as any),
        clearCache: () => Effect.succeed(undefined),
      });

      const layer = RecurringPaymentServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockConfigLayer),
        Layer.provide(OfframpAdapterRegistryLive),
        Layer.provide(MockPretiumLayer),
        Layer.provide(MockExchangeRateLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.processDuePayments();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe("failed");
    });

    it("should fail Pretium offramp when USDC transfer fails", async () => {
      const dueSchedule = makeFakeSchedule({
        paymentType: "offramp",
        isOfframp: true,
        offrampProvider: "pretium",
        tokenContractName: "usdc",
        amount: "10",
        offrampMetadata: {
          country: "KE",
          phoneNumber: "254712345678",
          mobileNetwork: "Safaricom",
        },
      });
      const failedExecution = makeFakeExecution({
        status: "failed",
        error: "USDC transfer to Pretium settlement failed",
      });

      const mockDb = makeMockDb({
        selectResult: [dueSchedule],
        insertResult: [failedExecution],
      });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });
      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction: () =>
          Effect.fail(new TransactionError({ message: "contract tx failed" })),
        submitRawTransaction: () => Effect.succeed(makeFakeTx()),
        getTransaction: () => Effect.succeed(makeFakeTx()),
        listTransactions: () => Effect.succeed([makeFakeTx()]),
      });
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 1,
        port: 3000,
        serverBaseUrl: "http://localhost:3000",
      } as any);
      const MockPretiumLayer = Layer.succeed(PretiumService, {
        disburse: () => Effect.succeed({} as any),
        getTransactionStatus: () => Effect.succeed({} as any),
        validatePhoneWithMno: () => Effect.succeed({} as any),
        validateBankAccount: () => Effect.succeed({} as any),
        getSupportedCountries: () => SUPPORTED_COUNTRIES,
        getSettlementAddress: () => SETTLEMENT_ADDRESS,
        getCountryPaymentConfig: () => undefined,
        isCountrySupported: () => true,
      } as any);
      const MockExchangeRateLayer = Layer.succeed(ExchangeRateService, {
        getExchangeRate: () => Effect.succeed({} as any),
        convertUsdcToFiat: () =>
          Effect.succeed({ amount: 1292.5, exchangeRate: 129.25 }),
        convertFiatToUsdc: () => Effect.succeed({} as any),
        clearCache: () => Effect.succeed(undefined),
      });

      const layer = RecurringPaymentServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockConfigLayer),
        Layer.provide(OfframpAdapterRegistryLive),
        Layer.provide(MockPretiumLayer),
        Layer.provide(MockExchangeRateLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.processDuePayments();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe("failed");
    });

    it("should fail Pretium offramp when disburse fails", async () => {
      const dueSchedule = makeFakeSchedule({
        paymentType: "offramp",
        isOfframp: true,
        offrampProvider: "pretium",
        tokenContractName: "usdc",
        amount: "10",
        offrampMetadata: {
          country: "KE",
          phoneNumber: "254712345678",
          mobileNetwork: "Safaricom",
        },
      });
      const failedExecution = makeFakeExecution({
        status: "failed",
        error: "Pretium disburse failed",
      });

      const mockDb = makeMockDb({
        selectResult: [dueSchedule],
        insertResult: [failedExecution],
      });

      const MockDbLayer = Layer.succeed(DatabaseService, {
        db: mockDb as any,
        pool: {} as any,
      });
      const MockTxServiceLayer = Layer.succeed(TransactionService, {
        submitContractTransaction: () =>
          Effect.succeed(makeFakeTx({ txHash: "0xofframphash" })),
        submitRawTransaction: () => Effect.succeed(makeFakeTx()),
        getTransaction: () => Effect.succeed(makeFakeTx()),
        listTransactions: () => Effect.succeed([makeFakeTx()]),
      });
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 1,
        port: 3000,
        serverBaseUrl: "http://localhost:3000",
      } as any);

      const MockPretiumLayer = Layer.succeed(PretiumService, {
        disburse: () =>
          Effect.fail(
            new PretiumError({
              message: "Disburse request failed",
              code: "API_ERROR",
            })
          ),
        getTransactionStatus: () => Effect.succeed({} as any),
        validatePhoneWithMno: () => Effect.succeed({} as any),
        validateBankAccount: () => Effect.succeed({} as any),
        getSupportedCountries: () => SUPPORTED_COUNTRIES,
        getSettlementAddress: () => SETTLEMENT_ADDRESS,
        getCountryPaymentConfig: () => undefined,
        isCountrySupported: () => true,
      } as any);
      const MockExchangeRateLayer = Layer.succeed(ExchangeRateService, {
        getExchangeRate: () => Effect.succeed({} as any),
        convertUsdcToFiat: () =>
          Effect.succeed({ amount: 1292.5, exchangeRate: 129.25 }),
        convertFiatToUsdc: () => Effect.succeed({} as any),
        clearCache: () => Effect.succeed(undefined),
      });

      const layer = RecurringPaymentServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockConfigLayer),
        Layer.provide(OfframpAdapterRegistryLive),
        Layer.provide(MockPretiumLayer),
        Layer.provide(MockExchangeRateLayer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.processDuePayments();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe("failed");
    });
  });

  describe("executeSchedule", () => {
    it("should execute a specific schedule by id", async () => {
      const schedule = makeFakeSchedule();
      const execution = makeFakeExecution();

      const mockDb = makeMockDb({
        selectResult: [schedule],
        insertResult: [execution],
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
      const MockConfigLayer = Layer.succeed(ConfigService, {
        databaseUrl: "postgres://test",
        privyAppId: "test",
        privyAppSecret: "test",
        coinmarketcapApiKey: "test",
        adminApiKey: "test",
        defaultChainId: 1,
        port: 3000,
      });

      const layer = RecurringPaymentServiceLive.pipe(
        Layer.provide(MockDbLayer),
        Layer.provide(MockTxServiceLayer),
        Layer.provide(MockConfigLayer),
        Layer.provide(OfframpAdapterRegistryLive),
        Layer.provide(Layer.succeed(PretiumService, { disburse: () => Effect.succeed({} as any), getTransactionStatus: () => Effect.succeed({} as any), validatePhoneWithMno: () => Effect.succeed({} as any), validateBankAccount: () => Effect.succeed({} as any) } as any)),
        Layer.provide(Layer.succeed(ExchangeRateService, { getExchangeRate: () => Effect.succeed({} as any), convertUsdcToFiat: () => Effect.succeed({} as any), convertFiatToUsdc: () => Effect.succeed({} as any), clearCache: () => Effect.succeed(undefined) }))
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.executeSchedule("rp-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.id).toBe("exec-1");
      expect(result.status).toBe("success");
    });

    it("should fail when schedule not found", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpService = yield* RecurringPaymentService;
          return yield* rpService.executeSchedule("nonexistent").pipe(
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

  describe("frequency parsing", () => {
    it("should create schedules with various frequency formats", async () => {
      const { layer } = makeTestLayers();

      for (const frequency of ["30s", "5m", "2h", "1d", "1w"]) {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const rpService = yield* RecurringPaymentService;
            return yield* rpService.createSchedule({
              userId: "user-1",
              walletId: "wallet-1",
              walletType: "server",
              recipientAddress: "0x0000000000000000000000000000000000000001",
              paymentType: "raw_transfer",
              amount: "1000000000000000000",
              frequency,
            });
          }).pipe(Effect.provide(layer))
        );
        expect(result).toBeDefined();
      }
    });
  });
});
