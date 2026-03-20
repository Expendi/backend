/**
 * Super Send Tool — high-level intent tool that replaces granular transfer tools.
 * Resolves recipients, checks balances, shows confirmation, and executes transfers.
 */

import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow, TokenAmount, Address } from "./components";
import {
  TOKEN_MAP,
  parseAmountString,
  toBaseUnits,
  fromBaseUnits,
  formatNumber,
  safeNumberToString,
  exceedsBalance,
  resolveRecipient,
  fetchBalances,
  getUserWallet,
  getTokenBalance,
  resolveTokenSymbol,
} from "./helpers";

export const sendTool: ToolConfig = defineTool({
  name: "send",
  description:
    "Send tokens to anyone — address, username, or saved contact. Resolves recipients, checks your balance, and shows a confirmation before executing.",
  inputSchema: z.object({
    to: z
      .string()
      .describe(
        "Recipient: wallet address (0x...), username, or contact label"
      ),
    amount: z
      .string()
      .describe("Amount with optional token, e.g. '10 USDC', '0.5 ETH', 'all'"),
    token: z
      .string()
      .optional()
      .describe("Token symbol if not in amount (default: USDC)"),
  }),
  displayPropsSchema: z.object({
    recipientLabel: z.string(),
    recipientAddress: z.string(),
    amount: z.string(),
    token: z.string(),
    remainingBalance: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,

  async do(input, display) {
    try {
      // 1. Resolve recipient
      const { address: recipientAddress, label: recipientLabel } =
        await resolveRecipient(input.to);

      // 2. Parse amount string
      const parsed = parseAmountString(input.amount);

      // 3. Determine token: explicit override > parsed from amount string > default USDC
      const tokenSymbol = input.token
        ? resolveTokenSymbol(input.token)
        : parsed.token
          ? resolveTokenSymbol(parsed.token)
          : "USDC";

      // 4. Validate token exists
      const tokenInfo = TOKEN_MAP[tokenSymbol];
      if (!tokenInfo) {
        return {
          status: "error" as const,
          data: "",
          message: `Unsupported token "${tokenSymbol}". Supported tokens: ${Object.keys(TOKEN_MAP).join(", ")}.`,
        };
      }

      // 5. Fetch balances and get user wallet
      const balances = await fetchBalances();
      const wallet = getUserWallet(balances);
      if (!wallet) {
        return {
          status: "error" as const,
          data: "",
          message:
            "No wallet found for your account. Please complete onboarding first.",
        };
      }

      // 6. Get token balance in base units
      const balanceBase = getTokenBalance(wallet, tokenSymbol);
      const balanceHuman = fromBaseUnits(balanceBase, tokenInfo.decimals);
      const balanceDisplay = Number(balanceHuman); // Only for display, not comparison

      // 7. Handle "all" amount — use string-based amounts, BigInt for comparison
      //    For native ETH, reserve ~0.0005 ETH for gas to avoid draining the wallet
      const ETH_GAS_RESERVE = "500000000000000"; // 0.0005 ETH in wei
      let sendAmountStr: string; // human-readable decimal string
      if (parsed.amount === "all") {
        if (BigInt(balanceBase) <= 0n) {
          return {
            status: "error" as const,
            data: "",
            message: `You have no ${tokenSymbol} to send.`,
          };
        }
        if (tokenSymbol === "ETH") {
          const reserved = BigInt(balanceBase) - BigInt(ETH_GAS_RESERVE);
          if (reserved <= 0n) {
            return {
              status: "error" as const,
              data: "",
              message: `Your ETH balance (${formatNumber(balanceDisplay)} ETH) is too low to send — you need to keep some for gas fees.`,
            };
          }
          sendAmountStr = fromBaseUnits(reserved.toString(), tokenInfo.decimals);
        } else {
          sendAmountStr = balanceHuman;
        }
      } else {
        const parsedNum = Number(parsed.amount);
        if (isNaN(parsedNum) || parsedNum <= 0) {
          return {
            status: "error" as const,
            data: "",
            message: `Invalid amount "${parsed.amount}". Please provide a positive number.`,
          };
        }
        sendAmountStr = parsed.amount;
      }

      // 8. Validate sufficient balance using BigInt
      if (exceedsBalance(sendAmountStr, balanceBase, tokenInfo.decimals)) {
        const sendDisplay = Number(sendAmountStr);
        return {
          status: "error" as const,
          data: "",
          message: `Insufficient balance. You have ${formatNumber(balanceDisplay)} ${tokenSymbol} but need ${formatNumber(sendDisplay)} ${tokenSymbol}.`,
        };
      }

      // 9. Compute remaining balance for display
      const sendDisplay = Number(sendAmountStr);
      const remainingBalance = balanceDisplay - sendDisplay;

      // 10. Show confirmation and wait for user decision
      const confirmed = await display.pushAndWait({
        recipientLabel,
        recipientAddress,
        amount: formatNumber(sendDisplay),
        token: tokenSymbol,
        remainingBalance: formatNumber(remainingBalance),
      });

      // 11. Handle cancellation
      if (!confirmed) {
        return { status: "success" as const, data: "Send cancelled." };
      }

      // 12. Convert amount to base units for the transaction
      const baseUnits = toBaseUnits(sendAmountStr, tokenInfo.decimals);

      // Lowercase the address to avoid EIP-55 checksum issues with viem
      const normalizedAddress = recipientAddress.toLowerCase();

      // 13–14. Execute the transfer
      let txData: unknown;

      if (tokenSymbol === "ETH") {
        // Native ETH transfer via raw transaction
        txData = await callApi("/transactions/raw", {
          method: "POST",
          body: {
            walletType: "user",
            to: normalizedAddress,
            value: baseUnits,
          },
        });
      } else {
        // ERC-20 transfer via contract call
        // contractName must match the connector name in the registry (lowercase token symbol)
        txData = await callApi("/transactions/contract", {
          method: "POST",
          body: {
            walletType: "user",
            contractName: tokenSymbol.toLowerCase(),
            method: "send",
            args: [normalizedAddress, baseUnits],
          },
        });
      }

      // 15. Return success
      return {
        status: "success" as const,
        data: JSON.stringify(txData),
        renderData: txData,
      };
    } catch (err) {
      return {
        status: "error" as const,
        data: "",
        message:
          err instanceof Error
            ? err.message
            : `Failed to send tokens: ${String(err)}`,
      };
    }
  },

  render({ props, resolve }) {
    return (
      <ConfirmDialog
        title="Confirm Send"
        confirmLabel="Send"
        onConfirm={() => resolve(true)}
        onCancel={() => resolve(false)}
      >
        <KVRow label="To" value={props.recipientLabel} />
        <KVRow
          label="Address"
          value={<Address value={props.recipientAddress} />}
        />
        <KVRow
          label="Amount"
          value={<TokenAmount amount={props.amount} symbol={props.token} />}
        />
        <KVRow
          label="Remaining"
          value={
            <TokenAmount amount={props.remainingBalance} symbol={props.token} />
          }
        />
      </ConfirmDialog>
    );
  },
});
