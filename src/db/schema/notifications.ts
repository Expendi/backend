import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  notificationTypeEnum,
  notificationChannelEnum,
  notificationStatusEnum,
} from "./enums.js";
import { userProfiles } from "./user-profiles.js";

export {
  notificationTypeEnum,
  notificationChannelEnum,
  notificationStatusEnum,
} from "./enums.js";

export const notifications = pgTable("notifications", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  type: notificationTypeEnum("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  /** Arbitrary data associated with the notification (tx hash, amounts, etc.) */
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  channel: notificationChannelEnum("channel").default("in_app").notNull(),
  status: notificationStatusEnum("status").default("unread").notNull(),
  /** Whether the email was sent successfully (null if channel is in_app only) */
  emailSent: boolean("email_sent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(userProfiles, {
    fields: [notifications.userId],
    references: [userProfiles.privyUserId],
  }),
}));

export const notificationPreferences = pgTable("notification_preferences", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().unique(),
  /** Master toggle for in-app notifications */
  inAppEnabled: boolean("in_app_enabled").default(true).notNull(),
  /** Master toggle for email notifications */
  emailEnabled: boolean("email_enabled").default(true).notNull(),
  /** Email address for notifications (fetched from Privy or user-provided) */
  email: text("email"),
  /** Per-type overrides: { "offramp_completed": false, ... } */
  typeOverrides: jsonb("type_overrides").$type<Record<string, boolean>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const notificationPreferencesRelations = relations(
  notificationPreferences,
  ({ one }) => ({
    user: one(userProfiles, {
      fields: [notificationPreferences.userId],
      references: [userProfiles.privyUserId],
    }),
  })
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
