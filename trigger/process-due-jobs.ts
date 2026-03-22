import { schedules, logger } from "@trigger.dev/sdk";
import { Effect } from "effect";
import { runtime } from "../src/runtime.js";
import { JobberService } from "../src/services/jobber/jobber-service.js";

export const processDueJobs = schedules.task({
  id: "process-due-jobs",
  cron: "* * * * *",
  run: async (payload) => {
    logger.info("Starting process-due-jobs", { timestamp: payload.timestamp });
    const jobs = await runtime.runPromise(
      Effect.gen(function* () {
        const jobber = yield* JobberService;
        return yield* jobber.processDueJobs();
      })
    );
    logger.info("Completed process-due-jobs", { processedCount: jobs.length });
    return { processedCount: jobs.length, timestamp: payload.timestamp };
  },
});
