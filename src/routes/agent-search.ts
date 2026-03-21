import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { WebSearchService } from "../services/agent/web-search-service.js";
import type { AuthVariables } from "../middleware/auth.js";

export function createAgentSearchRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // POST /search — Quick web search with a query or structured objective + queries
  app.post("/search", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.promise(() =>
          c.req.json<{
            query?: string;
            objective?: string;
            queries?: string[];
          }>()
        );

        const objective = body.objective ?? body.query ?? "";
        const queries = body.queries ?? (body.query ? [body.query] : []);

        if (!objective && queries.length === 0) {
          return yield* Effect.fail(
            new Error(
              "Either 'query' or 'objective' with 'queries' is required"
            )
          );
        }

        const searchService = yield* WebSearchService;
        return yield* searchService.search(objective, queries);
      }),
      c
    )
  );

  // POST /research — Deeper topic research with auto-generated queries
  app.post("/research", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.promise(() =>
          c.req.json<{ topic?: string }>()
        );

        if (!body.topic || body.topic.trim().length === 0) {
          return yield* Effect.fail(
            new Error("'topic' is required for research")
          );
        }

        const searchService = yield* WebSearchService;
        return yield* searchService.researchTopic(body.topic);
      }),
      c
    )
  );

  return app;
}
