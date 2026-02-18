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

const PROVIDER = "moonpay";

/**
 * Moonpay offramp adapter (stub).
 *
 * TODO: Replace placeholder implementations with real Moonpay API calls.
 * Moonpay docs: https://docs.moonpay.com/
 */
export function createMoonpayAdapter(): OfframpAdapter {
  return {
    providerName: PROVIDER,

    initiateOfframp: (params: InitiateOfframpParams) =>
      Effect.gen(function* () {
        // TODO: Call Moonpay sell API to initiate crypto-to-fiat conversion.
        // POST https://api.moonpay.com/v1/sell_transactions
        // Headers: { Authorization: Bearer <apiKey> }
        // Body: { baseCurrencyAmount, quoteCurrencyCode, depositWalletAddress, ... }
        const order: OfframpOrder = {
          orderId: `moonpay-${crypto.randomUUID()}`,
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
        // TODO: Call Moonpay API to get sell transaction status.
        // GET https://api.moonpay.com/v1/sell_transactions/{id}
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
        // TODO: Moonpay provides deposit addresses as part of the sell flow.
        // This may require creating a sell transaction first.
        const info: DepositAddressInfo = {
          address: "0x0000000000000000000000000000000000000000", // TODO: from API
          chainId: params.chainId,
        };
        return info;
      }),

    getSupportedCurrencies: () =>
      Effect.gen(function* () {
        // TODO: Fetch from Moonpay API.
        // GET https://api.moonpay.com/v1/currencies
        return ["USD", "EUR", "GBP"] as ReadonlyArray<string>;
      }),

    estimateOfframp: (params: EstimateOfframpParams) =>
      Effect.gen(function* () {
        // TODO: Call Moonpay quote API.
        // GET https://api.moonpay.com/v1/sell_quote?baseCurrencyCode=...
        const estimate: OfframpEstimate = {
          provider: PROVIDER,
          fiatAmount: "0.00", // TODO: from API
          fiatCurrency: params.fiatCurrency,
          exchangeRate: "0.00", // TODO: from API
          totalFees: "0.00", // TODO: from API
          estimatedMinutes: 30,
        };
        return estimate;
      }),
  };
}
