import { schedules } from "@trigger.dev/sdk";
import { Effect } from "effect";
import { runtime } from "../src/runtime.js";
import { SwapAutomationService } from "../src/services/swap-automation/swap-automation-service.js";

export const processSwapAutomations = schedules.task({
  id: "process-swap-automations",
  cron: "* * * * *", // every minute
  run: async (payload) => {
    const executions = await runtime.runPromise(
      Effect.gen(function* () {
        const service = yield* SwapAutomationService;
        return yield* service.processDueAutomations();
      })
    );
    return { processedCount: executions.length, timestamp: payload.timestamp };
  },
});
