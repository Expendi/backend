import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  splitExpenseStatusEnum,
  splitExpenseShareStatusEnum,
} from "./enums.js";
import { transactions } from "./transactions.js";
import { transactionCategories } from "./transaction-categories.js";

export { splitExpenseStatusEnum, splitExpenseShareStatusEnum } from "./enums.js";

export const splitExpenses = pgTable("split_expenses", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  creatorUserId: text("creator_user_id").notNull(),
  title: text("title").notNull(),
  tokenAddress: text("token_address").notNull(),
  tokenSymbol: text("token_symbol").notNull(),
  tokenDecimals: integer("token_decimals").notNull(),
  totalAmount: text("total_amount").notNull(),
  chainId: integer("chain_id").notNull().default(8453),
  transactionId: text("transaction_id").references(() => transactions.id),
  categoryId: text("category_id").references(() => transactionCategories.id),
  status: splitExpenseStatusEnum("status").default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const splitExpenseShares = pgTable("split_expense_shares", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  expenseId: text("expense_id")
    .notNull()
    .references(() => splitExpenses.id),
  debtorUserId: text("debtor_user_id").notNull(),
  amount: text("amount").notNull(),
  status: splitExpenseShareStatusEnum("status").default("pending").notNull(),
  transactionId: text("transaction_id").references(() => transactions.id),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const splitExpensesRelations = relations(
  splitExpenses,
  ({ one, many }) => ({
    transaction: one(transactions, {
      fields: [splitExpenses.transactionId],
      references: [transactions.id],
    }),
    shares: many(splitExpenseShares),
  })
);

export const splitExpenseSharesRelations = relations(
  splitExpenseShares,
  ({ one }) => ({
    expense: one(splitExpenses, {
      fields: [splitExpenseShares.expenseId],
      references: [splitExpenses.id],
    }),
    transaction: one(transactions, {
      fields: [splitExpenseShares.transactionId],
      references: [transactions.id],
    }),
  })
);

export type SplitExpense = typeof splitExpenses.$inferSelect;
export type NewSplitExpense = typeof splitExpenses.$inferInsert;
export type SplitExpenseShare = typeof splitExpenseShares.$inferSelect;
export type NewSplitExpenseShare = typeof splitExpenseShares.$inferInsert;
