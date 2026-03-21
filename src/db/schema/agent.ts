import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { userProfiles } from "./user-profiles.js";
import {
  trustTierEnum,
  mandateStatusEnum,
  mandateSourceEnum,
  mandateExecutionStatusEnum,
  agentActivityTypeEnum,
  inboxCategoryEnum,
  inboxPriorityEnum,
  inboxStatusEnum,
} from "./enums.js";
export {
  trustTierEnum,
  mandateStatusEnum,
  mandateSourceEnum,
  mandateExecutionStatusEnum,
  agentActivityTypeEnum,
  inboxCategoryEnum,
  inboxPriorityEnum,
  inboxStatusEnum,
};

// ── Profile JSON shape ────────────────────────────────────────────────

export interface AgentProfileData {
  country?: string;
  currency?: string;
  knowledgeLevel?: "beginner" | "intermediate" | "advanced";
  riskTolerance?: "conservative" | "moderate" | "aggressive";
  goals?: string[];
  patterns?: {
    frequentRecipients?: Array<{
      address: string;
      label: string;
      frequency: string;
    }>;
    preferredTokens?: string[];
    typicalAmounts?: Record<string, string>;
  };
  interests?: string[];
  communicationStyle?: string;
  onboardingComplete?: boolean;
  riskScore?: number;
  investmentHorizon?: "short" | "medium" | "long";
  maxSingleTradePercent?: number;
  preferredCategories?: string[];
  avoidCategories?: string[];
  customInstructions?: string;
}

// ── Conversation messages shape ───────────────────────────────────────

export interface ConversationMessage {
  role: "user" | "agent";
  content: string;
  timestamp: string;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
    output?: Record<string, unknown>;
  }>;
}

// ── Agent conversations ───────────────────────────────────────────────

export const agentConversations = pgTable("agent_conversations", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => userProfiles.privyUserId),
  title: text("title"),
  isActive: boolean("is_active").default(true).notNull(),
  messages: jsonb("messages").$type<ConversationMessage[]>().notNull().default([]),
  tokenCount: integer("token_count").default(0).notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const agentConversationsRelations = relations(
  agentConversations,
  ({}) => ({})
);

// ── Agent profiles ────────────────────────────────────────────────────

export const agentProfiles = pgTable("agent_profiles", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => userProfiles.privyUserId),
  profile: jsonb("profile").$type<AgentProfileData>().notNull().default({}),
  trustTier: trustTierEnum("trust_tier").default("observe").notNull(),
  agentBudget: text("agent_budget").default("0").notNull(),
  lastReflectionAt: timestamp("last_reflection_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const agentProfilesRelations = relations(agentProfiles, ({}) => ({}));

// ── Mandate trigger/action shapes ─────────────────────────────────────

export interface MandateTrigger {
  type: "price" | "schedule" | "balance" | "event";
  token?: string;
  condition?: "above" | "below";
  value?: string | number;
  frequency?: string;
  anchor?: string;
  wallet?: string;
  event?: string;
}

export interface MandateAction {
  type: "swap" | "offramp" | "goal_deposit" | "notify" | "transfer";
  from?: string;
  to?: string;
  amount?: string;
  phone?: string;
  network?: string;
  country?: string;
  goalId?: string;
  message?: string;
}

export interface MandateConstraints {
  maxPerExecution?: string;
  maxPerDay?: string;
  requireConfirmation?: boolean;
}

// ── Agent mandates ────────────────────────────────────────────────────

export const agentMandates = pgTable("agent_mandates", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => userProfiles.privyUserId),
  type: text("type").notNull(), // dca | auto_offramp | rebalance | alert | auto_save | custom
  name: text("name"),
  description: text("description"),
  trigger: jsonb("trigger").$type<MandateTrigger>().notNull(),
  action: jsonb("action").$type<MandateAction>().notNull(),
  constraints: jsonb("constraints").$type<MandateConstraints>(),
  status: mandateStatusEnum("status").default("active").notNull(),
  source: mandateSourceEnum("source").default("explicit").notNull(),
  executionCount: integer("execution_count").default(0).notNull(),
  lastExecutedAt: timestamp("last_executed_at", { withTimezone: true }),
  nextExecutionAt: timestamp("next_execution_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const agentMandatesRelations = relations(agentMandates, ({ many }) => ({
  executions: many(mandateExecutions),
}));

// ── Mandate executions ────────────────────────────────────────────────

export const mandateExecutions = pgTable("mandate_executions", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  mandateId: uuid("mandate_id")
    .notNull()
    .references(() => agentMandates.id),
  status: mandateExecutionStatusEnum("status").notNull(),
  triggerSnapshot: jsonb("trigger_snapshot"), // snapshot of conditions at execution time
  result: jsonb("result"), // execution output/error
  transactionId: text("transaction_id"), // FK to transactions if one was created
  executedAt: timestamp("executed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const mandateExecutionsRelations = relations(
  mandateExecutions,
  ({ one }) => ({
    mandate: one(agentMandates, {
      fields: [mandateExecutions.mandateId],
      references: [agentMandates.id],
    }),
  })
);

// ── Agent activity feed ───────────────────────────────────────────────

export const agentActivity = pgTable("agent_activity", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => userProfiles.privyUserId),
  type: agentActivityTypeEnum("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  mandateId: uuid("mandate_id").references(() => agentMandates.id),
  transactionId: text("transaction_id"),
  metadata: jsonb("metadata"),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const agentActivityRelations = relations(agentActivity, ({ one }) => ({
  mandate: one(agentMandates, {
    fields: [agentActivity.mandateId],
    references: [agentMandates.id],
  }),
}));

// ── Agent inbox ──────────────────────────────────────────────────

export const agentInbox = pgTable("agent_inbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfiles.privyUserId),
  category: inboxCategoryEnum("category").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  priority: inboxPriorityEnum("priority").notNull().default("medium"),
  status: inboxStatusEnum("status").notNull().default("unread"),
  actionType: text("action_type"),
  actionPayload: jsonb("action_payload").$type<Record<string, unknown>>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const agentInboxRelations = relations(agentInbox, ({}) => ({}));

// ── Type exports ──────────────────────────────────────────────────────

export type AgentConversation = typeof agentConversations.$inferSelect;
export type NewAgentConversation = typeof agentConversations.$inferInsert;
export type AgentProfile = typeof agentProfiles.$inferSelect;
export type NewAgentProfile = typeof agentProfiles.$inferInsert;
export type AgentMandate = typeof agentMandates.$inferSelect;
export type NewAgentMandate = typeof agentMandates.$inferInsert;
export type MandateExecution = typeof mandateExecutions.$inferSelect;
export type NewMandateExecution = typeof mandateExecutions.$inferInsert;
export type AgentActivityRecord = typeof agentActivity.$inferSelect;
export type NewAgentActivityRecord = typeof agentActivity.$inferInsert;
export type AgentInboxItem = typeof agentInbox.$inferSelect;
export type NewAgentInboxItem = typeof agentInbox.$inferInsert;
