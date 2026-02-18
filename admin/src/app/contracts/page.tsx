"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/header";
import { listContracts } from "@/lib/api";
import type { ContractConnector } from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ContractsPage() {
  const [contracts, setContracts] = useState<ContractConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const fetchContracts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listContracts();
      setContracts(Array.isArray(data) ? data : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contracts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContracts();
  }, [fetchContracts]);

  function connectorKey(c: ContractConnector) {
    return `${c.name}-${c.chainId}`;
  }

  return (
    <div>
      <Header
        title="Contracts"
        description="Registered contract connectors (read-only)"
      />

      <div className="p-6">
        <div className="mb-4 rounded-md border border-blue-500/20 bg-blue-500/10 p-3 text-sm text-blue-400">
          Connectors are registered in code. See docs/guides/adding-contracts.md
          for instructions on adding new connectors.
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            Loading contracts...
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Chain ID</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Methods</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No connectors registered.
                    </TableCell>
                  </TableRow>
                ) : (
                  contracts.map((c) => {
                    const key = connectorKey(c);
                    const isExpanded = expandedKey === key;
                    const methodCount = c.methods
                      ? Object.keys(c.methods).length
                      : 0;
                    return (
                      <>
                        <TableRow
                          key={key}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() =>
                            setExpandedKey(isExpanded ? null : key)
                          }
                        >
                          <TableCell className="font-medium">
                            {c.name}
                          </TableCell>
                          <TableCell>{c.chainId}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {c.address.slice(0, 6)}...{c.address.slice(-4)}
                          </TableCell>
                          <TableCell>{methodCount} methods</TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${key}-detail`}>
                            <TableCell colSpan={4} className="bg-muted/30 p-4">
                              <div className="space-y-4">
                                <div>
                                  <h4 className="mb-1 text-sm font-medium">
                                    Full Address
                                  </h4>
                                  <code className="text-xs">{c.address}</code>
                                </div>
                                {c.methods &&
                                  Object.keys(c.methods).length > 0 && (
                                    <div>
                                      <h4 className="mb-2 text-sm font-medium">
                                        Method Shortcuts
                                      </h4>
                                      <div className="space-y-1">
                                        {Object.entries(c.methods).map(
                                          ([name, m]) => (
                                            <div
                                              key={name}
                                              className="flex items-center gap-2 text-sm"
                                            >
                                              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                                                {name}
                                              </code>
                                              <span className="text-muted-foreground">
                                                {m.functionName}
                                              </span>
                                              {m.description && (
                                                <span className="text-xs text-muted-foreground">
                                                  -- {m.description}
                                                </span>
                                              )}
                                            </div>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  )}
                                <div>
                                  <h4 className="mb-1 text-sm font-medium">
                                    ABI ({c.abi.length} entries)
                                  </h4>
                                  <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
                                    {JSON.stringify(c.abi, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
