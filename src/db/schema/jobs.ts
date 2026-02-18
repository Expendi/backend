import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { jobStatusEnum } from "./enums.js";

export { jobStatusEnum } from "./enums.js";

export const jobs = pgTable("jobs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  jobType: text("job_type").notNull(),
  schedule: text("schedule").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: jobStatusEnum("status").default("pending").notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  maxRetries: integer("max_retries").default(3).notNull(),
  retryCount: integer("retry_count").default(0).notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
