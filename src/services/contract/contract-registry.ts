import { Effect, Context, Layer, Data } from "effect";
import type { ContractConnector } from "./types.js";
import { connectors as codeDefinedConnectors } from "../../connectors/index.js";

export class ContractNotFoundError extends Data.TaggedError(
  "ContractNotFoundError"
)<{
  readonly name: string;
  readonly chainId: number;
}> {}

export interface ContractRegistryApi {
  readonly register: (connector: ContractConnector) => Effect.Effect<void>;
  readonly get: (
    name: string,
    chainId: number
  ) => Effect.Effect<ContractConnector, ContractNotFoundError>;
  readonly list: () => Effect.Effect<ReadonlyArray<ContractConnector>>;
  readonly remove: (name: string, chainId: number) => Effect.Effect<boolean>;
}

export class ContractRegistry extends Context.Tag("ContractRegistry")<
  ContractRegistry,
  ContractRegistryApi
>() {}

export const ContractRegistryLive: Layer.Layer<ContractRegistry> = Layer.sync(
  ContractRegistry,
  () => {
    const store = new Map<string, ContractConnector>();

    const makeKey = (name: string, chainId: number) => `${name}:${chainId}`;

    // Pre-register all code-defined connectors from src/connectors/
    for (const connector of codeDefinedConnectors) {
      store.set(makeKey(connector.name, connector.chainId), connector);
    }

    return {
      register: (connector: ContractConnector) =>
        Effect.sync(() => {
          store.set(makeKey(connector.name, connector.chainId), connector);
        }),

      get: (name: string, chainId: number) =>
        Effect.gen(function* () {
          const connector = store.get(makeKey(name, chainId));
          if (!connector) {
            return yield* Effect.fail(
              new ContractNotFoundError({ name, chainId })
            );
          }
          return connector;
        }),

      list: () => Effect.sync(() => Array.from(store.values())),

      remove: (name: string, chainId: number) =>
        Effect.sync(() => store.delete(makeKey(name, chainId))),
    };
  }
);
