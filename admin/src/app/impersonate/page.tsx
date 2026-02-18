"use client";

import { useState } from "react";
import { Header } from "@/components/header";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  listWallets,
  getTransactionsByUser,
  createUserWallet,
  signMessage,
  submitRawTransaction,
} from "@/lib/api";
import type { Wallet, Transaction } from "@/lib/types";

export default function ImpersonatePage() {
  const [userId, setUserId] = useState("");
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [signModalOpen, setSignModalOpen] = useState(false);
  const [signWalletId, setSignWalletId] = useState("");
  const [signMessageText, setSignMessageText] = useState("");
  const [signResult, setSignResult] = useState<string | null>(null);
  const [signLoading, setSignLoading] = useState(false);

  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txWalletId, setTxWalletId] = useState("");
  const [txChainId, setTxChainId] = useState("1");
  const [txTo, setTxTo] = useState("");
  const [txValue, setTxValue] = useState("");
  const [txData, setTxData] = useState("");
  const [txLoading, setTxLoading] = useState(false);

  const [createWalletLoading, setCreateWalletLoading] = useState(false);

  async function loadUser() {
    if (!userId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const [allWallets, userTxs] = await Promise.all([
        listWallets(),
        getTransactionsByUser(userId.trim()),
      ]);
      const userWallets = allWallets.filter(
        (w) => w.ownerId === userId.trim()
      );
      setWallets(userWallets);
      setTransactions(userTxs);
      setActiveUserId(userId.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load user data");
    } finally {
      setLoading(false);
    }
  }

  function clearUser() {
    setActiveUserId(null);
    setWallets([]);
    setTransactions([]);
    setUserId("");
  }

  async function handleCreateWallet() {
    if (!activeUserId) return;
    setCreateWalletLoading(true);
    try {
      await createUserWallet(activeUserId);
      await loadUser();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create wallet");
    } finally {
      setCreateWalletLoading(false);
    }
  }

  async function handleSign() {
    if (!signWalletId || !signMessageText.trim()) return;
    setSignLoading(true);
    try {
      const result = await signMessage(signWalletId, signMessageText.trim());
      setSignResult(result.signature);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to sign message");
    } finally {
      setSignLoading(false);
    }
  }

  async function handleSubmitTx() {
    if (!txWalletId || !txTo.trim()) return;
    setTxLoading(true);
    try {
      const wallet = wallets.find((w) => w.id === txWalletId);
      await submitRawTransaction({
        walletId: txWalletId,
        walletType: wallet?.type ?? "user",
        chainId: parseInt(txChainId, 10),
        to: txTo.trim(),
        value: txValue.trim() || undefined,
        data: txData.trim() || undefined,
        userId: activeUserId ?? undefined,
      });
      setTxModalOpen(false);
      await loadUser();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit transaction");
    } finally {
      setTxLoading(false);
    }
  }

  const walletColumns: Column<Wallet>[] = [
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
          "-"
        ),
    },
    { key: "chainId", header: "Chain" },
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
              setSignWalletId(row.id);
              setSignMessageText("");
              setSignResult(null);
              setSignModalOpen(true);
            }}
          >
            Sign
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setTxWalletId(row.id);
              setTxTo("");
              setTxValue("");
              setTxData("");
              setTxModalOpen(true);
            }}
          >
            Send TX
          </Button>
        </div>
      ),
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
    {
      key: "createdAt",
      header: "Created",
      render: (row) => new Date(row.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <div>
      <Header
        title="Impersonate"
        description="View and act as a specific user"
      />

      {activeUserId && (
        <div className="border-b border-yellow-500/30 bg-yellow-500/10 px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-yellow-500" />
              <span className="text-sm font-medium text-yellow-500">
                Impersonating: {activeUserId}
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={clearUser}>
              Stop Impersonating
            </Button>
          </div>
        </div>
      )}

      <div className="p-6 space-y-6">
        {error && (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
            {error}
          </div>
        )}

        {!activeUserId ? (
          <Card>
            <CardHeader>
              <CardTitle>Load User</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="userId">User ID (Privy DID)</Label>
                  <Input
                    id="userId"
                    placeholder="did:privy:..."
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") loadUser();
                    }}
                  />
                </div>
                <Button onClick={loadUser} disabled={loading || !userId.trim()}>
                  {loading ? "Loading..." : "Load User"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Wallets ({wallets.length})
              </h2>
              <Button
                onClick={handleCreateWallet}
                disabled={createWalletLoading}
              >
                {createWalletLoading ? "Creating..." : "Create Wallet"}
              </Button>
            </div>
            <DataTable
              columns={walletColumns}
              data={wallets}
              emptyMessage="No wallets found for this user."
            />

            <Separator />

            <h2 className="text-lg font-semibold">
              Transactions ({transactions.length})
            </h2>
            <DataTable
              columns={txColumns}
              data={transactions}
              emptyMessage="No transactions found for this user."
            />
          </>
        )}
      </div>

      <Modal
        open={signModalOpen}
        onOpenChange={setSignModalOpen}
        title="Sign Message"
        description={`Signing with wallet ${signWalletId.slice(0, 8)}...`}
      >
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="signMsg">Message</Label>
            <Textarea
              id="signMsg"
              placeholder="Enter message to sign..."
              value={signMessageText}
              onChange={(e) => setSignMessageText(e.target.value)}
              rows={3}
            />
          </div>
          {signResult && (
            <div className="space-y-1">
              <Label>Signature</Label>
              <pre className="overflow-auto rounded-md bg-muted p-2 text-xs break-all">
                {signResult}
              </pre>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setSignModalOpen(false)}
            >
              Close
            </Button>
            <Button
              onClick={handleSign}
              disabled={signLoading || !signMessageText.trim()}
            >
              {signLoading ? "Signing..." : "Sign"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={txModalOpen}
        onOpenChange={setTxModalOpen}
        title="Submit Transaction"
        description={`From wallet ${txWalletId.slice(0, 8)}...`}
      >
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="txChain">Chain ID</Label>
            <Input
              id="txChain"
              type="number"
              value={txChainId}
              onChange={(e) => setTxChainId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="txTo">To Address</Label>
            <Input
              id="txTo"
              placeholder="0x..."
              value={txTo}
              onChange={(e) => setTxTo(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="txVal">Value (wei, optional)</Label>
            <Input
              id="txVal"
              placeholder="0"
              value={txValue}
              onChange={(e) => setTxValue(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="txDat">Data (hex, optional)</Label>
            <Input
              id="txDat"
              placeholder="0x..."
              value={txData}
              onChange={(e) => setTxData(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setTxModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitTx}
              disabled={txLoading || !txTo.trim()}
            >
              {txLoading ? "Submitting..." : "Submit"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
