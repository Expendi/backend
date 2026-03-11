import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { TransactionApprovalService } from "../services/transaction-approval/transaction-approval-service.js";
import type { AuthVariables } from "../middleware/auth.js";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/server";

/**
 * Security / transaction approval management routes.
 * Mounted at `/api/security/approval`.
 */
export function createTransactionApprovalRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Get approval settings
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* TransactionApprovalService;
        return yield* service.getApprovalSettings(userId);
      }),
      c
    )
  );

  // ── PIN endpoints ─────────────────────────────────────────────────

  // Set up PIN
  app.post("/pin/setup", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ pin: string }>(),
          catch: () => new Error("Invalid request body"),
        });
        const service = yield* TransactionApprovalService;
        yield* service.setupPin(userId, body.pin);
        return { message: "PIN configured successfully" };
      }),
      c
    )
  );

  // Change PIN
  app.post("/pin/change", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{ currentPin: string; newPin: string }>(),
          catch: () => new Error("Invalid request body"),
        });
        const service = yield* TransactionApprovalService;
        yield* service.changePin(userId, body.currentPin, body.newPin);
        return { message: "PIN updated successfully" };
      }),
      c
    )
  );

  // Remove PIN
  app.delete("/pin", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ pin: string }>(),
          catch: () => new Error("Invalid request body"),
        });
        const service = yield* TransactionApprovalService;
        yield* service.removePin(userId, body.pin);
        return { message: "PIN removed successfully" };
      }),
      c
    )
  );

  // ── Passkey endpoints ─────────────────────────────────────────────

  // Get registration options
  app.post("/passkey/register", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* TransactionApprovalService;
        return yield* service.generateRegistrationOptions(userId);
      }),
      c
    )
  );

  // Verify registration
  app.post("/passkey/register/verify", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              credential: RegistrationResponseJSON;
              label?: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });
        const service = yield* TransactionApprovalService;
        yield* service.verifyRegistration(
          userId,
          body.credential,
          body.label
        );
        return { message: "Passkey registered successfully" };
      }),
      c
    )
  );

  // List passkeys
  app.get("/passkeys", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const service = yield* TransactionApprovalService;
        return yield* service.listPasskeys(userId);
      }),
      c
    )
  );

  // Remove passkey
  app.delete("/passkeys/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const passkeyId = c.req.param("id");
        const service = yield* TransactionApprovalService;
        yield* service.removePasskey(userId, passkeyId);
        return { message: "Passkey removed successfully" };
      }),
      c
    )
  );

  // ── Verify & get approval token ───────────────────────────────────

  app.post("/verify", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              method: "pin" | "passkey";
              pin?: string;
              credential?: AuthenticationResponseJSON;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const service = yield* TransactionApprovalService;

        if (body.method === "pin") {
          if (!body.pin) {
            return yield* Effect.fail(
              new Error("PIN is required for pin verification")
            );
          }
          const isValid = yield* service.verifyPin(userId, body.pin);
          if (!isValid) {
            return yield* Effect.fail(new Error("Invalid PIN"));
          }
        } else if (body.method === "passkey") {
          if (!body.credential) {
            // No credential = first step: return authentication options
            const options =
              yield* service.generateAuthenticationOptions(userId);
            return { challenge: true, options };
          }
          const isValid = yield* service.verifyAuthentication(
            userId,
            body.credential
          );
          if (!isValid) {
            return yield* Effect.fail(
              new Error("Passkey authentication failed")
            );
          }
        } else {
          return yield* Effect.fail(
            new Error("Invalid method. Use 'pin' or 'passkey'")
          );
        }

        const approvalToken = yield* service.generateApprovalToken(userId);
        return { approvalToken };
      }),
      c
    )
  );

  // ── Disable approval entirely ─────────────────────────────────────

  app.delete("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              pin?: string;
              credential?: AuthenticationResponseJSON;
            }>(),
          catch: () => new Error("Invalid request body"),
        });
        const service = yield* TransactionApprovalService;
        yield* service.disableApproval(userId, body.pin, body.credential);
        return { message: "Transaction approval disabled" };
      }),
      c
    )
  );

  return app;
}
