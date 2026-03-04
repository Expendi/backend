import { describe, it, expect, vi } from "vitest";
import { Effect, Layer } from "effect";
import {
  SplitExpenseService,
  SplitExpenseServiceLive,
  SplitExpenseError,
} from "../../../services/split-expense/split-expense-service.js";
import { DatabaseService } from "../../../db/client.js";
import {
  TransactionService,
  TransactionError,
} from "../../../services/transaction/transaction-service.js";
import {
  OnboardingService,
  OnboardingError,
} from "../../../services/onboarding/onboarding-service.js";
import type {
  SplitExpense,
  SplitExpenseShare,
  Transaction,
  Wallet,
} from "../../../db/schema/index.js";

const now = new Date("2025-06-15T12:00:00Z");

function makeFakeExpense(overrides?: Partial<SplitExpense>): SplitExpense {
  return {
    id: "exp-1",
    creatorUserId: "user-1",
    title: "Dinner",
    tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    totalAmount: "50000000",
    chainId: 8453,
    transactionId: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeShare(
  overrides?: Partial<SplitExpenseShare>
): SplitExpenseShare {
  return {
    id: "share-1",
    expenseId: "exp-1",
    debtorUserId: "user-2",
    amount: "25000000",
    status: "pending",
    transactionId: null,
    paidAt: null,
    createdAt: now,
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
  selectCallResults?: unknown[][];
  insertResult?: unknown[];
  insertThrows?: Error;
  updateResult?: unknown[];
  updateThrows?: Error;
}) {
  let selectCallIndex = 0;
  const selectResults = opts?.selectCallResults ?? [];

  const makeSelectChain = () => {
    const result = selectResults[selectCallIndex] ?? [];
    selectCallIndex++;

    const limitFn = vi.fn().mockResolvedValue(result);
    const whereFn = vi.fn().mockImplementation(() => {
      const promise = Promise.resolve(result);
      (promise as any).limit = limitFn;
      return promise;
    });
    const leftJoinFn = vi.fn().mockReturnValue({ where: whereFn });
    const fromFn = vi.fn().mockReturnValue({
      where: whereFn,
      leftJoin: leftJoinFn,
    });
    return { from: fromFn };
  };

  const insertReturning = opts?.insertThrows
    ? vi.fn().mockRejectedValue(opts.insertThrows)
    : vi.fn().mockResolvedValue(opts?.insertResult ?? [makeFakeExpense()]);
  const insertValues = vi.fn().mockImplementation(() => {
    const promise = opts?.insertThrows
      ? Promise.reject(opts.insertThrows)
      : Promise.resolve(undefined);
    (promise as any).returning = insertReturning;
    return promise;
  });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturning = opts?.updateThrows
    ? vi.fn().mockRejectedValue(opts.updateThrows)
    : vi.fn().mockResolvedValue(
        opts?.updateResult ?? [makeFakeExpense({ status: "cancelled" })]
      );
  const updateWhere = vi.fn().mockImplementation(() => {
    const promise = opts?.updateThrows
      ? Promise.reject(opts.updateThrows)
      : Promise.resolve(undefined);
    (promise as any).returning = updateReturning;
    return promise;
  });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  return {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    insert: insertFn,
    update: updateFn,
  };
}

function makeTestLayers(opts?: {
  dbOpts?: Parameters<typeof makeMockDb>[0];
  submitRawFail?: boolean;
  getProfileFail?: boolean;
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

  const MockOnboardingLayer = Layer.succeed(OnboardingService, {
    onboardUser: () => Effect.succeed({} as any),
    getProfile: () => Effect.succeed({} as any),
    getProfileWithWallets: () =>
      opts?.getProfileFail
        ? Effect.fail(new OnboardingError({ message: "profile not found" }))
        : Effect.succeed({
            privyUserId: "user-1",
            username: "alice",
            userWalletId: "uw-1",
            serverWalletId: "sw-1",
            agentWalletId: "aw-1",
            chainId: 8453,
            createdAt: now,
            userWallet: {
              id: "uw-1",
              address: "0x1111111111111111111111111111111111111111",
              type: "user",
              privyId: "p1",
              createdAt: now,
            } as Wallet,
            serverWallet: {
              id: "sw-1",
              address: "0x2222222222222222222222222222222222222222",
              type: "server",
              privyId: "p2",
              createdAt: now,
            } as Wallet,
            agentWallet: {
              id: "aw-1",
              address: "0x3333333333333333333333333333333333333333",
              type: "agent",
              privyId: "p3",
              createdAt: now,
            } as Wallet,
          }),
    isOnboarded: () => Effect.succeed(true),
    resolveUsername: () => Effect.succeed({} as any),
  });

  return {
    layer: SplitExpenseServiceLive.pipe(
      Layer.provide(MockDbLayer),
      Layer.provide(MockTxServiceLayer),
      Layer.provide(MockOnboardingLayer)
    ),
  };
}

describe("SplitExpenseService", () => {
  describe("createExpense", () => {
    it("should create an expense with shares", async () => {
      const expense = makeFakeExpense();
      const shareWithUsername = {
        ...makeFakeShare(),
        username: "bob",
      };
      const { layer } = makeTestLayers({
        dbOpts: {
          // Call 1: validate user-2 exists
          // Call 2: validate user-3 exists
          // Call 3: fetchExpenseWithShares -> expense
          // Call 4: fetchExpenseWithShares -> shares
          selectCallResults: [
            [{ privyUserId: "user-2" }],
            [{ privyUserId: "user-3" }],
            [expense],
            [shareWithUsername, { ...shareWithUsername, id: "share-2", debtorUserId: "user-3", username: "charlie" }],
          ],
          insertResult: [expense],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service.createExpense("user-1", {
            title: "Dinner",
            tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            tokenSymbol: "USDC",
            tokenDecimals: 6,
            totalAmount: "50000000",
            chainId: 8453,
            shares: [
              { userId: "user-2", amount: "25000000" },
              { userId: "user-3", amount: "25000000" },
            ],
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.id).toBe("exp-1");
      expect(result.title).toBe("Dinner");
      expect(result.shares).toHaveLength(2);
    });

    it("should fail when a debtor user does not exist", async () => {
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [
            [], // user not found
          ],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service
            .createExpense("user-1", {
              title: "Dinner",
              tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              tokenSymbol: "USDC",
              tokenDecimals: 6,
              totalAmount: "50000000",
              chainId: 8453,
              shares: [{ userId: "nonexistent", amount: "25000000" }],
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
        expect(result.e).toBeInstanceOf(SplitExpenseError);
      }
    });

    it("should fail when DB insert fails", async () => {
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [[{ privyUserId: "user-2" }]],
          insertThrows: new Error("DB write failed"),
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service
            .createExpense("user-1", {
              title: "Dinner",
              tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              tokenSymbol: "USDC",
              tokenDecimals: 6,
              totalAmount: "50000000",
              chainId: 8453,
              shares: [{ userId: "user-2", amount: "25000000" }],
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

  describe("getExpense", () => {
    it("should return expense when user is creator", async () => {
      const expense = makeFakeExpense();
      const share = { ...makeFakeShare(), username: "bob" };
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [[expense], [share]],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service.getExpense("exp-1", "user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.id).toBe("exp-1");
      expect(result.shares).toHaveLength(1);
    });

    it("should return expense when user is debtor", async () => {
      const expense = makeFakeExpense({ creatorUserId: "user-other" });
      const share = {
        ...makeFakeShare({ debtorUserId: "user-1" }),
        username: "alice",
      };
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [[expense], [share]],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service.getExpense("exp-1", "user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.id).toBe("exp-1");
    });

    it("should fail when user is not a participant", async () => {
      const expense = makeFakeExpense({ creatorUserId: "user-other" });
      const share = { ...makeFakeShare({ debtorUserId: "user-other-2" }), username: "bob" };
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [[expense], [share]],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service
            .getExpense("exp-1", "user-1")
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
        expect(result.e).toBeInstanceOf(SplitExpenseError);
      }
    });

    it("should fail when expense not found", async () => {
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [[]],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service
            .getExpense("nonexistent", "user-1")
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

  describe("listByUser", () => {
    it("should return expenses where user is creator", async () => {
      const expenses = [makeFakeExpense(), makeFakeExpense({ id: "exp-2" })];
      const { layer } = makeTestLayers({
        dbOpts: {
          // Call 1: created expenses
          // Call 2: debtor share rows
          selectCallResults: [expenses, []],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service.listByUser("user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });

    it("should return empty array when no expenses", async () => {
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [[], []],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service.listByUser("user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });

  describe("payShare", () => {
    it("should pay a share and return updated share", async () => {
      const share = makeFakeShare({ debtorUserId: "user-1" });
      const expense = makeFakeExpense();
      const updatedShare = makeFakeShare({
        status: "paid",
        transactionId: "tx-1",
        paidAt: now,
      });
      const { layer } = makeTestLayers({
        dbOpts: {
          // Call 1: fetch share
          // Call 2: fetch expense
          // Call 3: fetch all shares to check settlement
          selectCallResults: [
            [share],
            [expense],
            [{ ...share, status: "paid" }],
          ],
          updateResult: [updatedShare],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service.payShare("share-1", "user-1", "wallet-1", "server");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("paid");
      expect(result.transactionId).toBe("tx-1");
    });

    it("should fail when share not found", async () => {
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [[]],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service
            .payShare("nonexistent", "user-1", "wallet-1", "server")
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

    it("should fail when user is not the debtor", async () => {
      const share = makeFakeShare({ debtorUserId: "user-other" });
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [[share]],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service
            .payShare("share-1", "user-1", "wallet-1", "server")
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
        expect(String(result.e)).toContain("Only the debtor");
      }
    });

    it("should fail when share is not pending", async () => {
      const share = makeFakeShare({ debtorUserId: "user-1", status: "paid" });
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [[share]],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service
            .payShare("share-1", "user-1", "wallet-1", "server")
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
        expect(String(result.e)).toContain("not pending");
      }
    });

    it("should fail when raw transaction fails", async () => {
      const share = makeFakeShare({ debtorUserId: "user-1" });
      const expense = makeFakeExpense();
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [[share], [expense]],
        },
        submitRawFail: true,
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service
            .payShare("share-1", "user-1", "wallet-1", "server")
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
        expect(result.e).toBeInstanceOf(TransactionError);
      }
    });
  });

  describe("cancelExpense", () => {
    it("should cancel an expense with no paid shares", async () => {
      const expense = makeFakeExpense();
      const shares = [
        makeFakeShare({ status: "pending" }),
        makeFakeShare({ id: "share-2", status: "pending" }),
      ];
      const cancelledExpense = makeFakeExpense({ status: "cancelled" });
      const { layer } = makeTestLayers({
        dbOpts: {
          // Call 1: fetch expense
          // Call 2: fetch shares
          selectCallResults: [[expense], shares],
          updateResult: [cancelledExpense],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service.cancelExpense("exp-1", "user-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("cancelled");
    });

    it("should fail when user is not the creator", async () => {
      const expense = makeFakeExpense({ creatorUserId: "user-other" });
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [[expense]],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service
            .cancelExpense("exp-1", "user-1")
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
        expect(String(result.e)).toContain("Only the creator");
      }
    });

    it("should fail when expense has paid shares", async () => {
      const expense = makeFakeExpense();
      const shares = [
        makeFakeShare({ status: "paid" }),
        makeFakeShare({ id: "share-2", status: "pending" }),
      ];
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [[expense], shares],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service
            .cancelExpense("exp-1", "user-1")
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
        expect(String(result.e)).toContain("paid shares");
      }
    });

    it("should fail when expense not found", async () => {
      const { layer } = makeTestLayers({
        dbOpts: {
          selectCallResults: [[]],
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SplitExpenseService;
          return yield* service
            .cancelExpense("nonexistent", "user-1")
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
});
