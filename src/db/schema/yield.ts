import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  numeric,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { yieldPositionStatusEnum } from "./enums";
import { wallets } from "./wallets";
import { transactions } from "./transactions";

export { yieldPositionStatusEnum } from "./enums";

// ── Yield Vaults ──────────────────────────────────────────────────────

export const yieldVaults = pgTable("yield_vaults", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  vaultAddress: text("vault_address").notNull(),
  chainId: integer("chain_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  underlyingToken: text("underlying_token"),
  underlyingSymbol: text("underlying_symbol"),
  underlyingDecimals: integer("underlying_decimals"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const yieldVaultsRelations = relations(yieldVaults, ({ many }) => ({
  positions: many(yieldPositions),
}));

// ── Yield Positions ───────────────────────────────────────────────────

export const yieldPositions = pgTable("yield_positions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  walletId: text("wallet_id")
    .notNull()
    .references(() => wallets.id),
  vaultId: text("vault_id")
    .notNull()
    .references(() => yieldVaults.id),
  /** The on-chain lock ID returned by YieldTimeLock.lockWithYield */
  onChainLockId: text("on_chain_lock_id").notNull(),
  /** Principal amount deposited (string for arbitrary precision) */
  principalAmount: text("principal_amount").notNull(),
  /** Vault shares received */
  shares: text("shares").notNull(),
  /** Unix timestamp when the lock expires */
  unlockTime: timestamp("unlock_time", { withTimezone: true }).notNull(),
  label: text("label"),
  status: yieldPositionStatusEnum("status").default("active").notNull(),
  /** FK to the transaction that created this lock */
  transactionId: text("transaction_id").references(() => transactions.id),
  chainId: integer("chain_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const yieldPositionsRelations = relations(
  yieldPositions,
  ({ one, many }) => ({
    wallet: one(wallets, {
      fields: [yieldPositions.walletId],
      references: [wallets.id],
    }),
    vault: one(yieldVaults, {
      fields: [yieldPositions.vaultId],
      references: [yieldVaults.id],
    }),
    transaction: one(transactions, {
      fields: [yieldPositions.transactionId],
      references: [transactions.id],
    }),
    snapshots: many(yieldSnapshots),
  })
);

// ── Yield Snapshots ───────────────────────────────────────────────────

export const yieldSnapshots = pgTable("yield_snapshots", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  positionId: text("position_id")
    .notNull()
    .references(() => yieldPositions.id),
  /** Current total assets for this position (string for precision) */
  currentAssets: text("current_assets").notNull(),
  /** Accrued yield since deposit (string for precision) */
  accruedYield: text("accrued_yield").notNull(),
  /** Estimated annualized yield percentage */
  estimatedApy: numeric("estimated_apy", { precision: 10, scale: 4 }),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const yieldSnapshotsRelations = relations(
  yieldSnapshots,
  ({ one }) => ({
    position: one(yieldPositions, {
      fields: [yieldSnapshots.positionId],
      references: [yieldPositions.id],
    }),
  })
);

// ── Type exports ──────────────────────────────────────────────────────

export type YieldVault = typeof yieldVaults.$inferSelect;
export type NewYieldVault = typeof yieldVaults.$inferInsert;
export type YieldPosition = typeof yieldPositions.$inferSelect;
export type NewYieldPosition = typeof yieldPositions.$inferInsert;
export type YieldSnapshot = typeof yieldSnapshots.$inferSelect;
export type NewYieldSnapshot = typeof yieldSnapshots.$inferInsert;
