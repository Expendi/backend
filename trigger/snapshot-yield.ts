import { schedules, logger } from "@trigger.dev/sdk";
import { Effect } from "effect";
import { runtime } from "../src/runtime.js";
import { YieldService } from "../src/services/yield/yield-service.js";

export const snapshotYield = schedules.task({
  id: "snapshot-yield-positions",
  cron: "0 * * * *",
  run: async (payload) => {
    logger.info("🔍 Fetching active yield positions for snapshotting", {
      timestamp: payload.timestamp,
    });

    const snapshots = await runtime.runPromise(
      Effect.gen(function* () {
        const yieldService = yield* YieldService;
        return yield* yieldService.snapshotAllActivePositions();
      })
    );

    if (snapshots.length === 0) {
      logger.info("No active yield positions to snapshot");
      return { snapshotCount: 0, timestamp: payload.timestamp };
    }

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i]!;
      logger.info(`[${i + 1}/${snapshots.length}] Yield snapshot recorded`, {
        snapshotId: snap.id,
        positionId: snap.positionId,
        currentAssets: snap.currentAssets,
        accruedYield: snap.accruedYield,
        estimatedApy: snap.estimatedApy,
      });
    }

    logger.info(
      `✅ Completed — ${snapshots.length} yield position snapshot(s) recorded`
    );
    return { snapshotCount: snapshots.length, timestamp: payload.timestamp };
  },
});
