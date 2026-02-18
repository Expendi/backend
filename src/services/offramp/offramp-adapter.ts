import { Effect, Data } from "effect";

// ── Error type ───────────────────────────────────────────────────────

export class OfframpError extends Data.TaggedError("OfframpError")<{
  readonly message: string;
  readonly provider: string;
  readonly cause?: unknown;
}> {}

// ── Parameter types ──────────────────────────────────────────────────

export interface InitiateOfframpParams {
  /** Crypto amount to convert (in smallest unit, e.g. wei) */
  readonly cryptoAmount: string;
  /** Fiat currency code (e.g. "USD", "EUR") */
  readonly fiatCurrency: string;
  /** Desired fiat amount (decimal string, e.g. "100.50") */
  readonly fiatAmount: string;
  /** The wallet address sending crypto */
  readonly sourceAddress: string;
  /** Chain ID for the source transaction */
  readonly chainId: number;
  /** Bank account / payment method ID at the provider */
  readonly destinationId: string;
  /** Provider-specific metadata */
  readonly metadata?: Record<string, unknown>;
}

export interface GetOfframpStatusParams {
  /** The provider's order/transaction ID */
  readonly orderId: string;
}

export interface GetDepositAddressParams {
  /** Chain ID for the deposit */
  readonly chainId: number;
  /** Fiat currency code */
  readonly fiatCurrency: string;
  /** Optional: the crypto token symbol (e.g. "ETH", "USDC") */
  readonly cryptoSymbol?: string;
}

export interface EstimateOfframpParams {
  /** Crypto amount to convert */
  readonly cryptoAmount: string;
  /** Fiat currency code */
  readonly fiatCurrency: string;
  /** Chain ID */
  readonly chainId: number;
  /** Optional: specific crypto token symbol */
  readonly cryptoSymbol?: string;
}

// ── Result types ─────────────────────────────────────────────────────

export interface OfframpOrder {
  /** Provider's unique order ID */
  readonly orderId: string;
  /** Status of the order */
  readonly status: "pending" | "processing" | "completed" | "failed";
  /** Provider name */
  readonly provider: string;
  /** Fiat currency */
  readonly fiatCurrency: string;
  /** Fiat amount */
  readonly fiatAmount: string;
  /** Crypto amount sent/to-send */
  readonly cryptoAmount: string;
  /** Deposit address to send crypto to (if applicable) */
  readonly depositAddress?: string;
  /** Provider-specific metadata */
  readonly metadata?: Record<string, unknown>;
  /** ISO timestamp of creation */
  readonly createdAt: string;
}

export interface OfframpEstimate {
  /** Provider name */
  readonly provider: string;
  /** Estimated fiat amount after fees */
  readonly fiatAmount: string;
  /** Fiat currency */
  readonly fiatCurrency: string;
  /** Exchange rate used */
  readonly exchangeRate: string;
  /** Total fees in fiat */
  readonly totalFees: string;
  /** Estimated time to completion in minutes */
  readonly estimatedMinutes: number;
}

export interface DepositAddressInfo {
  /** The crypto deposit address */
  readonly address: string;
  /** Chain ID */
  readonly chainId: number;
  /** Optional: memo/tag for the deposit */
  readonly memo?: string;
  /** Minimum deposit amount (in crypto smallest unit) */
  readonly minimumAmount?: string;
}

// ── Adapter interface ────────────────────────────────────────────────

export interface OfframpAdapter {
  /** Unique provider identifier (e.g. "moonpay", "bridge", "transak") */
  readonly providerName: string;

  /** Initiate a crypto-to-fiat offramp conversion */
  readonly initiateOfframp: (
    params: InitiateOfframpParams
  ) => Effect.Effect<OfframpOrder, OfframpError>;

  /** Check the status of an existing offramp order */
  readonly getOfframpStatus: (
    params: GetOfframpStatusParams
  ) => Effect.Effect<OfframpOrder, OfframpError>;

  /** Get the crypto deposit address for the provider (some providers require sending crypto to a specific address) */
  readonly getDepositAddress: (
    params: GetDepositAddressParams
  ) => Effect.Effect<DepositAddressInfo, OfframpError>;

  /** List supported fiat currencies for this provider */
  readonly getSupportedCurrencies: () => Effect.Effect<
    ReadonlyArray<string>,
    OfframpError
  >;

  /** Get a quote/estimate for a conversion */
  readonly estimateOfframp: (
    params: EstimateOfframpParams
  ) => Effect.Effect<OfframpEstimate, OfframpError>;
}
