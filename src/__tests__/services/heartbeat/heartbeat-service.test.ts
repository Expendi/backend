import { describe, it, expect, vi } from "vitest";
import { Effect, Layer } from "effect";
import {
  HeartbeatService,
  HeartbeatServiceLive,
  HeartbeatError,
  type HeartbeatCondition,
} from "../../../services/heartbeat/heartbeat-service.js";
import {
  AdapterService,
  AdapterError,
  type PriceData,
} from "../../../services/adapters/adapter-service.js";
import {
  TransactionService,
  TransactionError,
} from "../../../services/transaction/transaction-service.js";
import { ConfigService } from "../../../config.js";
import type { Transaction } from "../../../db/schema/index.js";

const now = new Date("2025-01-15T12:00:00Z");

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

function makePriceData(overrides?: Partial<PriceData>): PriceData {
  return {
    symbol: "ETH",
    price: 3000,
    percentChange24h: 2.5,
    marketCap: 360000000000,
    volume24h: 15000000000,
    lastUpdated: "2025-01-15T12:00:00Z",
    ...overrides,
  };
}

function makePriceTriggerCondition(overrides?: Partial<HeartbeatCondition>): HeartbeatCondition {
  return {
    id: "cond-price-1",
    type: "price_trigger",
    params: {
      symbol: "ETH",
      targetPrice: 2500,
      direction: "below",
    },
    action: {
      type: "transaction",
      payload: {
        walletId: "wallet-1",
        walletType: "server",
        chainId: 1,
        to: "0x0000000000000000000000000000000000000001",
      },
    },
    active: true,
    ...overrides,
  };
}

function makeBalanceThresholdCondition(): HeartbeatCondition {
  return {
    id: "cond-bal-1",
    type: "balance_threshold",
    params: {
      address: "0x0000000000000000000000000000000000000001",
      threshold: "1000000000000000000",
      direction: "below",
      chainId: 1,
    },
    action: {
      type: "transaction",
      payload: {
        walletId: "wallet-1",
        walletType: "server",
        chainId: 1,
        to: "0x0000000000000000000000000000000000000002",
      },
    },
    active: true,
  };
}

function makeTestLayers(opts?: {
  getPriceResult?: PriceData;
  getPriceFail?: AdapterError;
  submitRawFail?: boolean;
}) {
  const MockAdapterLayer = Layer.succeed(AdapterService, {
    getPrice: (symbol: string) =>
      opts?.getPriceFail
        ? Effect.fail(opts.getPriceFail)
        : Effect.succeed(opts?.getPriceResult ?? makePriceData({ symbol })),
    getPrices: (symbols: ReadonlyArray<string>) =>
      Effect.succeed(symbols.map((s) => makePriceData({ symbol: s }))),
  });

  const MockTxServiceLayer = Layer.succeed(TransactionService, {
    submitContractTransaction: () => Effect.succeed(makeFakeTx()),
    submitRawTransaction: () =>
      opts?.submitRawFail
        ? Effect.fail(new TransactionError({ message: "tx failed" }))
        : Effect.succeed(makeFakeTx()),
    getTransaction: () => Effect.succeed(makeFakeTx()),
    listTransactions: () => Effect.succeed([]),
  });

  const MockConfigLayer = Layer.succeed(ConfigService, {
    databaseUrl: "",
    privyAppId: "",
    privyAppSecret: "",
    coinmarketcapApiKey: "",
    adminApiKey: "",
    defaultChainId: 1,
    port: 3000,
    pretiumApiKey: "",
    pretiumBaseUri: "",
    serverBaseUrl: "",
    uniswapApiKey: "",
    approvalTokenSecret: "",
    baseRpcUrl: "",
  });

  return HeartbeatServiceLive.pipe(
    Layer.provide(MockAdapterLayer),
    Layer.provide(MockTxServiceLayer),
    Layer.provide(MockConfigLayer)
  );
}

