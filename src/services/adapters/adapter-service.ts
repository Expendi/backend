import { Effect, Context, Data } from "effect";

export class AdapterError extends Data.TaggedError("AdapterError")<{
  readonly message: string;
  readonly source: string;
  readonly cause?: unknown;
}> {}

export interface PriceData {
  readonly symbol: string;
  readonly price: number;
  readonly percentChange24h: number;
  readonly marketCap: number;
  readonly volume24h: number;
  readonly lastUpdated: string;
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
