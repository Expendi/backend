import { createMiddleware } from "hono/factory";
import { Effect } from "effect";
import type { AppRuntime } from "../routes/effect-handler.js";
import { TransactionApprovalService } from "../services/transaction-approval/transaction-approval-service.js";
import type { AuthVariables } from "./auth.js";

/**
 * Middleware that gates mutating requests behind an optional transaction
 * approval check (PIN or passkey). Read-only methods (GET, OPTIONS, HEAD)
 * always pass through.
 *
 * If the user has `requireTransactionApproval` enabled, the request must
 * include a valid `X-Approval-Token` header obtained via the
 * `/api/security/approval/verify` endpoint.
 *
 * Backend-automated flows (recurring payments, goal savings, etc.) never
 * hit HTTP middleware so they bypass this entirely.
 */
export function transactionApprovalMiddleware(runtime: AppRuntime) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    // Read-only methods always pass through
    if (["GET", "OPTIONS", "HEAD"].includes(c.req.method)) {
      await next();
      return;
    }

    // Dev bypass
    if (
      process.env.NODE_ENV === "development" &&
      c.req.header("X-Dev-User-Id")
    ) {
      await next();
      return;
    }

    const userId = c.get("userId");

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const approvalService = yield* TransactionApprovalService;
          const settings = yield* approvalService.getApprovalSettings(userId);

          if (!settings.enabled) {
            return { allowed: true as const };
          }

          const token = c.req.header("X-Approval-Token");
          if (!token) {
            return {
              allowed: false as const,
              reason: "Transaction approval required",
              method: settings.method,
            };
          }

          const tokenUserId =
            yield* approvalService.verifyApprovalToken(token);

          if (tokenUserId !== userId) {
            return {
              allowed: false as const,
              reason: "Invalid approval token",
              method: settings.method,
            };
          }

          return { allowed: true as const };
        })
      );

      if (result.allowed) {
        await next();
      } else {
        return c.json(
          {
            success: false,
            error: {
              _tag: "TransactionApprovalRequired",
              message: result.reason,
              method: result.method,
            },
          },
          403
        );
      }
    } catch {
      return c.json(
        {
          success: false,
          error: {
            _tag: "TransactionApprovalError",
            message: "Invalid or expired approval token",
          },
        },
        403
      );
    }
  });
}
