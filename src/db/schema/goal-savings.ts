import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  goalSavingsStatusEnum,
  goalSavingsDepositStatusEnum,
} from "./enums.js";
import { wallets } from "./wallets.js";
import { yieldVaults, yieldPositions } from "./yield.js";

export {
  goalSavingsStatusEnum,
  goalSavingsDepositStatusEnum,
} from "./enums.js";

// ── Goal Savings ─────────────────────────────────────────────────────

export const goalSavings = pgTable("goal_savings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  targetAmount: text("target_amount").notNull(),
  accumulatedAmount: text("accumulated_amount").notNull().default("0"),
  tokenAddress: text("token_address").notNull(),
  tokenSymbol: text("token_symbol").notNull(),
  tokenDecimals: integer("token_decimals").notNull(),
  status: goalSavingsStatusEnum("status").notNull().default("active"),
  walletId: text("wallet_id").references(() => wallets.id),
  walletType: text("wallet_type"),
  vaultId: text("vault_id").references(() => yieldVaults.id),
  chainId: integer("chain_id"),
  depositAmount: text("deposit_amount"),
  unlockTimeOffsetSeconds: integer("unlock_time_offset_seconds"),
  frequency: text("frequency"),
  nextDepositAt: timestamp("next_deposit_at", { withTimezone: true }),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  maxRetries: integer("max_retries").notNull().default(3),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  totalDeposits: integer("total_deposits").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const goalSavingsRelations = relations(goalSavings, ({ one, many }) => ({
  wallet: one(wallets, {
    fields: [goalSavings.walletId],
    references: [wallets.id],
  }),
  vault: one(yieldVaults, {
    fields: [goalSavings.vaultId],
    references: [yieldVaults.id],
  }),
  deposits: many(goalSavingsDeposits),
}));

// ── Goal Savings Deposits ────────────────────────────────────────────

export const goalSavingsDeposits = pgTable("goal_savings_deposits", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  goalId: text("goal_id")
    .notNull()
    .references(() => goalSavings.id),
  yieldPositionId: text("yield_position_id")
    .notNull()
    .references(() => yieldPositions.id),
  amount: text("amount").notNull(),
  depositType: text("deposit_type").notNull(), // "automated" | "manual"
  status: goalSavingsDepositStatusEnum("status").notNull().default("pending"),
  error: text("error"),
  depositedAt: timestamp("deposited_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const goalSavingsDepositsRelations = relations(
  goalSavingsDeposits,
  ({ one }) => ({
    goal: one(goalSavings, {
      fields: [goalSavingsDeposits.goalId],
      references: [goalSavings.id],
    }),
    yieldPosition: one(yieldPositions, {
      fields: [goalSavingsDeposits.yieldPositionId],
      references: [yieldPositions.id],
    }),
  })
);

// ── Types ────────────────────────────────────────────────────────────

export type GoalSaving = typeof goalSavings.$inferSelect;
export type NewGoalSaving = typeof goalSavings.$inferInsert;
export type GoalSavingsDeposit = typeof goalSavingsDeposits.$inferSelect;
export type NewGoalSavingsDeposit = typeof goalSavingsDeposits.$inferInsert;
