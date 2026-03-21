import { Effect, Context, Layer, Data } from "effect";
import {
  MarketIntelligenceService,
  type TrendingToken,
  type MarketOverview,
  type PricePoint,
  type TokenMetadata,
} from "../adapters/coingecko.js";
import type { PriceData } from "../adapters/adapter-service.js";
import type { AgentProfileData } from "../../db/schema/index.js";

// ── Error type ───────────────────────────────────────────────────────

export class MarketResearchError extends Data.TaggedError(
  "MarketResearchError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Result types ────────────────────────────────────────────────────

export interface MarketBrief {
  readonly overview: MarketOverview;
  readonly trending: ReadonlyArray<TrendingToken>;
  readonly watchlistPrices: ReadonlyArray<PriceData>;
  readonly watchlistHistory: ReadonlyArray<{
    readonly symbol: string;
    readonly history: ReadonlyArray<PricePoint>;
  }>;
  readonly generatedAt: string;
}

export interface Opportunity {
  readonly token: TrendingToken;
  readonly reason: string;
  readonly riskLevel: "low" | "medium" | "high";
  readonly relevanceScore: number;
}

export interface TokenEvaluation {
  readonly symbol: string;
  readonly price: PriceData;
  readonly metadata: TokenMetadata;
  readonly priceHistory30d: ReadonlyArray<PricePoint>;
  readonly volatility30d: number;
  readonly priceChange30d: number;
  readonly evaluatedAt: string;
}

// ── Service interface ────────────────────────────────────────────────

export interface MarketResearchServiceApi {
  readonly generateMarketBrief: (
    interests: string[]
  ) => Effect.Effect<MarketBrief, MarketResearchError>;
  readonly findOpportunities: (
    profile: AgentProfileData
  ) => Effect.Effect<Opportunity[], MarketResearchError>;
  readonly evaluateToken: (
    symbol: string
  ) => Effect.Effect<TokenEvaluation, MarketResearchError>;
}

export class MarketResearchService extends Context.Tag(
  "MarketResearchService"
)<MarketResearchService, MarketResearchServiceApi>() {}

// ── Helpers ──────────────────────────────────────────────────────────

function calculateVolatility(history: ReadonlyArray<PricePoint>): number {
  if (history.length < 2) return 0;

  const returns: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]!.price;
    const curr = history[i]!.price;
    if (prev > 0) {
      returns.push((curr - prev) / prev);
    }
  }

  if (returns.length === 0) return 0;

  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(365);
}

function calculatePriceChange(
  history: ReadonlyArray<PricePoint>
): number {
  if (history.length < 2) return 0;
  const first = history[0]!.price;
  const last = history[history.length - 1]!.price;
  if (first === 0) return 0;
  return ((last - first) / first) * 100;
}

function categorizeRisk(
  token: TrendingToken,
  riskTolerance: string | undefined
): "low" | "medium" | "high" {
  const absPriceChange = Math.abs(token.priceChange24h);
  const rank = token.marketCapRank;

  if (rank <= 10 && absPriceChange < 5) return "low";
  if (rank <= 50 && absPriceChange < 10) return "medium";
  return "high";
}

function computeRelevanceScore(
  token: TrendingToken,
  interests: string[],
  riskTolerance: string | undefined
): number {
  let score = 0;

  // Higher rank = more relevant
  if (token.marketCapRank > 0 && token.marketCapRank <= 10) score += 30;
  else if (token.marketCapRank <= 50) score += 20;
  else if (token.marketCapRank <= 100) score += 10;

  // Positive momentum bonus
  if (token.priceChange24h > 0) score += 15;
  if (token.priceChange24h > 5) score += 10;

  // Interest match
  const tokenNameLower = token.name.toLowerCase();
  const tokenSymbolLower = token.symbol.toLowerCase();
  for (const interest of interests) {
    const interestLower = interest.toLowerCase();
    if (
      tokenNameLower.includes(interestLower) ||
      tokenSymbolLower.includes(interestLower) ||
      interestLower.includes(tokenNameLower) ||
      interestLower.includes(tokenSymbolLower)
    ) {
      score += 25;
      break;
    }
  }

  // Risk tolerance alignment
  const risk = categorizeRisk(token, riskTolerance);
  if (riskTolerance === "conservative" && risk === "low") score += 15;
  else if (riskTolerance === "moderate" && risk !== "high") score += 10;
  else if (riskTolerance === "aggressive" && risk === "high") score += 10;

  return Math.min(score, 100);
}

function buildOpportunityReason(
  token: TrendingToken,
  interests: string[]
): string {
  const parts: string[] = [];

  if (token.priceChange24h > 5) {
    parts.push(
      `Strong upward momentum with ${token.priceChange24h.toFixed(1)}% gain in 24h`
    );
  } else if (token.priceChange24h > 0) {
    parts.push(
      `Positive price movement of ${token.priceChange24h.toFixed(1)}% in 24h`
    );
  } else if (token.priceChange24h < -5) {
    parts.push(
      `Significant dip of ${token.priceChange24h.toFixed(1)}% — potential buy opportunity`
    );
  }

  if (token.marketCapRank > 0 && token.marketCapRank <= 20) {
    parts.push(`Top ${token.marketCapRank} by market cap`);
  }

  const tokenLower = token.name.toLowerCase();
  for (const interest of interests) {
    if (
      tokenLower.includes(interest.toLowerCase()) ||
      interest.toLowerCase().includes(tokenLower)
    ) {
      parts.push(`Matches your interest in "${interest}"`);
      break;
    }
  }

  if (parts.length === 0) {
    parts.push(`Currently trending across the market`);
  }

  return parts.join(". ") + ".";
}

