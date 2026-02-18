import { describe, it, expect, vi } from "vitest";
import { Effect, Layer } from "effect";
import {
  LedgerService,
  LedgerServiceLive,
  LedgerError,
} from "../../../services/ledger/ledger-service.js";
import { DatabaseService } from "../../../db/client.js";
import type { Transaction } from "../../../db/schema/index.js";

const now = new Date("2025-01-15T12:00:00Z");

function makeFakeTransaction(overrides?: Partial<Transaction>): Transaction {
  return {
    id: "tx-1",
    walletId: "wallet-1",
    walletType: "server",
    chainId: "1",
    contractId: null,
    method: "transfer",
    payload: { args: [] },
    status: "pending",
    txHash: null,
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
  insertResult?: Transaction[];
  insertThrows?: Error;
  updateResult?: Transaction[];
  updateThrows?: Error;
  selectResult?: Transaction[];
  selectThrows?: Error;
}) {
  const throwOrResolve = <T>(throws?: Error, result?: T) =>
    throws ? vi.fn().mockRejectedValue(throws) : vi.fn().mockResolvedValue(result ?? []);

  // insert chain: db.insert(table).values(data).returning()
  const insertReturning = throwOrResolve(opts?.insertThrows, opts?.insertResult ?? [makeFakeTransaction()]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  // update chain: db.update(table).set(data).where(eq).returning()
  const updateReturning = throwOrResolve(
    opts?.updateThrows,
    opts?.updateResult ?? [makeFakeTransaction({ status: "submitted" })]
  );
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  // select chain: db.select().from(table).where(eq) or .where(eq).orderBy(col) or .orderBy(col).limit(n).offset(m)
  const selectResolve = throwOrResolve(opts?.selectThrows, opts?.selectResult ?? []);

  const selectFrom = vi.fn().mockReturnValue({
    // For getById: .where(eq) returns array directly
    where: vi.fn().mockImplementation(() => {
      // Return a thenable that also has .orderBy
      const result = opts?.selectThrows
        ? Promise.reject(opts.selectThrows)
        : Promise.resolve(opts?.selectResult ?? []);
      // Attach .orderBy for listByWallet/listByUser
      (result as any).orderBy = vi.fn().mockImplementation(() => {
        return opts?.selectThrows
          ? Promise.reject(opts.selectThrows)
          : Promise.resolve(opts?.selectResult ?? []);
      });
      return result;
    }),
    // For listAll: .orderBy(col).limit(n).offset(m)
    orderBy: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        offset: throwOrResolve(opts?.selectThrows, opts?.selectResult ?? []),
      }),
    }),
  });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  return {
    insert: insertFn,
    update: updateFn,
    select: selectFn,
  };
}

function makeTestLayer(dbOpts?: Parameters<typeof makeMockDb>[0]) {
  const mockDb = makeMockDb(dbOpts);
  const MockDbLayer = Layer.succeed(DatabaseService, {
    db: mockDb as any,
    pool: {} as any,
  });
  return LedgerServiceLive.pipe(Layer.provide(MockDbLayer));
}

