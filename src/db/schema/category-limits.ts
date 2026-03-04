import { pgTable, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { transactionCategories } from "./transaction-categories.js";

export const categoryLimits = pgTable(
  "category_limits",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => transactionCategories.id),
    monthlyLimit: text("monthly_limit").notNull(),
    tokenAddress: text("token_address").notNull(),
    tokenSymbol: text("token_symbol").notNull(),
    tokenDecimals: integer("token_decimals").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("category_limits_user_category_token").on(
      table.userId,
      table.categoryId,
      table.tokenAddress
    ),
  ]
);

export const categoryLimitsRelations = relations(categoryLimits, ({ one }) => ({
  category: one(transactionCategories, {
    fields: [categoryLimits.categoryId],
    references: [transactionCategories.id],
  }),
}));

export type CategoryLimit = typeof categoryLimits.$inferSelect;
export type NewCategoryLimit = typeof categoryLimits.$inferInsert;
