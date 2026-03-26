import { Effect, Context, Layer, Data } from "effect";
import { eq, desc, and } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import { ConfigService } from "../../config.js";
import {
  notifications,
  notificationPreferences,
  type Notification,
  type NewNotification,
  type NotificationPreference,
} from "../../db/schema/index.js";

// ── Error type ───────────────────────────────────────────────────────

export class NotificationError extends Data.TaggedError(
  "NotificationError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export type NotificationType =
  | "offramp_completed"
  | "offramp_failed"
  | "onramp_completed"
  | "onramp_failed"
  | "savings_deposit_success"
  | "savings_deposit_failed"
  | "savings_goal_completed"
  | "kyc_update"
  | "promo"
  | "general";

export interface SendNotificationParams {
  readonly userId: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body?: string;
  readonly metadata?: Record<string, unknown>;
  /** Override channel for this notification. Defaults to user preference or "in_app". */
  readonly channel?: "in_app" | "email" | "both";
}

export interface UpdatePreferencesParams {
  readonly inAppEnabled?: boolean;
  readonly emailEnabled?: boolean;
  readonly email?: string;
  readonly typeOverrides?: Record<string, boolean>;
}

// ── Service interface ────────────────────────────────────────────────

export interface NotificationServiceApi {
  /** Send a notification to a user (creates in-app record + optional email) */
  readonly send: (
    params: SendNotificationParams
  ) => Effect.Effect<Notification, NotificationError>;

  /** List notifications for a user */
  readonly list: (
    userId: string,
    limit?: number,
    offset?: number
  ) => Effect.Effect<ReadonlyArray<Notification>, NotificationError>;

  /** Count unread notifications */
  readonly countUnread: (
    userId: string
  ) => Effect.Effect<number, NotificationError>;

  /** Mark a single notification as read */
  readonly markRead: (
    id: string,
    userId: string
  ) => Effect.Effect<Notification, NotificationError>;

  /** Mark all notifications as read for a user */
  readonly markAllRead: (
    userId: string
  ) => Effect.Effect<void, NotificationError>;

  /** Get notification preferences for a user */
  readonly getPreferences: (
    userId: string
  ) => Effect.Effect<NotificationPreference, NotificationError>;

  /** Update notification preferences */
  readonly updatePreferences: (
    userId: string,
    params: UpdatePreferencesParams
  ) => Effect.Effect<NotificationPreference, NotificationError>;
}

export class NotificationService extends Context.Tag("NotificationService")<
  NotificationService,
  NotificationServiceApi
>() {}

// ── Email helper ─────────────────────────────────────────────────────

async function sendEmailViaResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  body: string
): Promise<boolean> {
  if (!apiKey) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html: body,
      }),
    });
    return res.ok;
  } catch {
    console.error("[NotificationService] Failed to send email");
    return false;
  }
}

// ── Live implementation ──────────────────────────────────────────────

export const NotificationServiceLive: Layer.Layer<
  NotificationService,
  never,
  DatabaseService | ConfigService
