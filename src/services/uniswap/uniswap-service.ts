import { Effect, Context, Layer, Data } from "effect";
import { ConfigService } from "../../config.js";

// ── Error type ───────────────────────────────────────────────────────

export class UniswapError extends Data.TaggedError("UniswapError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export const BASE_CHAIN_ID = 8453;

export const BASE_TOKENS = {
  ETH: "0x0000000000000000000000000000000000000000",
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6Ca",
} as const;

export interface CheckApprovalParams {
  readonly walletAddress: string;
  readonly token: string;
  readonly amount: string;
  readonly chainId?: number;
}

export interface ApprovalResult {
  readonly approval: {
    readonly to: string;
    readonly from: string;
    readonly data: string;
    readonly value: string;
    readonly chainId: number;
  } | null;
}

export interface GetQuoteParams {
  readonly swapper: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amount: string;
  readonly type?: "EXACT_INPUT" | "EXACT_OUTPUT";
  readonly slippageTolerance?: number;
  readonly chainId?: number;
}

export interface QuoteResponse {
  readonly routing: string;
  readonly quote: {
    readonly input: { readonly token: string; readonly amount: string };
    readonly output: { readonly token: string; readonly amount: string };
    readonly slippage: number;
    readonly gasFee: string;
    readonly gasFeeUSD: string;
    readonly gasUseEstimate: string;
  };
  readonly permitData?: Record<string, unknown> | null;
  readonly [key: string]: unknown;
}

export interface SwapTransaction {
  readonly to: string;
  readonly from: string;
  readonly data: string;
  readonly value: string;
  readonly chainId: number;
  readonly gasLimit?: string;
}

export interface SwapResponse {
  readonly swap: SwapTransaction;
}

// ── Service interface ────────────────────────────────────────────────

export interface UniswapServiceApi {
  readonly checkApproval: (
    params: CheckApprovalParams
  ) => Effect.Effect<ApprovalResult, UniswapError>;

  readonly getQuote: (
    params: GetQuoteParams
  ) => Effect.Effect<QuoteResponse, UniswapError>;

  readonly getSwapTransaction: (
    quoteResponse: QuoteResponse
  ) => Effect.Effect<SwapTransaction, UniswapError>;
}

export class UniswapService extends Context.Tag("UniswapService")<
  UniswapService,
  UniswapServiceApi
>() {}

// ── Live implementation ──────────────────────────────────────────────

const TRADING_API_BASE = "https://trade-api.gateway.uniswap.org/v1";

export const UniswapServiceLive: Layer.Layer<
  UniswapService,
  never,
  ConfigService
> = Layer.effect(
  UniswapService,
  Effect.gen(function* () {
    const config = yield* ConfigService;

    const headers = {
      "Content-Type": "application/json",
      "x-api-key": config.uniswapApiKey,
      "x-universal-router-version": "2.0",
    };

    const apiCall = <T>(endpoint: string, body: unknown): Effect.Effect<T, UniswapError> =>
      Effect.tryPromise({
        try: async () => {
          const res = await fetch(`${TRADING_API_BASE}${endpoint}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          });

          const data = (await res.json()) as Record<string, unknown>;

          if (!res.ok) {
            throw new UniswapError({
              message: String(data.detail ?? data.message ?? `Uniswap API error: ${res.status}`),
              cause: data,
            });
          }

          return data as T;
        },
        catch: (error) => {
          if (error instanceof UniswapError) return error;
          return new UniswapError({
            message: `Uniswap API request failed: ${error}`,
            cause: error,
          });
        },
      });

    return {
      checkApproval: (params: CheckApprovalParams) =>
        apiCall<ApprovalResult>("/check_approval", {
          walletAddress: params.walletAddress,
          token: params.token,
          amount: params.amount,
          chainId: params.chainId ?? BASE_CHAIN_ID,
        }),

      getQuote: (params: GetQuoteParams) => {
        const chainId = params.chainId ?? BASE_CHAIN_ID;
        return apiCall<QuoteResponse>("/quote", {
          swapper: params.swapper,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          tokenInChainId: String(chainId),
          tokenOutChainId: String(chainId),
          amount: params.amount,
          type: params.type ?? "EXACT_INPUT",
          slippageTolerance: params.slippageTolerance ?? 0.5,
          routingPreference: "BEST_PRICE",
        });
      },

      getSwapTransaction: (quoteResponse: QuoteResponse) =>
        Effect.gen(function* () {
          // Strip null fields — API rejects permitData: null
          const cleaned: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(quoteResponse)) {
            if (value !== null && value !== undefined) {
              cleaned[key] = value;
            }
          }

          const result = yield* apiCall<SwapResponse>("/swap", cleaned);

          // Validate swap data before returning
          if (
            !result.swap?.data ||
            result.swap.data === "" ||
            result.swap.data === "0x"
          ) {
            return yield* Effect.fail(
              new UniswapError({
                message: "Swap data is empty — quote may have expired. Please retry.",
              })
            );
          }

          return result.swap;
        }),
    };
  })
);
