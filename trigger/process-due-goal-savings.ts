import { schedules, logger } from "@trigger.dev/sdk";
import { Effect } from "effect";
import { runtime } from "../src/runtime.js";
import { GoalSavingsService } from "../src/services/goal-savings/goal-savings-service.js";

export const processDueGoalSavings = schedules.task({
  id: "process-due-goal-savings",
  cron: "*/5 * * * *",
  run: async (payload) => {
    const dbUrl = process.env.DATABASE_URL;
    logger.info("🔍 Fetching due goal savings deposits", {
      timestamp: payload.timestamp,
      dbHost: dbUrl ? new URL(dbUrl).host : "DATABASE_URL NOT SET",
    });

    const deposits = await runtime.runPromise(
      Effect.gen(function* () {
        const gsService = yield* GoalSavingsService;
        return yield* gsService.processDueDeposits();
      })
    );

    if (deposits.length === 0) {
      logger.info("No due goal savings deposits found");
      return { processedCount: 0, timestamp: payload.timestamp };
    }

    for (let i = 0; i < deposits.length; i++) {
      const deposit = deposits[i]!;
      logger.info(`[${i + 1}/${deposits.length}] Goal deposit processed`, {
        depositId: deposit.id,
        goalId: deposit.goalId,
        amount: deposit.amount,
        depositType: deposit.depositType,
        status: deposit.status,
        yieldPositionId: deposit.yieldPositionId,
      });
    }

    logger.info(
      `✅ Completed — ${deposits.length} goal savings deposit(s) processed`
    );
    return { processedCount: deposits.length, timestamp: payload.timestamp };
  },
});
