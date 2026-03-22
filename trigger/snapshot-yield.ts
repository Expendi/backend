import { schedules, logger } from "@trigger.dev/sdk";
import { Effect } from "effect";
import { runtime } from "../src/runtime.js";
import { YieldService } from "../src/services/yield/yield-service.js";

export const snapshotYield = schedules.task({
  id: "snapshot-yield-positions",
  cron: "0 * * * *",
  run: async (payload) => {
    logger.info("Starting snapshot-yield-positions", { timestamp: payload.timestamp });
    const snapshots = await runtime.runPromise(
      Effect.gen(function* () {
        const yieldService = yield* YieldService;
        return yield* yieldService.snapshotAllActivePositions();
      })
    );
    logger.info("Completed snapshot-yield-positions", { snapshotCount: snapshots.length });
    return { snapshotCount: snapshots.length, timestamp: payload.timestamp };
  },
});
