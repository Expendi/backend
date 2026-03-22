import { schedules, logger } from "@trigger.dev/sdk";
import { Effect } from "effect";
import { runtime } from "../src/runtime.js";
import { GoalSavingsService } from "../src/services/goal-savings/goal-savings-service.js";

export const processDueGoalSavings = schedules.task({
  id: "process-due-goal-savings",
  cron: "*/5 * * * *",
  run: async (payload) => {
    logger.info("Starting process-due-goal-savings", { timestamp: payload.timestamp });
    const deposits = await runtime.runPromise(
      Effect.gen(function* () {
        const gsService = yield* GoalSavingsService;
        return yield* gsService.processDueDeposits();
      })
    );
    logger.info("Completed process-due-goal-savings", { processedCount: deposits.length });
    return { processedCount: deposits.length, timestamp: payload.timestamp };
  },
});
