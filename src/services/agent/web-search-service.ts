import { Effect, Context, Layer, Data } from "effect";

// ── Error type ───────────────────────────────────────────────────────

export class WebSearchError extends Data.TaggedError("WebSearchError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Result types ────────────────────────────────────────────────────

export interface SearchResult {
  readonly url: string;
  readonly title: string;
  readonly publishDate: string | null;
  readonly excerpts: ReadonlyArray<string>;
}

export interface SearchResults {
  readonly searchId: string;
  readonly results: ReadonlyArray<SearchResult>;
  readonly searchedAt: string;
}

export interface ResearchBrief {
  readonly topic: string;
  readonly results: ReadonlyArray<SearchResult>;
  readonly searchedAt: string;
}

// ── Service interface ────────────────────────────────────────────────

export interface WebSearchServiceApi {
  readonly search: (
    objective: string,
    queries: string[]
  ) => Effect.Effect<SearchResults, WebSearchError>;
  readonly researchTopic: (
    topic: string
  ) => Effect.Effect<ResearchBrief, WebSearchError>;
}

export class WebSearchService extends Context.Tag("WebSearchService")<
  WebSearchService,
  WebSearchServiceApi
>() {}

// ── Parallel AI API types ───────────────────────────────────────────

interface ParallelSearchRequest {
  objective: string;
  search_queries: string[];
  mode: "fast";
  excerpts: {
    max_chars_per_result: number;
  };
}

interface ParallelSearchResponse {
  search_id: string;
  results: Array<{
    url: string;
    title: string;
    publish_date: string | null;
    excerpts: string[];
  }>;
  warnings: unknown;
  usage: Record<string, unknown>;
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildSearchQueries(topic: string): string[] {
  const normalizedTopic = topic.trim().toLowerCase();

  const queries: string[] = [normalizedTopic];

  // Add a "latest news" variant for news-oriented queries
  if (
    !normalizedTopic.includes("news") &&
    !normalizedTopic.includes("latest") &&
    !normalizedTopic.includes("update")
  ) {
    queries.push(`latest ${normalizedTopic} news`);
  }

  // Add a crypto-specific variant if the topic doesn't already mention crypto
  if (
    !normalizedTopic.includes("crypto") &&
    !normalizedTopic.includes("blockchain") &&
    !normalizedTopic.includes("defi") &&
    !normalizedTopic.includes("web3")
  ) {
    queries.push(`${normalizedTopic} crypto`);
  }

  return queries.slice(0, 5);
}

// ── Live implementation ──────────────────────────────────────────────

const PARALLEL_API_URL = "https://api.parallel.ai/v1beta/search";
const MAX_RESULTS = 10;
const MAX_CHARS_PER_RESULT = 500;

export const WebSearchServiceLive: Layer.Layer<WebSearchService> =
  Layer.succeed(
    WebSearchService,
    (() => {
      const executeSearch = (
        objective: string,
        searchQueries: string[]
      ): Effect.Effect<ParallelSearchResponse, WebSearchError> =>
        Effect.tryPromise({
          try: async () => {
            const apiKey = process.env.PARALLEL_API_KEY;
            if (!apiKey) {
              throw new Error(
                "PARALLEL_API_KEY environment variable is not set"
              );
            }

            const body: ParallelSearchRequest = {
              objective,
              search_queries: searchQueries.slice(0, 5),
              mode: "fast",
              excerpts: {
                max_chars_per_result: MAX_CHARS_PER_RESULT,
              },
            };

            const response = await fetch(PARALLEL_API_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
              },
              body: JSON.stringify(body),
            });

            if (response.status === 429) {
              throw new Error(
                "Search rate limit exceeded. Please try again in a moment."
              );
            }

            if (!response.ok) {
              const errorText = await response.text().catch(() => "");
              throw new Error(
                `Parallel API returned ${response.status}: ${errorText || response.statusText}`
              );
            }

            return (await response.json()) as ParallelSearchResponse;
          },
          catch: (err) =>
            new WebSearchError({
              message:
                err instanceof Error
                  ? err.message
                  : `Web search failed: ${String(err)}`,
              cause: err,
            }),
        });

      const search = (
        objective: string,
        queries: string[]
      ): Effect.Effect<SearchResults, WebSearchError> =>
        Effect.gen(function* () {
          if (!objective.trim() && queries.length === 0) {
            return yield* Effect.fail(
              new WebSearchError({
                message:
                  "At least an objective or one search query is required",
              })
            );
          }

          const effectiveObjective = objective.trim() || queries[0]!;
          const effectiveQueries =
            queries.length > 0 ? queries : [objective.trim()];

          const response = yield* executeSearch(
            effectiveObjective,
            effectiveQueries
          );

          const results: SearchResult[] = response.results
            .slice(0, MAX_RESULTS)
            .map((r) => ({
              url: r.url,
              title: r.title,
              publishDate: r.publish_date,
              excerpts: r.excerpts,
            }));

          return {
            searchId: response.search_id,
            results,
            searchedAt: new Date().toISOString(),
          };
        });

      const researchTopic = (
        topic: string
      ): Effect.Effect<ResearchBrief, WebSearchError> =>
        Effect.gen(function* () {
          const trimmedTopic = topic.trim();
          if (!trimmedTopic) {
            return yield* Effect.fail(
              new WebSearchError({
                message: "A research topic is required",
              })
            );
          }

          const queries = buildSearchQueries(trimmedTopic);
          const objective = `Research and gather current information about: ${trimmedTopic}. Find the most relevant and recent articles, news, and data.`;

          const response = yield* executeSearch(objective, queries);

          const results: SearchResult[] = response.results
            .slice(0, MAX_RESULTS)
            .map((r) => ({
              url: r.url,
              title: r.title,
              publishDate: r.publish_date,
              excerpts: r.excerpts,
            }));

          return {
            topic: trimmedTopic,
            results,
            searchedAt: new Date().toISOString(),
          };
        });

      return { search, researchTopic };
    })()
  );
