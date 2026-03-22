import type { Abi } from "viem";

export interface ContractConnector {
  readonly name: string;
  readonly chainId: number;
  readonly address: `0x${string}`;
  readonly abi: Abi;
  readonly methods?: Record<
    string,
    {
      readonly functionName: string;
      readonly description?: string;
    }
  >;
}

export interface ContractExecutionRequest {
  readonly contractName: string;
  readonly chainId: number;
  readonly method: string;
  readonly args: readonly unknown[];
  readonly value?: number | bigint;
}

// ── Multi-chain connector definition ──────────────────────────────────
// Define a connector once with addresses for every chain it's deployed on.
// Use `expandMultiChain` to produce the per-chain `ContractConnector[]`.

export interface MultiChainConnectorDef {
  readonly name: string;
  readonly addresses: Record<number, `0x${string}`>;
  readonly abi: Abi;
  readonly methods?: ContractConnector["methods"];
}

/**
 * Expands a multi-chain connector definition into one `ContractConnector`
 * per chain entry in `addresses`.
 */
export function expandMultiChain(def: MultiChainConnectorDef): ContractConnector[] {
  return Object.entries(def.addresses).map(([chainIdStr, address]) => ({
    name: def.name,
    chainId: Number(chainIdStr),
    address,
    abi: def.abi,
    ...(def.methods ? { methods: def.methods } : {}),
  }));
}
