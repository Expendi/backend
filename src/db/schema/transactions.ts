import {
  pgTable,
  text,
  timestamp,
  jsonb,
  bigint,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { walletTypeEnum, transactionStatusEnum } from "./enums.js";
import { wallets } from "./wallets.js";
import { transactionCategories } from "./transaction-categories.js";

export { transactionStatusEnum } from "./enums.js";

export const transactions = pgTable("transactions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  walletId: text("wallet_id")
    .notNull()
    .references(() => wallets.id),
  walletType: walletTypeEnum("wallet_type").notNull(),
  chainId: text("chain_id").notNull(),
  contractId: text("contract_id"),
  method: text("method").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: transactionStatusEnum("status").default("pending").notNull(),
  txHash: text("tx_hash"),
  gasUsed: bigint("gas_used", { mode: "bigint" }),
  categoryId: text("category_id").references(() => transactionCategories.id),
  userId: text("user_id"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
});

export const transactionsRelations = relations(transactions, ({ one }) => ({
  wallet: one(wallets, {
    fields: [transactions.walletId],
    references: [wallets.id],
  }),
  category: one(transactionCategories, {
    fields: [transactions.categoryId],
    references: [transactionCategories.id],
  }),
}));

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
