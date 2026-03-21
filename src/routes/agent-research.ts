import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import {
  MarketResearchService,
  AgentProfileService,
} from "../services/agent/index.js";
import type { AuthVariables } from "../middleware/auth.js";

export function createAgentResearchRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /brief — Generate a market brief based on user interests
  app.get("/brief", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const profileService = yield* AgentProfileService;
        const researchService = yield* MarketResearchService;

        const agentProfile = yield* profileService.getProfile(userId);
        const interests = agentProfile.profile.interests ?? [];

        return yield* researchService.generateMarketBrief(interests);
      }),
      c
    )
  );

  // GET /opportunities — Find opportunities based on user profile
  app.get("/opportunities", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const profileService = yield* AgentProfileService;
        const researchService = yield* MarketResearchService;

        const agentProfile = yield* profileService.getProfile(userId);

        return yield* researchService.findOpportunities(agentProfile.profile);
      }),
      c
    )
  );

  // GET /token/:symbol — Evaluate a specific token
  app.get("/token/:symbol", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const symbol = c.req.param("symbol");

        if (!symbol || symbol.trim().length === 0) {
          return yield* Effect.fail(
            new Error("Token symbol is required")
          );
        }

        const researchService = yield* MarketResearchService;
        return yield* researchService.evaluateToken(symbol);
      }),
      c
    )
  );

  return app;
}
