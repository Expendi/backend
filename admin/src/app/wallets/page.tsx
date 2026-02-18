"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/header";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listWallets,
  createServerWallet,
  createAgentWallet,
  getTransactionsByWallet,
} from "@/lib/api";
import type { Wallet, WalletType, Transaction } from "@/lib/types";

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [filtered, setFiltered] = useState<Wallet[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [creating, setCreating] = useState(false);

  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
  const [walletTxs, setWalletTxs] = useState<Transaction[]>([]);
  const [txModalOpen, setTxModalOpen] = useState(false);

  const fetchWallets = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listWallets();
      setWallets(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load wallets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  useEffect(() => {
    if (typeFilter === "all") {
      setFiltered(wallets);
    } else {
      setFiltered(wallets.filter((w) => w.type === typeFilter));
    }
  }, [wallets, typeFilter]);

  async function handleCreateServer() {
    setCreating(true);
    try {
      await createServerWallet();
      setServerModalOpen(false);
      await fetchWallets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create wallet");
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateAgent() {
    if (!agentId.trim()) return;
    setCreating(true);
    try {
      await createAgentWallet(agentId.trim());
      setAgentModalOpen(false);
      setAgentId("");
      await fetchWallets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create wallet");
    } finally {
      setCreating(false);
    }
  }

  async function handleRowClick(wallet: Wallet) {
    setSelectedWallet(wallet);
    setTxModalOpen(true);
    try {
      const txs = await getTransactionsByWallet(wallet.id);
      setWalletTxs(txs);
    } catch {
      setWalletTxs([]);
    }
  }

  const columns: Column<Wallet>[] = [
    {
      key: "id",
      header: "ID",
      render: (row) => (
        <span className="font-mono text-xs">{row.id.slice(0, 8)}...</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => <StatusBadge status={row.type} />,
    },
    {
      key: "address",
      header: "Address",
      render: (row) =>
        row.address ? (
          <span className="font-mono text-xs">
            {row.address.slice(0, 6)}...{row.address.slice(-4)}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    { key: "ownerId", header: "Owner" },
    { key: "chainId", header: "Chain" },
    {
      key: "createdAt",
      header: "Created",
      render: (row) => new Date(row.createdAt).toLocaleDateString(),
    },
  ];

  const txColumns: Column<Transaction>[] = [
    {
      key: "id",
      header: "ID",
      render: (row) => (
        <span className="font-mono text-xs">{row.id.slice(0, 8)}...</span>
      ),
    },
    { key: "method", header: "Method" },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    { key: "chainId", header: "Chain" },
  ];

  return (
    <div>
      <Header title="Wallets" description="Manage all wallets">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Filter type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="server">Server</SelectItem>
            <SelectItem value="agent">Agent</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => setServerModalOpen(true)}>
          Create Server Wallet
        </Button>
        <Button variant="outline" onClick={() => setAgentModalOpen(true)}>
          Create Agent Wallet
        </Button>
      </Header>

      <div className="p-6">
        {error && (
          <div className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            Loading wallets...
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filtered}
            onRowClick={(row) => handleRowClick(row)}
            emptyMessage="No wallets found."
          />
        )}
      </div>

      <Modal
        open={serverModalOpen}
        onOpenChange={setServerModalOpen}
        title="Create Server Wallet"
        description="Create a new server-managed wallet"
      >
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            This will create a new Privy server wallet. No additional input is
            required.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setServerModalOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateServer} disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={agentModalOpen}
        onOpenChange={setAgentModalOpen}
        title="Create Agent Wallet"
        description="Create a new agent-managed wallet"
      >
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="agentId">Agent ID</Label>
            <Input
              id="agentId"
              placeholder="Enter agent identifier"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setAgentModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateAgent}
              disabled={creating || !agentId.trim()}
            >
              {creating ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={txModalOpen}
        onOpenChange={setTxModalOpen}
        title={`Transactions for ${selectedWallet?.id.slice(0, 8)}...`}
        description={`Wallet type: ${selectedWallet?.type} | Address: ${selectedWallet?.address ?? "N/A"}`}
      >
        <div className="max-h-96 overflow-y-auto">
          <DataTable
            columns={txColumns}
            data={walletTxs}
            emptyMessage="No transactions for this wallet."
          />
        </div>
      </Modal>
    </div>
  );
}
