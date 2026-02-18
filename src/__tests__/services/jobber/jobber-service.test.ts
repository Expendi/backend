import { describe, it, expect, vi } from "vitest";
import { Effect, Layer } from "effect";
import {
  JobberService,
  JobberServiceLive,
  JobberError,
} from "../../../services/jobber/jobber-service.js";
import { DatabaseService } from "../../../db/client.js";
import {
  TransactionService,
  TransactionError,
} from "../../../services/transaction/transaction-service.js";
import type { Job, Transaction } from "../../../db/schema/index.js";

const now = new Date("2025-01-15T12:00:00Z");

function makeFakeJob(overrides?: Partial<Job>): Job {
  return {
    id: "job-1",
    name: "Test Job",
    jobType: "contract_transaction",
    schedule: "5m",
    payload: {
      walletId: "wallet-1",
      walletType: "server",
      contractName: "TestToken",
      chainId: 1,
      method: "transfer",
      args: [],
    },
    status: "pending",
    lastRunAt: null,
    nextRunAt: new Date(Date.now() - 60000),
    maxRetries: 3,
    retryCount: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
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
    method: "transfer",
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
  insertResult?: Job[];
  insertThrows?: Error;
  selectResult?: Job[];
  selectThrows?: Error;
  updateThrows?: Error;
}) {
  // insert: db.insert(table).values(data).returning()
  const insertReturning = opts?.insertThrows
    ? vi.fn().mockRejectedValue(opts.insertThrows)
    : vi.fn().mockResolvedValue(opts?.insertResult ?? [makeFakeJob()]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  // update: db.update(table).set(data).where(eq) or .where(eq).returning()
  // processDueJobs calls update without .returning(), createJob/cancelJob calls update with .returning()
  const updateReturning = opts?.updateThrows
    ? vi.fn().mockRejectedValue(opts.updateThrows)
    : vi.fn().mockResolvedValue([makeFakeJob({ status: "cancelled" })]);

  // update().set().where() -> thenable (no .returning) or has .returning
  const updateWhere = vi.fn().mockImplementation(() => {
    // Return a thenable that also has .returning
    const promise = opts?.updateThrows
      ? Promise.reject(opts.updateThrows)
      : Promise.resolve([makeFakeJob()]);
    (promise as any).returning = updateReturning;
    return promise;
  });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  // select: db.select().from(table).where(eq) or .orderBy(col)
  const selectWhere = opts?.selectThrows
    ? vi.fn().mockRejectedValue(opts.selectThrows)
    : vi.fn().mockResolvedValue(opts?.selectResult ?? []);
  const selectOrderBy = opts?.selectThrows
    ? vi.fn().mockRejectedValue(opts.selectThrows)
    : vi.fn().mockResolvedValue(opts?.selectResult ?? []);
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

  return {
    layer: JobberServiceLive.pipe(
      Layer.provide(MockDbLayer),
      Layer.provide(MockTxServiceLayer)
    ),
  };
}

describe("JobberService", () => {
  describe("createJob", () => {
    it("should create a job with correct defaults", async () => {
      const { layer } = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const jobber = yield* JobberService;
          return yield* jobber.createJob({
            name: "Test Job",
            jobType: "contract_transaction",
            schedule: "5m",
            payload: { walletId: "w1" },
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.id).toBe("job-1");
      expect(result.name).toBe("Test Job");
    });

    it("should accept custom maxRetries", async () => {
      const jobWithRetries = makeFakeJob({ maxRetries: 10 });
      const { layer } = makeTestLayers({
        dbOpts: { insertResult: [jobWithRetries] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const jobber = yield* JobberService;
          return yield* jobber.createJob({
            name: "Retry Job",
            jobType: "contract_transaction",
            schedule: "1h",
            payload: {},
            maxRetries: 10,
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.maxRetries).toBe(10);
    });

    it("should fail with JobberError when DB insert fails", async () => {
      const { layer } = makeTestLayers({
        dbOpts: { insertThrows: new Error("DB write failed") },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const jobber = yield* JobberService;
          return yield* jobber
            .createJob({
              name: "Bad Job",
              jobType: "contract_transaction",
              schedule: "5m",
              payload: {},
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
        expect(result.e).toBeInstanceOf(JobberError);
      }
    });
  });

  describe("getJob", () => {
    it("should return a job when found", async () => {
      const job = makeFakeJob();
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [job] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const jobber = yield* JobberService;
          return yield* jobber.getJob("job-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeDefined();
      expect(result!.id).toBe("job-1");
    });

    it("should return undefined when job not found", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const jobber = yield* JobberService;
          return yield* jobber.getJob("nonexistent");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeUndefined();
    });
  });

  describe("listJobs", () => {
    it("should list all jobs", async () => {
      const jobs = [makeFakeJob({ id: "j1" }), makeFakeJob({ id: "j2" })];
      const { layer } = makeTestLayers({ dbOpts: { selectResult: jobs } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const jobber = yield* JobberService;
          return yield* jobber.listJobs();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });

    it("should return empty array when no jobs exist", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const jobber = yield* JobberService;
          return yield* jobber.listJobs();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });

  describe("cancelJob", () => {
    it("should cancel a job and return it with cancelled status", async () => {
      const { layer } = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const jobber = yield* JobberService;
          return yield* jobber.cancelJob("job-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("cancelled");
    });

    it("should fail with JobberError when DB update fails", async () => {
      const { layer } = makeTestLayers({
        dbOpts: { updateThrows: new Error("DB error") },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const jobber = yield* JobberService;
          return yield* jobber.cancelJob("job-1").pipe(
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

  describe("processDueJobs", () => {
    it("should return empty array when no due jobs", async () => {
      const { layer } = makeTestLayers({ dbOpts: { selectResult: [] } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const jobber = yield* JobberService;
          return yield* jobber.processDueJobs();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });

    it("should process due contract_transaction jobs", async () => {
      const dueJob = makeFakeJob({
        jobType: "contract_transaction",
        status: "pending",
      });
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: [dueJob] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const jobber = yield* JobberService;
          return yield* jobber.processDueJobs();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("job-1");
    });

    it("should process due raw_transaction jobs", async () => {
      const dueJob = makeFakeJob({
        jobType: "raw_transaction",
        payload: {
          walletId: "wallet-1",
          walletType: "server",
          chainId: 1,
          to: "0x0000000000000000000000000000000000000001",
        },
      });
      const { layer } = makeTestLayers({
        dbOpts: { selectResult: [dueJob] },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const jobber = yield* JobberService;
          return yield* jobber.processDueJobs();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
    });
  });

  describe("schedule parsing", () => {
    it("should create jobs with various schedule formats", async () => {
      const { layer } = makeTestLayers();

      for (const schedule of ["10s", "5m", "2h", "1d"]) {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const jobber = yield* JobberService;
            return yield* jobber.createJob({
              name: `Job ${schedule}`,
              jobType: "contract_transaction",
              schedule,
              payload: {},
            });
          }).pipe(Effect.provide(layer))
        );
        expect(result).toBeDefined();
      }
    });
  });
});
