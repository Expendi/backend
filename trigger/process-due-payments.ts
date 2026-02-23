import { schedules } from "@trigger.dev/sdk";
import { Effect } from "effect";
import { runtime } from "../src/runtime.js";
import { RecurringPaymentService } from "../src/services/recurring-payment/recurring-payment-service.js";

export const processDuePayments = schedules.task({
  id: "process-due-payments",
  cron: "*/5 * * * *",
  run: async (payload) => {
    const executions = await runtime.runPromise(
      Effect.gen(function* () {
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.processDuePayments();
      })
    );
    return { processedCount: executions.length, timestamp: payload.timestamp };
  },
});
