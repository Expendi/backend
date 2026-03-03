import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createGroupAccountRoutes } from "../../routes/group-accounts.js";
import {
  GroupAccountService,
  GroupAccountError,
  type GroupWithMembers,
} from "../../services/group-account/group-account-service.js";
import type {
  GroupAccount,
  GroupAccountMember,
} from "../../db/schema/index.js";

const now = new Date("2025-06-15T12:00:00Z");

function makeFakeGroup(overrides?: Partial<GroupAccount>): GroupAccount {
  return {
    id: "group-1",
    groupAddress: "0x1234567890abcdef1234567890abcdef12345678",
    adminUserId: "user-1",
    name: "Test Group",
    description: "A test group",
    chainId: 8453,
    transactionId: "tx-1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeMember(
  overrides?: Partial<GroupAccountMember & { username: string | null }>
): GroupAccountMember & { username: string | null } {
  return {
    id: "member-1",
    groupId: "group-1",
    userId: "user-1",
    walletAddress: "0xuser1111111111111111111111111111111111111",
    role: "admin",
    joinedAt: now,
    username: "alice",
    ...overrides,
  };
}

function makeFakeGroupWithMembers(
  overrides?: Partial<GroupWithMembers>
): GroupWithMembers {
  return {
    ...makeFakeGroup(),
    members: [
      makeFakeMember(),
      makeFakeMember({
        id: "member-2",
        userId: "user-2",
        walletAddress: "0xuser2222222222222222222222222222222222222",
        role: "member",
        username: "bob",
      }),
    ],
    ...overrides,
  };
}

function makeTestRuntime(opts?: {
  createResult?: GroupAccount;
  createFail?: boolean;
  listResult?: GroupAccount[];
  getGroupResult?: GroupWithMembers;
  getGroupFail?: boolean;
  addMemberResult?: GroupAccountMember;
  addMemberFail?: boolean;
  removeFail?: boolean;
  payResult?: { transactionId: string };
  payFail?: boolean;
  depositResult?: { transactionId: string };
  depositFail?: boolean;
  transferFail?: boolean;
  balanceResult?: { eth: string; tokens: Record<string, string> };
  balanceFail?: boolean;
}) {
  const MockGroupAccountLayer = Layer.succeed(GroupAccountService, {
    createGroup: () =>
      opts?.createFail
        ? Effect.fail(new GroupAccountError({ message: "create failed" }))
        : Effect.succeed(opts?.createResult ?? makeFakeGroup()),

    getMyGroups: () =>
      Effect.succeed(opts?.listResult ?? [makeFakeGroup()]),

    getGroup: (groupId: string) =>
      opts?.getGroupFail
        ? Effect.fail(
            new GroupAccountError({ message: `Group not found: ${groupId}` })
          )
        : Effect.succeed(
            opts?.getGroupResult ?? makeFakeGroupWithMembers({ id: groupId })
          ),

    addMember: () =>
      opts?.addMemberFail
        ? Effect.fail(new GroupAccountError({ message: "add member failed" }))
        : Effect.succeed(
            opts?.addMemberResult ??
              makeFakeMember({
                id: "member-new",
                userId: "user-3",
                walletAddress: "0xnew3333333333333333333333333333333333333",
                role: "member",
                username: null,
              })
          ),

    removeMember: () =>
      opts?.removeFail
        ? Effect.fail(
            new GroupAccountError({ message: "remove member failed" })
          )
        : Effect.succeed(undefined as void),

    pay: () =>
      opts?.payFail
        ? Effect.fail(new GroupAccountError({ message: "pay failed" }))
        : Effect.succeed(opts?.payResult ?? { transactionId: "tx-pay-1" }),

    deposit: () =>
      opts?.depositFail
        ? Effect.fail(new GroupAccountError({ message: "deposit failed" }))
        : Effect.succeed(
            opts?.depositResult ?? { transactionId: "tx-deposit-1" }
          ),

    transferAdmin: () =>
      opts?.transferFail
        ? Effect.fail(
            new GroupAccountError({ message: "transfer admin failed" })
          )
        : Effect.succeed(undefined as void),

    getBalance: (groupId: string) =>
      opts?.balanceFail
        ? Effect.fail(
            new GroupAccountError({
              message: `Group not found: ${groupId}`,
            })
          )
        : Effect.succeed(
            opts?.balanceResult ?? {
              eth: "1000000000000000000",
              tokens: {},
            }
          ),
  });

  return ManagedRuntime.make(Layer.mergeAll(MockGroupAccountLayer));
}

function makeApp(runtime: ReturnType<typeof makeTestRuntime>) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId" as any, "user-1");
    await next();
  });
  app.route("/", createGroupAccountRoutes(runtime as any));
  return app;
}

