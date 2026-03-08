import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  recurringPaymentStatusEnum,
  recurringPaymentTypeEnum,
  executionStatusEnum,
} from "./enums.js";
import { wallets } from "./wallets.js";

export {
  recurringPaymentStatusEnum,
  recurringPaymentTypeEnum,
  executionStatusEnum,
} from "./enums.js";

export const recurringPayments = pgTable("recurring_payments", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  walletId: text("wallet_id")
    .notNull()
    .references(() => wallets.id),
  walletType: text("wallet_type").notNull().$type<"user" | "server" | "agent">(),
  recipientAddress: text("recipient_address").notNull(),
  paymentType: recurringPaymentTypeEnum("payment_type").notNull(),
  /** Amount as a string to support arbitrary precision (wei, token units, etc.) */
  amount: text("amount").notNull(),
  /** For erc20_transfer: the contract name registered in ContractRegistry */
  tokenContractName: text("token_contract_name"),
  /** For contract_call: the contract name */
  contractName: text("contract_name"),
  /** For contract_call: the method to invoke */
  contractMethod: text("contract_method"),
  /** For contract_call: the args to pass */
  contractArgs: jsonb("contract_args").$type<unknown[]>(),
  chainId: integer("chain_id").notNull(),
  // ── Offramp fields ────────────────────────────────────────────────
  /** Whether this is an offramp payment (fiat off-ramp) */
  isOfframp: boolean("is_offramp").default(false).notNull(),
  /** Fiat currency code for offramp (e.g. "USD", "EUR") */
  offrampCurrency: text("offramp_currency"),
  /** Fiat amount for offramp (decimal string, e.g. "100.50") */
  offrampFiatAmount: text("offramp_fiat_amount"),
  /** Offramp provider identifier (e.g. "moonpay", "transak", "bridge") */
  offrampProvider: text("offramp_provider"),
  /** Bank account / payment method ID at the offramp provider */
  offrampDestinationId: text("offramp_destination_id"),
  /** Arbitrary provider-specific metadata for the offramp */
  offrampMetadata: jsonb("offramp_metadata").$type<Record<string, unknown>>(),
  /** Optional category for the payment */
  categoryId: text("category_id"),
  /** Schedule interval using the same format as jobs: e.g. "5m", "1h", "1d", "7d" */
  frequency: text("frequency").notNull(),
  status: recurringPaymentStatusEnum("status").default("active").notNull(),
  startDate: timestamp("start_date", { withTimezone: true })
    .defaultNow()
    .notNull(),
  endDate: timestamp("end_date", { withTimezone: true }),
  nextExecutionAt: timestamp("next_execution_at", { withTimezone: true }).notNull(),
  maxRetries: integer("max_retries").default(3).notNull(),
  consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
  totalExecutions: integer("total_executions").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const recurringPaymentsRelations = relations(
  recurringPayments,
  ({ one, many }) => ({
    wallet: one(wallets, {
      fields: [recurringPayments.walletId],
      references: [wallets.id],
    }),
    executions: many(recurringPaymentExecutions),
  })
);

export const recurringPaymentExecutions = pgTable(
  "recurring_payment_executions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => recurringPayments.id),
    transactionId: text("transaction_id"),
    status: executionStatusEnum("status").notNull(),
    error: text("error"),
    executedAt: timestamp("executed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);

export const recurringPaymentExecutionsRelations = relations(
  recurringPaymentExecutions,
  ({ one }) => ({
    schedule: one(recurringPayments, {
      fields: [recurringPaymentExecutions.scheduleId],
      references: [recurringPayments.id],
    }),
  })
);

export type RecurringPayment = typeof recurringPayments.$inferSelect;
export type NewRecurringPayment = typeof recurringPayments.$inferInsert;
export type RecurringPaymentExecution =
  typeof recurringPaymentExecutions.$inferSelect;
export type NewRecurringPaymentExecution =
  typeof recurringPaymentExecutions.$inferInsert;