> = Layer.effect(
  NotificationService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const config = yield* ConfigService;

    const getOrCreatePreferences = (
      userId: string
    ): Effect.Effect<NotificationPreference, NotificationError> =>
      Effect.gen(function* () {
        const [existing] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(notificationPreferences)
              .where(eq(notificationPreferences.userId, userId)),
          catch: (error) =>
            new NotificationError({
              message: `Failed to fetch preferences: ${error}`,
              cause: error,
            }),
        });

        if (existing) return existing;

        const [created] = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(notificationPreferences)
              .values({ userId })
              .returning(),
          catch: (error) =>
            new NotificationError({
              message: `Failed to create default preferences: ${error}`,
              cause: error,
            }),
        });

        return created!;
      });

    return {
      send: (params: SendNotificationParams) =>
        Effect.gen(function* () {
          const prefs = yield* getOrCreatePreferences(params.userId);

          // Check if this notification type is disabled via overrides
          const typeOverrides = prefs.typeOverrides ?? {};
          if (typeOverrides[params.type] === false) {
            // User opted out of this type — still record but mark as archived
            const [notification] = yield* Effect.tryPromise({
              try: () =>
                db
                  .insert(notifications)
                  .values({
                    userId: params.userId,
                    type: params.type,
                    title: params.title,
                    body: params.body ?? null,
                    metadata: params.metadata ?? null,
                    channel: "in_app",
                    status: "archived",
                    emailSent: false,
                  } satisfies NewNotification)
                  .returning(),
              catch: (error) =>
                new NotificationError({
                  message: `Failed to create notification: ${error}`,
                  cause: error,
                }),
            });
            return notification!;
          }

          // Determine effective channel
          const requestedChannel = params.channel ?? "both";
          let effectiveChannel: "in_app" | "email" | "both" = requestedChannel;

          if (!prefs.emailEnabled || !prefs.email || !config.resendApiKey) {
            effectiveChannel =
              requestedChannel === "email" ? "in_app" : "in_app";
            if (requestedChannel === "both") effectiveChannel = "in_app";
          }
          if (!prefs.inAppEnabled) {
            effectiveChannel =
              requestedChannel === "in_app" ? "in_app" : effectiveChannel;
          }

          // Send email if needed
          let emailSent = false;
          if (
            (effectiveChannel === "email" || effectiveChannel === "both") &&
            prefs.email &&
            config.resendApiKey
          ) {
            const htmlBody = renderNotificationEmail(
              params.title,
              params.body
            );
            emailSent = yield* Effect.tryPromise({
              try: () =>
                sendEmailViaResend(
                  config.resendApiKey,
                  config.notificationFromEmail,
                  prefs.email!,
                  params.title,
                  htmlBody
                ),
              catch: () =>
                new NotificationError({
                  message: "Email send failed",
                }),
            });
          }

          // Create in-app notification record
          const [notification] = yield* Effect.tryPromise({
            try: () =>
              db
                .insert(notifications)
                .values({
                  userId: params.userId,
                  type: params.type,
                  title: params.title,
                  body: params.body ?? null,
                  metadata: params.metadata ?? null,
                  channel: effectiveChannel,
                  status: "unread",
                  emailSent,
                } satisfies NewNotification)
                .returning(),
            catch: (error) =>
              new NotificationError({
                message: `Failed to create notification: ${error}`,
                cause: error,
              }),
          });

          return notification!;
        }),

      list: (userId: string, limit = 50, offset = 0) =>
        Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(notifications)
              .where(eq(notifications.userId, userId))
              .orderBy(desc(notifications.createdAt))
              .limit(limit)
              .offset(offset),
          catch: (error) =>
            new NotificationError({
              message: `Failed to list notifications: ${error}`,
              cause: error,
            }),
        }),

      countUnread: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(notifications)
              .where(
                and(
                  eq(notifications.userId, userId),
                  eq(notifications.status, "unread")
                )
              );
            return results.length;
          },
          catch: (error) =>
            new NotificationError({
              message: `Failed to count unread: ${error}`,
              cause: error,
            }),
        }),

      markRead: (id: string, userId: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(notifications)
              .set({ status: "read" })
              .where(
                and(eq(notifications.id, id), eq(notifications.userId, userId))
              )
              .returning();
            if (!result) throw new Error("Notification not found");
            return result;
          },
          catch: (error) =>
            new NotificationError({
              message: `Failed to mark notification as read: ${error}`,
              cause: error,
            }),
        }),

      markAllRead: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(notifications)
              .set({ status: "read" })
              .where(
                and(
                  eq(notifications.userId, userId),
                  eq(notifications.status, "unread")
                )
              );
          },
          catch: (error) =>
            new NotificationError({
              message: `Failed to mark all as read: ${error}`,
              cause: error,
            }),
        }),

      getPreferences: (userId: string) => getOrCreatePreferences(userId),

      updatePreferences: (userId: string, params: UpdatePreferencesParams) =>
        Effect.gen(function* () {
          // Ensure preferences exist
          yield* getOrCreatePreferences(userId);

          const updates: Record<string, unknown> = {
            updatedAt: new Date(),
          };
          if (params.inAppEnabled !== undefined)
            updates.inAppEnabled = params.inAppEnabled;
          if (params.emailEnabled !== undefined)
            updates.emailEnabled = params.emailEnabled;
          if (params.email !== undefined) updates.email = params.email;
          if (params.typeOverrides !== undefined)
            updates.typeOverrides = params.typeOverrides;

          const [result] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(notificationPreferences)
                .set(updates)
                .where(eq(notificationPreferences.userId, userId))
                .returning(),
            catch: (error) =>
              new NotificationError({
                message: `Failed to update preferences: ${error}`,
                cause: error,
              }),
          });

          return result!;
        }),
    };
  })
);

// ── Email template ───────────────────────────────────────────────────

function renderNotificationEmail(
  title: string,
  body?: string | null
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5;">
  <div style="max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: #0A0A0A; padding: 24px 32px;">
      <h1 style="color: #ffffff; font-size: 20px; margin: 0;">Expendi</h1>
    </div>
    <div style="padding: 32px;">
      <h2 style="color: #1a1a1a; font-size: 18px; margin: 0 0 12px 0;">${title}</h2>
      ${body ? `<p style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin: 0;">${body}</p>` : ""}
    </div>
    <div style="padding: 16px 32px; border-top: 1px solid #eee; color: #999; font-size: 12px;">
      You received this because you have email notifications enabled on Expendi.
    </div>
  </div>
</body>
</html>`.trim();
}
