import { Effect, Layer, Context, Data } from "effect";
import { AdapterError, type PriceData } from "./adapter-service.js";

// --- Interfaces ---

export interface TrendingToken {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number;
  priceChange24h: number;
  thumb: string;
}

export interface MarketOverview {
  totalMarketCap: number;
  totalVolume24h: number;
  btcDominance: number;
  marketCapChangePercentage24h: number;
}

export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface TokenMetadata {
  id: string;
  symbol: string;
  name: string;
  description: string;
  categories: string[];
  links: { homepage: string[]; twitter: string };
}

export class MarketIntelligenceError extends Data.TaggedError(
  "MarketIntelligenceError"
)<{
  readonly message: string;
  readonly source: string;
  readonly cause?: unknown;
}> {}

export interface MarketIntelligenceApi {
  readonly getPrice: (
    symbol: string
  ) => Effect.Effect<PriceData, AdapterError>;
  readonly getPrices: (
    symbols: ReadonlyArray<string>
  ) => Effect.Effect<ReadonlyArray<PriceData>, AdapterError>;
  readonly getTrending: () => Effect.Effect<
    ReadonlyArray<TrendingToken>,
    MarketIntelligenceError
  >;
  readonly getMarketOverview: () => Effect.Effect<
    MarketOverview,
    MarketIntelligenceError
  >;
  readonly getPriceHistory: (
    symbol: string,
    days: number
  ) => Effect.Effect<ReadonlyArray<PricePoint>, MarketIntelligenceError>;
  readonly getTokenMetadata: (
    symbol: string
  ) => Effect.Effect<TokenMetadata, MarketIntelligenceError>;
}

export class MarketIntelligenceService extends Context.Tag(
  "MarketIntelligenceService"
)<MarketIntelligenceService, MarketIntelligenceApi>() {}

// --- Symbol-to-CoinGecko ID mapping ---

const SYMBOL_TO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDC: "usd-coin",
  USDT: "tether",
  WETH: "weth",
  DAI: "dai",
  WBTC: "wrapped-bitcoin",
  SOL: "solana",
  MATIC: "matic-network",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  UNI: "uniswap",
  AAVE: "aave",
  ARB: "arbitrum",
  OP: "optimism",
  DOT: "polkadot",
  ADA: "cardano",
  XRP: "ripple",
  DOGE: "dogecoin",
  SHIB: "shiba-inu",
};

// --- Cache TTLs ---

const PRICE_CACHE_TTL_MS = 60_000; // 60 seconds
const TRENDING_CACHE_TTL_MS = 900_000; // 15 minutes
const MARKET_OVERVIEW_CACHE_TTL_MS = 300_000; // 5 minutes
const PRICE_HISTORY_CACHE_TTL_MS = 3_600_000; // 1 hour
const TOKEN_METADATA_CACHE_TTL_MS = 86_400_000; // 24 hours
const REQUEST_TIMEOUT_MS = 10_000; // 10 seconds

// --- CoinGecko API response types ---

interface CoinGeckoSimplePriceResponse {
  [id: string]: {
    usd: number;
    usd_24h_change?: number;
    usd_market_cap?: number;
    usd_24h_vol?: number;
  };
}

interface CoinGeckoTrendingResponse {
  coins: Array<{
    item: {
      id: string;
      coin_id: number;
      name: string;
      symbol: string;
      market_cap_rank: number;
      thumb: string;
      data?: {
        price_change_percentage_24h?: {
          usd?: number;
        };
      };
    };
  }>;
}

interface CoinGeckoGlobalResponse {
  data: {
    total_market_cap: { usd: number };
    total_volume: { usd: number };
    market_cap_percentage: { btc: number };
    market_cap_change_percentage_24h_usd: number;
  };
}

interface CoinGeckoMarketChartResponse {
  prices: Array<[number, number]>;
}

interface CoinGeckoCoinResponse {
  id: string;
  symbol: string;
  name: string;
  description: { en: string };
  categories: string[];
  links: {
    homepage: string[];
    twitter_screen_name: string;
  };
}

interface CoinGeckoSearchResponse {
  coins: Array<{
    id: string;
    symbol: string;
    name: string;
  }>;
}

// --- Cache entry type ---

interface CacheEntry<T> {
  readonly data: T;
  readonly cachedAt: number;
}

// --- Layer ---

export const CoinGeckoAdapterLive: Layer.Layer<
  MarketIntelligenceService,
  never,
  never
