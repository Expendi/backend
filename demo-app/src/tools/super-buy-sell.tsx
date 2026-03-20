/**
 * Super Buy/Sell Tool — high-level intent tool for on/off-ramping crypto via mobile money.
 * Pre-fills country, currency, phone, and network from user preferences.
 */

import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow, TokenAmount } from "./components";
import {
  TOKEN_MAP,
  CURRENCY_TO_COUNTRY,
  parseAmountString,
  formatNumber,
  resolveTokenSymbol,
  fetchBalances,
  fetchPreferences,
  getUserWallet,
  getTokenBalance,
  fromBaseUnits,
} from "./helpers";

/** Set of known fiat currency codes used for amount disambiguation. */
const FIAT_CURRENCIES = new Set(Object.keys(CURRENCY_TO_COUNTRY));

/** Set of known crypto token symbols for amount disambiguation. */
const CRYPTO_SYMBOLS = new Set(Object.keys(TOKEN_MAP));

export const buySellTool: ToolConfig = defineTool({
  name: "buy_sell",
  description:
    "Buy crypto with mobile money or sell crypto to mobile money. Pre-fills your country, currency, phone, and network from preferences.",
  inputSchema: z.object({
    direction: z
      .enum(["buy", "sell"])
      .describe(
        "'buy' = fiat to crypto (onramp), 'sell' = crypto to fiat (offramp)"
      ),
    amount: z
      .string()
      .describe(
        "Amount, e.g. '10 USDC', '1000 KES', '5000'. If ambiguous, amounts >= 100 are assumed fiat."
      ),
    currency: z
      .string()
      .optional()
      .describe("Fiat currency code override (e.g. KES, NGN)"),
    phoneNumber: z
      .string()
      .optional()
      .describe("Phone number in local format (e.g. '0712345678')"),
    network: z
      .string()
      .optional()
      .describe("Mobile network override (e.g. 'Safaricom', 'MTN')"),
    paymentType: z
      .enum(["MOBILE", "BANK_TRANSFER", "BUY_GOODS", "PAYBILL"])
      .optional()
      .describe("Payment method (default: MOBILE)"),
  }),
  displayPropsSchema: z.object({
    direction: z.string(),
    cryptoAmount: z.string(),
    fiatAmount: z.string(),
    currency: z.string(),
    rate: z.string(),
    phoneNumber: z.string(),
    network: z.string(),
    country: z.string(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,

  async do(input, display) {
    try {
      // 1. Load user preferences for defaults
      const preferences = await fetchPreferences();

      // 2. Determine fiat currency
      const fiatCurrency = input.currency
        ? input.currency.toUpperCase()
        : preferences.currency
          ? preferences.currency.toUpperCase()
          : null;

      if (!fiatCurrency) {
        return {
          status: "error" as const,
          data: "",
          message:
            "I need to know your preferred fiat currency. What currency would you like to use? (e.g., KES, GHS, UGX)",
        };
      }

      // 3. Determine country from currency
      const country = CURRENCY_TO_COUNTRY[fiatCurrency];
      if (!country) {
        return {
          status: "error" as const,
          data: "",
          message: `Unsupported currency "${fiatCurrency}". Supported currencies: ${Object.keys(CURRENCY_TO_COUNTRY).join(", ")}.`,
        };
      }

      // 4. Get phone number
      const phone = input.phoneNumber ?? preferences.phoneNumber ?? null;
      if (!phone) {
        return {
          status: "error" as const,
          data: "",
          message: `I need your phone number to ${input.direction === "buy" ? "receive the deposit request" : "send the payout"} via mobile money. What is your phone number?`,
        };
      }

      // 5. Get mobile network (some endpoints accept empty string)
      const network =
        input.network ?? preferences.mobileNetwork ?? "";

      // 6. Parse amount string
      const parsed = parseAmountString(input.amount);
      const numericAmount = Number(parsed.amount);

      if (isNaN(numericAmount) || numericAmount <= 0) {
        return {
          status: "error" as const,
          data: "",
          message: `Invalid amount "${input.amount}". Please provide a positive number.`,
        };
      }

      // 7. Determine if the user specified crypto or fiat
      let cryptoAmount: number | undefined;
      let fiatAmount: number | undefined;

      if (parsed.token) {
        const resolvedToken = resolveTokenSymbol(parsed.token);

        if (CRYPTO_SYMBOLS.has(resolvedToken)) {
          // User specified a crypto token (e.g. "10 USDC")
          cryptoAmount = numericAmount;
        } else if (FIAT_CURRENCIES.has(resolvedToken)) {
          // User specified a fiat currency (e.g. "1000 KES")
          fiatAmount = numericAmount;
        } else {
          // Unknown token — assume crypto
          cryptoAmount = numericAmount;
        }
      } else {
        // No token specified — use the >= 100 heuristic
        if (numericAmount >= 100) {
          fiatAmount = numericAmount;
        } else {
          cryptoAmount = numericAmount;
        }
      }

      // 8. Fetch exchange rate
      const rateData = await callApi<{
        buyingRate: number;
        sellingRate: number;
        quotedRate: number;
      }>(`/pretium/exchange-rate/${fiatCurrency}`);

      if (!rateData || rateData.quotedRate === 0) {
        return {
          status: "error" as const,
          data: "",
          message: `Unable to fetch exchange rate for ${fiatCurrency}. Please try again in a moment.`,
        };
      }

      // Use the appropriate rate for the direction
      const rate =
        input.direction === "sell" ? rateData.sellingRate : rateData.buyingRate;

      if (rate <= 0) {
        return {
          status: "error" as const,
          data: "",
          message: `Exchange rate for ${fiatCurrency} is currently unavailable. Please try again later.`,
        };
      }

      // 9. Compute conversion
      if (cryptoAmount !== undefined) {
        fiatAmount = cryptoAmount * rate;
      } else if (fiatAmount !== undefined) {
        cryptoAmount = fiatAmount / rate;
      }

      // Safety check — both should now be defined
      if (cryptoAmount === undefined || fiatAmount === undefined) {
        return {
          status: "error" as const,
          data: "",
          message: `Could not determine conversion amounts. Please specify an amount (e.g., "10 USDC" or "1000 ${fiatCurrency}").`,
        };
      }

      // 10. If selling, check USDC balance is sufficient
      let walletId: string | undefined;

      if (input.direction === "sell") {
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

        walletId = wallet.walletId;
        const usdcBalanceBase = getTokenBalance(wallet, "USDC");
        const usdcBalance = Number(
          fromBaseUnits(usdcBalanceBase, TOKEN_MAP.USDC!.decimals)
        );

        if (cryptoAmount > usdcBalance) {
          return {
            status: "error" as const,
            data: "",
            message: `Insufficient USDC balance. You have ${formatNumber(usdcBalance)} USDC but need ${formatNumber(cryptoAmount)} USDC.`,
          };
        }
      }

      // 11. Get walletId if not already fetched (for buy direction)
      if (!walletId) {
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
        walletId = wallet.walletId;
      }

      // 12. Show confirmation and wait for user decision
      const confirmed = await display.pushAndWait({
        direction: input.direction,
        cryptoAmount: formatNumber(cryptoAmount),
        fiatAmount: formatNumber(fiatAmount),
        currency: fiatCurrency,
        rate: formatNumber(rate),
        phoneNumber: phone,
        network: network || "mobile money",
        country,
      });

      // 13. Handle cancellation
      if (!confirmed) {
        return {
          status: "success" as const,
          data: `${input.direction === "buy" ? "Buy" : "Sell"} cancelled.`,
        };
      }

      // 14–15. Execute the on/off-ramp
      let resultData: unknown;

      if (input.direction === "sell") {
        resultData = await callApi("/pretium/offramp", {
          method: "POST",
          body: {
            walletId,
            usdcAmount: cryptoAmount,
            country,
            phoneNumber: phone,
            mobileNetwork: network,
            paymentType: input.paymentType ?? "MOBILE",
          },
        });
      } else {
        resultData = await callApi("/pretium/onramp", {
          method: "POST",
          body: {
            walletId,
            fiatAmount,
            country,
            phoneNumber: phone,
            mobileNetwork: network,
            asset: "USDC",
          },
        });
      }

      // 16. Return success
      return {
        status: "success" as const,
        data: JSON.stringify(resultData),
        renderData: resultData,
      };
    } catch (err) {
      return {
        status: "error" as const,
        data: "",
        message:
          err instanceof Error
            ? err.message
            : `Failed to ${input.direction} crypto: ${String(err)}`,
      };
    }
  },

  render({ props, resolve }) {
    const isSell = props.direction === "sell";
    const conversionDisplay = isSell
      ? `${props.cryptoAmount} USDC -> ${props.fiatAmount} ${props.currency}`
      : `${props.fiatAmount} ${props.currency} -> ${props.cryptoAmount} USDC`;

    return (
      <ConfirmDialog
        title={`Confirm ${isSell ? "Sell" : "Buy"}`}
        confirmLabel={isSell ? "Sell" : "Buy"}
        onConfirm={() => resolve(true)}
        onCancel={() => resolve(false)}
      >
        <KVRow
          label="Conversion"
          value={
            isSell ? (
              <span>
                <TokenAmount amount={props.cryptoAmount} symbol="USDC" />
                <span style={{ color: "var(--text-muted)", margin: "0 6px" }}>
                  &rarr;
                </span>
                <TokenAmount
                  amount={props.fiatAmount}
                  symbol={props.currency}
                />
              </span>
            ) : (
              <span>
                <TokenAmount
                  amount={props.fiatAmount}
                  symbol={props.currency}
                />
                <span style={{ color: "var(--text-muted)", margin: "0 6px" }}>
                  &rarr;
                </span>
                <TokenAmount amount={props.cryptoAmount} symbol="USDC" />
              </span>
            )
          }
        />
        <KVRow
          label="Rate"
          value={`${props.rate} ${props.currency}/USDC`}
          mono
        />
        <KVRow label="Phone" value={props.phoneNumber} mono />
        <KVRow label="Network" value={props.network} />
        <KVRow label="Country" value={props.country} />
      </ConfirmDialog>
    );
  },
});