describe("HeartbeatService", () => {
  describe("registerCondition", () => {
    it("should register a new condition", async () => {
      const layer = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          yield* heartbeat.registerCondition(makePriceTriggerCondition());
          return yield* heartbeat.listConditions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("cond-price-1");
    });

    it("should overwrite existing condition with same id", async () => {
      const layer = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          yield* heartbeat.registerCondition(makePriceTriggerCondition());
          yield* heartbeat.registerCondition(
            makePriceTriggerCondition({
              params: { symbol: "BTC", targetPrice: 50000, direction: "above" },
            })
          );
          return yield* heartbeat.listConditions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect((result[0]!.params as any).symbol).toBe("BTC");
    });

    it("should register multiple conditions with different ids", async () => {
      const layer = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          yield* heartbeat.registerCondition(
            makePriceTriggerCondition({ id: "c1" })
          );
          yield* heartbeat.registerCondition(
            makePriceTriggerCondition({ id: "c2" })
          );
          yield* heartbeat.registerCondition(
            makePriceTriggerCondition({ id: "c3" })
          );
          return yield* heartbeat.listConditions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(3);
    });
  });

  describe("removeCondition", () => {
    it("should return true when removing existing condition", async () => {
      const layer = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          yield* heartbeat.registerCondition(makePriceTriggerCondition());
          return yield* heartbeat.removeCondition("cond-price-1");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBe(true);
    });

    it("should return false when removing non-existent condition", async () => {
      const layer = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          return yield* heartbeat.removeCondition("nonexistent");
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBe(false);
    });

    it("should remove condition from the list", async () => {
      const layer = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          yield* heartbeat.registerCondition(
            makePriceTriggerCondition({ id: "c1" })
          );
          yield* heartbeat.registerCondition(
            makePriceTriggerCondition({ id: "c2" })
          );
          yield* heartbeat.removeCondition("c1");
          return yield* heartbeat.listConditions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("c2");
    });
  });

  describe("listConditions", () => {
    it("should return empty array when no conditions registered", async () => {
      const layer = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          return yield* heartbeat.listConditions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });
  });

  describe("checkConditions", () => {
    it("should return empty array when no conditions registered", async () => {
      const layer = makeTestLayers();

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          return yield* heartbeat.checkConditions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });

    it("should trigger price_trigger condition when price is below target", async () => {
      const layer = makeTestLayers({
        getPriceResult: makePriceData({ price: 2000 }), // below 2500 target
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          yield* heartbeat.registerCondition(makePriceTriggerCondition());
          return yield* heartbeat.checkConditions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toContain("cond-price-1");
    });

    it("should NOT trigger price_trigger condition when price is above target", async () => {
      const layer = makeTestLayers({
        getPriceResult: makePriceData({ price: 3000 }), // above 2500 target
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          yield* heartbeat.registerCondition(makePriceTriggerCondition());
          return yield* heartbeat.checkConditions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).not.toContain("cond-price-1");
    });

    it("should trigger price_trigger with direction 'above' when price exceeds target", async () => {
      const layer = makeTestLayers({
        getPriceResult: makePriceData({ price: 4000 }),
      });

      const condition = makePriceTriggerCondition({
        params: {
          symbol: "ETH",
          targetPrice: 3500,
          direction: "above",
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          yield* heartbeat.registerCondition(condition);
          return yield* heartbeat.checkConditions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toContain("cond-price-1");
    });

    it("should skip inactive conditions", async () => {
      const layer = makeTestLayers({
        getPriceResult: makePriceData({ price: 2000 }),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          yield* heartbeat.registerCondition(
            makePriceTriggerCondition({ active: false })
          );
          return yield* heartbeat.checkConditions();
        }).pipe(Effect.provide(layer))
      );

      expect(result).toEqual([]);
    });

    it("should gracefully handle adapter errors for price checks", async () => {
      const layer = makeTestLayers({
        getPriceFail: new AdapterError({
          message: "API down",
          source: "coinmarketcap",
        }),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          yield* heartbeat.registerCondition(makePriceTriggerCondition());
          return yield* heartbeat.checkConditions();
        }).pipe(Effect.provide(layer))
      );

      // Should not trigger because the error is caught and defaults to false
      expect(result).toEqual([]);
    });

    it("should handle notification action type without sending transaction", async () => {
      const layer = makeTestLayers({
        getPriceResult: makePriceData({ price: 2000 }),
      });

      const condition = makePriceTriggerCondition({
        action: {
          type: "notification",
          payload: { message: "Price alert!" },
        },
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const heartbeat = yield* HeartbeatService;
          yield* heartbeat.registerCondition(condition);
          return yield* heartbeat.checkConditions();
        }).pipe(Effect.provide(layer))
      );

      // Condition is triggered but action is notification (no tx sent)
      expect(result).toContain("cond-price-1");
    });
  });
});
