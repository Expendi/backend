import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { groupAccountRoleEnum } from "./enums.js";
import { transactions } from "./transactions.js";

export { groupAccountRoleEnum } from "./enums.js";

export const groupAccounts = pgTable("group_accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  groupAddress: text("group_address").notNull().unique(),
  adminUserId: text("admin_user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  chainId: integer("chain_id").notNull().default(8453),
  transactionId: text("transaction_id").references(() => transactions.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const groupAccountMembers = pgTable("group_account_members", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  groupId: text("group_id")
    .notNull()
    .references(() => groupAccounts.id),
  userId: text("user_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  role: groupAccountRoleEnum("role").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const groupAccountsRelations = relations(
  groupAccounts,
  ({ one, many }) => ({
    transaction: one(transactions, {
      fields: [groupAccounts.transactionId],
      references: [transactions.id],
    }),
    members: many(groupAccountMembers),
  })
);

export const groupAccountMembersRelations = relations(
  groupAccountMembers,
  ({ one }) => ({
    group: one(groupAccounts, {
      fields: [groupAccountMembers.groupId],
      references: [groupAccounts.id],
    }),
  })
);

export type GroupAccount = typeof groupAccounts.$inferSelect;
export type NewGroupAccount = typeof groupAccounts.$inferInsert;
export type GroupAccountMember = typeof groupAccountMembers.$inferSelect;
export type NewGroupAccountMember = typeof groupAccountMembers.$inferInsert;
