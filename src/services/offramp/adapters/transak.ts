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

const PROVIDER = "transak";

/**
 * Transak offramp adapter (stub).
 *
 * TODO: Replace placeholder implementations with real Transak API calls.
 * Transak docs: https://docs.transak.com/
 */
export function createTransakAdapter(): OfframpAdapter {
  return {
    providerName: PROVIDER,

    initiateOfframp: (params: InitiateOfframpParams) =>
      Effect.gen(function* () {
        // TODO: Call Transak API to initiate a sell order.
        // POST https://api.transak.com/api/v2/orders
        // Headers: { "x-api-key": <apiKey> }
        const order: OfframpOrder = {
          orderId: `transak-${crypto.randomUUID()}`,
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
        // TODO: Call Transak API to get order status.
        // GET https://api.transak.com/api/v2/orders/{id}
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
        // TODO: Transak typically provides a deposit address in the order response.
        const info: DepositAddressInfo = {
          address: "0x0000000000000000000000000000000000000000", // TODO: from API
          chainId: params.chainId,
        };
        return info;
      }),

    getSupportedCurrencies: () =>
      Effect.gen(function* () {
        // TODO: Fetch from Transak API.
        // GET https://api.transak.com/api/v2/currencies/fiat-currencies
        return ["USD", "EUR", "GBP", "INR"] as ReadonlyArray<string>;
      }),

    estimateOfframp: (params: EstimateOfframpParams) =>
      Effect.gen(function* () {
        // TODO: Call Transak price API.
        // GET https://api.transak.com/api/v2/price?...
        const estimate: OfframpEstimate = {
          provider: PROVIDER,
          fiatAmount: "0.00", // TODO: from API
          fiatCurrency: params.fiatCurrency,
          exchangeRate: "0.00", // TODO: from API
          totalFees: "0.00", // TODO: from API
          estimatedMinutes: 20,
        };
        return estimate;
      }),
  };
}
