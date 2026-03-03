import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { wallets } from "./wallets.js";

export const userProfiles = pgTable("user_profiles", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  privyUserId: text("privy_user_id").notNull().unique(),
  userWalletId: text("user_wallet_id")
    .notNull()
    .references(() => wallets.id),
  serverWalletId: text("server_wallet_id")
    .notNull()
    .references(() => wallets.id),
  agentWalletId: text("agent_wallet_id")
    .notNull()
    .references(() => wallets.id),
  username: text("username").unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  userWallet: one(wallets, {
    fields: [userProfiles.userWalletId],
    references: [wallets.id],
    relationName: "userWallet",
  }),
  serverWallet: one(wallets, {
    fields: [userProfiles.serverWalletId],
    references: [wallets.id],
    relationName: "serverWallet",
  }),
  agentWallet: one(wallets, {
    fields: [userProfiles.agentWalletId],
    references: [wallets.id],
    relationName: "agentWallet",
  }),
}));

export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
