import { pgEnum } from "drizzle-orm/pg-core";

export const walletTypeEnum = pgEnum("wallet_type", [
  "user",
  "server",
  "agent",
]);

export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending",
  "submitted",
  "confirmed",
  "failed",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const recurringPaymentStatusEnum = pgEnum("recurring_payment_status", [
  "active",
  "paused",
  "cancelled",
  "completed",
  "failed",
]);

export const recurringPaymentTypeEnum = pgEnum("recurring_payment_type", [
  "erc20_transfer",
  "raw_transfer",
  "contract_call",
  "offramp",
]);

export const executionStatusEnum = pgEnum("execution_status", [
  "success",
  "failed",
]);

export const yieldPositionStatusEnum = pgEnum("yield_position_status", [
  "active",
  "matured",
  "withdrawn",
  "emergency",
]);
