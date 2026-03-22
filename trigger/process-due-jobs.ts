import { schedules, logger } from "@trigger.dev/sdk";
import { Effect } from "effect";
import { runtime } from "../src/runtime.js";
import { JobberService } from "../src/services/jobber/jobber-service.js";

export const processDueJobs = schedules.task({
  id: "process-due-jobs",
  cron: "* * * * *",
  run: async (payload) => {
    logger.info("🔍 Fetching due jobs", { timestamp: payload.timestamp });

    const jobs = await runtime.runPromise(
      Effect.gen(function* () {
        const jobber = yield* JobberService;
        return yield* jobber.processDueJobs();
      })
    );

    if (jobs.length === 0) {
      logger.info("No due jobs found");
      return { processedCount: 0, timestamp: payload.timestamp };
    }

    logger.info(`Found ${jobs.length} due job(s)`, {
      jobIds: jobs.map((j) => j.id),
      jobTypes: jobs.map((j) => j.jobType),
    });

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]!;
      logger.info(`[${i + 1}/${jobs.length}] Processed job`, {
        jobId: job.id,
        jobType: job.jobType,
        userId: job.userId,
        status: job.status,
        schedule: job.schedule,
      });
    }

    logger.info(`✅ Completed — processed ${jobs.length} job(s)`);
    return { processedCount: jobs.length, timestamp: payload.timestamp };
  },
});
