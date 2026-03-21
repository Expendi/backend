import type { ToolConfig } from "glove-react";
import { utilityTools } from "./data";
import { profileTools } from "./profile";
import { sendTool } from "./super-send";
import { buySellTool } from "./super-buy-sell";
import { swapTool } from "./super-swap";
import { earnTool } from "./super-earn";
import { manageTool } from "./super-manage";
import { researchTool } from "./research";

export { setApiFetcher, setApprovalHandler } from "./api";

export const allTools: ToolConfig[] = [
  // ── Super tools (5) — high-level intent dispatchers ──
  sendTool,
  buySellTool,
  swapTool,
  earnTool,
  manageTool,
  // ── Research tool — market analysis ──
  researchTool,
  // ── Utility tools — read-only info queries ──
  ...utilityTools,
  ...profileTools,
];
