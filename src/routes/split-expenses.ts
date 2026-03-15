import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { SplitExpenseService } from "../services/split-expense/index.js";
import type { AuthVariables } from "../middleware/auth.js";

export function createSplitExpenseRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // POST /api/split-expenses — Create a split expense
  app.post("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              title: string;
              tokenAddress: string;
              tokenSymbol: string;
              tokenDecimals: number;
              totalAmount: string;
              chainId: number;
              transactionId?: string | null;
              categoryId?: string | null;
              shares: { userId: string; amount: string }[];
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const service = yield* SplitExpenseService;
        return yield* service.createExpense(userId, body);
      }),
      c,
      201
    )
  );

  // GET /api/split-expenses — List user's split expenses
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* SplitExpenseService;
        return yield* service.listByUser(userId);
      }),
      c
    )
  );

  // GET /api/split-expenses/:id — Get single expense with shares
  app.get("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const service = yield* SplitExpenseService;
        return yield* service.getExpense(id, userId);
      }),
      c
    )
  );

  // POST /api/split-expenses/:id/pay — Pay your share
  app.post("/:id/pay", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const shareId = c.req.param("id");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId: string;
              walletType: "user" | "server" | "agent";
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const service = yield* SplitExpenseService;
        return yield* service.payShare(
          shareId,
          userId,
          body.walletId,
          body.walletType
        );
      }),
      c
    )
  );

  // DELETE /api/split-expenses/:id — Cancel expense (creator only)
  app.delete("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const expenseId = c.req.param("id");
        const service = yield* SplitExpenseService;
        return yield* service.cancelExpense(expenseId, userId);
      }),
      c
    )
  );

  return app;
}
