import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  swapAutomationStatusEnum,
  swapIndicatorTypeEnum,
  swapAutomationExecutionStatusEnum,
} from "./enums";
import { wallets } from "./wallets";

export {
  swapAutomationStatusEnum,
  swapIndicatorTypeEnum,
  swapAutomationExecutionStatusEnum,
} from "./enums";

export const swapAutomations = pgTable("swap_automations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  walletId: text("wallet_id")
    .notNull()
    .references(() => wallets.id),
  walletType: text("wallet_type").notNull().$type<"server" | "agent">(),

  // Swap parameters
  tokenIn: text("token_in").notNull(),
  tokenOut: text("token_out").notNull(),
  amount: text("amount").notNull(),
  slippageTolerance: doublePrecision("slippage_tolerance").default(0.5).notNull(),
  chainId: integer("chain_id").notNull(),

  // Indicator / trigger condition
  indicatorType: swapIndicatorTypeEnum("indicator_type").notNull(),
  /** The token symbol to monitor (e.g. "ETH", "USDC") */
  indicatorToken: text("indicator_token").notNull(),
  /** Threshold value: a price in USD for price_above/price_below, or a percentage for percent_change */
  thresholdValue: doublePrecision("threshold_value").notNull(),
  /** Snapshot of the price when the automation was created (used for percent_change calculations) */
  referencePrice: doublePrecision("reference_price"),

  // Status / lifecycle
  status: swapAutomationStatusEnum("status").default("active").notNull(),
  maxExecutions: integer("max_executions").default(1).notNull(),
  totalExecutions: integer("total_executions").default(0).notNull(),
  consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
  maxRetries: integer("max_retries").default(3).notNull(),

  // Timing
  /** Minimum seconds between checks (rate-limit per automation) */
  cooldownSeconds: integer("cooldown_seconds").default(60).notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const swapAutomationsRelations = relations(
  swapAutomations,
  ({ one, many }) => ({
    wallet: one(wallets, {
      fields: [swapAutomations.walletId],
      references: [wallets.id],
    }),
    executions: many(swapAutomationExecutions),
  })
);

export const swapAutomationExecutions = pgTable(
  "swap_automation_executions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    automationId: text("automation_id")
      .notNull()
      .references(() => swapAutomations.id),
    transactionId: text("transaction_id"),
    status: swapAutomationExecutionStatusEnum("status").notNull(),
    /** Price at the time of evaluation */
    priceAtExecution: doublePrecision("price_at_execution"),
    /** Reason for skip or failure */
    error: text("error"),
    /** Swap quote details for audit trail */
    quoteSnapshot: jsonb("quote_snapshot").$type<Record<string, unknown>>(),
    executedAt: timestamp("executed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);

export const swapAutomationExecutionsRelations = relations(
  swapAutomationExecutions,
  ({ one }) => ({
    automation: one(swapAutomations, {
      fields: [swapAutomationExecutions.automationId],
      references: [swapAutomations.id],
    }),
  })
);

export type SwapAutomation = typeof swapAutomations.$inferSelect;
export type NewSwapAutomation = typeof swapAutomations.$inferInsert;
export type SwapAutomationExecution =
  typeof swapAutomationExecutions.$inferSelect;
export type NewSwapAutomationExecution =
  typeof swapAutomationExecutions.$inferInsert;
