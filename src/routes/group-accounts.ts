import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { GroupAccountService } from "../services/group-account/index.js";
import type { AuthVariables } from "../middleware/auth.js";

export function createGroupAccountRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // POST /api/groups — Create a new group
  app.post("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              name: string;
              description?: string;
              members: string[];
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const groupService = yield* GroupAccountService;
        return yield* groupService.createGroup(userId, {
          name: body.name,
          description: body.description,
          members: body.members,
        });
      }),
      c,
      201
    )
  );

  // GET /api/groups — List user's groups
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const groupService = yield* GroupAccountService;
        return yield* groupService.getMyGroups(userId);
      }),
      c
    )
  );

  // GET /api/groups/:id — Get group with members
  app.get("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const groupId = c.req.param("id");
        const groupService = yield* GroupAccountService;
        return yield* groupService.getGroup(groupId);
      }),
      c
    )
  );

  // GET /api/groups/:id/members — List members with usernames + addresses
  app.get("/:id/members", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const groupId = c.req.param("id");
        const groupService = yield* GroupAccountService;
        const group = yield* groupService.getGroup(groupId);
        return group.members;
      }),
      c
    )
  );

  // POST /api/groups/:id/members — Add member (admin only)
  app.post("/:id/members", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const groupId = c.req.param("id");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ member: string }>(),
          catch: () => new Error("Invalid request body"),
        });

        const groupService = yield* GroupAccountService;
        return yield* groupService.addMember(
          groupId,
          userId,
          body.member
        );
      }),
      c,
      201
    )
  );

  // DELETE /api/groups/:id/members/:identifier — Remove member (admin only)
  app.delete("/:id/members/:identifier", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const groupId = c.req.param("id");
        const identifier = c.req.param("identifier");

        const groupService = yield* GroupAccountService;
        yield* groupService.removeMember(groupId, userId, identifier);
        return { removed: true };
      }),
      c
    )
  );

  // POST /api/groups/:id/pay — Admin payout
  app.post("/:id/pay", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const groupId = c.req.param("id");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{ to: string; amount: string; token?: string }>(),
          catch: () => new Error("Invalid request body"),
        });

        const groupService = yield* GroupAccountService;
        return yield* groupService.pay(groupId, userId, body);
      }),
      c
    )
  );

  // POST /api/groups/:id/deposit — Member deposit
  app.post("/:id/deposit", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const groupId = c.req.param("id");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{ amount: string; token?: string }>(),
          catch: () => new Error("Invalid request body"),
        });

        const groupService = yield* GroupAccountService;
        return yield* groupService.deposit(groupId, userId, body);
      }),
      c
    )
  );

  // POST /api/groups/:id/transfer-admin — Transfer admin role
  app.post("/:id/transfer-admin", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const groupId = c.req.param("id");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ newAdmin: string }>(),
          catch: () => new Error("Invalid request body"),
        });

        const groupService = yield* GroupAccountService;
        yield* groupService.transferAdmin(
          groupId,
          userId,
          body.newAdmin
        );
        return { transferred: true };
      }),
      c
    )
  );

  // GET /api/groups/:id/balance — Get balances
  app.get("/:id/balance", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const groupId = c.req.param("id");
        const tokensParam = c.req.query("tokens");
        const tokens = tokensParam
          ? tokensParam.split(",").filter(Boolean)
          : undefined;

        const groupService = yield* GroupAccountService;
        return yield* groupService.getBalance(groupId, tokens);
      }),
      c
    )
  );

  return app;
}
