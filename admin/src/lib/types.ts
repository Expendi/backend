// ── Wallet ──────────────────────────────────────────────────────────────────

export type WalletType = "user" | "server" | "agent";

export interface Wallet {
  id: string;
  type: WalletType;
  privyWalletId: string;
  ownerId: string;
  address: string | null;
  chainId: string | null;
  createdAt: string;
}

// ── Transaction ─────────────────────────────────────────────────────────────

export type TransactionStatus = "pending" | "submitted" | "confirmed" | "failed";

export interface Transaction {
  id: string;
  walletId: string;
  walletType: WalletType;
  chainId: string;
  contractId: string | null;
  method: string;
  payload: Record<string, unknown>;
  status: TransactionStatus;
  txHash: string | null;
  gasUsed: string | null;
  categoryId: string | null;
  userId: string | null;
  error: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

// ── Job ─────────────────────────────────────────────────────────────────────

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Job {
  id: string;
  name: string;
  jobType: string;
  schedule: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  lastRunAt: string | null;
  nextRunAt: string | null;
  maxRetries: number;
  retryCount: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Contract Connector ──────────────────────────────────────────────────────

export interface ContractMethod {
  functionName: string;
  description?: string;
}

export interface ContractConnector {
  name: string;
  chainId: number;
  address: string;
  abi: unknown[];
  methods?: Record<string, ContractMethod>;
}

// ── Category ────────────────────────────────────────────────────────────────

export interface TransactionCategory {
  id: string;
  name: string;
  userId: string | null;
  description: string | null;
  createdAt: string;
}

// ── Recurring Payment ──────────────────────────────────────────────────────

export type RecurringPaymentStatus = "active" | "paused" | "cancelled" | "completed" | "failed";
export type RecurringPaymentType = "erc20_transfer" | "raw_transfer" | "contract_call" | "offramp";
export type ExecutionStatus = "success" | "failed";

export interface RecurringPayment {
  id: string;
  userId: string;
  walletId: string;
  walletType: WalletType;
  recipientAddress: string;
  paymentType: RecurringPaymentType;
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
  status: RecurringPaymentStatus;
  startDate: string;
  endDate: string | null;
  nextExecutionAt: string;
  maxRetries: number;
  consecutiveFailures: number;
  totalExecutions: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringPaymentExecution {
  id: string;
  scheduleId: string;
  transactionId: string | null;
  status: ExecutionStatus;
  error: string | null;
  executedAt: string;
}

// ── API Responses ───────────────────────────────────────────────────────────

export interface CreateWalletResponse {
  address: string;
  type: WalletType;
}

export interface SignResponse {
  signature: string;
}

export interface ProcessJobsResponse {
  processedCount: number;
  jobs: Job[];
}

export interface ProcessRecurringPaymentsResponse {
  processedCount: number;
  executions: RecurringPaymentExecution[];
}
