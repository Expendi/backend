import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import {
  OfframpAdapterRegistry,
  OfframpAdapterRegistryLive,
  OfframpError,
} from "../../../services/offramp/index.js";

const layer = OfframpAdapterRegistryLive;

describe("OfframpAdapterRegistry", () => {
  describe("getAdapter", () => {
    it("should resolve the moonpay adapter", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* OfframpAdapterRegistry;
          return yield* registry.getAdapter("moonpay");
        }).pipe(Effect.provide(layer))
      );

      expect(result.providerName).toBe("moonpay");
    });

    it("should resolve the bridge adapter", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* OfframpAdapterRegistry;
          return yield* registry.getAdapter("bridge");
        }).pipe(Effect.provide(layer))
      );

      expect(result.providerName).toBe("bridge");
    });

    it("should resolve the transak adapter", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* OfframpAdapterRegistry;
          return yield* registry.getAdapter("transak");
        }).pipe(Effect.provide(layer))
      );

      expect(result.providerName).toBe("transak");
    });

    it("should be case-insensitive", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* OfframpAdapterRegistry;
          return yield* registry.getAdapter("MoonPay");
        }).pipe(Effect.provide(layer))
      );

      expect(result.providerName).toBe("moonpay");
    });

    it("should fail with OfframpError for unknown provider", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* OfframpAdapterRegistry;
          return yield* registry.getAdapter("unknown_provider").pipe(
            Effect.matchEffect({
              onSuccess: () => Effect.succeed({ tag: "ok" as const }),
              onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
            })
          );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(OfframpError);
        expect(result.e.provider).toBe("unknown_provider");
        expect(result.e.message).toContain("No offramp adapter registered");
      }
    });
  });

  describe("listProviders", () => {
    it("should list all registered providers", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* OfframpAdapterRegistry;
          return yield* registry.listProviders();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toContain("moonpay");
      expect(result).toContain("bridge");
      expect(result).toContain("transak");
      expect(result).toHaveLength(3);
    });
  });

  describe("adapter methods (stub behavior)", () => {
    it("should initiate an offramp and return an order", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* OfframpAdapterRegistry;
          const adapter = yield* registry.getAdapter("moonpay");
          return yield* adapter.initiateOfframp({
            cryptoAmount: "1000000000000000000",
            fiatCurrency: "USD",
            fiatAmount: "100.00",
            sourceAddress: "0x1234",
            chainId: 1,
            destinationId: "bank-123",
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.provider).toBe("moonpay");
      expect(result.status).toBe("pending");
      expect(result.fiatCurrency).toBe("USD");
      expect(result.orderId).toMatch(/^moonpay-/);
    });

    it("should get offramp status", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* OfframpAdapterRegistry;
          const adapter = yield* registry.getAdapter("bridge");
          return yield* adapter.getOfframpStatus({ orderId: "order-123" });
        }).pipe(Effect.provide(layer))
      );

      expect(result.orderId).toBe("order-123");
      expect(result.provider).toBe("bridge");
    });

    it("should get deposit address", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* OfframpAdapterRegistry;
          const adapter = yield* registry.getAdapter("transak");
          return yield* adapter.getDepositAddress({
            chainId: 1,
            fiatCurrency: "USD",
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.chainId).toBe(1);
      expect(result.address).toBeDefined();
    });

    it("should get supported currencies", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* OfframpAdapterRegistry;
          const adapter = yield* registry.getAdapter("moonpay");
          return yield* adapter.getSupportedCurrencies();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toContain("USD");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should estimate offramp", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* OfframpAdapterRegistry;
          const adapter = yield* registry.getAdapter("bridge");
          return yield* adapter.estimateOfframp({
            cryptoAmount: "1000000000000000000",
            fiatCurrency: "EUR",
            chainId: 1,
          });
        }).pipe(Effect.provide(layer))
      );

      expect(result.provider).toBe("bridge");
      expect(result.fiatCurrency).toBe("EUR");
    });
  });
});
