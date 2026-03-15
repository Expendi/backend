import { Effect, Context, Layer, Data } from "effect";
import { ConfigService } from "../../config.js";

// ── Error type ───────────────────────────────────────────────────────

export class ExchangeRateError extends Data.TaggedError("ExchangeRateError")<{
  readonly message: string;
  readonly code: ExchangeRateErrorCode;
}> {}

export type ExchangeRateErrorCode =
  | "INVALID_CURRENCY"
  | "NETWORK_ERROR"
  | "API_ERROR"
  | "AUTHENTICATION_FAILED";

// ── Types ────────────────────────────────────────────────────────────

export interface ExchangeRateData {
  readonly buyingRate: number;
  readonly sellingRate: number;
  readonly quotedRate: number;
}

export interface ConversionResult {
  readonly amount: number;
  readonly exchangeRate: number;
}

// ── Cache ────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedRate {
  data: ExchangeRateData;
  timestamp: number;
}

const rateCache = new Map<string, CachedRate>();

const getCachedRate = (currency: string): ExchangeRateData | null => {
  const cached = rateCache.get(currency.toUpperCase());
  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL_MS) {
    rateCache.delete(currency.toUpperCase());
    return null;
  }

  return cached.data;
};

const setCachedRate = (currency: string, data: ExchangeRateData): void => {
  rateCache.set(currency.toUpperCase(), { data, timestamp: Date.now() });
};

// ── Service interface ────────────────────────────────────────────────

export interface ExchangeRateServiceApi {
  /** Fetch exchange rate for a fiat currency (e.g. "KES", "NGN") */
  readonly getExchangeRate: (
    currency: string
  ) => Effect.Effect<ExchangeRateData, ExchangeRateError>;

  /** Convert USDC amount to fiat using the quoted rate */
  readonly convertUsdcToFiat: (
    usdcAmount: number,
    currency: string
  ) => Effect.Effect<ConversionResult, ExchangeRateError>;

  /** Convert fiat amount to USDC using the quoted rate (or selling rate) */
  readonly convertFiatToUsdc: (
    fiatAmount: number,
    currency: string,
    rateType?: "quoted" | "selling"
  ) => Effect.Effect<ConversionResult, ExchangeRateError>;

  /** Clear the rate cache */
  readonly clearCache: () => Effect.Effect<void, never>;
}

export class ExchangeRateService extends Context.Tag("ExchangeRateService")<
  ExchangeRateService,
  ExchangeRateServiceApi
>() {}

// ── Live implementation ──────────────────────────────────────────────

export const ExchangeRateServiceLive: Layer.Layer<
  ExchangeRateService,
  never,
  ConfigService
> = Layer.effect(
  ExchangeRateService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const baseUri = config.pretiumBaseUri;
    const apiKey = config.pretiumApiKey;

    const fetchRate = (
      currency: string
    ): Effect.Effect<ExchangeRateData, ExchangeRateError> => {
      const normalizedCurrency = currency.toUpperCase();

      // Check cache first
      const cached = getCachedRate(normalizedCurrency);
      if (cached) {
        return Effect.succeed(cached);
      }

      return Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${baseUri}/v1/exchange-rate`, {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ currency_code: normalizedCurrency }),
            signal: AbortSignal.timeout(10_000),
          });

          if (!response.ok) {
            const status = response.status;
            const data = (await response.json().catch(() => ({}))) as Record<
              string,
              unknown
            >;

            if (status === 401) {
              throw new ExchangeRateError({
                message: "Pretium API authentication failed",
                code: "AUTHENTICATION_FAILED",
              });
            }

            if (status === 400) {
              throw new ExchangeRateError({
                message:
                  (data?.message as string) || "Invalid currency code",
                code: "INVALID_CURRENCY",
              });
            }

            throw new ExchangeRateError({
              message:
                (data?.message as string) || `API error: ${status}`,
              code: "API_ERROR",
            });
          }

          const json = (await response.json()) as {
            data: {
              buying_rate: number;
              selling_rate: number;
              quoted_rate?: number;
            };
          };

          const rawData = json.data;
          const rateData: ExchangeRateData = {
            buyingRate: rawData.buying_rate,
            sellingRate: rawData.selling_rate,
            quotedRate: rawData.quoted_rate ?? rawData.buying_rate,
          };

          // Cache the result
          setCachedRate(normalizedCurrency, rateData);

          return rateData;
        },
        catch: (error) => {
          if (error instanceof ExchangeRateError) return error;
          return new ExchangeRateError({
            message: "Network error fetching exchange rate",
            code: "NETWORK_ERROR",
          });
        },
      });
    };

    return {
      getExchangeRate: fetchRate,

      convertUsdcToFiat: (usdcAmount: number, currency: string) =>
        Effect.gen(function* () {
          const rate = yield* fetchRate(currency);
          const fiatAmount =
            Math.round(usdcAmount * rate.quotedRate * 100) / 100;
          return { amount: fiatAmount, exchangeRate: rate.quotedRate };
        }),

      convertFiatToUsdc: (fiatAmount: number, currency: string, rateType: "quoted" | "selling" = "quoted") =>
        Effect.gen(function* () {
          const rate = yield* fetchRate(currency);
          const effectiveRate = rateType === "selling" ? rate.sellingRate : rate.quotedRate;
          const usdcAmount =
            Math.round((fiatAmount / effectiveRate) * 1e6) / 1e6;
          return { amount: usdcAmount, exchangeRate: effectiveRate };
        }),

      clearCache: () =>
        Effect.sync(() => {
          rateCache.clear();
        }),
    };
  })
);
