import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { userProfiles } from "./user-profiles.js";

export const userPasskeys = pgTable("user_passkeys", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => userProfiles.privyUserId),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  transports: text("transports"),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const userPasskeysRelations = relations(userPasskeys, ({ one }) => ({
  userProfile: one(userProfiles, {
    fields: [userPasskeys.userId],
    references: [userProfiles.privyUserId],
  }),
}));

export type UserPasskey = typeof userPasskeys.$inferSelect;
export type NewUserPasskey = typeof userPasskeys.$inferInsert;
