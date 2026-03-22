import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const queryKeys = {
  profile: ["profile"] as const,
  wallets: ["wallets"] as const,
  walletBalances: ["walletBalances"] as const,
  transactions: (params?: { limit?: number }) =>
    ["transactions", params] as const,
  categories: ["categories"] as const,
  categoryLimits: ["categoryLimits"] as const,
  spending: ["spending"] as const,
  dailySpending: (days?: number) => ["dailySpending", days] as const,
  tokenPrices: ["tokenPrices"] as const,
  preferences: ["preferences"] as const,
  approvalSettings: ["approvalSettings"] as const,
  passkeys: ["passkeys"] as const,
  goals: ["goalSavings"] as const,
  goal: (id: string) => ["goalSavings", id] as const,
  goalDeposits: (id: string) => ["goalSavings", id, "deposits"] as const,
  recurringPayments: ["recurringPayments"] as const,
  recurringPayment: (id: string) => ["recurringPayments", id] as const,
  recurringExecutions: (id: string) =>
    ["recurringPayments", id, "executions"] as const,
  yieldVaults: ["yieldVaults"] as const,
  yieldPositions: ["yieldPositions"] as const,
  yieldPortfolio: ["yieldPortfolio"] as const,
  groups: ["groups"] as const,
  group: (id: string) => ["groups", id] as const,
  splitExpenses: ["splitExpenses"] as const,
  swapAutomations: ["swapAutomations"] as const,
  conversations: ["conversations"] as const,
  activeConversation: ["activeConversation"] as const,
  conversation: (id: string) => ["conversations", id] as const,
} as const;
