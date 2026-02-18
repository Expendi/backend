// ============================================
// CONTRACT CONNECTOR REGISTRY
// ============================================
// To add a new contract connector:
// 1. Create a new file in this directory (e.g., myprotocol.ts)
// 2. Define your connectors with: name, chainId, address, abi, and optional method shortcuts
// 3. Import and spread them into the connectors array below
// 4. Restart the server
// ============================================

import type { ContractConnector } from "../services/contract/types.js";
import { erc20Connectors } from "./erc20.js";
import { erc721Connectors } from "./erc721.js";
import { morphoVaultDepositorConnectors } from "./morpho-vault-depositor.js";
import { timelockConnectors } from "./timelock.js";
import { yieldTimelockConnectors } from "./yield-timelock.js";

export const connectors: ContractConnector[] = [
  ...erc20Connectors,
  ...erc721Connectors,
  ...morphoVaultDepositorConnectors,
  ...timelockConnectors,
  ...yieldTimelockConnectors,
];
