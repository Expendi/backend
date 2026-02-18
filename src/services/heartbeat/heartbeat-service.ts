import { Effect, Context, Layer, Data, Schedule, Ref } from "effect";
import { createPublicClient, http, parseAbiItem, type Chain } from "viem";
import { mainnet, sepolia, polygon, arbitrum, optimism, base } from "viem/chains";
import {
  AdapterService,
  type AdapterError,
} from "../adapters/adapter-service.js";
import {
  TransactionService,
  type TransactionError,
} from "../transaction/transaction-service.js";
import type { LedgerError } from "../ledger/ledger-service.js";

export class HeartbeatError extends Data.TaggedError("HeartbeatError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ConditionType =
  | "balance_threshold"
  | "price_trigger"
  | "block_event";

export interface HeartbeatCondition {
  readonly id: string;
  readonly type: ConditionType;
  readonly params: Record<string, unknown>;
  readonly action: {
    readonly type: "transaction" | "notification";
    readonly payload: Record<string, unknown>;
  };
  readonly active: boolean;
}

export interface HeartbeatServiceApi {
  readonly registerCondition: (
    condition: HeartbeatCondition
  ) => Effect.Effect<void, HeartbeatError>;
  readonly removeCondition: (
    id: string
  ) => Effect.Effect<boolean, HeartbeatError>;
  readonly listConditions: () => Effect.Effect<
    ReadonlyArray<HeartbeatCondition>,
    HeartbeatError
  >;
  readonly checkConditions: () => Effect.Effect<
    ReadonlyArray<string>,
    HeartbeatError | AdapterError | TransactionError | LedgerError
  >;
  readonly startLoop: (
    intervalMs: number
  ) => Effect.Effect<
    void,
    HeartbeatError | AdapterError | TransactionError | LedgerError
  >;
}

export class HeartbeatService extends Context.Tag("HeartbeatService")<
  HeartbeatService,
  HeartbeatServiceApi
>() {}

const CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  137: polygon,
  42161: arbitrum,
  10: optimism,
  8453: base,
};

export const HeartbeatServiceLive: Layer.Layer<
  HeartbeatService,
  never,
  AdapterService | TransactionService
