import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./src/db/schema/wallets.ts",
    "./src/db/schema/transactions.ts",
    "./src/db/schema/transaction-categories.ts",
    "./src/db/schema/jobs.ts",
    "./src/db/schema/user-profiles.ts",
    "./src/db/schema/recurring-payments.ts",
    "./src/db/schema/yield.ts",
    "./src/db/schema/pretium-transactions.ts",
    "./src/db/schema/swap-automations.ts",
    "./src/db/schema/enums.ts",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
