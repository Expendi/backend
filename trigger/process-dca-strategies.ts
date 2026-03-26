import { schedules, logger } from "@trigger.dev/sdk";
import { Effect } from "effect";
import { runtime } from "../src/runtime.js";
import { DcaStrategyService } from "../src/services/dca/dca-strategy-service.js";

export const processDcaStrategies = schedules.task({
  id: "process-dca-strategies",
  cron: "* * * * *", // every minute (strategies self-throttle via nextExecutionAt)
  queue: {
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
    factor: 2,
  },
  run: async (payload) => {
    logger.info("Evaluating due DCA strategies", {
      timestamp: payload.timestamp,
    });

    const executions = await runtime.runPromise(
      Effect.gen(function* () {
        const service = yield* DcaStrategyService;
        return yield* service.processDueStrategies();
      })
    );

    if (executions.length === 0) {
      logger.info("No DCA strategies triggered this cycle");
      return {
        processedCount: 0,
        timestamp: payload.timestamp,
        scheduleId: payload.scheduleId,
      };
    }

    const succeeded = executions.filter((e) => e.status === "success");
    const failed = executions.filter((e) => e.status === "failed");
    const skipped = executions.filter((e) => e.status === "skipped");

    for (let i = 0; i < executions.length; i++) {
      const exec = executions[i]!;
      logger.info(`[${i + 1}/${executions.length}] DCA execution`, {
        strategyId: exec.strategyId,
        status: exec.status,
        priceAtExecution: exec.priceAtExecution,
        transactionId: exec.transactionId ?? "N/A",
        error: exec.error ?? undefined,
        indicatorSnapshot: exec.indicatorSnapshot ?? undefined,
      });
    }

    logger.info(
      `Completed — ${executions.length} execution(s): ${succeeded.length} succeeded, ${failed.length} failed, ${skipped.length} skipped`
    );

    return {
      processedCount: executions.length,
      succeeded: succeeded.length,
      failed: failed.length,
      skipped: skipped.length,
      timestamp: payload.timestamp,
      scheduleId: payload.scheduleId,
    };
  },
});