// ── Live implementation ──────────────────────────────────────────────

export const MarketResearchServiceLive: Layer.Layer<
  MarketResearchService,
  never,
  MarketIntelligenceService
> = Layer.effect(
  MarketResearchService,
  Effect.gen(function* () {
    const marketIntelligence = yield* MarketIntelligenceService;

    const generateMarketBrief = (
      interests: string[]
    ): Effect.Effect<MarketBrief, MarketResearchError> =>
      Effect.gen(function* () {
        // Parallel fetch trending data and market overview
        const [trending, overview] = yield* Effect.all(
          [marketIntelligence.getTrending(), marketIntelligence.getMarketOverview()],
          { concurrency: "unbounded" }
        ).pipe(
          Effect.mapError(
            (err) =>
              new MarketResearchError({
                message: `Failed to fetch market data: ${String(err)}`,
                cause: err,
              })
          )
        );

        // Fetch prices and history for interest tokens in parallel
        const interestSymbols =
          interests.length > 0 ? interests.slice(0, 10) : ["BTC", "ETH"];

        const watchlistPrices = yield* marketIntelligence
          .getPrices(interestSymbols)
          .pipe(
            Effect.catchAll(() =>
              Effect.succeed([] as ReadonlyArray<PriceData>)
            )
          );

        const watchlistHistory = yield* Effect.all(
          interestSymbols.map((symbol) =>
            marketIntelligence.getPriceHistory(symbol, 7).pipe(
              Effect.map((history) => ({ symbol: symbol.toUpperCase(), history })),
              Effect.catchAll(() =>
                Effect.succeed({
                  symbol: symbol.toUpperCase(),
                  history: [] as ReadonlyArray<PricePoint>,
                })
              )
            )
          ),
          { concurrency: "unbounded" }
        ).pipe(
          Effect.mapError(
            (err) =>
              new MarketResearchError({
                message: `Failed to fetch watchlist history: ${String(err)}`,
                cause: err,
              })
          )
        );

        return {
          overview,
          trending,
          watchlistPrices,
          watchlistHistory,
          generatedAt: new Date().toISOString(),
        };
      });

    const findOpportunities = (
      profile: AgentProfileData
    ): Effect.Effect<Opportunity[], MarketResearchError> =>
      Effect.gen(function* () {
        const trending = yield* marketIntelligence.getTrending().pipe(
          Effect.mapError(
            (err) =>
              new MarketResearchError({
                message: `Failed to fetch trending tokens: ${String(err)}`,
                cause: err,
              })
          )
        );

        const interests = profile.interests ?? [];
        const avoidCategories = profile.avoidCategories ?? [];
        const riskTolerance = profile.riskTolerance;

        // Filter out tokens whose names match avoided categories
        const filtered = trending.filter((token) => {
          const tokenNameLower = token.name.toLowerCase();
          return !avoidCategories.some((cat) =>
            tokenNameLower.includes(cat.toLowerCase())
          );
        });

        // Filter by risk tolerance
        const riskFiltered = filtered.filter((token) => {
          const risk = categorizeRisk(token, riskTolerance);
          if (riskTolerance === "conservative" && risk === "high") return false;
          return true;
        });

        // Score and sort opportunities
        const opportunities: Opportunity[] = riskFiltered
          .map((token) => ({
            token,
            reason: buildOpportunityReason(token, interests),
            riskLevel: categorizeRisk(token, riskTolerance),
            relevanceScore: computeRelevanceScore(
              token,
              interests,
              riskTolerance
            ),
          }))
          .sort((a, b) => b.relevanceScore - a.relevanceScore)
          .slice(0, 10);

        return opportunities;
      });

    const evaluateToken = (
      symbol: string
    ): Effect.Effect<TokenEvaluation, MarketResearchError> =>
      Effect.gen(function* () {
        const upperSymbol = symbol.toUpperCase();

        // Parallel fetch price, history, and metadata
        const [price, priceHistory30d, metadata] = yield* Effect.all(
          [
            marketIntelligence.getPrice(upperSymbol).pipe(
              Effect.mapError(
                (err) =>
                  new MarketResearchError({
                    message: `Failed to fetch price for ${upperSymbol}: ${String(err)}`,
                    cause: err,
                  })
              )
            ),
            marketIntelligence.getPriceHistory(upperSymbol, 30).pipe(
              Effect.mapError(
                (err) =>
                  new MarketResearchError({
                    message: `Failed to fetch price history for ${upperSymbol}: ${String(err)}`,
                    cause: err,
                  })
              )
            ),
            marketIntelligence.getTokenMetadata(upperSymbol).pipe(
              Effect.mapError(
                (err) =>
                  new MarketResearchError({
                    message: `Failed to fetch metadata for ${upperSymbol}: ${String(err)}`,
                    cause: err,
                  })
              )
            ),
          ],
          { concurrency: "unbounded" }
        );

        const volatility30d = calculateVolatility(priceHistory30d);
        const priceChange30d = calculatePriceChange(priceHistory30d);

        return {
          symbol: upperSymbol,
          price,
          metadata,
          priceHistory30d,
          volatility30d,
          priceChange30d,
          evaluatedAt: new Date().toISOString(),
        };
      });

    return {
      generateMarketBrief,
      findOpportunities,
      evaluateToken,
    };
  })
);
