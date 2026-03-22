import { schedules, logger } from "@trigger.dev/sdk";
import { Effect } from "effect";
import { runtime } from "../src/runtime.js";
import { RecurringPaymentService } from "../src/services/recurring-payment/recurring-payment-service.js";

export const processDuePayments = schedules.task({
  id: "process-due-payments",
  cron: "*/5 * * * *",
  run: async (payload) => {
    const dbUrl = process.env.DATABASE_URL;
    logger.info("🔍 Fetching due recurring payments", {
      timestamp: payload.timestamp,
      dbHost: dbUrl ? new URL(dbUrl).host : "DATABASE_URL NOT SET",
    });

    const executions = await runtime.runPromise(
      Effect.gen(function* () {
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.processDuePayments();
      })
    );

    if (executions.length === 0) {
      logger.info("No due recurring payments found");
      return { processedCount: 0, timestamp: payload.timestamp };
    }

    const succeeded = executions.filter((e) => e.status === "success");
    const failed = executions.filter((e) => e.status === "failed");

    for (let i = 0; i < executions.length; i++) {
      const exec = executions[i]!;
      if (exec.status === "success") {
        logger.info(`[${i + 1}/${executions.length}] Payment succeeded`, {
          scheduleId: exec.scheduleId,
          transactionId: exec.transactionId ?? "N/A",
          feeAmount: exec.feeAmount ?? undefined,
          feeCurrency: exec.feeCurrency ?? undefined,
        });
      } else {
        logger.error(`[${i + 1}/${executions.length}] Payment failed`, {
          scheduleId: exec.scheduleId,
          error: exec.error ?? "Unknown error",
        });
      }
    }

    logger.info(
      `✅ Completed — ${executions.length} payment(s): ${succeeded.length} succeeded, ${failed.length} failed`
    );

    return {
      processedCount: executions.length,
      succeeded: succeeded.length,
      failed: failed.length,
      timestamp: payload.timestamp,
    };
  },
});
