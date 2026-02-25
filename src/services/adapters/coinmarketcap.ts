import { Effect, Layer } from "effect";
import { AdapterService, AdapterError, type PriceData } from "./adapter-service.js";
import { ConfigService } from "../../config.js";

interface CmcQuoteResponse {
  data: Record<
    string,
    {
      symbol: string;
      quote: {
        USD: {
          price: number;
          percent_change_24h: number;
          market_cap: number;
          volume_24h: number;
          last_updated: string;
        };
      };
    }
  >;
}

// Cache configuration
const CACHE_TTL_MS = 60_000; // 1 minute cache (prices checked every minute anyway)
const REQUEST_TIMEOUT_MS = 10_000; // 10 second timeout

interface CachedPrices {
  readonly data: CmcQuoteResponse;
  readonly cachedAt: number;
}

export const CoinMarketCapAdapterLive: Layer.Layer<
  AdapterService,
  never,
  ConfigService
> = Layer.effect(
  AdapterService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const baseUrl = "https://pro-api.coinmarketcap.com/v1";

    // In-memory price cache
    const priceCache = new Map<string, CachedPrices>();

    const getCacheKey = (symbols: ReadonlyArray<string>): string =>
      [...symbols].sort().join(",").toUpperCase();

    const getCachedPrices = (
      symbols: ReadonlyArray<string>
    ): CmcQuoteResponse | null => {
      const key = getCacheKey(symbols);
      const cached = priceCache.get(key);
      if (!cached) return null;

      const age = Date.now() - cached.cachedAt;
      if (age > CACHE_TTL_MS) {
        priceCache.delete(key);
        return null;
      }

      return cached.data;
    };

    const setCachedPrices = (
      symbols: ReadonlyArray<string>,
      data: CmcQuoteResponse
    ): void => {
      const key = getCacheKey(symbols);
      priceCache.set(key, { data, cachedAt: Date.now() });
    };

    const fetchQuotes = (symbols: ReadonlyArray<string>) =>
      Effect.tryPromise({
        try: async () => {
          // Check cache first
          const cached = getCachedPrices(symbols);
          if (cached) {
            return cached;
          }

          const response = await fetch(
            `${baseUrl}/cryptocurrency/quotes/latest?symbol=${symbols.join(",")}`,
            {
              headers: {
                "X-CMC_PRO_API_KEY": config.coinmarketcapApiKey,
                Accept: "application/json",
              },
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            }
          );

          if (!response.ok) {
            throw new Error(
              `CoinMarketCap API error: ${response.status} ${response.statusText}`
            );
          }

          const json = (await response.json()) as CmcQuoteResponse;

          // Cache the response
          setCachedPrices(symbols, json);

          return json;
        },
        catch: (error) => {
          if (error instanceof DOMException && error.name === "TimeoutError") {
            return new AdapterError({
              message: "CoinMarketCap API request timed out",
              source: "coinmarketcap",
              cause: error,
            });
          }
          return new AdapterError({
            message: `Failed to fetch from CoinMarketCap: ${error}`,
            source: "coinmarketcap",
            cause: error,
          });
        },
      });

    const mapQuoteToPrice = (
      data: CmcQuoteResponse["data"],
      symbol: string
    ): PriceData | undefined => {
      const entry = data[symbol.toUpperCase()];
      if (!entry) return undefined;
      const usd = entry.quote.USD;

      // Validate price is reasonable (not 0, null, or negative)
      if (!usd.price || usd.price <= 0) {
        return undefined;
      }

      return {
        symbol: entry.symbol,
        price: usd.price,
        percentChange24h: usd.percent_change_24h,
        marketCap: usd.market_cap,
        volume24h: usd.volume_24h,
        lastUpdated: usd.last_updated,
      };
    };

    return {
      getPrice: (symbol: string) =>
        Effect.gen(function* () {
          const response = yield* fetchQuotes([symbol]);
          const price = mapQuoteToPrice(response.data, symbol);
          if (!price) {
            return yield* Effect.fail(
              new AdapterError({
                message: `No price data found for ${symbol}`,
                source: "coinmarketcap",
              })
            );
          }
          return price;
        }),

      getPrices: (symbols: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          if (symbols.length === 0) return [];

          const response = yield* fetchQuotes(symbols);
          const prices: PriceData[] = [];
          for (const symbol of symbols) {
            const price = mapQuoteToPrice(response.data, symbol);
            if (price) prices.push(price);
          }
          return prices;
        }),
    };
  })
);
