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
import {
  OfframpAdapterRegistry,
  OfframpError,
} from "../../../services/offramp/index.js";
import { OfframpAdapterRegistryLive } from "../../../services/offramp/index.js";
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
    paymentType: "offramp",
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
    nextExecutionAt: new Date(Date.now() - 60000),
    maxRetries: 3,
    consecutiveFailures: 0,
    totalExecutions: 0,
    isOfframp: true,
    offrampCurrency: "USD",
    offrampFiatAmount: "100.00",
    offrampProvider: "moonpay",
    offrampDestinationId: "bank-123",
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
  selectResult?: unknown[];
}) {
  const insertReturning = vi
    .fn()
    .mockResolvedValue(opts?.insertResult ?? [makeFakeExecution()]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturning = vi.fn().mockResolvedValue([makeFakeSchedule()]);
  const updateWhere = vi.fn().mockImplementation(() => {
    const promise = Promise.resolve([makeFakeSchedule()]);
    (promise as any).returning = updateReturning;
    return promise;
  });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  const defaultResult = opts?.selectResult ?? [];
  const selectLimit = vi.fn().mockResolvedValue(defaultResult);
  const selectOrderByFromWhere = vi.fn().mockImplementation(() => {
    const promise = Promise.resolve(defaultResult);
    (promise as any).limit = selectLimit;
    return promise;
  });
  const selectWhere = vi.fn().mockImplementation(() => {
    const promise = Promise.resolve(defaultResult);
    (promise as any).orderBy = selectOrderByFromWhere;
    return promise;
  });
  const selectOrderBy = vi.fn().mockReturnValue({
    limit: vi.fn().mockReturnValue({
      offset: vi.fn().mockResolvedValue(defaultResult),
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
  selectResult?: unknown[];
  insertResult?: unknown[];
  submitRawFail?: boolean;
  mockOfframpRegistry?: typeof OfframpAdapterRegistry.Type;
}) {
  const mockDb = makeMockDb({
    selectResult: opts?.selectResult,
    insertResult: opts?.insertResult,
  });

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

  const MockConfigLayer = Layer.succeed(ConfigService, {
    databaseUrl: "postgres://test",
    privyAppId: "test",
    privyAppSecret: "test",
    coinmarketcapApiKey: "test",
    adminApiKey: "test",
    defaultChainId: 1,
    port: 3000,
  });

  // Use real registry (with stub adapters) or a custom mock
  const OfframpLayer = opts?.mockOfframpRegistry
    ? Layer.succeed(OfframpAdapterRegistry, opts.mockOfframpRegistry)
    : OfframpAdapterRegistryLive;

  return {
    layer: RecurringPaymentServiceLive.pipe(
      Layer.provide(MockDbLayer),
      Layer.provide(MockTxServiceLayer),
      Layer.provide(MockConfigLayer),
      Layer.provide(OfframpLayer)
    ),
  };
}

describe("Offramp Execution in RecurringPaymentService", () => {
  it("should execute an offramp schedule via the adapter", async () => {
    const schedule = makeFakeSchedule();
    const { layer } = makeTestLayers({
      selectResult: [schedule],
      insertResult: [makeFakeExecution()],
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.executeSchedule("rp-1");
      }).pipe(Effect.provide(layer))
    );

    expect(result.id).toBe("exec-1");
    expect(result.status).toBe("success");
  });

  it("should fail when offrampProvider is missing", async () => {
    const schedule = makeFakeSchedule({
      paymentType: "offramp",
      offrampProvider: null,
    });
    const { layer } = makeTestLayers({
      selectResult: [schedule],
      insertResult: [makeFakeExecution({ status: "failed" })],
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.executeSchedule("rp-1");
      }).pipe(Effect.provide(layer))
    );

    // The execution should be recorded as failed
    expect(result.status).toBe("failed");
  });

  it("should fail when provider is not registered", async () => {
    const schedule = makeFakeSchedule({
      paymentType: "offramp",
      offrampProvider: "nonexistent_provider",
    });
    const { layer } = makeTestLayers({
      selectResult: [schedule],
      insertResult: [makeFakeExecution({ status: "failed" })],
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.executeSchedule("rp-1");
      }).pipe(Effect.provide(layer))
    );

    expect(result.status).toBe("failed");
  });

  it("should process due offramp payments in processDuePayments", async () => {
    const schedule = makeFakeSchedule({
      paymentType: "offramp",
      status: "active",
    });
    const { layer } = makeTestLayers({
      selectResult: [schedule],
      insertResult: [makeFakeExecution()],
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.processDuePayments();
      }).pipe(Effect.provide(layer))
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("success");
  });

  it("should record failure when on-chain tx fails", async () => {
    const schedule = makeFakeSchedule();
    const { layer } = makeTestLayers({
      selectResult: [schedule],
      insertResult: [makeFakeExecution({ status: "failed" })],
      submitRawFail: true,
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.executeSchedule("rp-1");
      }).pipe(Effect.provide(layer))
    );

    expect(result.status).toBe("failed");
  });

  it("should work with bridge provider", async () => {
    const schedule = makeFakeSchedule({
      offrampProvider: "bridge",
    });
    const { layer } = makeTestLayers({
      selectResult: [schedule],
      insertResult: [makeFakeExecution()],
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.executeSchedule("rp-1");
      }).pipe(Effect.provide(layer))
    );

    expect(result.status).toBe("success");
  });

  it("should work with transak provider", async () => {
    const schedule = makeFakeSchedule({
      offrampProvider: "transak",
    });
    const { layer } = makeTestLayers({
      selectResult: [schedule],
      insertResult: [makeFakeExecution()],
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.executeSchedule("rp-1");
      }).pipe(Effect.provide(layer))
    );

    expect(result.status).toBe("success");
  });
});
