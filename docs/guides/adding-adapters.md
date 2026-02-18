# Adding Data Adapters

Data adapters provide external information (prices, market data, etc.) to the Expendi system. The `HeartbeatService` consumes adapters for price-trigger conditions, but adapters can also be used by any service that needs external data.

This guide walks through the adapter interface, the existing CoinMarketCap implementation, and how to build a new adapter from scratch.

## The AdapterService Interface

```typescript
// src/services/adapters/adapter-service.ts

export class AdapterError extends Data.TaggedError("AdapterError")<{
  readonly message: string;
  readonly source: string;    // identifies which adapter produced the error
  readonly cause?: unknown;
}> {}

export interface PriceData {
  readonly symbol: string;           // e.g., "BTC"
  readonly price: number;            // current price in USD
  readonly percentChange24h: number; // 24h percent change
  readonly marketCap: number;        // market capitalization in USD
  readonly volume24h: number;        // 24h trading volume in USD
  readonly lastUpdated: string;      // ISO timestamp
}

export interface AdapterServiceApi {
  readonly getPrice: (
    symbol: string
  ) => Effect.Effect<PriceData, AdapterError>;
  readonly getPrices: (
    symbols: ReadonlyArray<string>
  ) => Effect.Effect<ReadonlyArray<PriceData>, AdapterError>;
}

export class AdapterService extends Context.Tag("AdapterService")<
  AdapterService,
  AdapterServiceApi
>() {}
```

Any adapter implementation must satisfy the `AdapterServiceApi` interface: it must implement `getPrice` (single symbol) and `getPrices` (batch).

## Existing Implementation: CoinMarketCap

The `CoinMarketCapAdapterLive` in `src/services/adapters/coinmarketcap.ts` calls the CoinMarketCap REST API:

```
GET https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=BTC,ETH
```

It authenticates with the `X-CMC_PRO_API_KEY` header (read from `ConfigService.coinmarketcapApiKey`) and maps the response into the `PriceData` shape.

Key implementation details:

- Both `getPrice` and `getPrices` call the same internal `fetchQuotes` function, which issues a single HTTP request with a comma-separated symbol list.
- If a symbol is not found in the response data, `getPrice` fails with an `AdapterError`, while `getPrices` silently omits it from the results.
- The `source` field on `AdapterError` is always `"coinmarketcap"` for this adapter.

## Building a New Adapter: CoinGecko Example

Here is a complete walkthrough of adding a CoinGecko adapter.

### 1. Create the adapter file

Create `src/services/adapters/coingecko.ts`:

```typescript
import { Effect, Layer } from "effect";
import { AdapterService, AdapterError, type PriceData } from "./adapter-service.js";
import { ConfigService } from "../../config.js";

interface CoinGeckoPrice {
  [id: string]: {
    usd: number;
    usd_24h_change: number;
    usd_market_cap: number;
    usd_24h_vol: number;
    last_updated_at: number;
  };
}

// CoinGecko uses lowercase IDs, not ticker symbols.
// This map converts common ticker symbols to CoinGecko IDs.
const SYMBOL_TO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDC: "usd-coin",
  USDT: "tether",
  SOL: "solana",
  MATIC: "matic-network",
  ARB: "arbitrum",
  OP: "optimism",
};

function symbolToId(symbol: string): string {
  return SYMBOL_TO_ID[symbol.toUpperCase()] ?? symbol.toLowerCase();
}

export const CoinGeckoAdapterLive: Layer.Layer<
  AdapterService,
  never,
  ConfigService
> = Layer.effect(
  AdapterService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const baseUrl = "https://api.coingecko.com/api/v3";

    const fetchPrices = (ids: ReadonlyArray<string>) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(
            `${baseUrl}/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true&include_last_updated_at=true`,
            {
              headers: { Accept: "application/json" },
            }
          );

          if (!response.ok) {
            throw new Error(
              `CoinGecko API error: ${response.status} ${response.statusText}`
            );
          }

          return (await response.json()) as CoinGeckoPrice;
        },
        catch: (error) =>
          new AdapterError({
            message: `Failed to fetch from CoinGecko: ${error}`,
            source: "coingecko",
            cause: error,
          }),
      });

    const mapToPriceData = (
      data: CoinGeckoPrice,
      id: string,
      symbol: string
    ): PriceData | undefined => {
      const entry = data[id];
      if (!entry) return undefined;
      return {
        symbol: symbol.toUpperCase(),
        price: entry.usd,
        percentChange24h: entry.usd_24h_change,
        marketCap: entry.usd_market_cap,
        volume24h: entry.usd_24h_vol,
        lastUpdated: new Date(entry.last_updated_at * 1000).toISOString(),
      };
    };

    return {
      getPrice: (symbol: string) =>
        Effect.gen(function* () {
          const id = symbolToId(symbol);
          const response = yield* fetchPrices([id]);
          const price = mapToPriceData(response, id, symbol);
          if (!price) {
            return yield* Effect.fail(
              new AdapterError({
                message: `No price data found for ${symbol} (CoinGecko ID: ${id})`,
                source: "coingecko",
              })
            );
          }
          return price;
        }),

      getPrices: (symbols: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const ids = symbols.map(symbolToId);
          const response = yield* fetchPrices(ids);
          const prices: PriceData[] = [];
          for (let i = 0; i < symbols.length; i++) {
            const price = mapToPriceData(response, ids[i]!, symbols[i]!);
            if (price) prices.push(price);
          }
          return prices;
        }),
    };
  })
);
```

