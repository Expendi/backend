import { Effect } from "effect";
import {
  type OfframpAdapter,
  type InitiateOfframpParams,
  type GetOfframpStatusParams,
  type GetDepositAddressParams,
  type EstimateOfframpParams,
  type OfframpOrder,
  type OfframpEstimate,
  type DepositAddressInfo,
} from "../offramp-adapter.js";
import {
  SETTLEMENT_ADDRESS,
  SUPPORTED_COUNTRIES,
} from "../../pretium/pretium-service.js";

const PROVIDER = "pretium";

/**
 * Pretium offramp adapter for African mobile money and bank transfers.
 *
 * Unlike other adapters that are self-contained stubs, Pretium operations
 * require the PretiumService and ExchangeRateService from the Effect
 * context. For complex Pretium-specific flows (disburse with country-
 * specific payment types, phone/bank validation), use the PretiumService
 * directly via the /api/pretium/* routes.
 *
 * This adapter provides a simplified OfframpAdapter interface so Pretium
 * appears in the offramp registry alongside MoonPay, Bridge, and Transak.
 */
export function createPretiumAdapter(): OfframpAdapter {
  const supportedCurrencies = Object.values(SUPPORTED_COUNTRIES).map(
    (c) => c.currency
  );

  return {
    providerName: PROVIDER,

    initiateOfframp: (params: InitiateOfframpParams) =>
      Effect.gen(function* () {
        // The full Pretium disburse flow requires country-specific fields
        // (phone number, network, bank details) that are not part of the
        // generic OfframpAdapter interface. Use /api/pretium/offramp for
        // the complete flow. This adapter returns a pending order shell.
        const order: OfframpOrder = {
          orderId: `pretium-${crypto.randomUUID()}`,
          status: "pending",
          provider: PROVIDER,
          fiatCurrency: params.fiatCurrency,
          fiatAmount: params.fiatAmount,
          cryptoAmount: params.cryptoAmount,
          depositAddress: SETTLEMENT_ADDRESS,
          metadata: {
            ...params.metadata,
            note: "Use /api/pretium/offramp for full Pretium disburse flow with country-specific payment details",
          },
          createdAt: new Date().toISOString(),
        };
        return order;
      }),

    getOfframpStatus: (params: GetOfframpStatusParams) =>
      Effect.gen(function* () {
        // Status polling requires the PretiumService context.
        // Use /api/pretium/offramp/:id/status for real status checks.
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
        // Pretium uses a single settlement address for all countries
        const info: DepositAddressInfo = {
          address: SETTLEMENT_ADDRESS,
          chainId: params.chainId,
        };
        return info;
      }),

    getSupportedCurrencies: () =>
      Effect.gen(function* () {
        return supportedCurrencies as ReadonlyArray<string>;
      }),

    estimateOfframp: (params: EstimateOfframpParams) =>
      Effect.gen(function* () {
        // Exchange rate estimation requires the ExchangeRateService.
        // Use /api/pretium/exchange-rate for real-time rates.
        const estimate: OfframpEstimate = {
          provider: PROVIDER,
          fiatAmount: "0.00",
          fiatCurrency: params.fiatCurrency,
          exchangeRate: "0.00",
          totalFees: "0.00",
          estimatedMinutes: 5,
        };
        return estimate;
      }),
  };
}
