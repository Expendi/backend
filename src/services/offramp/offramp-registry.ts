import { Effect, Context, Layer } from "effect";
import type { OfframpAdapter } from "./offramp-adapter.js";
import { OfframpError } from "./offramp-adapter.js";
import {
  createMoonpayAdapter,
  createBridgeAdapter,
  createTransakAdapter,
  createPretiumAdapter,
} from "./adapters/index.js";

// ── Service interface ────────────────────────────────────────────────

export interface OfframpAdapterRegistryApi {
  /** Resolve an adapter by provider name (e.g. "moonpay", "bridge", "transak") */
  readonly getAdapter: (
    providerName: string
  ) => Effect.Effect<OfframpAdapter, OfframpError>;

  /** List all registered provider names */
  readonly listProviders: () => Effect.Effect<ReadonlyArray<string>, never>;
}

export class OfframpAdapterRegistry extends Context.Tag(
  "OfframpAdapterRegistry"
)<OfframpAdapterRegistry, OfframpAdapterRegistryApi>() {}

// ── Live implementation ──────────────────────────────────────────────

export const OfframpAdapterRegistryLive: Layer.Layer<
  OfframpAdapterRegistry,
  never,
  never
> = Layer.sync(OfframpAdapterRegistry, () => {
  // Register all known adapters
  const adapters = new Map<string, OfframpAdapter>();

  const moonpay = createMoonpayAdapter();
  const bridge = createBridgeAdapter();
  const transak = createTransakAdapter();
  const pretium = createPretiumAdapter();

  adapters.set(moonpay.providerName, moonpay);
  adapters.set(bridge.providerName, bridge);
  adapters.set(transak.providerName, transak);
  adapters.set(pretium.providerName, pretium);

  return {
    getAdapter: (providerName: string) =>
      Effect.gen(function* () {
        const adapter = adapters.get(providerName.toLowerCase());
        if (!adapter) {
          return yield* Effect.fail(
            new OfframpError({
              message: `No offramp adapter registered for provider: "${providerName}". Available providers: ${[...adapters.keys()].join(", ")}`,
              provider: providerName,
            })
          );
        }
        return adapter;
      }),

    listProviders: () => Effect.succeed([...adapters.keys()]),
  };
});
