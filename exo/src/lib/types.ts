export interface Wallet {
  id: string;
  type: "user" | "server" | "agent";
  privyWalletId: string;
  ownerId: string;
  address: string | null;
  chainId: string | null;
  createdAt: string;
}

export interface Profile {
  id: string;
  privyUserId: string;
  userWalletId: string;
  serverWalletId: string;
  agentWalletId: string;
  username?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardResult {
  profile: Profile;
  wallets: {
    user: Wallet;
    server: Wallet;
    agent: Wallet;
  };
}

export interface ProfileWithWallets extends Profile {
  wallets?: {
    user: Wallet;
    server: Wallet;
    agent: Wallet;
  };
}

export interface Transaction {
  id: string;
  walletId: string;
  walletType: "user" | "server" | "agent";
  chainId: string;
  contractId: string | null;
  method: string;
  payload: Record<string, unknown>;
  status: "pending" | "submitted" | "confirmed" | "failed";
  txHash: string | null;
  gasUsed: string | null;
  categoryId: string | null;
  userId: string | null;
  error: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  userId: string | null;
  isGlobal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryLimit {
  id: string;
  userId: string;
  categoryId: string;
  monthlyLimit: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  createdAt: string;
  updatedAt: string;
  categoryName?: string;
}

export interface RecurringPayment {
  id: string;
  userId: string;
  walletId: string;
  walletType: "user" | "server" | "agent";
  name: string | null;
  categoryId: string | null;
  recipientAddress: string;
  paymentType: "erc20_transfer" | "raw_transfer" | "contract_call" | "offramp";
  amount: string;
  tokenContractName: string | null;
  contractName: string | null;
  contractMethod: string | null;
  contractArgs: unknown[] | null;
  chainId: number;
  isOfframp: boolean;
  offrampCurrency: string | null;
  offrampFiatAmount: string | null;
  offrampProvider: string | null;
  offrampDestinationId: string | null;
  offrampMetadata: Record<string, unknown> | null;
  frequency: string;
  status: "active" | "paused" | "cancelled" | "completed" | "failed";
  startDate: string;
  endDate: string | null;
  nextExecutionAt: string;
  maxRetries: number;
  consecutiveFailures: number;
  totalExecutions: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringExecution {
  id: string;
  scheduleId: string;
  status: string;
  txHash: string | null;
  error: string | null;
  executedAt: string;
}

export interface YieldVault {
  id: string;
  name: string;
  address: string;
  underlyingToken: string;
  underlyingSymbol: string;
  underlyingDecimals: number;
  chainId: number;
  apy: string | null;
  netApy: string | null;
  performanceFee: string | null;
  totalAssetsUsd: string | null;
  assetPriceUsd: number | null;
  vaultImage: string | null;
  vaultDescription: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface YieldPosition {
  id: string;
  userId: string;
  walletId: string;
  vaultId: string;
  shares: string;
  depositAmount: string;
  currentValue: string | null;
  unlockTime: string;
  status: "active" | "withdrawn" | "matured";
  label: string | null;
  txHash: string | null;
  chainId: number;
  createdAt: string;
  updatedAt: string;
}

export interface YieldPortfolio {
  totalDeposited: string;
  totalCurrentValue: string;
  totalYieldEarned: string;
  weightedApy: string;
  positionCount: number;
}

export interface PretiumCountry {
  code: string;
  name: string;
  currency: string;
  mobileNetworks: string[];
  paymentTypes: string[];
}

export interface OfframpTransaction {
  id: string;
  userId: string;
  walletId: string;
  country: string;
  usdcAmount: string;
  fiatAmount: string;
  feeFiatAmount: string;
  currency: string;
  phoneNumber: string;
  mobileNetwork: string;
  paymentType: string;
  status: "pending" | "processing" | "completed" | "failed" | "reversed";
  pretiumTransactionCode: string | null;
  txHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OnrampTransaction {
  id: string;
  userId: string;
  walletId: string;
  country: string;
  fiatAmount: string;
  currency: string;
  asset: string;
  address: string;
  phoneNumber: string;
  mobileNetwork: string;
  status: "pending" | "processing" | "completed" | "failed" | "reversed";
  pretiumTransactionCode: string | null;
  onChainTxHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SwapQuote {
  routing: string;
  quote: {
    input: { token: string; amount: string };
    output: { token: string; amount: string };
    gasFee: string;
    gasFeeUSD: string;
  };
}

export interface SwapResult {
  approvalTxId?: string;
  swapTxId: string;
  swapTxHash: string;
  quote: {
    routing: string;
    input: { token: string; amount: string };
    output: { token: string; amount: string };
    gasFeeUSD: string;
  };
}

export interface SwapAutomation {
  id: string;
  userId: string;
  walletId: string;
  walletType: "user" | "server" | "agent";
  tokenIn: string;
  tokenOut: string;
  amount: string;
  indicatorType: "price_above" | "price_below" | "percent_change_up" | "percent_change_down";
  indicatorToken: string;
  thresholdValue: number;
  slippageTolerance: number;
  maxExecutions: number;
  executionCount: number;
  cooldownSeconds: number;
  maxRetries: number;
  maxExecutionsPerDay: number | null;
  status: "active" | "paused" | "cancelled" | "completed";
  lastCheckedAt: string | null;
  lastExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupAccount {
  id: string;
  name: string;
  description: string | null;
  adminUserId: string;
  contractAddress: string | null;
  walletId: string | null;
  chainId: number;
  createdAt: string;
  updatedAt: string;
  members?: GroupMember[];
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: "admin" | "member";
  username: string | null;
  address: string | null;
  joinedAt: string;
}

export interface SplitExpense {
  id: string;
  creatorUserId: string;
  title: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  totalAmount: string;
  chainId: number;
  transactionId: string | null;
  categoryId: string | null;
  status: "active" | "settled" | "cancelled";
  shares?: SplitShare[];
  createdAt: string;
  updatedAt: string;
}

export interface SplitExpenseWithShares extends SplitExpense {
  shares: SplitShare[];
}

export interface SplitShare {
  id: string;
  expenseId: string;
  debtorUserId: string;
  amount: string;
  status: "pending" | "paid" | "cancelled";
  transactionId: string | null;
  paidAt: string | null;
  createdAt: string;
  username: string | null;
}

export interface GoalSaving {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  targetAmount: string;
  accumulatedAmount: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  status: "active" | "paused" | "cancelled" | "completed";
  walletId: string | null;
  walletType: string | null;
  vaultId: string | null;
  chainId: number | null;
  depositAmount: string | null;
  unlockTimeOffsetSeconds: number | null;
  frequency: string | null;
  nextDepositAt: string | null;
  startDate: string | null;
  endDate: string | null;
  maxRetries: number;
  consecutiveFailures: number;
  totalDeposits: number;
  createdAt: string;
  updatedAt: string;
}

export interface GoalSavingsDeposit {
  id: string;
  goalId: string;
  yieldPositionId: string;
  amount: string;
  depositType: "automated" | "manual";
  status: "pending" | "confirmed" | "failed";
  error: string | null;
  depositedAt: string;
}

export interface ApprovalSettings {
  enabled: boolean;
  method: "pin" | "passkey" | null;
  hasPin: boolean;
  passkeyCount: number;
}

export interface Passkey {
  id: string;
  label: string | null;
  createdAt: string;
}

export interface ExchangeRate {
  currency: string;
  rate: string;
}

export interface ConversionResult {
  amount: string;
  exchangeRate: string;
}

export interface ResolvedUsername {
  username: string;
  userId: string;
  address: string;
}

export interface UserPreferences {
  country?: string;
  currency?: string;
  mobileNetwork?: string;
  phoneNumber?: string;
  defaultWallet?: "user" | "server" | "agent";
}

export interface ApiError {
  _tag: string;
  message: string;
  method?: string;
  [key: string]: unknown;
}

export interface FeeEstimate {
  grossAmount: number;
  fiatAmount: number;
  fee: number;
  netAmount: number;
}

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };
