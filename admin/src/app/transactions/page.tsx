"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/header";
import { StatusBadge } from "@/components/status-badge";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listTransactions,
  confirmTransaction,
  failTransaction,
} from "@/lib/api";
import type { Transaction, TransactionStatus } from "@/lib/types";

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [failModalOpen, setFailModalOpen] = useState(false);
  const [failTarget, setFailTarget] = useState<string | null>(null);
  const [failReason, setFailReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listTransactions(200, 0);
      setTransactions(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const filtered = transactions.filter((tx) => {
    if (statusFilter !== "all" && tx.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        tx.id.toLowerCase().includes(q) ||
        tx.walletId.toLowerCase().includes(q) ||
        tx.method.toLowerCase().includes(q) ||
        (tx.userId ?? "").toLowerCase().includes(q) ||
        (tx.txHash ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function handleConfirm(id: string) {
    setActionLoading(true);
    try {
      await confirmTransaction(id);
      await fetchTransactions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to confirm");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleFail() {
    if (!failTarget || !failReason.trim()) return;
    setActionLoading(true);
    try {
      await failTransaction(failTarget, failReason.trim());
      setFailModalOpen(false);
      setFailTarget(null);
      setFailReason("");
      await fetchTransactions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark as failed");
    } finally {
      setActionLoading(false);
    }
  }

  function openFailModal(id: string) {
    setFailTarget(id);
    setFailReason("");
    setFailModalOpen(true);
  }

  return (
    <div>
      <Header title="Transactions" description="View and manage all transactions">
        <Input
          placeholder="Search by ID, wallet, method, user..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-72"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </Header>

      <div className="p-6">
        {error && (
          <div className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            Loading transactions...
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Chain</TableHead>
                  <TableHead>TX Hash</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No transactions found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((tx) => (
                    <>
                      <TableRow
                        key={tx.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() =>
                          setExpandedId(expandedId === tx.id ? null : tx.id)
                        }
                      >
                        <TableCell className="font-mono text-xs">
                          {tx.id.slice(0, 8)}...
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {tx.walletId.slice(0, 8)}...
                        </TableCell>
                        <TableCell>{tx.method}</TableCell>
                        <TableCell>
                          <StatusBadge status={tx.status} />
                        </TableCell>
                        <TableCell>{tx.chainId}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {tx.txHash
                            ? `${tx.txHash.slice(0, 10)}...`
                            : "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(tx.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div
                            className="flex justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {tx.status === "submitted" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleConfirm(tx.id)}
                                disabled={actionLoading}
                              >
                                Confirm
                              </Button>
                            )}
                            {(tx.status === "pending" ||
                              tx.status === "submitted") && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => openFailModal(tx.id)}
                                disabled={actionLoading}
                              >
                                Fail
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedId === tx.id && (
                        <TableRow key={`${tx.id}-detail`}>
                          <TableCell colSpan={8} className="bg-muted/30 p-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="font-medium text-muted-foreground">
                                  Full ID:
                                </span>{" "}
                                <span className="font-mono">{tx.id}</span>
                              </div>
                              <div>
                                <span className="font-medium text-muted-foreground">
                                  User ID:
                                </span>{" "}
                                {tx.userId ?? "-"}
                              </div>
                              <div>
                                <span className="font-medium text-muted-foreground">
                                  Category:
                                </span>{" "}
                                {tx.categoryId ?? "-"}
                              </div>
                              <div>
                                <span className="font-medium text-muted-foreground">
                                  Gas Used:
                                </span>{" "}
                                {tx.gasUsed ?? "-"}
                              </div>
                              <div>
                                <span className="font-medium text-muted-foreground">
                                  Contract:
                                </span>{" "}
                                {tx.contractId ?? "-"}
                              </div>
                              <div>
                                <span className="font-medium text-muted-foreground">
                                  Confirmed At:
                                </span>{" "}
                                {tx.confirmedAt
                                  ? new Date(tx.confirmedAt).toLocaleString()
                                  : "-"}
                              </div>
                              {tx.error && (
                                <div className="col-span-2">
                                  <span className="font-medium text-red-500">
                                    Error:
                                  </span>{" "}
                                  <span className="text-red-400">
                                    {tx.error}
                                  </span>
                                </div>
                              )}
                              <div className="col-span-2">
                                <span className="font-medium text-muted-foreground">
                                  Payload:
                                </span>
                                <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs">
                                  {JSON.stringify(tx.payload, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Modal
        open={failModalOpen}
        onOpenChange={setFailModalOpen}
        title="Mark Transaction as Failed"
        description="Provide a reason for the failure"
      >
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="failReason">Error Reason</Label>
            <Textarea
              id="failReason"
              placeholder="Enter the failure reason..."
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setFailModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleFail}
              disabled={actionLoading || !failReason.trim()}
            >
              {actionLoading ? "Marking..." : "Mark Failed"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
