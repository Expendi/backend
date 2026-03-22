import { schedules, logger } from "@trigger.dev/sdk";
import { Effect } from "effect";
import { runtime } from "../src/runtime.js";
import { AgentAutonomyService } from "../src/services/agent/agent-autonomy-service.js";

export const evaluateAgentMandates = schedules.task({
  id: "evaluate-agent-mandates",
  cron: "* * * * *", // every minute
  queue: {
    concurrencyLimit: 1, // Prevent overlapping evaluations
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 10000,
    factor: 2,
  },
  run: async (payload) => {
    logger.info("Starting evaluate-agent-mandates", { timestamp: payload.timestamp });
    const summary = await runtime.runPromise(
      Effect.gen(function* () {
        const autonomy = yield* AgentAutonomyService;
        return yield* autonomy.processAllMandates();
      })
    );
    logger.info("Completed evaluate-agent-mandates", {
      processedCount: summary.results.length,
      triggered: summary.results.filter((r) => r.triggered).length,
    });
    return {
      processedCount: summary.results.length,
      triggered: summary.results.filter((r) => r.triggered).length,
      timestamp: payload.timestamp,
      scheduleId: payload.scheduleId,
    };
  },
});