> = Layer.effect(
  HeartbeatService,
  Effect.gen(function* () {
    const adapters = yield* AdapterService;
    const txService = yield* TransactionService;
    const conditionsRef = yield* Ref.make<Map<string, HeartbeatCondition>>(
      new Map()
    );

    const checkBalanceThreshold = (condition: HeartbeatCondition) =>
      Effect.gen(function* () {
        const params = condition.params;
        const chainId = (params.chainId as number) ?? 1;
        const chain = CHAIN_MAP[chainId] ?? mainnet;
        const client = createPublicClient({ chain, transport: http() });

        const address = params.address as `0x${string}`;
        const threshold = BigInt(params.threshold as string);
        const direction = (params.direction as string) ?? "below";

        const balance = yield* Effect.tryPromise({
          try: () => client.getBalance({ address }),
          catch: (error) =>
            new HeartbeatError({
              message: `Failed to check balance: ${error}`,
              cause: error,
            }),
        });

        const triggered =
          direction === "below" ? balance < threshold : balance > threshold;

        return triggered;
      });

    const checkPriceTrigger = (condition: HeartbeatCondition) =>
      Effect.gen(function* () {
        const params = condition.params;
        const symbol = params.symbol as string;
        const targetPrice = params.targetPrice as number;
        const direction = (params.direction as string) ?? "below";

        const priceData = yield* adapters.getPrice(symbol);

        const triggered =
          direction === "below"
            ? priceData.price < targetPrice
            : priceData.price > targetPrice;

        return triggered;
      });

    const checkBlockEvent = (condition: HeartbeatCondition) =>
      Effect.gen(function* () {
        const params = condition.params;
        const chainId = (params.chainId as number) ?? 1;
        const chain = CHAIN_MAP[chainId] ?? mainnet;
        const client = createPublicClient({ chain, transport: http() });

        const contractAddress = params.contractAddress as `0x${string}`;
        const eventSignature = params.eventSignature as string;
        const blockRange = (params.blockRange as number) ?? 100;

        const latestBlock = yield* Effect.tryPromise({
          try: () => client.getBlockNumber(),
          catch: (error) =>
            new HeartbeatError({
              message: `Failed to get block number: ${error}`,
              cause: error,
            }),
        });

        const fromBlock =
          latestBlock > BigInt(blockRange)
            ? latestBlock - BigInt(blockRange)
            : 0n;

        const abiItem = parseAbiItem(`event ${eventSignature}`);

        const filterArgs = params.filterArgs as
          | Record<string, unknown>
          | undefined;

        const logs = yield* Effect.tryPromise({
          try: () =>
            client.getLogs({
              address: contractAddress,
              event: abiItem as Parameters<typeof client.getLogs>[0] extends
                | { event?: infer E }
                | undefined
                ? NonNullable<E>
                : never,
              args: filterArgs,
              fromBlock,
              toBlock: latestBlock,
            } as Parameters<typeof client.getLogs>[0]),
          catch: (error) =>
            new HeartbeatError({
              message: `Failed to fetch logs for event: ${error}`,
              cause: error,
            }),
        });

        return (logs as unknown[]).length > 0;
      });

    const executeAction = (condition: HeartbeatCondition) =>
      Effect.gen(function* () {
        if (condition.action.type === "transaction") {
          const payload = condition.action.payload;
          yield* txService
            .submitRawTransaction({
              walletId: payload.walletId as string,
              walletType: payload.walletType as "user" | "server" | "agent",
              chainId: payload.chainId as number,
              to: payload.to as `0x${string}`,
              value: payload.value
                ? BigInt(payload.value as string)
                : undefined,
            })
            .pipe(
              Effect.mapError(
                (e) =>
                  new HeartbeatError({ message: String(e), cause: e })
              )
            );
        }
      });

    return {
      registerCondition: (condition: HeartbeatCondition) =>
        Ref.update(conditionsRef, (map) => {
          const newMap = new Map(map);
          newMap.set(condition.id, condition);
          return newMap;
        }),

      removeCondition: (id: string) =>
        Ref.modify(conditionsRef, (map) => {
          const newMap = new Map(map);
          const existed = newMap.delete(id);
          return [existed, newMap] as const;
        }),

      listConditions: () =>
        Ref.get(conditionsRef).pipe(
          Effect.map((map) => Array.from(map.values()))
        ),

      checkConditions: () =>
        Effect.gen(function* () {
          const conditions = yield* Ref.get(conditionsRef);
          const triggered: string[] = [];

          for (const [id, condition] of conditions) {
            if (!condition.active) continue;

            let isTriggered = false;

            switch (condition.type) {
              case "balance_threshold":
                isTriggered = yield* checkBalanceThreshold(condition).pipe(
                  Effect.catchAll(() => Effect.succeed(false))
                );
                break;
              case "price_trigger":
                isTriggered = yield* checkPriceTrigger(condition).pipe(
                  Effect.catchAll(() => Effect.succeed(false))
                );
                break;
              case "block_event":
                isTriggered = yield* checkBlockEvent(condition).pipe(
                  Effect.catchAll(() => Effect.succeed(false))
                );
                break;
            }

            if (isTriggered) {
              yield* executeAction(condition).pipe(Effect.ignore);
              triggered.push(id);
            }
          }

          return triggered;
        }),

      startLoop: (intervalMs: number) =>
        Effect.gen(function* () {
          const conditions = yield* Ref.get(conditionsRef);
          const triggered: string[] = [];

          for (const [id, condition] of conditions) {
            if (!condition.active) continue;

            let isTriggered = false;

            switch (condition.type) {
              case "balance_threshold":
                isTriggered = yield* checkBalanceThreshold(condition).pipe(
                  Effect.catchAll(() => Effect.succeed(false))
                );
                break;
              case "price_trigger":
                isTriggered = yield* checkPriceTrigger(condition).pipe(
                  Effect.catchAll(() => Effect.succeed(false))
                );
                break;
              case "block_event":
                isTriggered = yield* checkBlockEvent(condition).pipe(
                  Effect.catchAll(() => Effect.succeed(false))
                );
                break;
            }

            if (isTriggered) {
              yield* executeAction(condition).pipe(Effect.ignore);
              triggered.push(id);
            }
          }
        }).pipe(
          Effect.repeat(Schedule.spaced(`${intervalMs} millis`)),
          Effect.ignore
        ),
    };
  })
);
