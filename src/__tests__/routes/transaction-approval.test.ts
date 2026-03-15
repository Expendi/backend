import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createTransactionApprovalRoutes } from "../../routes/transaction-approval.js";
import {
  TransactionApprovalService,
  TransactionApprovalError,
} from "../../services/transaction-approval/transaction-approval-service.js";

function makeTestRuntime(opts?: {
  approvalSettings?: {
    enabled: boolean;
    method: "pin" | "passkey" | null;
    passkeyCount: number;
  };
  setupPinFail?: boolean;
  changePinFail?: boolean;
  removePinFail?: boolean;
  verifyPinResult?: boolean;
  registrationOptions?: unknown;
  authenticationOptions?: unknown;
  verifyRegistrationFail?: boolean;
  verifyAuthenticationResult?: boolean;
  passkeys?: Array<{
    id: string;
    credentialId: string;
    label: string | null;
    createdAt: Date;
  }>;
  removePasskeyFail?: boolean;
  approvalToken?: string;
  disableApprovalFail?: boolean;
}) {
  const MockTransactionApprovalLayer = Layer.succeed(
    TransactionApprovalService,
    {
      getApprovalSettings: () =>
        Effect.succeed(
          opts?.approvalSettings ?? {
            enabled: true,
            method: "pin",
            passkeyCount: 0,
          }
        ),
      setupPin: () =>
        opts?.setupPinFail
          ? Effect.fail(
              new TransactionApprovalError({ message: "setup pin failed" })
            )
          : Effect.void,
      changePin: () =>
        opts?.changePinFail
          ? Effect.fail(
              new TransactionApprovalError({ message: "change pin failed" })
            )
          : Effect.void,
      removePin: () =>
        opts?.removePinFail
          ? Effect.fail(
              new TransactionApprovalError({ message: "remove pin failed" })
            )
          : Effect.void,
      verifyPin: () => Effect.succeed(opts?.verifyPinResult ?? true),
      generateRegistrationOptions: () =>
        Effect.succeed(
          opts?.registrationOptions ?? {
            challenge: "test-challenge",
            rp: { name: "Expendi", id: "expendi.app" },
            user: { id: "user-1", name: "user-1", displayName: "User" },
          }
        ),
      verifyRegistration: () =>
        opts?.verifyRegistrationFail
          ? Effect.fail(
              new TransactionApprovalError({
                message: "verification failed",
              })
            )
          : Effect.void,
      generateAuthenticationOptions: () =>
        Effect.succeed(
          opts?.authenticationOptions ?? {
            challenge: "auth-challenge",
            allowCredentials: [],
          }
        ),
      verifyAuthentication: () =>
        Effect.succeed(opts?.verifyAuthenticationResult ?? true),
      listPasskeys: () =>
        Effect.succeed(
          opts?.passkeys ?? [
            {
              id: "passkey-1",
              credentialId: "cred-1",
              label: "My Key",
              createdAt: new Date("2025-01-15T12:00:00Z"),
            },
          ]
        ),
      removePasskey: () =>
        opts?.removePasskeyFail
          ? Effect.fail(
              new TransactionApprovalError({
                message: "remove passkey failed",
              })
            )
          : Effect.void,
      generateApprovalToken: () =>
        Effect.succeed(opts?.approvalToken ?? "test-approval-token"),
      verifyApprovalToken: () => Effect.succeed("user-1"),
      disableApproval: () =>
        opts?.disableApprovalFail
          ? Effect.fail(
              new TransactionApprovalError({
                message: "disable approval failed",
              })
            )
          : Effect.void,
    }
  );

  return ManagedRuntime.make(MockTransactionApprovalLayer);
}

function makeApp(runtime: ReturnType<typeof makeTestRuntime>) {
  const app = new Hono();
  // Simulate auth by setting userId
  app.use("*", async (c, next) => {
    c.set("userId" as any, "user-1");
    await next();
  });
  app.route("/", createTransactionApprovalRoutes(runtime as any));
  return app;
}

