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

export const CoinMarketCapAdapterLive: Layer.Layer<
  AdapterService,
  never,
  ConfigService
> = Layer.effect(
  AdapterService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const baseUrl = "https://pro-api.coinmarketcap.com/v1";

    const fetchQuotes = (symbols: ReadonlyArray<string>) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(
            `${baseUrl}/cryptocurrency/quotes/latest?symbol=${symbols.join(",")}`,
            {
              headers: {
                "X-CMC_PRO_API_KEY": config.coinmarketcapApiKey,
                Accept: "application/json",
              },
            }
          );

          if (!response.ok) {
            throw new Error(
              `CoinMarketCap API error: ${response.status} ${response.statusText}`
            );
          }

          const json = (await response.json()) as CmcQuoteResponse;
          return json;
        },
        catch: (error) =>
          new AdapterError({
            message: `Failed to fetch from CoinMarketCap: ${error}`,
            source: "coinmarketcap",
            cause: error,
          }),
      });

    const mapQuoteToPrice = (
      data: CmcQuoteResponse["data"],
      symbol: string
    ): PriceData | undefined => {
      const entry = data[symbol.toUpperCase()];
      if (!entry) return undefined;
      const usd = entry.quote.USD;
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
