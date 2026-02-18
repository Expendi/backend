"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/header";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listRecurringPayments,
  getRecurringPayment,
  executeRecurringPayment,
  getRecurringPaymentExecutions,
  processRecurringPayments,
} from "@/lib/api";
import type {
  RecurringPayment,
  RecurringPaymentExecution,
} from "@/lib/types";

const OFFRAMP_PROVIDERS = ["moonpay", "bridge", "transak"];

export default function RecurringPaymentsPage() {
  const [schedules, setSchedules] = useState<RecurringPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Detail modal
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedSchedule, setSelectedSchedule] =
    useState<RecurringPayment | null>(null);

  // Executions modal
  const [executionsModalOpen, setExecutionsModalOpen] = useState(false);
  const [executionsScheduleId, setExecutionsScheduleId] = useState<
    string | null
  >(null);
  const [executions, setExecutions] = useState<RecurringPaymentExecution[]>([]);
  const [executionsLoading, setExecutionsLoading] = useState(false);

  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listRecurringPayments(100, 0);
      setSchedules(data);
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load recurring payments"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  async function handleViewDetails(schedule: RecurringPayment) {
    try {
      const detail = await getRecurringPayment(schedule.id);
      setSelectedSchedule(detail);
      setDetailModalOpen(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load schedule details"
      );
    }
  }

  async function handleViewExecutions(scheduleId: string) {
    setExecutionsScheduleId(scheduleId);
    setExecutionsLoading(true);
    setExecutionsModalOpen(true);
    try {
      const data = await getRecurringPaymentExecutions(scheduleId, 50);
      setExecutions(data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load execution history"
      );
    } finally {
      setExecutionsLoading(false);
    }
  }

  async function handleForceExecute(scheduleId: string) {
    setActionLoading(true);
    try {
      const execution = await executeRecurringPayment(scheduleId);
      const statusLabel =
        execution.status === "success" ? "succeeded" : "failed";
      alert(`Execution ${statusLabel}`);
      await fetchSchedules();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to execute schedule"
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleProcessDue() {
    setActionLoading(true);
    try {
      const result = await processRecurringPayments();
      alert(`Processed ${result.processedCount} payment(s)`);
      await fetchSchedules();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to process due payments"
      );
    } finally {
      setActionLoading(false);
    }
  }

  function formatPaymentType(type: string): string {
    switch (type) {
      case "erc20_transfer":
        return "ERC-20";
      case "raw_transfer":
        return "Raw Transfer";
      case "contract_call":
        return "Contract Call";
      case "offramp":
        return "Offramp";
      default:
        return type;
    }
  }

  const columns: Column<RecurringPayment>[] = [
    {
      key: "id",
      header: "ID",
      render: (row) => (
        <span className="font-mono text-xs">{row.id.slice(0, 8)}...</span>
      ),
    },
    {
      key: "userId",
      header: "User",
      render: (row) => (
        <span className="font-mono text-xs">
          {row.userId.length > 20
            ? row.userId.slice(0, 20) + "..."
            : row.userId}
        </span>
      ),
    },
    {
      key: "paymentType",
      header: "Type",
      render: (row) => formatPaymentType(row.paymentType),
    },
    {
      key: "amount",
      header: "Amount",
      render: (row) => (
        <span className="font-mono text-xs">{row.amount}</span>
      ),
    },
    {
      key: "frequency",
      header: "Frequency",
      className: "font-mono text-xs",
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "nextExecutionAt",
      header: "Next Execution",
      render: (row) =>
        row.nextExecutionAt
          ? new Date(row.nextExecutionAt).toLocaleString()
          : "-",
    },
    {
      key: "totalExecutions",
      header: "Runs",
      render: (row) => (
        <span>
          {row.totalExecutions}
          {row.consecutiveFailures > 0 && (
            <span className="ml-1 text-red-500">
              ({row.consecutiveFailures} fails)
            </span>
          )}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              handleViewExecutions(row.id);
            }}
          >
            History
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              handleForceExecute(row.id);
            }}
            disabled={actionLoading}
          >
            Execute
          </Button>
        </div>
      ),
    },
  ];

  const executionColumns: Column<RecurringPaymentExecution>[] = [
    {
      key: "id",
      header: "ID",
      render: (row) => (
        <span className="font-mono text-xs">{row.id.slice(0, 8)}...</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "transactionId",
      header: "Transaction",
      render: (row) =>
        row.transactionId ? (
          <span className="font-mono text-xs">
            {row.transactionId.slice(0, 8)}...
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "error",
      header: "Error",
      render: (row) =>
        row.error ? (
          <span className="text-xs text-red-500">{row.error.slice(0, 60)}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "executedAt",
      header: "Executed At",
      render: (row) => new Date(row.executedAt).toLocaleString(),
    },
  ];

  const activeCount = schedules.filter((s) => s.status === "active").length;
  const pausedCount = schedules.filter((s) => s.status === "paused").length;

  return (
    <div>
      <Header
        title="Recurring Payments"
        description={`${schedules.length} total schedules, ${activeCount} active, ${pausedCount} paused`}
      >
        <Button
          variant="outline"
          onClick={handleProcessDue}
          disabled={actionLoading}
        >
          {actionLoading ? "Processing..." : "Process Due Payments"}
        </Button>
      </Header>

      <div className="p-6 space-y-6">
        {error && (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            Loading recurring payments...
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={schedules}
            onRowClick={handleViewDetails}
            emptyMessage="No recurring payment schedules found."
          />
        )}

        {/* Offramp Providers Section */}
        <div>
          <h2 className="mb-3 text-lg font-semibold">
            Registered Offramp Providers
          </h2>
          <div className="flex gap-2">
            {OFFRAMP_PROVIDERS.map((provider) => (
              <Badge
                key={provider}
                variant="outline"
                className="bg-violet-500/15 text-violet-500 border-violet-500/20 text-xs font-medium capitalize"
              >
                {provider}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            These providers are registered in the OfframpAdapterRegistry and can
            be used with recurring payments of type &quot;offramp&quot;.
          </p>
        </div>
      </div>

      {/* Schedule Detail Modal */}
      <Modal
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        title="Schedule Details"
        description={
          selectedSchedule
            ? `Schedule ${selectedSchedule.id.slice(0, 8)}...`
            : ""
        }
      >
        {selectedSchedule && (
          <div className="space-y-3 pt-2 text-sm">
            <DetailRow label="ID" value={selectedSchedule.id} mono />
            <DetailRow label="User" value={selectedSchedule.userId} mono />
            <DetailRow label="Wallet" value={selectedSchedule.walletId} mono />
            <DetailRow
              label="Wallet Type"
              value={selectedSchedule.walletType}
            />
            <DetailRow
              label="Payment Type"
              value={formatPaymentType(selectedSchedule.paymentType)}
            />
            <DetailRow label="Amount" value={selectedSchedule.amount} mono />
            <DetailRow
              label="Recipient"
              value={selectedSchedule.recipientAddress}
              mono
            />
            <DetailRow
              label="Chain ID"
              value={String(selectedSchedule.chainId)}
            />
            <DetailRow
              label="Frequency"
              value={selectedSchedule.frequency}
              mono
            />
            <DetailRow label="Status" value={selectedSchedule.status} />
            <DetailRow
              label="Next Execution"
              value={new Date(
                selectedSchedule.nextExecutionAt
              ).toLocaleString()}
            />
            <DetailRow
              label="Total Executions"
              value={String(selectedSchedule.totalExecutions)}
            />
            <DetailRow
              label="Consecutive Failures"
              value={String(selectedSchedule.consecutiveFailures)}
            />
            <DetailRow
              label="Max Retries"
              value={String(selectedSchedule.maxRetries)}
            />
            {selectedSchedule.tokenContractName && (
              <DetailRow
                label="Token Contract"
                value={selectedSchedule.tokenContractName}
              />
            )}
            {selectedSchedule.contractName && (
              <DetailRow
                label="Contract"
                value={selectedSchedule.contractName}
              />
            )}
            {selectedSchedule.contractMethod && (
              <DetailRow
                label="Method"
                value={selectedSchedule.contractMethod}
              />
            )}
            {selectedSchedule.isOfframp && (
              <>
                <div className="border-t border-border pt-2">
                  <span className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    Offramp Details
                  </span>
                </div>
                <DetailRow
                  label="Provider"
                  value={selectedSchedule.offrampProvider ?? "-"}
                />
                <DetailRow
                  label="Fiat Currency"
                  value={selectedSchedule.offrampCurrency ?? "-"}
                />
                <DetailRow
                  label="Fiat Amount"
                  value={selectedSchedule.offrampFiatAmount ?? "-"}
                />
                <DetailRow
                  label="Destination ID"
                  value={selectedSchedule.offrampDestinationId ?? "-"}
                  mono
                />
              </>
            )}
            <DetailRow
              label="Start Date"
              value={new Date(selectedSchedule.startDate).toLocaleString()}
            />
            <DetailRow
              label="End Date"
              value={
                selectedSchedule.endDate
                  ? new Date(selectedSchedule.endDate).toLocaleString()
                  : "No end date"
              }
            />
            <DetailRow
              label="Created"
              value={new Date(selectedSchedule.createdAt).toLocaleString()}
            />
            <DetailRow
              label="Updated"
              value={new Date(selectedSchedule.updatedAt).toLocaleString()}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDetailModalOpen(false);
                  handleViewExecutions(selectedSchedule.id);
                }}
              >
                View History
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setDetailModalOpen(false);
                  handleForceExecute(selectedSchedule.id);
                }}
                disabled={actionLoading}
              >
                Force Execute
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Execution History Modal */}
      <Modal
        open={executionsModalOpen}
        onOpenChange={setExecutionsModalOpen}
        title="Execution History"
        description={
          executionsScheduleId
            ? `Schedule ${executionsScheduleId.slice(0, 8)}...`
            : ""
        }
      >
        <div className="pt-2">
          {executionsLoading ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              Loading executions...
            </div>
          ) : (
            <DataTable
              columns={executionColumns}
              data={executions}
              emptyMessage="No executions recorded yet."
            />
          )}
        </div>
      </Modal>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span
        className={`text-right truncate ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
