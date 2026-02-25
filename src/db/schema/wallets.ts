import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { walletTypeEnum } from "./enums";
import { transactions } from "./transactions";

export { walletTypeEnum } from "./enums";

export const wallets = pgTable("wallets", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  type: walletTypeEnum("type").notNull(),
  privyWalletId: text("privy_wallet_id").notNull(),
  ownerId: text("owner_id").notNull(),
  address: text("address"),
  chainId: text("chain_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const walletsRelations = relations(wallets, ({ many }) => ({
  transactions: many(transactions),
}));

export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;