### 2. Wire it into the layer system

In `src/layers/main.ts`, replace or supplement the CoinMarketCap adapter:

```typescript
// Replace the CoinMarketCap adapter with CoinGecko:
import { CoinGeckoAdapterLive } from "../services/adapters/coingecko.js";

const AdapterServiceLayer = CoinGeckoAdapterLive.pipe(
  Layer.provide(ConfigLayer)
);
```

Since both adapters provide the same `AdapterService` tag, no other code needs to change. Every consumer (`HeartbeatService`, route handlers, etc.) automatically uses the new adapter.

### 3. Add config if needed

If your adapter requires an API key, add it to the `AppConfig` interface in `src/config.ts`:

```typescript
export interface AppConfig {
  readonly databaseUrl: string;
  readonly privyAppId: string;
  readonly privyAppSecret: string;
  readonly coinmarketcapApiKey: string;
  readonly adminApiKey: string;
  readonly coingeckoApiKey: string;   // add this
  readonly port: number;
}
```

Then read it in the `ConfigLive` layer:

```typescript
const coingeckoApiKey = yield* Config.string("COINGECKO_API_KEY");
```

And update `.env.example`:

```
COINGECKO_API_KEY=your-coingecko-api-key
```

## How Heartbeat Consumes Adapters

The `HeartbeatService` depends on `AdapterService` and uses it in the `price_trigger` condition type:

```typescript
const checkPriceTrigger = (condition: HeartbeatCondition) =>
  Effect.gen(function* () {
    const params = condition.params;
    const symbol = params.symbol as string;        // e.g., "ETH"
    const targetPrice = params.targetPrice as number; // e.g., 3000
    const direction = (params.direction as string) ?? "below";

    const priceData = yield* adapters.getPrice(symbol);

    const triggered =
      direction === "below"
        ? priceData.price < targetPrice
        : priceData.price > targetPrice;

    return triggered;
  });
```

The adapter is called with a symbol string, and the returned `PriceData.price` is compared against the threshold. The adapter implementation is completely opaque to `HeartbeatService` -- it does not know or care whether the data comes from CoinMarketCap, CoinGecko, or any other source.

## Design Guidelines for New Adapters

1. **Always provide both `getPrice` and `getPrices`.** Even if your data source does not support batch queries, implement `getPrices` by calling `getPrice` in a loop.

2. **Use the `source` field on `AdapterError`.** This makes it easy to diagnose which adapter is failing in a multi-adapter setup.

3. **Normalize symbols to uppercase.** The `PriceData.symbol` field should always be uppercase (e.g., `"BTC"`, not `"btc"`), since callers expect this convention.

4. **Handle missing symbols gracefully.** `getPrice` should fail with an `AdapterError` if the symbol is not found. `getPrices` should skip missing symbols and return whatever was found.

5. **Keep the layer dependency minimal.** Most adapters only need `ConfigService` for API keys. Avoid depending on database or wallet services.