> = Layer.succeed(
  MarketIntelligenceService,
  (() => {
    const apiKey = process.env.COINGECKO_API_KEY;
    const baseUrl = apiKey
      ? "https://pro-api.coingecko.com/api/v3"
      : "https://api.coingecko.com/api/v3";

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (apiKey) {
      headers["x-cg-pro-api-key"] = apiKey;
    }

    // In-memory caches
    const priceCache = new Map<string, CacheEntry<CoinGeckoSimplePriceResponse>>();
    const trendingCache: { entry: CacheEntry<ReadonlyArray<TrendingToken>> | null } = { entry: null };
    const marketOverviewCache: { entry: CacheEntry<MarketOverview> | null } = { entry: null };
    const priceHistoryCache = new Map<string, CacheEntry<ReadonlyArray<PricePoint>>>();
    const tokenMetadataCache = new Map<string, CacheEntry<TokenMetadata>>();
    const symbolIdCache = new Map<string, CacheEntry<string>>();

    // --- Cache helpers ---

    function getCached<T>(
      cache: Map<string, CacheEntry<T>>,
      key: string,
      ttl: number
    ): T | null {
      const cached = cache.get(key);
      if (!cached) return null;
      if (Date.now() - cached.cachedAt > ttl) {
        cache.delete(key);
        return null;
      }
      return cached.data;
    }

    function setCached<T>(
      cache: Map<string, CacheEntry<T>>,
      key: string,
      data: T
    ): void {
      cache.set(key, { data, cachedAt: Date.now() });
    }

    function getSingletonCached<T>(
      ref: { entry: CacheEntry<T> | null },
      ttl: number
    ): T | null {
      if (!ref.entry) return null;
      if (Date.now() - ref.entry.cachedAt > ttl) {
        ref.entry = null;
        return null;
      }
      return ref.entry.data;
    }

    function setSingletonCached<T>(
      ref: { entry: CacheEntry<T> | null },
      data: T
    ): void {
      ref.entry = { data, cachedAt: Date.now() };
    }

    // --- Symbol resolution ---

    const resolveSymbolToId = (symbol: string): Effect.Effect<string, AdapterError> =>
      Effect.gen(function* () {
        const upper = symbol.toUpperCase();
        const knownId = SYMBOL_TO_ID[upper];
        if (knownId) return knownId;

        const cachedId = getCached(symbolIdCache, upper, TOKEN_METADATA_CACHE_TTL_MS);
        if (cachedId) return cachedId;

        const searchResult = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(
              `${baseUrl}/search?query=${encodeURIComponent(symbol)}`,
              { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
            );
            if (!response.ok) {
              throw new Error(
                `CoinGecko search API error: ${response.status} ${response.statusText}`
              );
            }
            return (await response.json()) as CoinGeckoSearchResponse;
          },
          catch: (error) =>
            new AdapterError({
              message: `Failed to search CoinGecko for symbol "${symbol}": ${error}`,
              source: "coingecko",
              cause: error,
            }),
        });

        const match = searchResult.coins.find(
          (c) => c.symbol.toUpperCase() === upper
        );
        if (!match) {
          return yield* Effect.fail(
            new AdapterError({
              message: `No CoinGecko ID found for symbol "${symbol}"`,
              source: "coingecko",
            })
          );
        }

        setCached(symbolIdCache, upper, match.id);
        return match.id;
      });

    const resolveSymbolsToIds = (
      symbols: ReadonlyArray<string>
    ): Effect.Effect<ReadonlyArray<{ symbol: string; id: string }>, AdapterError> =>
      Effect.gen(function* () {
        const results: Array<{ symbol: string; id: string }> = [];
        for (const symbol of symbols) {
          const id = yield* resolveSymbolToId(symbol);
          results.push({ symbol: symbol.toUpperCase(), id });
        }
        return results;
      });

    // --- Fetch helpers ---

    const fetchPrices = (
      ids: ReadonlyArray<string>
    ): Effect.Effect<CoinGeckoSimplePriceResponse, AdapterError> =>
      Effect.gen(function* () {
        const cacheKey = [...ids].sort().join(",");
        const cached = getCached(priceCache, cacheKey, PRICE_CACHE_TTL_MS);
        if (cached) return cached;

        const data = yield* Effect.tryPromise({
          try: async () => {
            const url = `${baseUrl}/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
            const response = await fetch(url, {
              headers,
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            if (!response.ok) {
              throw new Error(
                `CoinGecko price API error: ${response.status} ${response.statusText}`
              );
            }
            return (await response.json()) as CoinGeckoSimplePriceResponse;
          },
          catch: (error) => {
            if (
              error instanceof DOMException &&
              error.name === "TimeoutError"
            ) {
              return new AdapterError({
                message: "CoinGecko API request timed out",
                source: "coingecko",
                cause: error,
              });
            }
            return new AdapterError({
              message: `Failed to fetch prices from CoinGecko: ${error}`,
              source: "coingecko",
              cause: error,
            });
          },
        });

        setCached(priceCache, cacheKey, data);
        return data;
      });

    const mapPriceResponse = (
      data: CoinGeckoSimplePriceResponse,
      id: string,
      symbol: string
    ): PriceData | undefined => {
      const entry = data[id];
      if (!entry || !entry.usd || entry.usd <= 0) return undefined;
      return {
        symbol: symbol.toUpperCase(),
        price: entry.usd,
        percentChange24h: entry.usd_24h_change ?? 0,
        marketCap: entry.usd_market_cap ?? 0,
        volume24h: entry.usd_24h_vol ?? 0,
        lastUpdated: new Date().toISOString(),
      };
    };

    // --- API implementation ---

    const api: MarketIntelligenceApi = {
      getPrice: (symbol: string) =>
        Effect.gen(function* () {
          const id = yield* resolveSymbolToId(symbol);
          const response = yield* fetchPrices([id]);
          const price = mapPriceResponse(response, id, symbol);
          if (!price) {
            return yield* Effect.fail(
              new AdapterError({
                message: `No price data found for ${symbol}`,
                source: "coingecko",
              })
            );
          }
          return price;
        }),

      getPrices: (symbols: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          if (symbols.length === 0) return [];

          const resolved = yield* resolveSymbolsToIds(symbols);
          const ids = resolved.map((r) => r.id);
          const response = yield* fetchPrices(ids);

          const prices: PriceData[] = [];
          for (const { symbol, id } of resolved) {
            const price = mapPriceResponse(response, id, symbol);
            if (price) prices.push(price);
          }
          return prices;
        }),

      getTrending: () =>
        Effect.gen(function* () {
          const cached = getSingletonCached(
            trendingCache,
            TRENDING_CACHE_TTL_MS
          );
          if (cached) return cached;

          const result = yield* Effect.tryPromise({
            try: async () => {
              const response = await fetch(`${baseUrl}/search/trending`, {
                headers,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
              });
              if (!response.ok) {
                throw new Error(
                  `CoinGecko trending API error: ${response.status} ${response.statusText}`
                );
              }
              return (await response.json()) as CoinGeckoTrendingResponse;
            },
            catch: (error) =>
              new MarketIntelligenceError({
                message: `Failed to fetch trending from CoinGecko: ${error}`,
                source: "coingecko",
                cause: error,
              }),
          });

          const trending: ReadonlyArray<TrendingToken> = result.coins.map(
            ({ item }) => ({
              id: item.id,
              symbol: item.symbol,
              name: item.name,
              marketCapRank: item.market_cap_rank ?? 0,
              priceChange24h:
                item.data?.price_change_percentage_24h?.usd ?? 0,
              thumb: item.thumb,
            })
          );

          setSingletonCached(trendingCache, trending);
          return trending;
        }).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(
              `CoinGecko getTrending failed, returning empty: ${String(error)}`
            ).pipe(
              Effect.map(() => [] as ReadonlyArray<TrendingToken>)
            )
          )
        ),

      getMarketOverview: () =>
        Effect.gen(function* () {
          const cached = getSingletonCached(
            marketOverviewCache,
            MARKET_OVERVIEW_CACHE_TTL_MS
          );
          if (cached) return cached;

          const result = yield* Effect.tryPromise({
            try: async () => {
              const response = await fetch(`${baseUrl}/global`, {
                headers,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
              });
              if (!response.ok) {
                throw new Error(
                  `CoinGecko global API error: ${response.status} ${response.statusText}`
                );
              }
              return (await response.json()) as CoinGeckoGlobalResponse;
            },
            catch: (error) =>
              new MarketIntelligenceError({
                message: `Failed to fetch market overview from CoinGecko: ${error}`,
                source: "coingecko",
                cause: error,
              }),
          });

          const overview: MarketOverview = {
            totalMarketCap: result.data.total_market_cap.usd,
            totalVolume24h: result.data.total_volume.usd,
            btcDominance: result.data.market_cap_percentage.btc,
            marketCapChangePercentage24h:
              result.data.market_cap_change_percentage_24h_usd,
          };

          setSingletonCached(marketOverviewCache, overview);
          return overview;
        }).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(
              `CoinGecko getMarketOverview failed, returning defaults: ${String(error)}`
            ).pipe(
              Effect.map(() => ({
                totalMarketCap: 0,
                totalVolume24h: 0,
                btcDominance: 0,
                marketCapChangePercentage24h: 0,
              }) satisfies MarketOverview)
            )
          )
        ),

      getPriceHistory: (symbol: string, days: number) =>
        Effect.gen(function* () {
          const cacheKey = `${symbol.toUpperCase()}_${days}`;
          const cached = getCached(
            priceHistoryCache,
            cacheKey,
            PRICE_HISTORY_CACHE_TTL_MS
          );
          if (cached) return cached;

          const id = yield* resolveSymbolToId(symbol).pipe(
            Effect.mapError(
              (err) =>
                new MarketIntelligenceError({
                  message: err.message,
                  source: "coingecko",
                  cause: err,
                })
            )
          );

          const result = yield* Effect.tryPromise({
            try: async () => {
              const url = `${baseUrl}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`;
              const response = await fetch(url, {
                headers,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
              });
              if (!response.ok) {
                throw new Error(
                  `CoinGecko market_chart API error: ${response.status} ${response.statusText}`
                );
              }
              return (await response.json()) as CoinGeckoMarketChartResponse;
            },
            catch: (error) =>
              new MarketIntelligenceError({
                message: `Failed to fetch price history from CoinGecko for "${symbol}": ${error}`,
                source: "coingecko",
                cause: error,
              }),
          });

          const points: ReadonlyArray<PricePoint> = result.prices.map(
            ([timestamp, price]) => ({ timestamp, price })
          );

          setCached(priceHistoryCache, cacheKey, points);
          return points;
        }).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(
              `CoinGecko getPriceHistory failed, returning empty: ${String(error)}`
            ).pipe(
              Effect.map(() => [] as ReadonlyArray<PricePoint>)
            )
          )
        ),

      getTokenMetadata: (symbol: string) =>
        Effect.gen(function* () {
          const upper = symbol.toUpperCase();
          const cached = getCached(
            tokenMetadataCache,
            upper,
            TOKEN_METADATA_CACHE_TTL_MS
          );
          if (cached) return cached;

          const id = yield* resolveSymbolToId(symbol).pipe(
            Effect.mapError(
              (err) =>
                new MarketIntelligenceError({
                  message: err.message,
                  source: "coingecko",
                  cause: err,
                })
            )
          );

          const result = yield* Effect.tryPromise({
            try: async () => {
              const url = `${baseUrl}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false`;
              const response = await fetch(url, {
                headers,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
              });
              if (!response.ok) {
                throw new Error(
                  `CoinGecko coin API error: ${response.status} ${response.statusText}`
                );
              }
              return (await response.json()) as CoinGeckoCoinResponse;
            },
            catch: (error) =>
              new MarketIntelligenceError({
                message: `Failed to fetch token metadata from CoinGecko for "${symbol}": ${error}`,
                source: "coingecko",
                cause: error,
              }),
          });

          const metadata: TokenMetadata = {
            id: result.id,
            symbol: result.symbol,
            name: result.name,
            description: result.description.en,
            categories: result.categories.filter(
              (c): c is string => c !== null && c !== undefined
            ),
            links: {
              homepage: result.links.homepage.filter(
                (url) => url !== null && url !== undefined && url !== ""
              ),
              twitter: result.links.twitter_screen_name
                ? `https://twitter.com/${result.links.twitter_screen_name}`
                : "",
            },
          };

          setCached(tokenMetadataCache, upper, metadata);
          return metadata;
        }).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(
              `CoinGecko getTokenMetadata failed: ${String(error)}`
            ).pipe(
              Effect.flatMap(() =>
                Effect.fail(
                  error instanceof MarketIntelligenceError
                    ? error
                    : new MarketIntelligenceError({
                        message: `Failed to get token metadata for "${symbol}"`,
                        source: "coingecko",
                        cause: error,
                      })
                )
              )
            )
          )
        ),
    };

    return api;
  })()
);
