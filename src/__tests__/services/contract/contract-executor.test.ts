import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import {
  ContractExecutor,
  ContractExecutorLive,
  ContractExecutionError,
} from "../../../services/contract/contract-executor.js";
import {
  ContractRegistry,
  ContractNotFoundError,
} from "../../../services/contract/contract-registry.js";
import {
  WalletService,
  WalletError,
  type WalletInstance,
} from "../../../services/wallet/wallet-service.js";
import type { ContractConnector } from "../../../services/contract/types.js";

const erc20Abi = [
  {
    type: "function" as const,
    name: "transfer",
    inputs: [
      { name: "to", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "nonpayable" as const,
  },
  {
    type: "function" as const,
    name: "balanceOf",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view" as const,
  },
] as const;

const testConnector: ContractConnector = {
  name: "TestToken",
  chainId: 1,
  address: "0x1234567890abcdef1234567890abcdef12345678",
  abi: erc20Abi as unknown as ContractConnector["abi"],
  methods: {
    send: { functionName: "transfer", description: "Transfer tokens" },
  },
};

const fakeTxHash =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as const;

function makeMockWalletInstance(overrides?: Partial<WalletInstance>): WalletInstance {
  return {
    getAddress: () =>
      Effect.succeed("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as `0x${string}`),
    sign: () =>
      Effect.succeed("0xsignature" as `0x${string}`),
    sendTransaction: () => Effect.succeed(fakeTxHash),
    ...overrides,
  };
}

function makeTestLayers(opts?: {
  registryGet?: (
    name: string,
    chainId: number
  ) => Effect.Effect<ContractConnector, ContractNotFoundError>;
  walletInstance?: WalletInstance;
  getWalletError?: WalletError;
}) {
  const MockRegistryLayer = Layer.succeed(ContractRegistry, {
    register: () => Effect.void,
    get: opts?.registryGet ??
      ((name: string, chainId: number) => {
        if (name === testConnector.name && chainId === testConnector.chainId) {
          return Effect.succeed(testConnector);
        }
        return Effect.fail(new ContractNotFoundError({ name, chainId }));
      }),
    list: () => Effect.succeed([testConnector]),
    remove: () => Effect.succeed(true),
  });

  const MockWalletServiceLayer = Layer.succeed(WalletService, {
    createUserWallet: () => Effect.succeed(makeMockWalletInstance()),
    createServerWallet: () => Effect.succeed(makeMockWalletInstance()),
    createAgentWallet: () => Effect.succeed(makeMockWalletInstance()),
    getWallet: () =>
      opts?.getWalletError
        ? Effect.fail(opts.getWalletError)
        : Effect.succeed(opts?.walletInstance ?? makeMockWalletInstance()),
  });

  return ContractExecutorLive.pipe(
    Layer.provide(MockRegistryLayer),
    Layer.provide(MockWalletServiceLayer)
  );
}

describe("ContractExecutor", () => {
  describe("execute", () => {
    it("should encode function data and send transaction", async () => {
      const testLayer = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* ContractExecutor;
          return yield* executor.execute(
            {
              contractName: "TestToken",
              chainId: 1,
              method: "transfer",
              args: [
                "0x0000000000000000000000000000000000000001",
                BigInt(1000),
              ],
            },
            "wallet-1",
            "server"
          );
        }).pipe(Effect.provide(testLayer))
      );

      expect(result.txHash).toBe(fakeTxHash);
      expect(result.contractName).toBe("TestToken");
      expect(result.method).toBe("transfer");
      expect(result.chainId).toBe(1);
    });

    it("should resolve method aliases via methods mapping", async () => {
      let capturedTx: { data?: string } = {};
      const walletInstance = makeMockWalletInstance({
        sendTransaction: (tx) => {
          capturedTx = tx;
          return Effect.succeed(fakeTxHash);
        },
      });
      const testLayer = makeTestLayers({ walletInstance });

      await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* ContractExecutor;
          return yield* executor.execute(
            {
              contractName: "TestToken",
              chainId: 1,
              method: "send", // alias for "transfer"
              args: [
                "0x0000000000000000000000000000000000000001",
                BigInt(1000),
              ],
            },
            "wallet-1",
            "server"
          );
        }).pipe(Effect.provide(testLayer))
      );

      // The encoded data should exist and be a hex string (it encoded "transfer")
      expect(capturedTx.data).toBeDefined();
      expect(typeof capturedTx.data).toBe("string");
      expect(capturedTx.data!.startsWith("0x")).toBe(true);
    });

    it("should fail with ContractNotFoundError when contract is not registered", async () => {
      const testLayer = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* ContractExecutor;
          return yield* executor
            .execute(
              {
                contractName: "Unknown",
                chainId: 1,
                method: "transfer",
                args: [],
              },
              "wallet-1",
              "server"
            )
            .pipe(
              Effect.matchEffect({
                onSuccess: (r) => Effect.succeed({ tag: "ok" as const, r }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(testLayer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(ContractNotFoundError);
      }
    });

    it("should fail with ContractExecutionError for invalid ABI encoding", async () => {
      const testLayer = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* ContractExecutor;
          return yield* executor
            .execute(
              {
                contractName: "TestToken",
                chainId: 1,
                method: "nonExistentMethod",
                args: [],
              },
              "wallet-1",
              "server"
            )
            .pipe(
              Effect.matchEffect({
                onSuccess: (r) => Effect.succeed({ tag: "ok" as const, r }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(testLayer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(ContractExecutionError);
      }
    });

    it("should propagate wallet errors as ContractExecutionError", async () => {
      const walletInstance = makeMockWalletInstance({
        sendTransaction: () =>
          Effect.fail(new WalletError({ message: "wallet kaput" })),
      });
      const testLayer = makeTestLayers({ walletInstance });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* ContractExecutor;
          return yield* executor
            .execute(
              {
                contractName: "TestToken",
                chainId: 1,
                method: "transfer",
                args: [
                  "0x0000000000000000000000000000000000000001",
                  BigInt(1000),
                ],
              },
              "wallet-1",
              "server"
            )
            .pipe(
              Effect.matchEffect({
                onSuccess: (r) => Effect.succeed({ tag: "ok" as const, r }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(testLayer))
      );

      expect(result.tag).toBe("err");
    });

    it("should pass value and correct chain to wallet sendTransaction", async () => {
      let capturedTx: { to?: string; value?: bigint; chainId?: number; data?: string } = {};
      const walletInstance = makeMockWalletInstance({
        sendTransaction: (tx) => {
          capturedTx = tx;
          return Effect.succeed(fakeTxHash);
        },
      });
      const testLayer = makeTestLayers({ walletInstance });

      await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* ContractExecutor;
          return yield* executor.execute(
            {
              contractName: "TestToken",
              chainId: 1,
              method: "transfer",
              args: [
                "0x0000000000000000000000000000000000000001",
                BigInt(1000),
              ],
              value: BigInt(500),
            },
            "wallet-1",
            "server"
          );
        }).pipe(Effect.provide(testLayer))
      );

      expect(capturedTx.to).toBe(testConnector.address);
      expect(capturedTx.value).toBe(BigInt(500));
      expect(capturedTx.chainId).toBe(1);
    });
  });

  describe("readContract", () => {
    it("should fail with ContractNotFoundError for unregistered contract", async () => {
      const testLayer = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* ContractExecutor;
          return yield* executor.readContract("Unknown", 1, "balanceOf", []).pipe(
            Effect.matchEffect({
              onSuccess: (r) => Effect.succeed({ tag: "ok" as const, r }),
              onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
            })
          );
        }).pipe(Effect.provide(testLayer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(ContractNotFoundError);
      }
    });

    // Note: testing readContract success fully would require mocking viem's
    // createPublicClient which is created inside the executor. Since it makes
    // real HTTP calls, we test that the error path works correctly instead.
    it("should fail with ContractExecutionError when RPC call fails", async () => {
      const testLayer = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* ContractExecutor;
          return yield* executor
            .readContract("TestToken", 1, "balanceOf", [
              "0x0000000000000000000000000000000000000001",
            ])
            .pipe(
              Effect.matchEffect({
                onSuccess: (r) => Effect.succeed({ tag: "ok" as const, r }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(testLayer))
      );

      // Will fail because there is no real RPC endpoint, which is the expected behavior
      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(ContractExecutionError);
      }
    });
  });
});
