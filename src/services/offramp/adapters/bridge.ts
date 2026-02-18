import { Effect } from "effect";
import {
  type OfframpAdapter,
  OfframpError,
  type InitiateOfframpParams,
  type GetOfframpStatusParams,
  type GetDepositAddressParams,
  type EstimateOfframpParams,
  type OfframpOrder,
  type OfframpEstimate,
  type DepositAddressInfo,
} from "../offramp-adapter.js";

const PROVIDER = "bridge";

/**
 * Bridge (bridge.xyz) offramp adapter (stub).
 *
 * TODO: Replace placeholder implementations with real Bridge API calls.
 * Bridge docs: https://docs.bridge.xyz/
 */
export function createBridgeAdapter(): OfframpAdapter {
  return {
    providerName: PROVIDER,

    initiateOfframp: (params: InitiateOfframpParams) =>
      Effect.gen(function* () {
        // TODO: Call Bridge API to initiate a liquidation (crypto-to-fiat).
        // POST https://api.bridge.xyz/v0/transfers
        // Headers: { "Api-Key": <apiKey> }
        const order: OfframpOrder = {
          orderId: `bridge-${crypto.randomUUID()}`,
          status: "pending",
          provider: PROVIDER,
          fiatCurrency: params.fiatCurrency,
          fiatAmount: params.fiatAmount,
          cryptoAmount: params.cryptoAmount,
          depositAddress: "0x0000000000000000000000000000000000000000", // TODO: from API response
          metadata: params.metadata,
          createdAt: new Date().toISOString(),
        };
        return order;
      }),

    getOfframpStatus: (params: GetOfframpStatusParams) =>
      Effect.gen(function* () {
        // TODO: Call Bridge API to get transfer status.
        // GET https://api.bridge.xyz/v0/transfers/{id}
        const order: OfframpOrder = {
          orderId: params.orderId,
          status: "processing",
          provider: PROVIDER,
          fiatCurrency: "USD",
          fiatAmount: "0",
          cryptoAmount: "0",
          createdAt: new Date().toISOString(),
        };
        return order;
      }),

    getDepositAddress: (params: GetDepositAddressParams) =>
      Effect.gen(function* () {
        // TODO: Bridge provides deposit addresses per-transfer.
        // May need to create a transfer first or use a pre-configured address.
        const info: DepositAddressInfo = {
          address: "0x0000000000000000000000000000000000000000", // TODO: from API
          chainId: params.chainId,
        };
        return info;
      }),

    getSupportedCurrencies: () =>
      Effect.gen(function* () {
        // TODO: Fetch from Bridge API.
        // Bridge typically supports USD, EUR, and other major currencies.
        return ["USD", "EUR"] as ReadonlyArray<string>;
      }),

    estimateOfframp: (params: EstimateOfframpParams) =>
      Effect.gen(function* () {
        // TODO: Call Bridge quote/estimate API.
        const estimate: OfframpEstimate = {
          provider: PROVIDER,
          fiatAmount: "0.00", // TODO: from API
          fiatCurrency: params.fiatCurrency,
          exchangeRate: "0.00", // TODO: from API
          totalFees: "0.00", // TODO: from API
          estimatedMinutes: 15,
        };
        return estimate;
      }),
  };
}