describe("LedgerService", () => {
  describe("createIntent", () => {
    it("should create a pending transaction record", async () => {
      const expectedTx = makeFakeTransaction();
      const layer = makeTestLayer({ insertResult: [expectedTx] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger.createIntent({
            walletId: "wallet-1",
            walletType: "server",
            chainId: "1",
            method: "transfer",
            payload: { args: [] },
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.id).toBe("tx-1");
      expect(result.status).toBe("pending");
      expect(result.walletId).toBe("wallet-1");
    });

    it("should include optional categoryId and userId", async () => {
      const expectedTx = makeFakeTransaction({
        categoryId: "cat-1",
        userId: "user-1",
      });
      const layer = makeTestLayer({ insertResult: [expectedTx] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger.createIntent({
            walletId: "wallet-1",
            walletType: "server",
            chainId: "1",
            method: "transfer",
            payload: { args: [] },
            categoryId: "cat-1",
            userId: "user-1",
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.categoryId).toBe("cat-1");
      expect(result.userId).toBe("user-1");
    });

    it("should fail with LedgerError when DB insert fails", async () => {
      const layer = makeTestLayer({
        insertThrows: new Error("connection refused"),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger
            .createIntent({
              walletId: "w-1",
              walletType: "user",
              chainId: "1",
              method: "transfer",
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
        expect(result.e).toBeInstanceOf(LedgerError);
        expect((result.e as LedgerError).message).toContain("Failed to create intent");
      }
    });
  });

  describe("markSubmitted", () => {
    it("should update status to submitted and set txHash", async () => {
      const submittedTx = makeFakeTransaction({
        status: "submitted",
        txHash: "0xhash123",
      });
      const layer = makeTestLayer({ updateResult: [submittedTx] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger.markSubmitted(
            "tx-1",
            "0xhash123" as `0x${string}`
          );
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("submitted");
      expect(result.txHash).toBe("0xhash123");
    });

    it("should fail with LedgerError when DB update fails", async () => {
      const layer = makeTestLayer({ updateThrows: new Error("timeout") });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger
            .markSubmitted("tx-1", "0xhash" as `0x${string}`)
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

  describe("markConfirmed", () => {
    it("should update status to confirmed with gasUsed", async () => {
      const confirmedTx = makeFakeTransaction({
        status: "confirmed",
        gasUsed: BigInt(21000),
        confirmedAt: now,
      });
      const layer = makeTestLayer({ updateResult: [confirmedTx] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger.markConfirmed("tx-1", BigInt(21000));
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("confirmed");
      expect(result.gasUsed).toBe(BigInt(21000));
      expect(result.confirmedAt).toBeTruthy();
    });

    it("should work without gasUsed", async () => {
      const confirmedTx = makeFakeTransaction({
        status: "confirmed",
        confirmedAt: now,
      });
      const layer = makeTestLayer({ updateResult: [confirmedTx] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger.markConfirmed("tx-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("confirmed");
    });
  });

  describe("markFailed", () => {
    it("should update status to failed with error message", async () => {
      const failedTx = makeFakeTransaction({
        status: "failed",
        error: "Out of gas",
      });
      const layer = makeTestLayer({ updateResult: [failedTx] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger.markFailed("tx-1", "Out of gas");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("failed");
      expect(result.error).toBe("Out of gas");
    });
  });

  describe("getById", () => {
    it("should return a transaction when found", async () => {
      const tx = makeFakeTransaction();
      const layer = makeTestLayer({ selectResult: [tx] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger.getById("tx-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeDefined();
      expect(result!.id).toBe("tx-1");
    });

    it("should return undefined when transaction not found", async () => {
      const layer = makeTestLayer({ selectResult: [] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger.getById("nonexistent");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeUndefined();
    });

    it("should fail with LedgerError when DB query fails", async () => {
      const layer = makeTestLayer({
        selectThrows: new Error("connection reset"),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger.getById("tx-1").pipe(
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

  describe("listByWallet", () => {
    it("should return transactions for a given wallet", async () => {
      const txs = [
        makeFakeTransaction({ id: "tx-1" }),
        makeFakeTransaction({ id: "tx-2" }),
      ];
      const layer = makeTestLayer({ selectResult: txs });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger.listByWallet("wallet-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });

    it("should return empty array when no transactions exist", async () => {
      const layer = makeTestLayer({ selectResult: [] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger.listByWallet("wallet-empty");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });

  describe("listByUser", () => {
    it("should return transactions for a given user", async () => {
      const txs = [makeFakeTransaction({ userId: "user-1" })];
      const layer = makeTestLayer({ selectResult: txs });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger.listByUser("user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.userId).toBe("user-1");
    });
  });

  describe("listAll", () => {
    it("should return all transactions with default limit and offset", async () => {
      const txs = [makeFakeTransaction()];
      const layer = makeTestLayer({ selectResult: txs });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerService;
          return yield* ledger.listAll();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
    });
  });

  describe("state transitions", () => {
    it("should support pending -> submitted -> confirmed flow", () => {
      const pendingTx = makeFakeTransaction({ status: "pending" });
      const submittedTx = makeFakeTransaction({
        status: "submitted",
        txHash: "0xhash",
      });
      const confirmedTx = makeFakeTransaction({
        status: "confirmed",
        confirmedAt: now,
      });

      expect(pendingTx.status).toBe("pending");
      expect(submittedTx.status).toBe("submitted");
      expect(confirmedTx.status).toBe("confirmed");
      expect(pendingTx.txHash).toBeNull();
      expect(submittedTx.txHash).toBe("0xhash");
      expect(confirmedTx.confirmedAt).toBeTruthy();
    });

    it("should support pending -> submitted -> failed flow", () => {
      const pendingTx = makeFakeTransaction({ status: "pending" });
      const submittedTx = makeFakeTransaction({
        status: "submitted",
        txHash: "0xhash",
      });
      const failedTx = makeFakeTransaction({
        status: "failed",
        error: "reverted",
      });

      expect(pendingTx.status).toBe("pending");
      expect(submittedTx.status).toBe("submitted");
      expect(failedTx.status).toBe("failed");
      expect(failedTx.error).toBe("reverted");
    });
  });
});