describe("Group Account Routes", () => {
  describe("POST /", () => {
    it("should create a new group", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "My Group",
          description: "A test group",
          members: ["bob", "0xuser2222222222222222222222222222222222222"],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("Test Group");
      expect(body.data.groupAddress).toBeDefined();

      await runtime.dispose();
    });

    it("should return 400 when creation fails", async () => {
      const runtime = makeTestRuntime({ createFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "My Group",
          members: ["bob"],
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("GET /", () => {
    it("should return list of user groups", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);

      await runtime.dispose();
    });

    it("should return empty array when no groups", async () => {
      const runtime = makeTestRuntime({ listResult: [] });
      const app = makeApp(runtime);

      const res = await app.request("/");
      const body = await res.json();
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("GET /:id", () => {
    it("should return group with members", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/group-1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.members).toBeDefined();
      expect(body.data.members).toHaveLength(2);

      await runtime.dispose();
    });

    it("should return 400 when group not found", async () => {
      const runtime = makeTestRuntime({ getGroupFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/nonexistent");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("GET /:id/members", () => {
    it("should return members list", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/group-1/members");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(body.data[0].username).toBe("alice");

      await runtime.dispose();
    });
  });

  describe("POST /:id/members", () => {
    it("should add a member", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/group-1/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member: "charlie" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.role).toBe("member");

      await runtime.dispose();
    });

    it("should return 400 when add member fails", async () => {
      const runtime = makeTestRuntime({ addMemberFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/group-1/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member: "charlie" }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("DELETE /:id/members/:identifier", () => {
    it("should remove a member", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/group-1/members/bob", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.removed).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when remove fails", async () => {
      const runtime = makeTestRuntime({ removeFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/group-1/members/bob", {
        method: "DELETE",
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("POST /:id/pay", () => {
    it("should execute admin payout", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/group-1/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "bob",
          amount: "1000000",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.transactionId).toBe("tx-pay-1");

      await runtime.dispose();
    });

    it("should support token payments", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/group-1/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "0xuser2222222222222222222222222222222222222",
          amount: "5000000",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when pay fails", async () => {
      const runtime = makeTestRuntime({ payFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/group-1/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "bob",
          amount: "1000000",
        }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("POST /:id/deposit", () => {
    it("should execute member deposit", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/group-1/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: "500000",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.transactionId).toBe("tx-deposit-1");

      await runtime.dispose();
    });

    it("should support token deposits", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/group-1/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: "5000000",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        }),
      });

      expect(res.status).toBe(200);

      await runtime.dispose();
    });

    it("should return 400 when deposit fails", async () => {
      const runtime = makeTestRuntime({ depositFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/group-1/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: "500000" }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("POST /:id/transfer-admin", () => {
    it("should transfer admin role", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/group-1/transfer-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newAdmin: "bob" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.transferred).toBe(true);

      await runtime.dispose();
    });

    it("should return 400 when transfer fails", async () => {
      const runtime = makeTestRuntime({ transferFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/group-1/transfer-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newAdmin: "bob" }),
      });

      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });

  describe("GET /:id/balance", () => {
    it("should return balances", async () => {
      const runtime = makeTestRuntime({
        balanceResult: {
          eth: "2000000000000000000",
          tokens: {
            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": "10000000",
          },
        },
      });
      const app = makeApp(runtime);

      const res = await app.request("/group-1/balance");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.eth).toBe("2000000000000000000");
      expect(body.data.tokens).toBeDefined();

      await runtime.dispose();
    });

    it("should support token query parameter", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request(
        "/group-1/balance?tokens=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
      );
      expect(res.status).toBe(200);

      await runtime.dispose();
    });

    it("should return 400 when group not found", async () => {
      const runtime = makeTestRuntime({ balanceFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/nonexistent/balance");
      expect(res.status).toBe(400);

      await runtime.dispose();
    });
  });
});
