import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  dcaStrategyTypeEnum,
  dcaFrequencyEnum,
  dcaStrategyStatusEnum,
  dcaExecutionStatusEnum,
} from "./enums.js";
import { wallets } from "./wallets.js";

export {
  dcaStrategyTypeEnum,
  dcaFrequencyEnum,
  dcaStrategyStatusEnum,
  dcaExecutionStatusEnum,
} from "./enums.js";

// ── Indicator configuration stored as JSONB ────────────────────────
//
// For "indicator" strategies, `indicatorConfig` holds the conditions
// that must be satisfied before executing a buy.
//
// Example:
// {
//   sma200: { enabled: true, condition: "price_below" },
//   rsi:    { enabled: true, period: 14, oversoldThreshold: 30 },
//   fearGreed: { enabled: true, threshold: 25, condition: "below" }
// }

export interface SMA200Config {
  enabled: boolean;
  /** "price_below" = buy when price < SMA-200, "price_above" = buy when price > SMA-200 */
  condition: "price_below" | "price_above";
}

export interface RSIConfig {
  enabled: boolean;
  period: number;
  /** Buy when RSI drops below this value (classic oversold signal) */
  oversoldThreshold: number;
}

export interface FearGreedConfig {
  enabled: boolean;
  /** Buy when Fear & Greed index is at or below this value (0-100) */
  threshold: number;
  condition: "below" | "above";
}

export interface IndicatorConfig {
  sma200?: SMA200Config;
  rsi?: RSIConfig;
  fearGreed?: FearGreedConfig;
}

// ── DCA Strategies table ───────────────────────────────────────────

export const dcaStrategies = pgTable("dca_strategies", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  name: text("name"),
  walletId: text("wallet_id")
    .notNull()
    .references(() => wallets.id),
  walletType: text("wallet_type").notNull().$type<"server" | "agent">(),

  // Strategy type
  strategyType: dcaStrategyTypeEnum("strategy_type").notNull(),

  // Swap parameters
  tokenIn: text("token_in").notNull(),
  tokenOut: text("token_out").notNull(),
  amount: text("amount").notNull(),
  slippageTolerance: doublePrecision("slippage_tolerance")
    .default(0.5)
    .notNull(),
  chainId: integer("chain_id").notNull(),

  // Frequency config (used by both types — indicator strategies
  // still need a minimum check frequency)
  frequency: dcaFrequencyEnum("frequency").notNull(),

  // Indicator config (only for "indicator" strategies)
  indicatorConfig: jsonb("indicator_config").$type<IndicatorConfig>(),
  /** The token to monitor indicators against (e.g. "ETH", "BTC") */
  indicatorToken: text("indicator_token"),

  // Lifecycle
  status: dcaStrategyStatusEnum("status").default("active").notNull(),
  maxExecutions: integer("max_executions"),
  totalExecutions: integer("total_executions").default(0).notNull(),
  consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
  maxRetries: integer("max_retries").default(3).notNull(),

  // Scheduling
  startDate: timestamp("start_date", { withTimezone: true })
    .defaultNow()
    .notNull(),
  endDate: timestamp("end_date", { withTimezone: true }),
  nextExecutionAt: timestamp("next_execution_at", { withTimezone: true })
    .notNull(),
  lastExecutedAt: timestamp("last_executed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const dcaStrategiesRelations = relations(
  dcaStrategies,
  ({ one, many }) => ({
    wallet: one(wallets, {
      fields: [dcaStrategies.walletId],
      references: [wallets.id],
    }),
    executions: many(dcaExecutions),
  })
);

// ── DCA Executions table ───────────────────────────────────────────

export const dcaExecutions = pgTable("dca_executions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  strategyId: text("strategy_id")
    .notNull()
    .references(() => dcaStrategies.id),
  transactionId: text("transaction_id"),
  status: dcaExecutionStatusEnum("status").notNull(),
  /** Price of the output token at time of execution */
  priceAtExecution: doublePrecision("price_at_execution"),
  error: text("error"),
  /** Swap quote details for audit trail */
  quoteSnapshot: jsonb("quote_snapshot").$type<Record<string, unknown>>(),
  /** Indicator values at time of evaluation (for indicator strategies) */
  indicatorSnapshot: jsonb("indicator_snapshot").$type<{
    sma200?: number;
    rsi?: number;
    fearGreedIndex?: number;
    currentPrice?: number;
  }>(),
  executedAt: timestamp("executed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const dcaExecutionsRelations = relations(dcaExecutions, ({ one }) => ({
  strategy: one(dcaStrategies, {
    fields: [dcaExecutions.strategyId],
    references: [dcaStrategies.id],
  }),
}));

export type DcaStrategy = typeof dcaStrategies.$inferSelect;
export type NewDcaStrategy = typeof dcaStrategies.$inferInsert;
export type DcaExecution = typeof dcaExecutions.$inferSelect;
export type NewDcaExecution = typeof dcaExecutions.$inferInsert;
