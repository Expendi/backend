import { createMiddleware } from "hono/factory";
import type { PrivyClient } from "@privy-io/node";

/**
 * Hono variable types added by the auth middleware.
 * Use with `Hono<{ Variables: AuthVariables }>` so that
 * `c.get('userId')` is correctly typed as `string`.
 */
export type AuthVariables = {
  userId: string;
};

/**
 * Creates Hono middleware that verifies a Privy access token from the
 * `Authorization: Bearer <token>` header. On success the authenticated
 * user's Privy DID is stored as `userId` in the Hono context.
 *
 * The PrivyClient is passed in at setup time so the middleware does not
 * need to reach into the Effect runtime on every request.
 */
export function privyAuthMiddleware(privyClient: PrivyClient) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    // Dev bypass: allow X-Dev-User-Id header in development mode
    if (process.env.NODE_ENV === "development") {
      const devUserId = c.req.header("X-Dev-User-Id");
      if (devUserId) {
        c.set("userId", devUserId);
        await next();
        return;
      }
    }

    const authorization = c.req.header("Authorization");

    if (!authorization || !authorization.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const token = authorization.slice("Bearer ".length);

    if (token.length === 0) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    try {
      const payload = await privyClient.utils().auth().verifyAccessToken(token);
      c.set("userId", payload.user_id);
      await next();
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }
  });
}

/**
 * Hono middleware that protects internal/admin routes by checking the
 * `X-Admin-Key` header against the configured `ADMIN_API_KEY`.
 */
export function adminKeyMiddleware(adminApiKey: string) {
  return createMiddleware(async (c, next) => {
    const providedKey = c.req.header("X-Admin-Key");

    if (!providedKey || providedKey !== adminApiKey) {
      return c.json({ error: "Forbidden" }, 403);
    }

    await next();
  });
}
