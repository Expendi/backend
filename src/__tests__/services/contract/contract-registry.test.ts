import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import {
  ContractRegistry,
  ContractRegistryLive,
  ContractNotFoundError,
} from "../../../services/contract/contract-registry.js";
import type { ContractConnector } from "../../../services/contract/types.js";

const testAbi = [
  {
    type: "function" as const,
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable" as const,
  },
] as const;

const makeConnector = (
  name: string,
  chainId: number,
  overrides?: Partial<ContractConnector>
): ContractConnector => ({
  name,
  chainId,
  address: "0x1234567890abcdef1234567890abcdef12345678",
  abi: testAbi as unknown as ContractConnector["abi"],
  ...overrides,
});

const runWithRegistry = <A, E>(
  effect: Effect.Effect<A, E, ContractRegistry>
) => Effect.runPromise(Effect.provide(effect, ContractRegistryLive));

describe("ContractRegistry", () => {
  describe("register", () => {
    it("should register a contract connector", async () => {
      const result = await runWithRegistry(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          yield* registry.register(makeConnector("TestToken", 1));
          return yield* registry.get("TestToken", 1);
        })
      );

      expect(result.name).toBe("TestToken");
      expect(result.chainId).toBe(1);
      expect(result.address).toBe(
        "0x1234567890abcdef1234567890abcdef12345678"
      );
    });

    it("should overwrite an existing connector with the same name and chainId", async () => {
      const newAddress =
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as `0x${string}`;
      const result = await runWithRegistry(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          yield* registry.register(makeConnector("TestToken", 1));
          yield* registry.register(
            makeConnector("TestToken", 1, { address: newAddress })
          );
          return yield* registry.get("TestToken", 1);
        })
      );

      expect(result.address).toBe(newAddress);
    });

    it("should register the same name on different chains independently", async () => {
      const result = await runWithRegistry(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          yield* registry.register(
            makeConnector("TestToken", 1, {
              address:
                "0x1111111111111111111111111111111111111111" as `0x${string}`,
            })
          );
          yield* registry.register(
            makeConnector("TestToken", 137, {
              address:
                "0x2222222222222222222222222222222222222222" as `0x${string}`,
            })
          );
          const mainnet = yield* registry.get("TestToken", 1);
          const polygon = yield* registry.get("TestToken", 137);
          return { mainnet, polygon };
        })
      );

      expect(result.mainnet.address).toBe(
        "0x1111111111111111111111111111111111111111"
      );
      expect(result.polygon.address).toBe(
        "0x2222222222222222222222222222222222222222"
      );
    });
  });

  describe("get", () => {
    it("should fail with ContractNotFoundError when contract does not exist", async () => {
      const result = await runWithRegistry(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          return yield* registry.get("NonExistent", 1).pipe(
            Effect.matchEffect({
              onSuccess: () => Effect.succeed("found" as const),
              onFailure: (e) => Effect.succeed(e),
            })
          );
        })
      );

      expect(result).toBeInstanceOf(ContractNotFoundError);
      expect((result as ContractNotFoundError).name).toBe("NonExistent");
      expect((result as ContractNotFoundError).chainId).toBe(1);
    });

    it("should fail when name matches but chainId does not", async () => {
      const result = await runWithRegistry(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          yield* registry.register(makeConnector("TestToken", 1));
          return yield* registry.get("TestToken", 137).pipe(
            Effect.matchEffect({
              onSuccess: () => Effect.succeed("found" as const),
              onFailure: (e) => Effect.succeed(e),
            })
          );
        })
      );

      expect(result).toBeInstanceOf(ContractNotFoundError);
    });
  });

  describe("list", () => {
    it("should include pre-loaded connectors when no additional contracts registered", async () => {
      const result = await runWithRegistry(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          return yield* registry.list();
        })
      );

      // The registry pre-loads ERC-20 and ERC-721 connectors from code:
      // usdc:1, usdc:137, usdt:1, usdt:137, bayc:1
      expect(result.length).toBeGreaterThanOrEqual(5);
      const names = result.map((c) => `${c.name}:${c.chainId}`);
      expect(names).toContain("usdc:1");
      expect(names).toContain("bayc:1");
    });

    it("should return all registered contracts including pre-loaded ones", async () => {
      const result = await runWithRegistry(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          const beforeCount = (yield* registry.list()).length;
          yield* registry.register(makeConnector("Token", 1));
          yield* registry.register(makeConnector("Vault", 1));
          yield* registry.register(makeConnector("Token", 137));
          return { list: yield* registry.list(), beforeCount };
        })
      );

      // 3 newly registered + whatever was pre-loaded
      expect(result.list).toHaveLength(result.beforeCount + 3);
      const names = result.list.map((c) => `${c.name}:${c.chainId}`);
      expect(names).toContain("Token:1");
      expect(names).toContain("Vault:1");
      expect(names).toContain("Token:137");
    });
  });

  describe("remove", () => {
    it("should return true when removing an existing contract", async () => {
      const result = await runWithRegistry(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          yield* registry.register(makeConnector("TestToken", 1));
          return yield* registry.remove("TestToken", 1);
        })
      );

      expect(result).toBe(true);
    });

    it("should return false when removing a non-existent contract", async () => {
      const result = await runWithRegistry(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          return yield* registry.remove("NonExistent", 1);
        })
      );

      expect(result).toBe(false);
    });

    it("should make the contract no longer accessible after removal", async () => {
      const result = await runWithRegistry(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          yield* registry.register(makeConnector("TestToken", 1));
          yield* registry.remove("TestToken", 1);
          return yield* registry.get("TestToken", 1).pipe(
            Effect.matchEffect({
              onSuccess: () => Effect.succeed("found" as const),
              onFailure: () => Effect.succeed("not_found" as const),
            })
          );
        })
      );

      expect(result).toBe("not_found");
    });

    it("should only remove the specified chain deployment", async () => {
      const result = await runWithRegistry(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          const beforeCount = (yield* registry.list()).length;
          yield* registry.register(makeConnector("CustomToken", 1));
          yield* registry.register(makeConnector("CustomToken", 137));
          // Should have 2 more than pre-loaded
          const afterRegister = yield* registry.list();
          expect(afterRegister).toHaveLength(beforeCount + 2);

          yield* registry.remove("CustomToken", 1);
          const list = yield* registry.list();
          return { list, beforeCount };
        })
      );

      // Only one of the two custom tokens should remain
      expect(result.list).toHaveLength(result.beforeCount + 1);
      const customTokens = result.list.filter((c) => c.name === "CustomToken");
      expect(customTokens).toHaveLength(1);
      expect(customTokens[0]!.chainId).toBe(137);
    });
  });

  describe("methods mapping", () => {
    it("should store and retrieve method mappings", async () => {
      const result = await runWithRegistry(
        Effect.gen(function* () {
          const registry = yield* ContractRegistry;
          yield* registry.register(
            makeConnector("TestToken", 1, {
              methods: {
                send: {
                  functionName: "transfer",
                  description: "Transfer tokens",
                },
              },
            })
          );
          return yield* registry.get("TestToken", 1);
        })
      );

      expect(result.methods).toBeDefined();
      expect(result.methods!["send"]!.functionName).toBe("transfer");
      expect(result.methods!["send"]!.description).toBe("Transfer tokens");
    });
  });
});
