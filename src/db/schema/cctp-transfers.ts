import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { walletTypeEnum } from "./enums.js";
import { wallets } from "./wallets.js";

export const cctpTransferStatusEnum = pgEnum("cctp_transfer_status", [
  "pending_approval",
  "approved",
  "burning",
  "burned",
  "attesting",
  "attested",
  "minting",
  "completed",
  "failed",
]);

export const cctpTransfers = pgTable("cctp_transfers", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  walletId: text("wallet_id")
    .notNull()
    .references(() => wallets.id),
  walletType: walletTypeEnum("wallet_type").notNull(),

  // Chain routing
  sourceChainId: integer("source_chain_id").notNull(),
  destinationChainId: integer("destination_chain_id").notNull(),
  destinationDomain: integer("destination_domain").notNull(),

  // Transfer details
  amount: text("amount").notNull(), // Human-readable USDC amount
  recipient: text("recipient").notNull(), // 0x address on destination chain

  // On-chain tracking
  approveTxHash: text("approve_tx_hash"),
  burnTxHash: text("burn_tx_hash"),
  mintTxHash: text("mint_tx_hash"),
  messageHash: text("message_hash"),
  messageBytes: text("message_bytes"),
  attestation: text("attestation"),

  // Status
  status: cctpTransferStatusEnum("status")
    .default("pending_approval")
    .notNull(),
  error: text("error"),

  // Metadata
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const cctpTransfersRelations = relations(cctpTransfers, ({ one }) => ({
  wallet: one(wallets, {
    fields: [cctpTransfers.walletId],
    references: [wallets.id],
  }),
}));

export type CctpTransfer = typeof cctpTransfers.$inferSelect;
export type NewCctpTransfer = typeof cctpTransfers.$inferInsert;
