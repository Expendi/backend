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

export const pretiumTransactionStatusEnum = pgEnum(
  "pretium_transaction_status",
  ["pending", "processing", "completed", "failed", "reversed"]
);

export const pretiumPaymentTypeEnum = pgEnum("pretium_payment_type", [
  "MOBILE",
  "BUY_GOODS",
  "PAYBILL",
  "BANK_TRANSFER",
]);

export const swapAutomationStatusEnum = pgEnum("swap_automation_status", [
  "active",
  "paused",
  "cancelled",
  "triggered",
  "failed",
]);

export const swapIndicatorTypeEnum = pgEnum("swap_indicator_type", [
  "price_above",
  "price_below",
  "percent_change_up",
  "percent_change_down",
]);

export const swapAutomationExecutionStatusEnum = pgEnum(
  "swap_automation_execution_status",
  ["success", "failed", "skipped"]
);

export const pretiumTransactionDirectionEnum = pgEnum(
  "pretium_transaction_direction",
  ["onramp", "offramp"]
);

export const groupAccountRoleEnum = pgEnum("group_account_role", [
  "admin",
  "member",
]);

export const splitExpenseStatusEnum = pgEnum("split_expense_status", [
  "active",
  "settled",
  "cancelled",
]);

export const splitExpenseShareStatusEnum = pgEnum(
  "split_expense_share_status",
  ["pending", "paid", "cancelled"]
);

export const goalSavingsStatusEnum = pgEnum("goal_savings_status", [
  "active",
  "paused",
  "cancelled",
  "completed",
]);

export const goalSavingsDepositStatusEnum = pgEnum(
  "goal_savings_deposit_status",
  ["pending", "confirmed", "failed"]
);

export const trustTierEnum = pgEnum("trust_tier", [
  "observe",
  "notify",
  "act_within_limits",
  "full",
]);

export const mandateStatusEnum = pgEnum("mandate_status", [
  "active",
  "paused",
  "expired",
  "revoked",
]);

export const mandateSourceEnum = pgEnum("mandate_source", [
  "explicit",
  "suggested",
  "inferred",
]);

export const mandateExecutionStatusEnum = pgEnum("mandate_execution_status", [
  "success",
  "failed",
  "skipped",
]);

export const agentActivityTypeEnum = pgEnum("agent_activity_type", [
  "mandate_executed",
  "pattern_detected",
  "alert",
  "suggestion",
  "balance_change",
  "position_matured",
  "research_finding",
  "action_request",
  "risk_alert",
]);

export const inboxCategoryEnum = pgEnum("inbox_category", [
  "research",
  "request",
  "alert",
  "news",
  "suggestion",
  "mandate_update",
]);

export const inboxPriorityEnum = pgEnum("inbox_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);

export const inboxStatusEnum = pgEnum("inbox_status", [
  "unread",
  "read",
  "actioned",
  "dismissed",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "offramp_completed",
  "offramp_failed",
  "onramp_completed",
  "onramp_failed",
  "savings_deposit_success",
  "savings_deposit_failed",
  "savings_goal_completed",
  "kyc_update",
  "promo",
  "general",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "in_app",
  "email",
  "both",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "unread",
  "read",
  "archived",
]);
