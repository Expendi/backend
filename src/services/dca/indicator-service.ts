import { Effect, Context, Layer, Data } from "effect";
import {
  MarketIntelligenceService,
  type PricePoint,
} from "../adapters/coingecko.js";

// ── Error ────────────────────────────────────────────────────────────

export class IndicatorError extends Data.TaggedError("IndicatorError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export interface IndicatorValues {
  readonly sma200: number | null;
  readonly rsi: number | null;
  readonly fearGreedIndex: number | null;
  readonly currentPrice: number;
}

// ── Pure calculation helpers ─────────────────────────────────────────

/** Calculate Simple Moving Average for a given period */
export function calculateSMA(
  prices: ReadonlyArray<number>,
  period: number
): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

/** Calculate Relative Strength Index */
export function calculateRSI(
  prices: ReadonlyArray<number>,
  period: number = 14
): number | null {
  if (prices.length < period + 1) return null;

  const changes = prices.slice(-(period + 1));
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < changes.length; i++) {
    const change = changes[i]! - changes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }

  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── Service interface ────────────────────────────────────────────────

export interface IndicatorServiceApi {
  /** Get all indicator values for a given token symbol */
  readonly getIndicators: (
    symbol: string
  ) => Effect.Effect<IndicatorValues, IndicatorError>;

  /** Fetch the current Fear & Greed index */
  readonly getFearGreedIndex: () => Effect.Effect<number, IndicatorError>;
}

export class IndicatorService extends Context.Tag("IndicatorService")<
  IndicatorService,
  IndicatorServiceApi
>() {}

// ── Fear & Greed cache ───────────────────────────────────────────────

const FEAR_GREED_CACHE_TTL_MS = 3_600_000; // 1 hour
let fearGreedCache: { value: number; cachedAt: number } | null = null;

// ── Live implementation ──────────────────────────────────────────────

export const IndicatorServiceLive: Layer.Layer<
  IndicatorService,
  never,
  MarketIntelligenceService
> = Layer.effect(
  IndicatorService,
  Effect.gen(function* () {
    const market = yield* MarketIntelligenceService;

    const fetchFearGreedIndex = (): Effect.Effect<number, IndicatorError> =>
      Effect.gen(function* () {
        if (
          fearGreedCache &&
          Date.now() - fearGreedCache.cachedAt < FEAR_GREED_CACHE_TTL_MS
        ) {
          return fearGreedCache.value;
        }

        const result = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(
              "https://api.alternative.me/fng/?limit=1",
              { signal: AbortSignal.timeout(10_000) }
            );
            if (!response.ok) {
              throw new Error(
                `Fear & Greed API error: ${response.status} ${response.statusText}`
              );
            }
            const data = (await response.json()) as {
              data: Array<{ value: string; value_classification: string }>;
            };
            return Number(data.data[0]?.value ?? 50);
          },
          catch: (error) =>
            new IndicatorError({
              message: `Failed to fetch Fear & Greed index: ${error}`,
              cause: error,
            }),
        });

        fearGreedCache = { value: result, cachedAt: Date.now() };
        return result;
      });

    const getIndicators = (
      symbol: string
    ): Effect.Effect<IndicatorValues, IndicatorError> =>
      Effect.gen(function* () {
        // Fetch price history (200+ days for SMA-200)
        const priceHistory = yield* market
          .getPriceHistory(symbol, 210)
          .pipe(
            Effect.mapError(
              (e) =>
                new IndicatorError({
                  message: `Failed to fetch price history for ${symbol}: ${e.message}`,
                  cause: e,
                })
            )
          );

        const prices = priceHistory.map((p) => p.price);
        const currentPrice = prices.length > 0 ? prices[prices.length - 1]! : 0;

        // Calculate SMA-200
        const sma200 = calculateSMA(prices, 200);

        // Calculate RSI-14
        const rsi = calculateRSI(prices, 14);

        // Fetch Fear & Greed index
        const fearGreedIndex = yield* fetchFearGreedIndex().pipe(
          Effect.catchAll(() => Effect.succeed(-1))
        );

        return {
          sma200,
          rsi,
          fearGreedIndex: fearGreedIndex === -1 ? null : fearGreedIndex,
          currentPrice,
        };
      });

    return {
      getIndicators,
      getFearGreedIndex: fetchFearGreedIndex,
    };
  })
);
