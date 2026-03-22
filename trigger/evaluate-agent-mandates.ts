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
    logger.info("🔍 Evaluating all active agent mandates", {
      timestamp: payload.timestamp,
    });

    const summary = await runtime.runPromise(
      Effect.gen(function* () {
        const autonomy = yield* AgentAutonomyService;
        return yield* autonomy.processAllMandates();
      })
    );

    if (summary.processed === 0) {
      logger.info("No active mandates to evaluate");
      return {
        processedCount: 0,
        triggered: 0,
        skipped: 0,
        failed: 0,
        timestamp: payload.timestamp,
        scheduleId: payload.scheduleId,
      };
    }

    for (let i = 0; i < summary.results.length; i++) {
      const r = summary.results[i]!;
      const logLevel = r.status === "failed" ? "error" : "info";
      logger[logLevel](
        `[${i + 1}/${summary.results.length}] Mandate ${r.status}`,
        {
          mandateId: r.mandateId,
          status: r.status,
          reason: r.reason ?? undefined,
        }
      );
    }

    logger.info(
      `✅ Completed — ${summary.processed} mandate(s): ${summary.executed} triggered, ${summary.skipped} skipped, ${summary.failed} failed`
    );

    return {
      processedCount: summary.processed,
      triggered: summary.executed,
      skipped: summary.skipped,
      failed: summary.failed,
      timestamp: payload.timestamp,
      scheduleId: payload.scheduleId,
    };
  },
});
