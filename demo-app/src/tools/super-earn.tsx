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
      .describe(
        "What to do. 'overview' (default) shows your yield portfolio, active positions, and available vaults. " +
        "'deposit' deposits into a vault (requires vaultId and amount). " +
        "'withdraw' pulls funds from a position (requires positionId)."
      ),
    vaultId: z.string().optional().describe("The vault ID to deposit into. Required when action is 'deposit'. Get vault IDs from the 'overview' action."),
    positionId: z.string().optional().describe("The position ID to withdraw from. Required when action is 'withdraw'. Get position IDs from the 'overview' action."),
    amount: z.string().optional().describe("Human-readable amount for deposit, e.g. '100 USDC', '0.5 ETH'. Only needed for 'deposit'. Do NOT pass base units."),
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

      // Convert base-unit amounts to human-readable for the LLM
      const defaultDecimals = 6; // USDC
      const fmtBase = (val: string | undefined, decimals?: number) => {
        if (!val || val === "0") return "0";
        return formatNumber(Number(fromBaseUnits(val, decimals ?? defaultDecimals)));
      };

      const summary = {
        portfolio: {
          totalPrincipal: fmtBase(portfolio.totalPrincipal) + " USDC",
          totalCurrentValue: fmtBase(portfolio.totalCurrentValue) + " USDC",
          totalYield: fmtBase(portfolio.totalYield) + " USDC",
          averageApy: portfolio.averageApy + "%",
          positionCount: portfolio.positionCount,
        },
        positions: positions.map((p) => {
          const token = p.token ?? "USDC";
          const dec = TOKEN_MAP[token]?.decimals ?? defaultDecimals;
          return {
            id: p.id,
            vaultName: p.vaultName ?? p.vaultId,
            principal: fmtBase(p.principalAmount, dec) + ` ${token}`,
            currentValue: fmtBase(p.currentValue ?? p.principalAmount, dec) + ` ${token}`,
            earned: fmtBase(p.earnedYield ?? "0", dec) + ` ${token}`,
            status: p.status,
            apy: (p.estimatedApy ?? "0") + "%",
          };
        }),
        availableVaults: vaults.map((v) => ({
          id: v.id,
          name: v.name,
          apy: v.apy + "%",
          token: v.underlyingSymbol ?? "USDC",
          tvl: v.tvl ? fmtBase(v.tvl, TOKEN_MAP[v.underlyingSymbol ?? "USDC"]?.decimals ?? defaultDecimals) + ` ${v.underlyingSymbol ?? "USDC"}` : undefined,
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
      // Default unlock time: 30 days from now (in seconds)
      const unlockTime = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      try {
        const result = await callApi<Record<string, unknown>>("/yield/positions", {
          method: "POST",
          body: {
            vaultId: input.vaultId,
            amount: baseUnits,
            walletType: "user",
            unlockTime,
          },
        });
        return {
          status: "success",
          data: `Deposited ${formatNumber(depositAmount)} ${tokenSymbol} into ${vault.name}. Position created successfully.`,
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

      const token = position.token ?? "USDC";
      const dec = TOKEN_MAP[token]?.decimals ?? 6;
      const principalHuman = Number(fromBaseUnits(position.principalAmount ?? "0", dec));
      const earnedHuman = Number(fromBaseUnits(position.earnedYield ?? "0", dec));
      const currentHuman = Number(fromBaseUnits(position.currentValue ?? position.principalAmount ?? "0", dec));

      // Show withdrawal confirmation
      const confirmed = await display.pushAndWait({
        action: "withdraw" as const,
        vaultName: position.vaultName ?? position.vaultId,
        principal: formatNumber(principalHuman),
        earned: formatNumber(earnedHuman),
        totalWithdraw: formatNumber(currentHuman),
        token,
      });

      if (!confirmed) {
        return { status: "success", data: "Withdrawal cancelled." };
      }

      // Execute withdrawal
      try {
        const result = await callApi<Record<string, unknown>>(
          `/yield/positions/${input.positionId}/withdraw`,
          { method: "POST" }
        );
        return {
          status: "success",
          data: `Withdrew ${formatNumber(currentHuman)} ${token} (${formatNumber(principalHuman)} principal + ${formatNumber(earnedHuman)} earned).`,
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
