import { describe, it, expect } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  ContractRegistry,
  ContractRegistryLive,
  ContractNotFoundError,
} from "../../services/contract/contract-registry.js";
import {
  ContractExecutor,
  ContractExecutionError,
} from "../../services/contract/contract-executor.js";
import type { ContractConnector } from "../../services/contract/types.js";

/**
 * Contract route tests -- the public contract routes (POST register, DELETE)
 * were removed when routes were restructured. Contract read-only access is
 * done through the ContractRegistry service directly. These tests verify
 * that the registry is usable with pre-loaded connectors and custom ones.
 */

const testConnector: ContractConnector = {
  name: "TestToken",
  chainId: 1,
  address: "0x1234567890abcdef1234567890abcdef12345678",
  abi: [],
};

function makeTestRuntime(opts?: {
  listResult?: ContractConnector[];
  getResult?: ContractConnector;
  getFail?: boolean;
  readResult?: unknown;
  readFail?: boolean;
}) {
  const MockRegistryLayer = Layer.succeed(ContractRegistry, {
    register: () => Effect.void,
    get: (name: string, chainId: number) =>
      opts?.getFail
        ? Effect.fail(new ContractNotFoundError({ name, chainId }))
        : Effect.succeed(opts?.getResult ?? testConnector),
    list: () => Effect.succeed(opts?.listResult ?? [testConnector]),
    remove: () => Effect.succeed(true),
  });

  const MockExecutorLayer = Layer.succeed(ContractExecutor, {
    execute: () =>
      Effect.succeed({
        txHash: "0xhash" as `0x${string}`,
        contractName: "TestToken",
        method: "transfer",
        chainId: 1,
      }),
    readContract: () =>
      opts?.readFail
        ? Effect.fail(
            new ContractExecutionError({ message: "read failed" })
          )
        : Effect.succeed(opts?.readResult ?? BigInt(1000)),
  });

  const testLayer = Layer.mergeAll(MockRegistryLayer, MockExecutorLayer);
  return ManagedRuntime.make(testLayer);
}

describe("Contract Service Integration", () => {
  describe("registry list", () => {
    it("should return contracts from registry", async () => {
      const runtime = makeTestRuntime();

      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          return yield* registry.list();
        })
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);

      await runtime.dispose();
    });

    it("should return empty array when registry has no contracts", async () => {
      const runtime = makeTestRuntime({ listResult: [] });

      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          return yield* registry.list();
        })
      );

      expect(result).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("registry get", () => {
    it("should return a contract for valid name and chainId", async () => {
      const runtime = makeTestRuntime();

      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          return yield* registry.get("TestToken", 1);
        })
      );

      expect(result.name).toBe("TestToken");

      await runtime.dispose();
    });

    it("should fail with ContractNotFoundError when contract not found", async () => {
      const runtime = makeTestRuntime({ getFail: true });

      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          return yield* registry.get("Unknown", 1).pipe(
            Effect.matchEffect({
              onSuccess: () => Effect.succeed("found" as const),
              onFailure: (e) => Effect.succeed(e),
            })
          );
        })
      );

      expect(result).toBeInstanceOf(ContractNotFoundError);

      await runtime.dispose();
    });
  });

  describe("contract executor read", () => {
    it("should read from contract and return result", async () => {
      const runtime = makeTestRuntime({ readResult: "42" });

      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const executor = yield* ContractExecutor;
          return yield* executor.readContract({
            contractName: "TestToken",
            chainId: 1,
            method: "balanceOf",
            args: ["0x0000000000000000000000000000000000000001"],
          });
        })
      );

      expect(result).toBe("42");

      await runtime.dispose();
    });

    it("should fail when read fails", async () => {
      const runtime = makeTestRuntime({ readFail: true });

      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const executor = yield* ContractExecutor;
          return yield* executor
            .readContract({
              contractName: "TestToken",
              chainId: 1,
              method: "balanceOf",
              args: [],
            })
            .pipe(
              Effect.matchEffect({
                onSuccess: () => Effect.succeed("ok" as const),
                onFailure: (e) => Effect.succeed(e),
              })
            );
        })
      );

      expect(result).toBeInstanceOf(ContractExecutionError);

      await runtime.dispose();
    });
  });

  describe("pre-loaded connectors via ContractRegistryLive", () => {
    it("should have pre-loaded ERC-20 and ERC-721 connectors", async () => {
      const result = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const registry = yield* ContractRegistry;
            return yield* registry.list();
          }),
          ContractRegistryLive
        )
      );

      // The registry should have pre-loaded connectors: usdc(1), usdc(137),
      // usdt(1), usdt(137), bayc(1)
      expect(result.length).toBeGreaterThanOrEqual(5);
      const names = result.map((c) => `${c.name}:${c.chainId}`);
      expect(names).toContain("usdc:1");
      expect(names).toContain("usdc:137");
      expect(names).toContain("usdt:1");
      expect(names).toContain("usdt:137");
      expect(names).toContain("bayc:1");
    });

    it("should retrieve a pre-loaded connector by name and chainId", async () => {
      const result = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const registry = yield* ContractRegistry;
            return yield* registry.get("usdc", 1);
          }),
          ContractRegistryLive
        )
      );

      expect(result.name).toBe("usdc");
      expect(result.chainId).toBe(1);
      expect(result.address).toBe(
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
      );
    });
  });
});
