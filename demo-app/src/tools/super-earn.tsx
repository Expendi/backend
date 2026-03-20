import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow, TokenAmount } from "./components";
import {
  TOKEN_MAP,
  parseAmountString,
  toBaseUnits,
  fromBaseUnits,
  formatNumber,
  fetchBalances,
  getUserWallet,
  getTokenBalance,
} from "./helpers";

// ── API response types ──────────────────────────────────────────────

interface PortfolioSummary {
  totalPrincipal: string;
  totalCurrentValue: string;
  totalYield: string;
  averageApy: string;
  positionCount: number;
}

interface YieldVault {
  id: string;
  name: string;
  apy: string;
  underlyingSymbol?: string;
  underlyingDecimals?: number;
  tvl?: string;
  status?: string;
}

interface YieldPosition {
  id: string;
  vaultId: string;
  vaultName?: string;
  principalAmount: string;
  currentValue?: string;
  earnedYield?: string;
  token?: string;
  status?: string;
  estimatedApy?: string;
}

// ── Earn super tool ─────────────────────────────────────────────────

export const earnTool: ToolConfig = defineTool({
  name: "earn",
  description:
    "Explore yield opportunities, deposit into vaults, or withdraw positions. Shows portfolio overview with earnings.",
  inputSchema: z.object({
    action: z
      .enum(["overview", "deposit", "withdraw"])
      .optional()
      .describe("What to do (default: overview)"),
    vaultId: z.string().optional().describe("Vault ID for deposit"),
    positionId: z.string().optional().describe("Position ID for withdraw"),
    amount: z.string().optional().describe("Amount for deposit (e.g. '100 USDC')"),
  }),
  displayPropsSchema: z.object({
    action: z.enum(["deposit", "withdraw"]),
    vaultName: z.string().optional(),
    apy: z.string().optional(),
    depositAmount: z.string().optional(),
    token: z.string().optional(),
    remainingBalance: z.string().optional(),
    principal: z.string().optional(),
    earned: z.string().optional(),
    totalWithdraw: z.string().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,

  async do(input, display) {
    const action = input.action ?? "overview";

    // ── Overview ──────────────────────────────────────────────────
    if (action === "overview") {
      let portfolio: PortfolioSummary;
      try {
        portfolio = await callApi<PortfolioSummary>("/yield/portfolio");
      } catch {
        portfolio = {
          totalPrincipal: "0",
          totalCurrentValue: "0",
          totalYield: "0",
          averageApy: "0",
          positionCount: 0,
        };
      }

      let positions: YieldPosition[];
      try {
        positions = await callApi<YieldPosition[]>("/yield/positions");
      } catch {
        positions = [];
      }

      let vaults: YieldVault[];
      try {
        vaults = await callApi<YieldVault[]>("/yield/vaults");
      } catch {
        vaults = [];
      }

      if (portfolio.positionCount === 0 && vaults.length === 0) {
        return {
          status: "success",
          data: JSON.stringify({
            portfolio,
            positions: [],
            availableVaults: [],
          }),
        };
      }

      const summary = {
        portfolio: {
          totalPrincipal: portfolio.totalPrincipal,
          totalCurrentValue: portfolio.totalCurrentValue,
          totalYield: portfolio.totalYield,
          averageApy: portfolio.averageApy,
          positionCount: portfolio.positionCount,
        },
        positions: positions.map((p) => ({
          id: p.id,
          vaultName: p.vaultName ?? p.vaultId,
          principal: p.principalAmount,
          currentValue: p.currentValue ?? p.principalAmount,
          earned: p.earnedYield ?? "0",
          status: p.status,
          apy: p.estimatedApy,
        })),
        availableVaults: vaults.map((v) => ({
          id: v.id,
          name: v.name,
          apy: v.apy,
          token: v.underlyingSymbol ?? "USDC",
          tvl: v.tvl,
        })),
      };

      return {
        status: "success",
        data: JSON.stringify(summary),
      };
    }

    // ── Deposit ──────────────────────────────────────────────────
    if (action === "deposit") {
      // If no vaultId, return available vaults asking user to pick
      if (!input.vaultId) {
        let vaults: YieldVault[];
        try {
          vaults = await callApi<YieldVault[]>("/yield/vaults");
        } catch (err) {
          return {
            status: "error",
            data: "",
            message: `Failed to fetch vaults: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        if (vaults.length === 0) {
          return {
            status: "error",
            data: "",
            message: "No vaults are available for deposit at the moment.",
          };
        }

        return {
          status: "success",
          data: JSON.stringify({
            status: "needs_input",
            message: "Which vault would you like to deposit into?",
            availableVaults: vaults.map((v) => ({
              id: v.id,
              name: v.name,
              apy: v.apy,
              token: v.underlyingSymbol ?? "USDC",
            })),
          }),
        };
      }

      // If no amount, ask for it
      if (!input.amount) {
        return {
          status: "success",
          data: JSON.stringify({
            status: "needs_input",
            message:
              "How much would you like to deposit? Please specify an amount (e.g. '100 USDC').",
          }),
        };
      }

      // Fetch vault details
      let vault: YieldVault;
      try {
        vault = await callApi<YieldVault>(`/yield/vaults/${input.vaultId}`);
      } catch (err) {
        return {
          status: "error",
          data: "",
          message: `Vault "${input.vaultId}" not found. Please check the vault ID and try again.`,
        };
      }

      const tokenSymbol = vault.underlyingSymbol ?? "USDC";
      const tokenDecimals = vault.underlyingDecimals ?? TOKEN_MAP[tokenSymbol]?.decimals ?? 6;

      // Parse deposit amount
      const parsed = parseAmountString(input.amount);
      const depositAmount = Number(parsed.amount);

      if (isNaN(depositAmount) || depositAmount <= 0) {
        return {
          status: "error",
          data: "",
          message: `Invalid deposit amount "${input.amount}". Please provide a positive number.`,
        };
      }

      // Check user balance
      let balances;
      try {
        balances = await fetchBalances();
      } catch (err) {
        return {
          status: "error",
          data: "",
          message: `Failed to fetch wallet balances: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const userWallet = getUserWallet(balances);
      if (!userWallet) {
        return {
          status: "error",
          data: "",
          message: "No user wallet found. Please complete onboarding first.",
        };
      }

      const balanceBase = getTokenBalance(userWallet, tokenSymbol);
      const balanceHuman = Number(fromBaseUnits(balanceBase, tokenDecimals));

      if (depositAmount > balanceHuman) {
        return {
          status: "error",
          data: "",
          message: `Insufficient ${tokenSymbol} balance. You have ${formatNumber(balanceHuman)} ${tokenSymbol} but need ${formatNumber(depositAmount)} ${tokenSymbol}.`,
        };
      }

      const remainingBalance = balanceHuman - depositAmount;

      // Show deposit confirmation
      const confirmed = await display.pushAndWait({
        action: "deposit" as const,
        vaultName: vault.name,
        apy: vault.apy,
        depositAmount: formatNumber(depositAmount),
        token: tokenSymbol,
        remainingBalance: formatNumber(remainingBalance),
      });

      if (!confirmed) {
        return { status: "success", data: "Deposit cancelled." };
      }

      // Execute deposit
      const baseUnits = toBaseUnits(depositAmount.toString(), tokenDecimals);
      try {
        const result = await callApi("/yield/positions", {
          method: "POST",
          body: {
            vaultId: input.vaultId,
            amount: baseUnits,
            walletType: "user",
          },
        });
        return {
          status: "success",
          data: JSON.stringify(result),
          renderData: result,
        };
      } catch (err) {
        return {
          status: "error",
          data: "",
          message: `Deposit failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // ── Withdraw ─────────────────────────────────────────────────
    if (action === "withdraw") {
      // If no positionId, return user positions asking them to pick
      if (!input.positionId) {
        let positions: YieldPosition[];
        try {
          positions = await callApi<YieldPosition[]>("/yield/positions");
        } catch (err) {
          return {
            status: "error",
            data: "",
            message: `Failed to fetch positions: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        if (positions.length === 0) {
          return {
            status: "error",
            data: "",
            message: "You have no active yield positions to withdraw from.",
          };
        }

        return {
          status: "success",
          data: JSON.stringify({
            status: "needs_input",
            message: "Which position would you like to withdraw from?",
            positions: positions.map((p) => ({
              id: p.id,
              vaultName: p.vaultName ?? p.vaultId,
              principal: p.principalAmount,
              currentValue: p.currentValue ?? p.principalAmount,
              earned: p.earnedYield ?? "0",
              status: p.status,
            })),
          }),
        };
      }

      // Fetch position details
      let position: YieldPosition;
      try {
        position = await callApi<YieldPosition>(
          `/yield/positions/${input.positionId}`
        );
      } catch {
        return {
          status: "error",
          data: "",
          message: `Position "${input.positionId}" not found. Please check the ID and try again.`,
        };
      }

      const principal = position.principalAmount ?? "0";
      const earned = position.earnedYield ?? "0";
      const currentValue = position.currentValue ?? principal;
      const token = position.token ?? "USDC";

      // Show withdrawal confirmation
      const confirmed = await display.pushAndWait({
        action: "withdraw" as const,
        vaultName: position.vaultName ?? position.vaultId,
        principal: formatNumber(Number(principal)),
        earned: formatNumber(Number(earned)),
        totalWithdraw: formatNumber(Number(currentValue)),
        token,
      });

      if (!confirmed) {
        return { status: "success", data: "Withdrawal cancelled." };
      }

      // Execute withdrawal
      try {
        const result = await callApi(
          `/yield/positions/${input.positionId}/withdraw`,
          { method: "POST" }
        );
        return {
          status: "success",
          data: JSON.stringify(result),
          renderData: result,
        };
      } catch (err) {
        return {
          status: "error",
          data: "",
          message: `Withdrawal failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    return {
      status: "error",
      data: "",
      message: `Unknown earn action "${action}". Valid actions: overview, deposit, withdraw.`,
    };
  },

  render({ props, resolve }) {
    if (props.action === "deposit") {
      return (
        <ConfirmDialog
          title="Confirm Deposit"
          onConfirm={() => resolve(true)}
          onCancel={() => resolve(false)}
        >
          <KVRow label="Vault" value={props.vaultName ?? "Unknown"} />
          <KVRow label="APY" value={props.apy ? `${props.apy}%` : "N/A"} />
          <KVRow
            label="Deposit"
            value={
              <TokenAmount
                amount={props.depositAmount ?? "0"}
                symbol={props.token}
              />
            }
          />
          <KVRow
            label="Remaining Balance"
            value={
              <TokenAmount
                amount={props.remainingBalance ?? "0"}
                symbol={props.token}
              />
            }
          />
        </ConfirmDialog>
      );
    }

    // Withdraw confirmation
    return (
      <ConfirmDialog
        title="Confirm Withdrawal"
        variant="danger"
        confirmLabel="Withdraw"
        onConfirm={() => resolve(true)}
        onCancel={() => resolve(false)}
      >
        <KVRow label="Vault" value={props.vaultName ?? "Unknown"} />
        <KVRow
          label="Principal"
          value={
            <TokenAmount
              amount={props.principal ?? "0"}
              symbol={props.token}
            />
          }
        />
        <KVRow
          label="Earned Yield"
          value={
            <TokenAmount
              amount={props.earned ?? "0"}
              symbol={props.token}
            />
          }
        />
        <KVRow
          label="Total Withdrawal"
          value={
            <TokenAmount
              amount={props.totalWithdraw ?? "0"}
              symbol={props.token}
            />
          }
        />
      </ConfirmDialog>
    );
  },
});