describe("Transaction Approval Routes", () => {
  describe("GET /", () => {
    it("should return approval settings", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.enabled).toBe(true);
      expect(body.data.method).toBe("pin");
      expect(body.data.passkeyCount).toBe(0);

      await runtime.dispose();
    });

    it("should return disabled settings when approval is off", async () => {
      const runtime = makeTestRuntime({
        approvalSettings: {
          enabled: false,
          method: null,
          passkeyCount: 0,
        },
      });
      const app = makeApp(runtime);

      const res = await app.request("/");
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.enabled).toBe(false);
      expect(body.data.method).toBe(null);

      await runtime.dispose();
    });
  });

  describe("POST /pin/setup", () => {
    it("should set up a PIN successfully", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/pin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "1234" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.message).toBe("PIN configured successfully");

      await runtime.dispose();
    });

    it("should return 400 when setup fails", async () => {
      const runtime = makeTestRuntime({ setupPinFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/pin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "1234" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /pin/change", () => {
    it("should change PIN successfully", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/pin/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPin: "1234", newPin: "5678" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.message).toBe("PIN updated successfully");

      await runtime.dispose();
    });

    it("should return 400 when change fails", async () => {
      const runtime = makeTestRuntime({ changePinFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/pin/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPin: "1234", newPin: "5678" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("DELETE /pin", () => {
    it("should remove PIN successfully", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/pin", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "1234" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.message).toBe("PIN removed successfully");

      await runtime.dispose();
    });

    it("should return 400 when remove fails", async () => {
      const runtime = makeTestRuntime({ removePinFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/pin", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "1234" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /passkey/register", () => {
    it("should return registration options", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/passkey/register", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.challenge).toBe("test-challenge");
      expect(body.data.rp).toBeDefined();

      await runtime.dispose();
    });
  });

  describe("POST /passkey/register/verify", () => {
    it("should verify registration successfully", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: {
            id: "cred-id",
            rawId: "raw-id",
            response: {
              attestationObject: "attestation",
              clientDataJSON: "client-data",
            },
            type: "public-key",
          },
          label: "My Passkey",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.message).toBe("Passkey registered successfully");

      await runtime.dispose();
    });

    it("should return 400 when verification fails", async () => {
      const runtime = makeTestRuntime({ verifyRegistrationFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: {
            id: "cred-id",
            rawId: "raw-id",
            response: {
              attestationObject: "attestation",
              clientDataJSON: "client-data",
            },
            type: "public-key",
          },
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("GET /passkeys", () => {
    it("should return list of passkeys", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/passkeys");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe("passkey-1");
      expect(body.data[0].label).toBe("My Key");

      await runtime.dispose();
    });

    it("should return empty array when no passkeys", async () => {
      const runtime = makeTestRuntime({ passkeys: [] });
      const app = makeApp(runtime);

      const res = await app.request("/passkeys");
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);

      await runtime.dispose();
    });
  });

  describe("DELETE /passkeys/:id", () => {
    it("should remove a passkey successfully", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/passkeys/passkey-1", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.message).toBe("Passkey removed successfully");

      await runtime.dispose();
    });

    it("should return 400 when remove fails", async () => {
      const runtime = makeTestRuntime({ removePasskeyFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/passkeys/nonexistent", {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("POST /verify", () => {
    it("should verify PIN and return approval token", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "pin", pin: "1234" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.approvalToken).toBe("test-approval-token");

      await runtime.dispose();
    });

    it("should return challenge when passkey method without credential", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "passkey" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.challenge).toBe(true);
      expect(body.data.options).toBeDefined();
      expect(body.data.options.challenge).toBe("auth-challenge");

      await runtime.dispose();
    });

    it("should verify passkey credential and return approval token", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "passkey",
          credential: {
            id: "cred-id",
            rawId: "raw-id",
            response: {
              authenticatorData: "auth-data",
              clientDataJSON: "client-data",
              signature: "sig",
            },
            type: "public-key",
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.approvalToken).toBe("test-approval-token");

      await runtime.dispose();
    });

    it("should return 400 when PIN verification fails", async () => {
      const runtime = makeTestRuntime({ verifyPinResult: false });
      const app = makeApp(runtime);

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "pin", pin: "0000" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });

  describe("DELETE /", () => {
    it("should disable approval successfully", async () => {
      const runtime = makeTestRuntime();
      const app = makeApp(runtime);

      const res = await app.request("/", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "1234" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.message).toBe("Transaction approval disabled");

      await runtime.dispose();
    });

    it("should return 400 when disable fails", async () => {
      const runtime = makeTestRuntime({ disableApprovalFail: true });
      const app = makeApp(runtime);

      const res = await app.request("/", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "1234" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);

      await runtime.dispose();
    });
  });
});
