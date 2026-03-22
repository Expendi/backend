import { z } from "zod";

// ─── Username ────────────────────────────────────────────────────────
export const usernameSchema = z.object({
  username: z
    .string()
    .min(3, "Must be at least 3 characters")
    .max(20, "Must be 20 characters or less")
    .regex(/^[a-z0-9_]+$/, "Only lowercase letters, numbers, and underscores"),
});
export type UsernameFormData = z.infer<typeof usernameSchema>;

// ─── Transfer ────────────────────────────────────────────────────────
export const transferSchema = z
  .object({
    from: z.enum(["user", "server", "agent"]),
    to: z.enum(["user", "server", "agent"]),
    amount: z
      .string()
      .min(1, "Amount is required")
      .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, "Must be greater than 0"),
    token: z.string(),
    categoryId: z.string().optional(),
  })
  .refine((data) => data.from !== data.to, {
    message: "Source and destination must be different",
    path: ["to"],
  });
export type TransferFormData = z.infer<typeof transferSchema>;

// ─── Swap ────────────────────────────────────────────────────────────
export const swapSchema = z.object({
  tokenIn: z.string().min(1),
  tokenOut: z.string().min(1),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, "Must be greater than 0"),
  slippage: z.string(),
});
export type SwapFormData = z.infer<typeof swapSchema>;

// ─── Category ────────────────────────────────────────────────────────
export const createCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  description: z.string().max(200).optional(),
  monthlyLimit: z.string().optional(),
  wallet: z.enum(["user", "server", "agent"]),
});
export type CreateCategoryFormData = z.infer<typeof createCategorySchema>;

export const editCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  description: z.string().max(200).optional(),
  monthlyLimit: z.string().optional(),
});
export type EditCategoryFormData = z.infer<typeof editCategorySchema>;

// ─── Goal Savings ────────────────────────────────────────────────────
export const createGoalSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  targetAmount: z.string().min(1, "Target amount is required"),
  tokenAddress: z.string().min(1),
  tokenSymbol: z.string().min(1),
  tokenDecimals: z.number().int().min(0).max(18),
  walletType: z.enum(["server", "agent"]).optional(),
  vaultId: z.string().optional(),
  depositAmount: z.string().optional(),
  unlockTimeOffsetSeconds: z.number().optional(),
  frequency: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export type CreateGoalFormData = z.infer<typeof createGoalSchema>;

export const updateGoalSchema = z.object({
  goalId: z.string().min(1, "Goal ID is required"),
  name: z.string().optional(),
  description: z.string().optional(),
  depositAmount: z.string().optional(),
  frequency: z.string().optional(),
});
export type UpdateGoalFormData = z.infer<typeof updateGoalSchema>;

export const goalDepositSchema = z.object({
  goalId: z.string().min(1, "Goal ID is required"),
  amount: z.string().min(1, "Amount is required"),
  walletType: z.enum(["server", "agent"]),
  vaultId: z.string().optional(),
});
export type GoalDepositFormData = z.infer<typeof goalDepositSchema>;

// ─── Security / PIN ──────────────────────────────────────────────────
export const setupPinSchema = z.object({
  pin: z
    .string()
    .min(4, "PIN must be 4-6 digits")
    .max(6, "PIN must be 4-6 digits")
    .regex(/^\d+$/, "PIN must be digits only"),
});
export type SetupPinFormData = z.infer<typeof setupPinSchema>;

export const changePinSchema = z.object({
  currentPin: z
    .string()
    .min(4, "PIN must be 4-6 digits")
    .max(6)
    .regex(/^\d+$/, "PIN must be digits only"),
  newPin: z
    .string()
    .min(4, "PIN must be 4-6 digits")
    .max(6)
    .regex(/^\d+$/, "PIN must be digits only"),
});
export type ChangePinFormData = z.infer<typeof changePinSchema>;

// ─── Recurring Payment ──────────────────────────────────────────────
export const createRecurringPaymentSchema = z.object({
  type: z.enum(["transfer", "offramp", "raw_transfer", "contract_call"]),
  name: z.string().optional(),
  wallet: z.enum(["user", "server", "agent"]),
  to: z.string().min(1, "Recipient is required"),
  amount: z.string().min(1, "Amount is required"),
  token: z.string(),
  frequency: z.string().min(1, "Frequency is required"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  executeImmediately: z.boolean(),
  categoryId: z.string().optional(),
});
export type CreateRecurringPaymentFormData = z.infer<typeof createRecurringPaymentSchema>;

// ─── Preferences ─────────────────────────────────────────────────────
export const preferencesSchema = z.object({
  country: z.string().optional(),
  currency: z.string().optional(),
  mobileNetwork: z.string().optional(),
  phoneNumber: z.string().optional(),
  defaultWallet: z.enum(["user", "server", "agent"]).optional(),
});
export type PreferencesFormData = z.infer<typeof preferencesSchema>;

// ─── Offramp ─────────────────────────────────────────────────────────
export const offrampSchema = z.object({
  country: z.string().min(1, "Country is required"),
  walletId: z.string().min(1, "Wallet is required"),
  usdcAmount: z.number().positive("Amount must be positive"),
  phoneNumber: z.string().min(1, "Phone number is required"),
  mobileNetwork: z.string().min(1, "Network is required"),
  paymentType: z.string(),
  accountNumber: z.string().optional(),
});
export type OfframpFormData = z.infer<typeof offrampSchema>;

// ─── Onramp ──────────────────────────────────────────────────────────
export const onrampSchema = z.object({
  country: z.string().min(1, "Country is required"),
  walletId: z.string().min(1, "Wallet is required"),
  fiatAmount: z.number().positive("Amount must be positive"),
  phoneNumber: z.string().min(1, "Phone number is required"),
  mobileNetwork: z.string().min(1, "Network is required"),
  asset: z.enum(["USDC", "USDT", "CUSD"]),
  address: z.string().min(1, "Wallet address is required"),
});
export type OnrampFormData = z.infer<typeof onrampSchema>;

// ─── Split Expense ───────────────────────────────────────────────────
export const createSplitExpenseSchema = z.object({
  title: z.string().min(1, "Title is required"),
  tokenAddress: z.string().min(1),
  tokenSymbol: z.string().min(1),
  tokenDecimals: z.number().int(),
  totalAmount: z.string().min(1, "Total amount is required"),
  chainId: z.number(),
  shares: z.array(
    z.object({
      userId: z.string().min(1),
      amount: z.string().min(1),
    })
  ).min(1, "At least one share is required"),
});
export type CreateSplitExpenseFormData = z.infer<typeof createSplitExpenseSchema>;

// ─── Swap Automation ─────────────────────────────────────────────────
export const createSwapAutomationSchema = z.object({
  walletType: z.enum(["user", "server", "agent"]),
  tokenIn: z.string().min(1),
  tokenOut: z.string().min(1),
  amount: z.string().min(1, "Amount is required"),
  indicatorType: z.enum(["price_above", "price_below", "percent_change_up", "percent_change_down"]),
  indicatorToken: z.string().min(1),
  thresholdValue: z.number().positive(),
  slippageTolerance: z.number(),
  maxExecutions: z.number().int(),
  cooldownSeconds: z.number().int(),
});
export type CreateSwapAutomationFormData = z.infer<typeof createSwapAutomationSchema>;

// ─── Group Account ───────────────────────────────────────────────────
export const createGroupSchema = z.object({
  name: z.string().min(1, "Group name is required"),
  description: z.string().optional(),
  members: z.array(z.string()).min(1, "At least one member is required"),
});
export type CreateGroupFormData = z.infer<typeof createGroupSchema>;
