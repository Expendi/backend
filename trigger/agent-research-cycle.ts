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
    logger.info("🔍 Starting agent research cycle", {
      timestamp: payload.timestamp,
    });

    const results = await runtime.runPromise(
      Effect.gen(function* () {
        const profileService = yield* AgentProfileService;
        const autonomy = yield* AgentAutonomyService;

        const profiles = yield* profileService.listActiveProfiles();
        logger.info(`Found ${profiles.length} agent profile(s)`, {
          tiers: profiles.map((p) => ({
            userId: p.userId,
            trustTier: p.trustTier,
          })),
        });

        const eligibleProfiles = profiles.filter(
          (p) =>
            p.trustTier === "act_within_limits" || p.trustTier === "full"
        );

        if (eligibleProfiles.length === 0) {
          logger.info(
            "No profiles with sufficient trust tier (act_within_limits or full)"
          );
          return [];
        }

        logger.info(
          `${eligibleProfiles.length} profile(s) eligible for research`
        );

        const cycleResults: Array<{
          userId: string;
          opportunities: number;
          suggestions: number;
        }> = [];

        for (let i = 0; i < eligibleProfiles.length; i++) {
          const profile = eligibleProfiles[i]!;
          logger.info(
            `[${i + 1}/${eligibleProfiles.length}] Running research for user`,
            {
              userId: profile.userId,
              trustTier: profile.trustTier,
            }
          );

          const result = yield* autonomy
            .runResearchCycle(profile.userId)
            .pipe(
              Effect.catchAll((error) => {
                logger.error(
                  `[${i + 1}/${eligibleProfiles.length}] Research failed for user`,
                  {
                    userId: profile.userId,
                    error: String(error),
                  }
                );
                return Effect.succeed({
                  userId: profile.userId,
                  opportunitiesFound: 0,
                  suggestionsCreated: 0,
                });
              })
            );

          logger.info(
            `[${i + 1}/${eligibleProfiles.length}] Research completed`,
            {
              userId: result.userId,
              opportunitiesFound: result.opportunitiesFound,
              suggestionsCreated: result.suggestionsCreated,
            }
          );

          cycleResults.push({
            userId: result.userId,
            opportunities: result.opportunitiesFound,
            suggestions: result.suggestionsCreated,
          });
        }

        return cycleResults;
      })
    );

    const totalOpportunities = results.reduce(
      (s, r) => s + r.opportunities,
      0
    );
    const totalSuggestions = results.reduce((s, r) => s + r.suggestions, 0);

    logger.info(
      `✅ Completed — ${results.length} user(s) processed, ${totalOpportunities} opportunities found, ${totalSuggestions} suggestions created`
    );

    return {
      usersProcessed: results.length,
      totalOpportunities,
      totalSuggestions,
      timestamp: payload.timestamp,
    };
  },
});
