import { describe, it, expect, vi } from "vitest";
import { Effect, Layer } from "effect";
import {
  TransactionService,
  TransactionServiceLive,
  TransactionError,
} from "../../../services/transaction/transaction-service.js";
import {
  LedgerService,
  LedgerError,
} from "../../../services/ledger/ledger-service.js";
import {
  ContractExecutor,
  ContractExecutionError,
} from "../../../services/contract/contract-executor.js";
import { ContractNotFoundError } from "../../../services/contract/contract-registry.js";
import {
  WalletService,
  WalletError,
} from "../../../services/wallet/wallet-service.js";
import type { Transaction } from "../../../db/schema/index.js";

const now = new Date("2025-01-15T12:00:00Z");

function makeFakeTx(overrides?: Partial<Transaction>): Transaction {
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

const fakeTxHash =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as const;

function makeTestLayers(opts?: {
  createIntentResult?: Transaction;
  createIntentFail?: LedgerError;
  markSubmittedResult?: Transaction;
  markSubmittedFail?: LedgerError;
  markFailedResult?: Transaction;
  executeFail?: ContractExecutionError | ContractNotFoundError | WalletError;
  executeResult?: { txHash: typeof fakeTxHash; contractName: string; method: string; chainId: number };
  getWalletFail?: WalletError;
  sendTxFail?: WalletError;
  sendTxHash?: `0x${string}`;
  getByIdResult?: Transaction | null;
  listAllResult?: Transaction[];
}) {
  const markFailedFn = vi.fn();

  const MockLedgerLayer = Layer.succeed(LedgerService, {
    createIntent: () =>
      opts?.createIntentFail
        ? Effect.fail(opts.createIntentFail)
        : Effect.succeed(opts?.createIntentResult ?? makeFakeTx()),
    markSubmitted: (id: string, txHash: any) =>
      opts?.markSubmittedFail
        ? Effect.fail(opts.markSubmittedFail)
        : Effect.succeed(
            opts?.markSubmittedResult ??
              makeFakeTx({ id, status: "submitted", txHash })
          ),
    markConfirmed: (id: string) =>
      Effect.succeed(makeFakeTx({ id, status: "confirmed" })),
    markFailed: (id: string, error: string) => {
      markFailedFn(id, error);
      return Effect.succeed(makeFakeTx({ id, status: "failed", error }));
    },
    getById: () => Effect.succeed(opts?.getByIdResult === null ? undefined : (opts?.getByIdResult ?? makeFakeTx())),
    listByWallet: () => Effect.succeed([]),
    listByUser: () => Effect.succeed([]),
    listAll: () => Effect.succeed(opts?.listAllResult ?? [makeFakeTx()]),
  });

  const MockExecutorLayer = Layer.succeed(ContractExecutor, {
    execute: () =>
      opts?.executeFail
        ? Effect.fail(opts.executeFail)
        : Effect.succeed(
            opts?.executeResult ?? {
              txHash: fakeTxHash,
              contractName: "TestToken",
              method: "transfer",
              chainId: 1,
            }
          ),
    readContract: () => Effect.succeed("mock-result"),
  });

  const MockWalletServiceLayer = Layer.succeed(WalletService, {
    createUserWallet: () =>
      Effect.succeed({
        getAddress: () => Effect.succeed("0x1111" as `0x${string}`),
        sign: () => Effect.succeed("0xsig" as `0x${string}`),
        sendTransaction: () => Effect.succeed(fakeTxHash),
      }),
    createServerWallet: () =>
      Effect.succeed({
        getAddress: () => Effect.succeed("0x2222" as `0x${string}`),
        sign: () => Effect.succeed("0xsig" as `0x${string}`),
        sendTransaction: () => Effect.succeed(fakeTxHash),
      }),
    createAgentWallet: () =>
      Effect.succeed({
        getAddress: () => Effect.succeed("0x3333" as `0x${string}`),
        sign: () => Effect.succeed("0xsig" as `0x${string}`),
        sendTransaction: () => Effect.succeed(fakeTxHash),
      }),
    getWallet: () =>
      opts?.getWalletFail
        ? Effect.fail(opts.getWalletFail)
        : Effect.succeed({
            getAddress: () => Effect.succeed("0x4444" as `0x${string}`),
            sign: () => Effect.succeed("0xsig" as `0x${string}`),
            sendTransaction: () =>
              opts?.sendTxFail
                ? Effect.fail(opts.sendTxFail)
                : Effect.succeed(opts?.sendTxHash ?? fakeTxHash),
          }),
  });

  return {
    layer: TransactionServiceLive.pipe(
      Layer.provide(MockLedgerLayer),
      Layer.provide(MockExecutorLayer),
      Layer.provide(MockWalletServiceLayer)
    ),
    markFailedFn,
  };
}

describe("TransactionService", () => {
  describe("submitContractTransaction", () => {
    it("should create intent, execute contract, and mark submitted", async () => {
      const { layer } = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const txService = yield* TransactionService;
          return yield* txService.submitContractTransaction({
            walletId: "wallet-1",
            walletType: "server",
            contractName: "TestToken",
            chainId: 1,
            method: "transfer",
            args: ["0x0000000000000000000000000000000000000001", BigInt(1000)],
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("submitted");
      expect(result.txHash).toBe(fakeTxHash);
    });

    it("should include categoryId and userId in the intent", async () => {
      const { layer } = makeTestLayers({
        createIntentResult: makeFakeTx({
          categoryId: "cat-1",
          userId: "user-1",
        }),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const txService = yield* TransactionService;
          return yield* txService.submitContractTransaction({
            walletId: "wallet-1",
            walletType: "server",
            contractName: "TestToken",
            chainId: 1,
            method: "transfer",
            args: [],
            categoryId: "cat-1",
            userId: "user-1",
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("submitted");
    });

    it("should mark failed and propagate error when executor fails", async () => {
      const { layer, markFailedFn } = makeTestLayers({
        executeFail: new ContractExecutionError({
          message: "Encode failed",
        }),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const txService = yield* TransactionService;
          return yield* txService
            .submitContractTransaction({
              walletId: "wallet-1",
              walletType: "server",
              contractName: "TestToken",
              chainId: 1,
              method: "transfer",
              args: [],
            })
            .pipe(
              Effect.matchEffect({
                onSuccess: (r) => Effect.succeed({ tag: "ok" as const, r }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      expect(markFailedFn).toHaveBeenCalled();
    });

    it("should fail when ledger createIntent fails", async () => {
      const { layer } = makeTestLayers({
        createIntentFail: new LedgerError({ message: "DB down" }),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const txService = yield* TransactionService;
          return yield* txService
            .submitContractTransaction({
              walletId: "wallet-1",
              walletType: "server",
              contractName: "TestToken",
              chainId: 1,
              method: "transfer",
              args: [],
            })
            .pipe(
              Effect.matchEffect({
                onSuccess: (r) => Effect.succeed({ tag: "ok" as const }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(LedgerError);
      }
    });
  });

  describe("submitRawTransaction", () => {
    it("should create intent, send raw transaction, and mark submitted", async () => {
      const { layer } = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const txService = yield* TransactionService;
          return yield* txService.submitRawTransaction({
            walletId: "wallet-1",
            walletType: "server",
            chainId: 1,
            to: "0x0000000000000000000000000000000000000001",
            value: BigInt(1000000),
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("submitted");
      expect(result.txHash).toBe(fakeTxHash);
    });

    it("should include data field in raw transaction", async () => {
      const { layer } = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const txService = yield* TransactionService;
          return yield* txService.submitRawTransaction({
            walletId: "wallet-1",
            walletType: "user",
            chainId: 137,
            to: "0x0000000000000000000000000000000000000001",
            data: "0xabcdef",
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.status).toBe("submitted");
    });

    it("should mark failed and propagate error when wallet sendTransaction fails", async () => {
      const { layer, markFailedFn } = makeTestLayers({
        sendTxFail: new WalletError({ message: "Insufficient funds" }),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const txService = yield* TransactionService;
          return yield* txService
            .submitRawTransaction({
              walletId: "wallet-1",
              walletType: "server",
              chainId: 1,
              to: "0x0000000000000000000000000000000000000001",
            })
            .pipe(
              Effect.matchEffect({
                onSuccess: (r) => Effect.succeed({ tag: "ok" as const }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      expect(markFailedFn).toHaveBeenCalled();
    });

    it("should fail when getWallet fails", async () => {
      const { layer } = makeTestLayers({
        getWalletFail: new WalletError({ message: "Wallet not found" }),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const txService = yield* TransactionService;
          return yield* txService
            .submitRawTransaction({
              walletId: "wallet-bad",
              walletType: "server",
              chainId: 1,
              to: "0x0000000000000000000000000000000000000001",
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

  describe("getTransaction", () => {
    it("should return a transaction by id", async () => {
      const { layer } = makeTestLayers({
        getByIdResult: makeFakeTx({ id: "tx-42" }),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const txService = yield* TransactionService;
          return yield* txService.getTransaction("tx-42");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeDefined();
      expect(result!.id).toBe("tx-42");
    });

    it("should return undefined when transaction not found", async () => {
      const { layer } = makeTestLayers({ getByIdResult: null });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const txService = yield* TransactionService;
          return yield* txService.getTransaction("nonexistent");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeUndefined();
    });
  });

  describe("listTransactions", () => {
    it("should return all transactions with default pagination", async () => {
      const txs = [makeFakeTx({ id: "tx-1" }), makeFakeTx({ id: "tx-2" })];
      const { layer } = makeTestLayers({ listAllResult: txs });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const txService = yield* TransactionService;
          return yield* txService.listTransactions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(2);
    });

    it("should return empty array when no transactions exist", async () => {
      const { layer } = makeTestLayers({ listAllResult: [] });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const txService = yield* TransactionService;
          return yield* txService.listTransactions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });
});
