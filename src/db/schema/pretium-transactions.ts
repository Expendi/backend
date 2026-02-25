import {
  pgTable,
  text,
  timestamp,
  numeric,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  pretiumTransactionStatusEnum,
  pretiumPaymentTypeEnum,
} from "./enums";
import { wallets } from "./wallets";

export {
  pretiumTransactionStatusEnum,
  pretiumPaymentTypeEnum,
} from "./enums";

export const pretiumTransactions = pgTable("pretium_transactions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  /** Privy user ID who initiated this offramp */
  userId: text("user_id").notNull(),

  /** Wallet used to send USDC to settlement address */
  walletId: text("wallet_id")
    .notNull()
    .references(() => wallets.id),

  /** Country code: KE, NG, GH, UG, CD, MW, ET */
  countryCode: text("country_code").notNull(),

  /** Fiat currency code: KES, NGN, GHS, UGX, CDF, MWK, ETB */
  fiatCurrency: text("fiat_currency").notNull(),

  /** USDC amount sent to settlement address */
  usdcAmount: numeric("usdc_amount", { precision: 18, scale: 6 }).notNull(),

  /** Fiat amount to be disbursed */
  fiatAmount: numeric("fiat_amount", { precision: 18, scale: 2 }).notNull(),

  /** Exchange rate used at time of transaction */
  exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull(),

  /** Fee in USDC (if any) */
  fee: numeric("fee", { precision: 18, scale: 6 }).default("0"),

  /** Payment type: MOBILE, BUY_GOODS, PAYBILL, BANK_TRANSFER */
  paymentType: pretiumPaymentTypeEnum("payment_type").notNull(),

  /** Current status of the Pretium transaction */
  status: pretiumTransactionStatusEnum("status").default("pending").notNull(),

  /** On-chain tx hash of USDC transfer to settlement address */
  onChainTxHash: text("on_chain_tx_hash").notNull(),

  /** Pretium's internal transaction code (returned from disburse) */
  pretiumTransactionCode: text("pretium_transaction_code"),

  /** Pretium receipt number (set on completion) */
  pretiumReceiptNumber: text("pretium_receipt_number"),

  // ── Recipient details ──────────────────────────────────────────────

  /** Phone number (for mobile money) or paybill/till number */
  phoneNumber: text("phone_number"),

  /** Mobile network: safaricom, mtn, airtel, vodafone, etc. */
  mobileNetwork: text("mobile_network"),

  /** Account number (for PAYBILL or bank transfer) */
  accountNumber: text("account_number"),

  /** Bank code (for bank transfers) */
  bankCode: text("bank_code"),

  /** Bank name (for bank transfers, especially Nigeria) */
  bankName: text("bank_name"),

  /** Account holder name (for bank transfers or validated mobile) */
  accountName: text("account_name"),

  // ── Metadata ───────────────────────────────────────────────────────

  /** Failure reason from Pretium (if failed) */
  failureReason: text("failure_reason"),

  /** Callback URL provided to Pretium */
  callbackUrl: text("callback_url"),

  /** Any additional provider-specific metadata */
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const pretiumTransactionsRelations = relations(
  pretiumTransactions,
  ({ one }) => ({
    wallet: one(wallets, {
      fields: [pretiumTransactions.walletId],
      references: [wallets.id],
    }),
  })
);

export type PretiumTransaction = typeof pretiumTransactions.$inferSelect;
export type NewPretiumTransaction = typeof pretiumTransactions.$inferInsert;
