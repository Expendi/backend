import type {
  Wallet,
  Transaction,
  Job,
  ContractConnector,
  TransactionCategory,
  RecurringPayment,
  RecurringPaymentExecution,
  CreateWalletResponse,
  SignResponse,
  ProcessJobsResponse,
  ProcessRecurringPaymentsResponse,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";

async function adminFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/internal${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": ADMIN_KEY,
      ...options?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Wallets ─────────────────────────────────────────────────────────────────

export async function listWallets(): Promise<Wallet[]> {
  return adminFetch<Wallet[]>("/wallets");
}

export async function getWallet(id: string): Promise<Wallet> {
  return adminFetch<Wallet>(`/wallets/${id}`);
}

export async function createServerWallet(): Promise<CreateWalletResponse> {
  return adminFetch<CreateWalletResponse>("/wallets/server", { method: "POST" });
}

export async function createAgentWallet(agentId: string): Promise<CreateWalletResponse> {
  return adminFetch<CreateWalletResponse>("/wallets/agent", {
    method: "POST",
    body: JSON.stringify({ agentId }),
  });
}

export async function createUserWallet(userId: string): Promise<CreateWalletResponse> {
  return adminFetch<CreateWalletResponse>("/wallets/user", {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export async function signMessage(walletId: string, message: string): Promise<SignResponse> {
  return adminFetch<SignResponse>(`/wallets/${walletId}/sign`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

// ── Transactions ────────────────────────────────────────────────────────────

export async function listTransactions(
  limit = 50,
  offset = 0
): Promise<Transaction[]> {
  return adminFetch<Transaction[]>(`/transactions?limit=${limit}&offset=${offset}`);
}

export async function getTransaction(id: string): Promise<Transaction> {
  return adminFetch<Transaction>(`/transactions/${id}`);
}

export async function getTransactionsByWallet(walletId: string): Promise<Transaction[]> {
  return adminFetch<Transaction[]>(`/transactions/wallet/${walletId}`);
}

export async function getTransactionsByUser(userId: string): Promise<Transaction[]> {
  return adminFetch<Transaction[]>(`/transactions/user/${userId}`);
}

export async function confirmTransaction(
  id: string,
  gasUsed?: string
): Promise<Transaction> {
  return adminFetch<Transaction>(`/transactions/${id}/confirm`, {
    method: "PATCH",
    body: JSON.stringify({ gasUsed }),
  });
}

export async function failTransaction(
  id: string,
  error: string
): Promise<Transaction> {
  return adminFetch<Transaction>(`/transactions/${id}/fail`, {
    method: "PATCH",
    body: JSON.stringify({ error }),
  });
}

export async function submitRawTransaction(params: {
  walletId: string;
  walletType: "user" | "server" | "agent";
  chainId: number;
  to: string;
  data?: string;
  value?: string;
  categoryId?: string;
  userId?: string;
}): Promise<Transaction> {
  return adminFetch<Transaction>("/transactions/raw", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export async function listJobs(): Promise<Job[]> {
  return adminFetch<Job[]>("/jobs");
}

export async function getJob(id: string): Promise<Job> {
  return adminFetch<Job>(`/jobs/${id}`);
}

export async function createJob(params: {
  name: string;
  jobType: string;
  schedule: string;
  payload: Record<string, unknown>;
  maxRetries?: number;
}): Promise<Job> {
  return adminFetch<Job>("/jobs", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function cancelJob(id: string): Promise<Job> {
  return adminFetch<Job>(`/jobs/${id}/cancel`, { method: "POST" });
}

export async function processJobs(): Promise<ProcessJobsResponse> {
  return adminFetch<ProcessJobsResponse>("/jobs/process", { method: "POST" });
}

// ── Recurring Payments ──────────────────────────────────────────────────────

export async function listRecurringPayments(
  limit = 50,
  offset = 0
): Promise<RecurringPayment[]> {
  return adminFetch<RecurringPayment[]>(
    `/recurring-payments?limit=${limit}&offset=${offset}`
  );
}

export async function getRecurringPayment(
  id: string
): Promise<RecurringPayment> {
  return adminFetch<RecurringPayment>(`/recurring-payments/${id}`);
}

export async function executeRecurringPayment(
  id: string
): Promise<RecurringPaymentExecution> {
  return adminFetch<RecurringPaymentExecution>(
    `/recurring-payments/${id}/execute`,
    { method: "POST" }
  );
}

export async function getRecurringPaymentExecutions(
  id: string,
  limit = 50
): Promise<RecurringPaymentExecution[]> {
  return adminFetch<RecurringPaymentExecution[]>(
    `/recurring-payments/${id}/executions?limit=${limit}`
  );
}

export async function processRecurringPayments(): Promise<ProcessRecurringPaymentsResponse> {
  return adminFetch<ProcessRecurringPaymentsResponse>(
    "/recurring-payments/process",
    { method: "POST" }
  );
}

// ── Contracts ───────────────────────────────────────────────────────────────

export async function listContracts(): Promise<ContractConnector[]> {
  return adminFetch<ContractConnector[]>("/contracts");
}

export async function getContract(
  name: string,
  chainId: number
): Promise<ContractConnector> {
  return adminFetch<ContractConnector>(`/contracts/${name}/${chainId}`);
}

// ── Categories ──────────────────────────────────────────────────────────────

export async function listCategories(): Promise<TransactionCategory[]> {
  return adminFetch<TransactionCategory[]>("/categories");
}

export async function getCategory(id: string): Promise<TransactionCategory> {
  return adminFetch<TransactionCategory>(`/categories/${id}`);
}

export async function createCategory(params: {
  name: string;
  userId?: string;
  description?: string;
}): Promise<TransactionCategory> {
  return adminFetch<TransactionCategory>("/categories", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function updateCategory(
  id: string,
  params: { name?: string; description?: string }
): Promise<TransactionCategory> {
  return adminFetch<TransactionCategory>(`/categories/${id}`, {
    method: "PUT",
    body: JSON.stringify(params),
  });
}

export async function deleteCategory(id: string): Promise<{ deleted: boolean; id: string }> {
  return adminFetch<{ deleted: boolean; id: string }>(`/categories/${id}`, {
    method: "DELETE",
  });
}
