import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow, TokenAmount } from "./components";
import {
  TOKEN_MAP,
  resolveTokenSymbol,
  parseAmountString,
  toBaseUnits,
  fromBaseUnits,
  formatNumber,
  exceedsBalance,
  fetchBalances,
  getUserWallet,
  getTokenBalance,
} from "./helpers";

// ── Quote response shape from /uniswap/quote ────────────────────────

interface QuoteResponse {
  quote: {
    input: { amount: string; token: string };
    output: { amount: string; token: string };
    gasFeeUSD?: string;
    priceImpact?: string;
  };
  routing?: string;
}

// ── Swap super tool ─────────────────────────────────────────────────

export const swapTool: ToolConfig = defineTool({
  name: "swap",
  description:
    "Swap tokens on Uniswap. Gets a quote with price impact and gas estimate, shows confirmation, then executes.",
  inputSchema: z.object({
    from: z.string().describe("Token to sell (e.g. 'USDC', 'ETH', 'WETH')"),
    to: z.string().describe("Token to buy (e.g. 'ETH', 'USDC')"),
    amount: z.string().describe("Amount to swap (e.g. '10', '0.5', 'all')"),
    slippage: z.number().optional().describe("Slippage tolerance % (default: 0.5)"),
  }),
  displayPropsSchema: z.object({
    fromToken: z.string(),
    toToken: z.string(),
    amountIn: z.string(),
    amountOut: z.string(),
    rate: z.string(),
    priceImpact: z.string(),
    gasEstimate: z.string(),
    slippage: z.number(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,

  async do(input, display) {
    const slippage = input.slippage ?? 0.5;

    // 1. Resolve and validate token symbols
    const fromSymbol = resolveTokenSymbol(input.from);
    const toSymbol = resolveTokenSymbol(input.to);

    if (!TOKEN_MAP[fromSymbol]) {
      return {
        status: "error",
        data: "",
        message: `Unsupported source token "${input.from}". Supported tokens: ${Object.keys(TOKEN_MAP).join(", ")}.`,
      };
    }

    if (!TOKEN_MAP[toSymbol]) {
      return {
        status: "error",
        data: "",
        message: `Unsupported destination token "${input.to}". Supported tokens: ${Object.keys(TOKEN_MAP).join(", ")}.`,
      };
    }

    // Also block ETH↔WETH swaps (they map to the same Uniswap address)
    if (fromSymbol === toSymbol) {
      return {
        status: "error",
        data: "",
        message: `Cannot swap ${fromSymbol} to itself. Please choose different tokens.`,
      };
    }
    const ethWethPair =
      (fromSymbol === "ETH" && toSymbol === "WETH") ||
      (fromSymbol === "WETH" && toSymbol === "ETH");
    if (ethWethPair) {
      return {
        status: "error",
        data: "",
        message: `ETH and WETH are equivalent on Uniswap. No swap needed — you can wrap/unwrap directly.`,
      };
    }

    const fromTokenInfo = TOKEN_MAP[fromSymbol]!;
    const toTokenInfo = TOKEN_MAP[toSymbol]!;

    // 2. Parse amount and cap slippage
    if (slippage > 50) {
      return {
        status: "error",
        data: "",
        message: `Slippage tolerance of ${slippage}% is too high. Maximum allowed is 50%.`,
      };
    }

    const parsed = parseAmountString(input.amount);
    const isAll = parsed.amount === "all";
    const parsedNumber = isAll ? 0 : Number(parsed.amount);

    if (!isAll && (isNaN(parsedNumber) || parsedNumber <= 0)) {
      return {
        status: "error",
        data: "",
        message: `Invalid amount "${input.amount}". Please provide a positive number or "all".`,
      };
    }

    // 3. Fetch balances and get user wallet
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

    // 4. Get token balance — use BigInt for comparison, Number only for display
    const balanceBase = getTokenBalance(userWallet, fromSymbol);
    const balanceHumanStr = fromBaseUnits(balanceBase, fromTokenInfo.decimals);
    const balanceDisplay = Number(balanceHumanStr);

    // 5. Determine actual swap amount (string-based)
    let amountStr: string;
    if (isAll) {
      if (BigInt(balanceBase) <= 0n) {
        return {
          status: "error",
          data: "",
          message: `You have no ${fromSymbol} to swap.`,
        };
      }
      amountStr = balanceHumanStr;
    } else {
      amountStr = parsed.amount;
    }

    if (exceedsBalance(amountStr, balanceBase, fromTokenInfo.decimals)) {
      const amountDisplay = Number(amountStr);
      return {
        status: "error",
        data: "",
        message: `Insufficient ${fromSymbol} balance. You have ${formatNumber(balanceDisplay)} ${fromSymbol} but need ${formatNumber(amountDisplay)} ${fromSymbol}.`,
      };
    }

    // 6. Convert to base units
    const amountInBase = toBaseUnits(amountStr, fromTokenInfo.decimals);

    // 7. Map ETH to WETH address for Uniswap
    const fromAddress = fromSymbol === "ETH" ? TOKEN_MAP["WETH"]!.address : fromTokenInfo.address;
    const toAddress = toSymbol === "ETH" ? TOKEN_MAP["WETH"]!.address : toTokenInfo.address;

    // 8. Get quote from Uniswap (backend needs walletId, not walletType)
    const walletId = userWallet.walletId;
    let quote: QuoteResponse;
    try {
      quote = await callApi<QuoteResponse>("/uniswap/quote", {
        method: "POST",
        body: {
          tokenIn: fromAddress,
          tokenOut: toAddress,
          amount: amountInBase,
          walletId,
        },
      });
    } catch (err) {
      return {
        status: "error",
        data: "",
        message: `Failed to get swap quote: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 9. Parse quote results
    const expectedOutBase = quote.quote.output.amount;
    const expectedOutHuman = Number(fromBaseUnits(expectedOutBase, toTokenInfo.decimals));

    const priceImpact = quote.quote.priceImpact ?? "0";
    const gasEstimate = quote.quote.gasFeeUSD
      ? `$${Number(quote.quote.gasFeeUSD).toFixed(2)}`
      : "unknown";

    // 10. Compute rate display (Number is fine here — display only)
    const actualAmountDisplay = Number(amountStr);
    let rateDisplay: string;
    const stablecoins = ["USDC", "USDbC"];
    if (stablecoins.includes(fromSymbol)) {
      const price = actualAmountDisplay / expectedOutHuman;
      rateDisplay = `1 ${toSymbol} = ${formatNumber(price)} ${fromSymbol}`;
    } else if (stablecoins.includes(toSymbol)) {
      const price = expectedOutHuman / actualAmountDisplay;
      rateDisplay = `1 ${fromSymbol} = ${formatNumber(price)} ${toSymbol}`;
    } else {
      const ratio = expectedOutHuman / actualAmountDisplay;
      rateDisplay = `1 ${fromSymbol} = ${formatNumber(ratio)} ${toSymbol}`;
    }

    // 11. Show confirmation dialog
    const confirmed = await display.pushAndWait({
      fromToken: fromSymbol,
      toToken: toSymbol,
      amountIn: formatNumber(actualAmountDisplay),
      amountOut: formatNumber(expectedOutHuman),
      rate: rateDisplay,
      priceImpact: `${priceImpact}%`,
      gasEstimate,
      slippage,
    });

    if (!confirmed) {
      return { status: "success", data: "Swap cancelled." };
    }

    // 12. Execute the swap
    try {
      const result = await callApi("/uniswap/swap", {
        method: "POST",
        body: {
          tokenIn: fromAddress,
          tokenOut: toAddress,
          amount: amountInBase,
          slippageTolerance: slippage,
          walletId,
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
        message: `Swap execution failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  render({ props, resolve }) {
    return (
      <ConfirmDialog
        title="Confirm Swap"
        onConfirm={() => resolve(true)}
        onCancel={() => resolve(false)}
      >
        <KVRow
          label="You send"
          value={
            <TokenAmount amount={props.amountIn} symbol={props.fromToken} />
          }
        />
        <KVRow
          label="You receive"
          value={
            <TokenAmount amount={props.amountOut} symbol={props.toToken} />
          }
        />
        <KVRow label="Rate" value={props.rate} />
        <KVRow label="Price Impact" value={props.priceImpact} />
        <KVRow label="Gas Estimate" value={props.gasEstimate} mono />
        <KVRow label="Slippage" value={`${props.slippage}%`} />
      </ConfirmDialog>
    );
  },
});
