import { schedules, logger } from "@trigger.dev/sdk";
import { Effect } from "effect";
import { runtime } from "../src/runtime.js";
import { AgentAutonomyService } from "../src/services/agent/agent-autonomy-service.js";
import { AgentProfileService } from "../src/services/agent/agent-profile-service.js";

export const agentResearchCycle = schedules.task({
  id: "agent-research-cycle",
  cron: "0 */6 * * *", // every 6 hours
  queue: {
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30000,
    factor: 2,
  },
  run: async (payload) => {
    logger.info("Starting agent-research-cycle", { timestamp: payload.timestamp });
    const results = await runtime.runPromise(
      Effect.gen(function* () {
        const profileService = yield* AgentProfileService;
        const autonomy = yield* AgentAutonomyService;

        // Get all users who have agent profiles with act_within_limits or full tier
        const profiles = yield* profileService.listActiveProfiles();

        const cycleResults: Array<{
          userId: string;
          opportunities: number;
          suggestions: number;
        }> = [];

        for (const profile of profiles) {
          // Only run research for users with sufficient trust tier
          if (
            profile.trustTier === "act_within_limits" ||
            profile.trustTier === "full"
          ) {
            const result = yield* autonomy
              .runResearchCycle(profile.userId)
              .pipe(
                Effect.catchAll(() =>
                  Effect.succeed({
                    userId: profile.userId,
                    opportunitiesFound: 0,
                    suggestionsCreated: 0,
                  })
                )
              );
            cycleResults.push({
              userId: result.userId,
              opportunities: result.opportunitiesFound,
              suggestions: result.suggestionsCreated,
            });
          }
        }

        return cycleResults;
      })
    );

    logger.info("Completed agent-research-cycle", {
      usersProcessed: results.length,
      totalOpportunities: results.reduce((s, r) => s + r.opportunities, 0),
      totalSuggestions: results.reduce((s, r) => s + r.suggestions, 0),
    });
    return {
      usersProcessed: results.length,
      totalOpportunities: results.reduce((s, r) => s + r.opportunities, 0),
      totalSuggestions: results.reduce((s, r) => s + r.suggestions, 0),
      timestamp: payload.timestamp,
    };
  },
});
