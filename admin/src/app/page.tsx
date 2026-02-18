import { Header } from "@/components/header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { listWallets, listTransactions, listJobs } from "@/lib/api";
import type { Wallet, Transaction, Job } from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

async function loadDashboardData() {
  try {
    const [wallets, transactions, jobs] = await Promise.all([
      listWallets().catch((): Wallet[] => []),
      listTransactions(50, 0).catch((): Transaction[] => []),
      listJobs().catch((): Job[] => []),
    ]);
    return { wallets, transactions, jobs };
  } catch {
    return { wallets: [], transactions: [], jobs: [] };
  }
}

export default async function DashboardPage() {
  const { wallets, transactions, jobs } = await loadDashboardData();

  const walletsByType = {
    user: wallets.filter((w) => w.type === "user").length,
    server: wallets.filter((w) => w.type === "server").length,
    agent: wallets.filter((w) => w.type === "agent").length,
  };

  const txByStatus = {
    pending: transactions.filter((t) => t.status === "pending").length,
    submitted: transactions.filter((t) => t.status === "submitted").length,
    confirmed: transactions.filter((t) => t.status === "confirmed").length,
    failed: transactions.filter((t) => t.status === "failed").length,
  };

  const activeJobs = jobs.filter(
    (j) => j.status === "pending" || j.status === "running"
  ).length;

  const recentTransactions = transactions.slice(0, 10);

  return (
    <div>
      <Header
        title="Dashboard"
        description="Overview of the Expendi backend"
      />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Wallets"
            value={wallets.length}
            description={`${walletsByType.user} user, ${walletsByType.server} server, ${walletsByType.agent} agent`}
          />
          <StatCard
            title="Transactions"
            value={transactions.length}
            description={`${txByStatus.confirmed} confirmed, ${txByStatus.pending} pending`}
          />
          <StatCard
            title="Active Jobs"
            value={activeJobs}
            description={`${jobs.length} total jobs`}
          />
          <StatCard
            title="Failed Transactions"
            value={txByStatus.failed}
            description={`${txByStatus.submitted} submitted`}
          />
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">Recent Transactions</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Chain</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentTransactions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No transactions yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentTransactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-mono text-xs">
                        {tx.id.slice(0, 8)}...
                      </TableCell>
                      <TableCell>{tx.method}</TableCell>
                      <TableCell>
                        <StatusBadge status={tx.status} />
                      </TableCell>
                      <TableCell>{tx.chainId}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
