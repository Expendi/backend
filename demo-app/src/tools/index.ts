import type { ToolConfig } from "glove-react";
import { dataTools } from "./data";
import { profileTools } from "./profile";
import { walletTools } from "./wallets";
import { transactionTools } from "./transactions";
import { categoryTools } from "./categories";
import { recurringTools } from "./recurring";
import { yieldTools } from "./yield";
import { pretiumTools } from "./pretium";
import { swapTools } from "./swap";
import { groupTools } from "./groups";
import { savingsTools } from "./savings";
import { securityTools } from "./security";

export { setApiFetcher, setApprovalHandler } from "./api";

export const allTools: ToolConfig[] = [
  ...dataTools,
  ...profileTools,
  ...walletTools,
  ...transactionTools,
  ...categoryTools,
  ...recurringTools,
  ...yieldTools,
  ...pretiumTools,
  ...swapTools,
  ...groupTools,
  ...savingsTools,
  ...securityTools,
];
