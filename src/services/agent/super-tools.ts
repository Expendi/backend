import { Effect } from "effect";
import { createPublicClient, http, formatUnits, parseUnits, type Address } from "viem";
import { base } from "viem/chains";
import { eq, and } from "drizzle-orm";
import type { AgentProfileData } from "../../db/schema/index.js";
import { wallets } from "../../db/schema/index.js";
import { DatabaseService } from "../../db/client.js";
import { ConfigService } from "../../config.js";
import { OnboardingService } from "../onboarding/onboarding-service.js";
import { ContractExecutor } from "../contract/contract-executor.js";
import { UniswapService, type QuoteResponse } from "../uniswap/uniswap-service.js";
import {
  ExchangeRateService,
  type ExchangeRateData,
} from "../pretium/exchange-rate-service.js";
import {
  SUPPORTED_COUNTRIES,
  type SupportedCountry,
} from "../pretium/pretium-service.js";
import {
  YieldService,
  type PortfolioSummary,
} from "../yield/yield-service.js";
import { RecurringPaymentService } from "../recurring-payment/recurring-payment-service.js";
import { GoalSavingsService } from "../goal-savings/goal-savings-service.js";
import { GroupAccountService } from "../group-account/group-account-service.js";

// ── Token map for Base chain ─────────────────────────────────────────

const TOKEN_MAP: Record<string, { address: string; decimals: number }> = {
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  ETH: { address: "0x0000000000000000000000000000000000000000", decimals: 18 },
  DAI: { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
  USDbC: { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6Da", decimals: 6 },
  cbETH: { address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18 },
};

// ── Reverse lookup: currency code to country code ────────────────────

const CURRENCY_TO_COUNTRY: Record<string, SupportedCountry> = {};
for (const [countryCode, info] of Object.entries(SUPPORTED_COUNTRIES)) {
  CURRENCY_TO_COUNTRY[info.currency] = countryCode as SupportedCountry;
}

// ── Types ────────────────────────────────────────────────────────────

export interface SuperToolContext {
  userId: string;
  profile?: AgentProfileData;
}

export interface SuperToolResult {
  status: "success" | "error" | "needs_confirmation" | "needs_input";
  data?: unknown;
  message: string;
  confirmationId?: string;
}

export interface SuperToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (
    input: Record<string, unknown>,
    ctx: SuperToolContext
  ) => Effect.Effect<SuperToolResult, never, any>;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Resolve a token symbol string to its uppercase canonical form.
 * Accepts mixed-case input like "usdc", "Eth", etc.
 */
function resolveTokenSymbol(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (upper === "ETHEREUM") return "ETH";
  if (upper === "WRAPPED ETH" || upper === "WRAPPED ETHER") return "WETH";
  return upper;
}

/**
 * Parse an amount string that may contain a token symbol, e.g. "10 USDC", "0.5 ETH", "all".
 * Returns the numeric amount as a string and the token symbol if present.
 */
function parseAmountString(raw: string): { amount: string; token?: string } {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === "all") {
    return { amount: "all" };
  }

  // Match patterns like "10 USDC", "0.5ETH", "$100"
  const match = trimmed.match(
    /^\$?([\d,]+(?:\.\d+)?)\s*([a-zA-Z]+)?$/
  );
  if (match) {
    const amount = match[1]!.replace(/,/g, "");
    const token = match[2] ? resolveTokenSymbol(match[2]) : undefined;
    return { amount, token };
  }

  // If it's just a number
  const numMatch = trimmed.match(/^[\d,]+(?:\.\d+)?$/);
  if (numMatch) {
    return { amount: trimmed.replace(/,/g, "") };
  }

  return { amount: trimmed };
}

/**
 * Format a number with appropriate decimal places and thousands separators.
 */
function formatNumber(value: number, maxDecimals: number = 6): string {
  if (value === 0) return "0";

  // For very small numbers, show more decimals
  if (value < 0.001 && value > 0) {
    return value.toFixed(maxDecimals);
  }

  // For larger numbers, limit to 2-4 decimals
  const decimals = value >= 1 ? 2 : 4;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Get the user's primary wallet address (the "user" type wallet).
 */
function getUserWalletAddress(
  userId: string
): Effect.Effect<string, never, DatabaseService> {
  return Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    const userWallets = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(wallets)
          .where(and(eq(wallets.ownerId, userId), eq(wallets.type, "user"))),
      catch: () => new Error("Failed to fetch user wallets"),
    }).pipe(Effect.catchAll(() => Effect.succeed([] as Array<{ address: string | null }>)));

    const wallet = userWallets.find(
      (w) => w.address !== null && w.address !== ""
    );
    return wallet?.address ?? "";
  });
}

/**
 * Fetch the ETH balance for a given address on Base.
 */
function getEthBalance(address: string): Effect.Effect<bigint, never, never> {
  return Effect.tryPromise({
    try: () => {
      const client = createPublicClient({ chain: base, transport: http() });
      return client.getBalance({ address: address as Address });
    },
    catch: () => new Error("Failed to fetch ETH balance"),
  }).pipe(Effect.catchAll(() => Effect.succeed(0n)));
}

/**
 * Fetch an ERC-20 token balance using the contract executor.
 */
function getTokenBalance(
  address: string,
  contractName: string,
  chainId: number
): Effect.Effect<string, never, ContractExecutor> {
  return Effect.gen(function* () {
    const executor = yield* ContractExecutor;
    const balance = yield* executor
      .readContract(contractName, chainId, "balance", [address])
      .pipe(
        Effect.map((b) => String(b)),
        Effect.catchAll(() => Effect.succeed("0"))
      );
    return balance;
  });
}

// ── Send Tool ────────────────────────────────────────────────────────

const sendTool: SuperToolDefinition = {
  name: "send",
  description:
    "Send tokens to another user or address. Handles recipient resolution, balance checks, and execution.",
  parameters: {
    type: "object",
    properties: {
      to: {
        type: "string",
        description:
          "Recipient address, username, or label (e.g., 'mom', 'alice', '0x...')",
      },
      amount: {
        type: "string",
        description: "Amount to send (e.g., '10 USDC', '0.5 ETH', 'all')",
      },
      token: {
        type: "string",
        description: "Token symbol (defaults to USDC)",
      },
      note: {
        type: "string",
        description: "Optional note for the transfer",
      },
    },
    required: ["to", "amount"],
  },
  handler: (input, ctx) =>
    Effect.gen(function* () {
      const toRaw = String(input.to ?? "");
      const amountRaw = String(input.amount ?? "");
      const tokenOverride = input.token
        ? resolveTokenSymbol(String(input.token))
        : undefined;
      const note = input.note ? String(input.note) : undefined;

      if (!toRaw) {
        return {
          status: "error" as const,
          message: "Recipient is required. Please provide an address, username, or contact label.",
        };
      }

      if (!amountRaw) {
        return {
          status: "error" as const,
          message: "Amount is required. Please specify how much to send (e.g., '10 USDC').",
        };
      }

      // 1. Resolve recipient
      let resolvedAddress = "";
      let resolvedLabel = toRaw;

      if (toRaw.startsWith("0x") && toRaw.length === 42) {
        // Direct address
        resolvedAddress = toRaw;
        resolvedLabel = `${toRaw.slice(0, 6)}...${toRaw.slice(-4)}`;
      } else {
        // Check profile frequent recipients first
        const frequentRecipients = ctx.profile?.patterns?.frequentRecipients ?? [];
        const matchedRecipient = frequentRecipients.find(
          (r) => r.label.toLowerCase() === toRaw.toLowerCase()
        );

        if (matchedRecipient) {
          resolvedAddress = matchedRecipient.address;
          resolvedLabel = matchedRecipient.label;
        } else {
          // Try username resolution
          const onboarding = yield* OnboardingService;
          const resolved = yield* onboarding
            .resolveUsername(toRaw)
            .pipe(
              Effect.map((r) => ({
                address: r.address,
                found: true,
              })),
              Effect.catchAll(() =>
                Effect.succeed({ address: "", found: false })
              )
            );

          if (resolved.found && resolved.address) {
            resolvedAddress = resolved.address;
            resolvedLabel = `@${toRaw}`;
          } else {
            return {
              status: "error" as const,
              message: `Could not resolve recipient "${toRaw}". Please provide a valid Ethereum address (0x...) or a registered username.`,
            };
          }
        }
      }

      // 2. Parse token and amount
      const parsed = parseAmountString(amountRaw);
      const tokenSymbol = tokenOverride ?? parsed.token ?? "USDC";
      const tokenInfo = TOKEN_MAP[tokenSymbol];

      if (!tokenInfo) {
        return {
          status: "error" as const,
          message: `Unsupported token "${tokenSymbol}". Supported tokens: ${Object.keys(TOKEN_MAP).join(", ")}.`,
        };
      }

      // 3. Get user wallet address
      const userAddress = yield* getUserWalletAddress(ctx.userId);
      if (!userAddress) {
        return {
          status: "error" as const,
          message: "No wallet found for your account. Please complete onboarding first.",
        };
      }

      // 4. Fetch balance
      const config = yield* ConfigService;
      const chainId = config.defaultChainId;
      let balanceRaw: string;

      if (tokenSymbol === "ETH") {
        const ethBal = yield* getEthBalance(userAddress);
        balanceRaw = ethBal.toString();
      } else {
        // Use contract executor for ERC-20 balances
        balanceRaw = yield* getTokenBalance(
          userAddress,
          tokenSymbol.toLowerCase(),
          chainId
        );
      }

      const balanceHuman = Number(
        formatUnits(BigInt(balanceRaw), tokenInfo.decimals)
      );

      // 5. Determine send amount
      let sendAmount: number;
      if (parsed.amount === "all") {
        sendAmount = balanceHuman;
        if (sendAmount <= 0) {
          return {
            status: "error" as const,
            message: `You have no ${tokenSymbol} to send.`,
          };
        }
      } else {
        sendAmount = Number(parsed.amount);
        if (isNaN(sendAmount) || sendAmount <= 0) {
          return {
            status: "error" as const,
            message: `Invalid amount "${parsed.amount}". Please provide a positive number.`,
          };
        }
      }

      // 6. Check sufficiency
      if (sendAmount > balanceHuman) {
        return {
          status: "error" as const,
          message: `Insufficient balance. You have ${formatNumber(balanceHuman)} ${tokenSymbol} but need ${formatNumber(sendAmount)} ${tokenSymbol}.`,
        };
      }

      const remainingBalance = balanceHuman - sendAmount;

      // 7. Return confirmation payload
      return {
        status: "needs_confirmation" as const,
        message: `Send ${formatNumber(sendAmount)} ${tokenSymbol} to ${resolvedLabel} (${resolvedAddress.slice(0, 6)}...${resolvedAddress.slice(-4)})? This will leave you with ${formatNumber(remainingBalance)} ${tokenSymbol}.`,
        data: {
          to: resolvedLabel,
          amount: sendAmount.toString(),
          token: tokenSymbol,
          resolvedAddress,
          remainingBalance: remainingBalance.toString(),
          ...(note ? { note } : {}),
        },
      };
    }).pipe(
      Effect.catchAll((err: unknown) =>
        Effect.succeed({
          status: "error" as const,
          message: `Failed to prepare send transaction: ${err instanceof Error ? err.message : String(err)}`,
        })
      )
    ),
};

// ── Buy/Sell Tool ────────────────────────────────────────────────────

const buySellTool: SuperToolDefinition = {
  name: "buy_sell",
  description:
    "Buy crypto (onramp) or sell crypto (offramp) using mobile money. Pre-fills from user profile.",
  parameters: {
    type: "object",
    properties: {
      direction: {
        type: "string",
        enum: ["buy", "sell"],
        description: "Buy (fiat to crypto) or sell (crypto to fiat)",
      },
      amount: {
        type: "string",
        description:
          "Amount (e.g., '10 USDC', '1000 KES', '5000')",
      },
      currency: {
        type: "string",
        description:
          "Fiat currency override (uses profile default if not set)",
      },
      phoneNumber: {
        type: "string",
        description:
          "Phone number override (uses profile default if not set)",
      },
      network: {
        type: "string",
        description:
          "Mobile network override (uses profile default if not set)",
      },
    },
    required: ["direction"],
  },
  handler: (input, ctx) =>
    Effect.gen(function* () {
      const direction = String(input.direction ?? "");
      if (direction !== "buy" && direction !== "sell") {
        return {
          status: "error" as const,
          message:
            'Invalid direction. Please specify "buy" (fiat to crypto) or "sell" (crypto to fiat).',
        };
      }

      // 1. Load preferences from profile
      const profileCurrency = ctx.profile?.currency;
      const profileCountry = ctx.profile?.country;
      const fiatCurrency = input.currency
        ? String(input.currency).toUpperCase()
        : profileCurrency?.toUpperCase();

      if (!fiatCurrency) {
        return {
          status: "needs_input" as const,
          message:
            "I need to know your preferred fiat currency. What currency would you like to use? (e.g., KES, GHS, UGX)",
        };
      }

      // Determine country from currency or profile
      let country: SupportedCountry | undefined;
      if (CURRENCY_TO_COUNTRY[fiatCurrency]) {
        country = CURRENCY_TO_COUNTRY[fiatCurrency];
      } else if (profileCountry) {
        const upper = profileCountry.toUpperCase() as SupportedCountry;
        if (upper in SUPPORTED_COUNTRIES) {
          country = upper;
        }
      }

      if (!country) {
        return {
          status: "error" as const,
          message: `Unsupported currency "${fiatCurrency}". Supported currencies: ${Object.values(SUPPORTED_COUNTRIES).map((c) => c.currency).join(", ")}.`,
        };
      }

      const countryInfo = SUPPORTED_COUNTRIES[country];

      // Phone number and network
      const phone = input.phoneNumber
        ? String(input.phoneNumber)
        : undefined;
      const network = input.network
        ? String(input.network).toLowerCase()
        : undefined;

      if (!phone) {
        return {
          status: "needs_input" as const,
          message: `I need your phone number to ${direction === "buy" ? "receive the deposit request" : "send the payout"} via mobile money. What is your phone number?`,
        };
      }

      // 2. Parse amount
      let cryptoAmount: number | undefined;
      let fiatAmount: number | undefined;

      if (input.amount) {
        const parsed = parseAmountString(String(input.amount));
        const numericAmount = Number(parsed.amount);

        if (isNaN(numericAmount) || numericAmount <= 0) {
          return {
            status: "error" as const,
            message: `Invalid amount "${input.amount}". Please provide a positive number.`,
          };
        }

        // Determine if amount is in crypto or fiat
        if (parsed.token && parsed.token === fiatCurrency) {
          fiatAmount = numericAmount;
        } else if (
          parsed.token &&
          (parsed.token === "USDC" || parsed.token === "USDT")
        ) {
          cryptoAmount = numericAmount;
        } else if (!parsed.token) {
          // Ambiguous: if number >= 100, likely fiat; otherwise treat as USDC
          if (numericAmount >= 100) {
            fiatAmount = numericAmount;
          } else {
            cryptoAmount = numericAmount;
          }
        } else {
          cryptoAmount = numericAmount;
        }
      }

      if (cryptoAmount === undefined && fiatAmount === undefined) {
        return {
          status: "needs_input" as const,
          message: `How much would you like to ${direction}? You can specify in USDC (e.g., "10 USDC") or ${fiatCurrency} (e.g., "1000 ${fiatCurrency}").`,
        };
      }

      // 3. Fetch exchange rate
      const exchangeRateService = yield* ExchangeRateService;
      const rateData: ExchangeRateData = yield* exchangeRateService
        .getExchangeRate(fiatCurrency)
        .pipe(
          Effect.catchAll(() =>
            Effect.succeed({
              buyingRate: 0,
              sellingRate: 0,
              quotedRate: 0,
            } as ExchangeRateData)
          )
        );

      if (rateData.quotedRate === 0) {
        return {
          status: "error" as const,
          message: `Unable to fetch exchange rate for ${fiatCurrency}. Please try again in a moment.`,
        };
      }

      // Compute conversion
      const rate =
        direction === "sell" ? rateData.sellingRate : rateData.buyingRate;

      if (cryptoAmount !== undefined) {
        fiatAmount = cryptoAmount * rate;
      } else if (fiatAmount !== undefined) {
        cryptoAmount = fiatAmount / rate;
      }

      // 4. If selling, check USDC balance
      if (direction === "sell") {
        const userAddress = yield* getUserWalletAddress(ctx.userId);
        if (!userAddress) {
          return {
            status: "error" as const,
            message:
              "No wallet found for your account. Please complete onboarding first.",
          };
        }

        const config = yield* ConfigService;
        const usdcBalanceRaw = yield* getTokenBalance(
          userAddress,
          "usdc",
          config.defaultChainId
        );
        const usdcBalance = Number(formatUnits(BigInt(usdcBalanceRaw), 6));

        if (cryptoAmount! > usdcBalance) {
          return {
            status: "error" as const,
            message: `Insufficient USDC balance. You have ${formatNumber(usdcBalance)} USDC but need ${formatNumber(cryptoAmount!)} USDC.`,
          };
        }
      }

      // 5. Determine network name for display
      let networkDisplay = network ?? "mobile money";
      if (country === "KE" && !network) {
        networkDisplay = "M-Pesa";
      }

      const directionLabel = direction === "sell" ? "Sell" : "Buy";
      const conversionArrow =
        direction === "sell"
          ? `${formatNumber(cryptoAmount!)} USDC \u2192 ${formatNumber(fiatAmount!)} ${fiatCurrency}`
          : `${formatNumber(fiatAmount!)} ${fiatCurrency} \u2192 ${formatNumber(cryptoAmount!)} USDC`;

      return {
        status: "needs_confirmation" as const,
        message: `${directionLabel} ${conversionArrow} at rate ${formatNumber(rate)} ${fiatCurrency}/USDC. ${direction === "sell" ? "Sent" : "Paid"} via ${networkDisplay} to ${phone}.`,
        data: {
          direction,
          cryptoAmount: cryptoAmount!.toString(),
          fiatAmount: fiatAmount!.toString(),
          rate: rate.toString(),
          phone,
          network: network ?? null,
          country,
          currency: fiatCurrency,
        },
      };
    }).pipe(
      Effect.catchAll((err: unknown) =>
        Effect.succeed({
          status: "error" as const,
          message: `Failed to prepare ${input.direction ?? "buy/sell"} transaction: ${err instanceof Error ? err.message : String(err)}`,
        })
      )
    ),
};

// ── Swap Tool ────────────────────────────────────────────────────────

const swapTool: SuperToolDefinition = {
  name: "swap",
  description:
    "Swap tokens on Uniswap. Gets quotes, handles approvals, shows preview.",
  parameters: {
    type: "object",
    properties: {
      from: {
        type: "string",
        description: "Token to sell (e.g., 'USDC', 'ETH')",
      },
      to: {
        type: "string",
        description: "Token to buy (e.g., 'ETH', 'USDC')",
      },
      amount: {
        type: "string",
        description:
          "Amount to swap (human-readable, e.g., '10 USDC')",
      },
      slippage: {
        type: "number",
        description: "Slippage tolerance percentage (default 0.5)",
      },
    },
    required: ["from", "to", "amount"],
  },
  handler: (input, ctx) =>
    Effect.gen(function* () {
      const fromRaw = resolveTokenSymbol(String(input.from ?? ""));
      const toRaw = resolveTokenSymbol(String(input.to ?? ""));
      const amountRaw = String(input.amount ?? "");
      const slippage =
        typeof input.slippage === "number" ? input.slippage : 0.5;

      if (!fromRaw || !TOKEN_MAP[fromRaw]) {
        return {
          status: "error" as const,
          message: `Unsupported source token "${input.from}". Supported tokens: ${Object.keys(TOKEN_MAP).join(", ")}.`,
        };
      }

      if (!toRaw || !TOKEN_MAP[toRaw]) {
        return {
          status: "error" as const,
          message: `Unsupported destination token "${input.to}". Supported tokens: ${Object.keys(TOKEN_MAP).join(", ")}.`,
        };
      }

      if (fromRaw === toRaw) {
        return {
          status: "error" as const,
          message: `Cannot swap ${fromRaw} to itself. Please choose different tokens.`,
        };
      }

      const fromToken = TOKEN_MAP[fromRaw]!;
      const toToken = TOKEN_MAP[toRaw]!;

      // Parse amount
      const parsed = parseAmountString(amountRaw);
      const sendAmount = Number(parsed.amount);

      if (parsed.amount === "all") {
        // For "all", we need to check balance first
      } else if (isNaN(sendAmount) || sendAmount <= 0) {
        return {
          status: "error" as const,
          message: `Invalid amount "${amountRaw}". Please provide a positive number.`,
        };
      }

      // Get user wallet address
      const userAddress = yield* getUserWalletAddress(ctx.userId);
      if (!userAddress) {
        return {
          status: "error" as const,
          message:
            "No wallet found for your account. Please complete onboarding first.",
        };
      }

      // Fetch balance of source token
      const config = yield* ConfigService;
      const chainId = config.defaultChainId;
      let sourceBalanceRaw: string;

      if (fromRaw === "ETH") {
        const ethBal = yield* getEthBalance(userAddress);
        sourceBalanceRaw = ethBal.toString();
      } else {
        sourceBalanceRaw = yield* getTokenBalance(
          userAddress,
          fromRaw.toLowerCase(),
          chainId
        );
      }

      const sourceBalanceHuman = Number(
        formatUnits(BigInt(sourceBalanceRaw), fromToken.decimals)
      );

      // Determine actual amount
      let actualAmount: number;
      if (parsed.amount === "all") {
        actualAmount = sourceBalanceHuman;
        if (actualAmount <= 0) {
          return {
            status: "error" as const,
            message: `You have no ${fromRaw} to swap.`,
          };
        }
      } else {
        actualAmount = sendAmount;
      }

      // Check sufficiency
      if (actualAmount > sourceBalanceHuman) {
        return {
          status: "error" as const,
          message: `Insufficient ${fromRaw} balance. You have ${formatNumber(sourceBalanceHuman)} ${fromRaw} but need ${formatNumber(actualAmount)} ${fromRaw}.`,
        };
      }

      // Convert to raw amount for the quote
      const amountInRaw = parseUnits(
        actualAmount.toString(),
        fromToken.decimals
      ).toString();

      // For ETH, the Uniswap API uses WETH
      const tokenInAddress =
        fromRaw === "ETH" ? TOKEN_MAP["WETH"]!.address : fromToken.address;
      const tokenOutAddress =
        toRaw === "ETH" ? TOKEN_MAP["WETH"]!.address : toToken.address;

      // Get quote from Uniswap
      const uniswap = yield* UniswapService;
      const quoteResult: QuoteResponse = yield* uniswap
        .getQuote({
          swapper: userAddress,
          tokenIn: tokenInAddress,
          tokenOut: tokenOutAddress,
          amount: amountInRaw,
          type: "EXACT_INPUT",
          slippageTolerance: slippage,
          chainId: 8453, // Base chain
        })
        .pipe(
          Effect.catchAll((err) =>
            Effect.fail(
              new Error(
                `Failed to get swap quote: ${err.message}`
              )
            )
          )
        );

      // Parse quote output
      const expectedOutRaw = quoteResult.quote.output.amount;
      const expectedOutHuman = Number(
        formatUnits(BigInt(expectedOutRaw), toToken.decimals)
      );

      // Compute effective rate
      let rateDisplay: string;
      if (fromRaw === "USDC" || fromRaw === "USDbC" || fromRaw === "DAI") {
        // Price of output token in stablecoin terms
        const price = actualAmount / expectedOutHuman;
        rateDisplay = `1 ${toRaw} = ${formatNumber(price)} ${fromRaw}`;
      } else if (
        toRaw === "USDC" ||
        toRaw === "USDbC" ||
        toRaw === "DAI"
      ) {
        const price = expectedOutHuman / actualAmount;
        rateDisplay = `1 ${fromRaw} = ${formatNumber(price)} ${toRaw}`;
      } else {
        const ratio = expectedOutHuman / actualAmount;
        rateDisplay = `1 ${fromRaw} = ${formatNumber(ratio)} ${toRaw}`;
      }

      const gasFeeUsd = quoteResult.quote.gasFeeUSD
        ? `$${Number(quoteResult.quote.gasFeeUSD).toFixed(2)}`
        : "unknown";

      return {
        status: "needs_confirmation" as const,
        message: `Swap ${formatNumber(actualAmount)} ${fromRaw} \u2192 ~${formatNumber(expectedOutHuman)} ${toRaw}. Rate: ${rateDisplay}. Slippage: ${slippage}%. Gas estimate: ~${gasFeeUsd}.`,
        data: {
          from: fromRaw,
          to: toRaw,
          amountIn: actualAmount.toString(),
          expectedOut: expectedOutHuman.toString(),
          rate: rateDisplay,
          slippage,
          quoteData: {
            routing: quoteResult.routing,
            input: quoteResult.quote.input,
            output: quoteResult.quote.output,
            gasFeeUSD: quoteResult.quote.gasFeeUSD,
          },
        },
      };
    }).pipe(
      Effect.catchAll((err: unknown) =>
        Effect.succeed({
          status: "error" as const,
          message: `Failed to prepare swap: ${err instanceof Error ? err.message : String(err)}`,
        })
      )
    ),
};

// ── Earn Tool ────────────────────────────────────────────────────────

const earnTool: SuperToolDefinition = {
  name: "earn",
  description:
    "View yield opportunities, deposit into vaults, or withdraw. Shows portfolio overview.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["overview", "deposit", "withdraw"],
        description: "What to do (default: overview)",
      },
      vaultId: {
        type: "string",
        description: "Vault ID for deposit",
      },
      positionId: {
        type: "string",
        description: "Position ID for withdraw",
      },
      amount: {
        type: "string",
        description: "Amount for deposit/withdraw",
      },
    },
  },
  handler: (input, ctx) =>
    Effect.gen(function* () {
      const action = String(input.action ?? "overview");
      const yieldService = yield* YieldService;

      if (action === "overview" || action === "") {
        // Fetch portfolio summary
        const portfolio: PortfolioSummary = yield* yieldService
          .getPortfolioSummary(ctx.userId)
          .pipe(
            Effect.catchAll(() =>
              Effect.succeed({
                totalPrincipal: "0",
                totalCurrentValue: "0",
                totalYield: "0",
                averageApy: "0",
                positionCount: 0,
              } as PortfolioSummary)
            )
          );

        // Fetch active positions
        const positions = yield* yieldService
          .getUserPositions(ctx.userId)
          .pipe(Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<unknown>)));

        // Fetch available vaults
        const vaults = yield* yieldService
          .listVaults()
          .pipe(Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<unknown>)));

        if (
          portfolio.positionCount === 0 &&
          (vaults as ReadonlyArray<unknown>).length === 0
        ) {
          return {
            status: "success" as const,
            message:
              "You have no active yield positions and there are no vaults available at the moment.",
            data: {
              portfolio,
              positions: [],
              availableVaults: [],
            },
          };
        }

        const totalPrincipal = Number(portfolio.totalPrincipal);
        const totalValue = Number(portfolio.totalCurrentValue);
        const totalYield = Number(portfolio.totalYield);
        const avgApy = Number(portfolio.averageApy);

        let summary = "";
        if (portfolio.positionCount > 0) {
          summary = `You have ${portfolio.positionCount} active position${portfolio.positionCount > 1 ? "s" : ""}. Total deposited: ${formatNumber(totalPrincipal)} USDC. Current value: ${formatNumber(totalValue)} USDC. Earned: ${formatNumber(totalYield)} USDC. Average APY: ${formatNumber(avgApy)}%.`;
        } else {
          summary = "You have no active yield positions.";
        }

        if ((vaults as ReadonlyArray<unknown>).length > 0) {
          summary += ` There ${(vaults as ReadonlyArray<unknown>).length === 1 ? "is" : "are"} ${(vaults as ReadonlyArray<unknown>).length} vault${(vaults as ReadonlyArray<unknown>).length > 1 ? "s" : ""} available for deposit.`;
        }

        return {
          status: "success" as const,
          message: summary,
          data: {
            portfolio,
            positions,
            availableVaults: vaults,
          },
        };
      }

      if (action === "deposit") {
        const vaultId = input.vaultId ? String(input.vaultId) : undefined;
        const amountRaw = input.amount ? String(input.amount) : undefined;

        if (!vaultId) {
          // List available vaults for the user to choose
          const vaults = yield* yieldService
            .listVaults()
            .pipe(
              Effect.catchAll(() =>
                Effect.succeed([] as ReadonlyArray<unknown>)
              )
            );

          if ((vaults as ReadonlyArray<unknown>).length === 0) {
            return {
              status: "error" as const,
              message:
                "No vaults are available for deposit at the moment.",
            };
          }

          return {
            status: "needs_input" as const,
            message:
              "Which vault would you like to deposit into? Here are the available options:",
            data: { availableVaults: vaults },
          };
        }

        if (!amountRaw) {
          return {
            status: "needs_input" as const,
            message:
              "How much would you like to deposit? Please specify an amount (e.g., '100 USDC').",
          };
        }

        // Fetch vault details
        const vault = yield* yieldService
          .getVault(vaultId)
          .pipe(
            Effect.catchAll(() => Effect.succeed(undefined))
          );

        if (!vault) {
          return {
            status: "error" as const,
            message: `Vault "${vaultId}" not found. Please check the vault ID and try again.`,
          };
        }

        // Parse amount
        const parsed = parseAmountString(amountRaw);
        const depositAmount = Number(parsed.amount);

        if (isNaN(depositAmount) || depositAmount <= 0) {
          return {
            status: "error" as const,
            message: `Invalid deposit amount "${amountRaw}". Please provide a positive number.`,
          };
        }

        // Check balance
        const userAddress = yield* getUserWalletAddress(ctx.userId);
        if (!userAddress) {
          return {
            status: "error" as const,
            message:
              "No wallet found for your account. Please complete onboarding first.",
          };
        }

        const config = yield* ConfigService;
        const tokenSymbol = vault.underlyingSymbol ?? "USDC";
        const tokenDecimals = vault.underlyingDecimals ?? 6;

        let balanceRaw: string;
        if (tokenSymbol.toUpperCase() === "ETH") {
          const ethBal = yield* getEthBalance(userAddress);
          balanceRaw = ethBal.toString();
        } else {
          balanceRaw = yield* getTokenBalance(
            userAddress,
            tokenSymbol.toLowerCase(),
            config.defaultChainId
          );
        }

        const balanceHuman = Number(
          formatUnits(BigInt(balanceRaw), tokenDecimals)
        );

        if (depositAmount > balanceHuman) {
          return {
            status: "error" as const,
            message: `Insufficient ${tokenSymbol} balance. You have ${formatNumber(balanceHuman)} ${tokenSymbol} but need ${formatNumber(depositAmount)} ${tokenSymbol}.`,
          };
        }

        return {
          status: "needs_confirmation" as const,
          message: `Deposit ${formatNumber(depositAmount)} ${tokenSymbol} into ${vault.name}? Your remaining balance will be ${formatNumber(balanceHuman - depositAmount)} ${tokenSymbol}.`,
          data: {
            action: "deposit",
            vaultId: vault.id,
            vaultName: vault.name,
            amount: depositAmount.toString(),
            token: tokenSymbol,
            remainingBalance: (balanceHuman - depositAmount).toString(),
          },
        };
      }

      if (action === "withdraw") {
        const positionId = input.positionId
          ? String(input.positionId)
          : undefined;

        if (!positionId) {
          // List user positions
          const positions = yield* yieldService
            .getUserPositions(ctx.userId)
            .pipe(
              Effect.catchAll(() =>
                Effect.succeed([] as ReadonlyArray<unknown>)
              )
            );

          if ((positions as ReadonlyArray<unknown>).length === 0) {
            return {
              status: "error" as const,
              message:
                "You have no active yield positions to withdraw from.",
            };
          }

          return {
            status: "needs_input" as const,
            message:
              "Which position would you like to withdraw from? Here are your active positions:",
            data: { positions },
          };
        }

        // Fetch position + accrued yield
        const position = yield* yieldService
          .getPosition(positionId)
          .pipe(
            Effect.catchAll(() => Effect.succeed(undefined))
          );

        if (!position) {
          return {
            status: "error" as const,
            message: `Position "${positionId}" not found. Please check the ID and try again.`,
          };
        }

        const yieldInfo = yield* yieldService
          .getAccruedYield(positionId)
          .pipe(
            Effect.catchAll(() =>
              Effect.succeed({
                positionId,
                principalAmount: position.principalAmount ?? "0",
                currentAssets: position.principalAmount ?? "0",
                accruedYield: "0",
                estimatedApy: "0",
              })
            )
          );

        const principal = Number(yieldInfo.principalAmount);
        const currentAssets = Number(yieldInfo.currentAssets);
        const accruedYield = Number(yieldInfo.accruedYield);
        const apy = Number(yieldInfo.estimatedApy);

        return {
          status: "needs_confirmation" as const,
          message: `Withdraw from position? Principal: ${formatNumber(principal)} USDC. Current value: ${formatNumber(currentAssets)} USDC. Earned yield: ${formatNumber(accruedYield)} USDC (${formatNumber(apy)}% APY). You will receive ${formatNumber(currentAssets)} USDC.`,
          data: {
            action: "withdraw",
            positionId,
            principalAmount: yieldInfo.principalAmount,
            currentAssets: yieldInfo.currentAssets,
            accruedYield: yieldInfo.accruedYield,
            estimatedApy: yieldInfo.estimatedApy,
          },
        };
      }

      return {
        status: "error" as const,
        message: `Unknown earn action "${action}". Valid actions: overview, deposit, withdraw.`,
      };
    }).pipe(
      Effect.catchAll((err: unknown) =>
        Effect.succeed({
          status: "error" as const,
          message: `Failed to process earn request: ${err instanceof Error ? err.message : String(err)}`,
        })
      )
    ),
};

// ── Manage Tool ──────────────────────────────────────────────────────

const manageTool: SuperToolDefinition = {
  name: "manage",
  description:
    "Manage recurring payments, savings goals, categories, groups, and security settings.",
  parameters: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        enum: [
          "recurring",
          "goals",
          "categories",
          "groups",
          "settings",
          "security",
        ],
        description: "What to manage",
      },
      action: {
        type: "string",
        enum: [
          "list",
          "create",
          "update",
          "pause",
          "resume",
          "cancel",
          "delete",
        ],
        description: "Action to take (default: list)",
      },
      id: {
        type: "string",
        description: "ID of the item to act on",
      },
      params: {
        type: "object",
        description: "Domain-specific parameters",
      },
    },
    required: ["domain"],
  },
  handler: (input, ctx) =>
    Effect.gen(function* () {
      const domain = String(input.domain ?? "");
      const action = String(input.action ?? "list");
      const id = input.id ? String(input.id) : undefined;
      const params = (input.params as Record<string, unknown>) ?? {};

      // ── Recurring Payments ───────────────────────────────────────

      if (domain === "recurring") {
        const recurringService = yield* RecurringPaymentService;

        if (action === "list") {
          const schedules = yield* recurringService
            .listSchedulesByUser(ctx.userId)
            .pipe(
              Effect.catchAll(() =>
                Effect.succeed([] as ReadonlyArray<unknown>)
              )
            );

          if ((schedules as ReadonlyArray<unknown>).length === 0) {
            return {
              status: "success" as const,
              message:
                "You have no recurring payments set up.",
              data: { schedules: [] },
            };
          }

          return {
            status: "success" as const,
            message: `You have ${(schedules as ReadonlyArray<unknown>).length} recurring payment${(schedules as ReadonlyArray<unknown>).length > 1 ? "s" : ""}.`,
            data: { schedules },
          };
        }

        if (action === "pause") {
          if (!id) {
            return {
              status: "needs_input" as const,
              message:
                "Which recurring payment would you like to pause? Please provide the payment ID.",
            };
          }
          const paused = yield* recurringService.pauseSchedule(id).pipe(
            Effect.catchAll((err) =>
              Effect.fail(new Error(`Failed to pause: ${err.message}`))
            )
          );
          return {
            status: "success" as const,
            message: `Recurring payment "${paused.name ?? id}" has been paused.`,
            data: { schedule: paused },
          };
        }

        if (action === "resume") {
          if (!id) {
            return {
              status: "needs_input" as const,
              message:
                "Which recurring payment would you like to resume? Please provide the payment ID.",
            };
          }
          const resumed = yield* recurringService.resumeSchedule(id).pipe(
            Effect.catchAll((err) =>
              Effect.fail(new Error(`Failed to resume: ${err.message}`))
            )
          );
          return {
            status: "success" as const,
            message: `Recurring payment "${resumed.name ?? id}" has been resumed.`,
            data: { schedule: resumed },
          };
        }

        if (action === "cancel") {
          if (!id) {
            return {
              status: "needs_input" as const,
              message:
                "Which recurring payment would you like to cancel? Please provide the payment ID.",
            };
          }
          const cancelled = yield* recurringService
            .cancelSchedule(id)
            .pipe(
              Effect.catchAll((err) =>
                Effect.fail(
                  new Error(`Failed to cancel: ${err.message}`)
                )
              )
            );
          return {
            status: "success" as const,
            message: `Recurring payment "${cancelled.name ?? id}" has been cancelled.`,
            data: { schedule: cancelled },
          };
        }

        if (action === "update") {
          if (!id) {
            return {
              status: "needs_input" as const,
              message:
                "Which recurring payment would you like to update? Please provide the payment ID.",
            };
          }
          const updateParams: Record<string, unknown> = {};
          if (params.name !== undefined) updateParams.name = String(params.name);
          if (params.amount !== undefined) updateParams.amount = String(params.amount);
          if (params.frequency !== undefined) updateParams.frequency = String(params.frequency);
          if (params.recipientAddress !== undefined)
            updateParams.recipientAddress = String(params.recipientAddress);
          if (params.categoryId !== undefined)
            updateParams.categoryId = String(params.categoryId);

          if (Object.keys(updateParams).length === 0) {
            return {
              status: "needs_input" as const,
              message:
                "What would you like to change? You can update the name, amount, frequency, recipient, or category.",
            };
          }

          const updated = yield* recurringService
            .updateSchedule(id, updateParams as any)
            .pipe(
              Effect.catchAll((err) =>
                Effect.fail(
                  new Error(`Failed to update: ${err.message}`)
                )
              )
            );
          return {
            status: "success" as const,
            message: `Recurring payment "${updated.name ?? id}" has been updated.`,
            data: { schedule: updated },
          };
        }

        if (action === "create") {
          return {
            status: "needs_confirmation" as const,
            message:
              "To create a recurring payment, I need the following details: recipient, amount, token, frequency (e.g., daily, weekly, monthly), and an optional name.",
            data: { action: "create", domain: "recurring", params },
          };
        }

        return {
          status: "error" as const,
          message: `Unsupported action "${action}" for recurring payments. Valid actions: list, create, update, pause, resume, cancel.`,
        };
      }

      // ── Goals ────────────────────────────────────────────────────

      if (domain === "goals") {
        const goalService = yield* GoalSavingsService;

        if (action === "list") {
          const goals = yield* goalService
            .listGoals(ctx.userId)
            .pipe(
              Effect.catchAll(() =>
                Effect.succeed([] as ReadonlyArray<unknown>)
              )
            );

          if ((goals as ReadonlyArray<unknown>).length === 0) {
            return {
              status: "success" as const,
              message:
                "You have no savings goals set up. Would you like to create one?",
              data: { goals: [] },
            };
          }

          return {
            status: "success" as const,
            message: `You have ${(goals as ReadonlyArray<unknown>).length} savings goal${(goals as ReadonlyArray<unknown>).length > 1 ? "s" : ""}.`,
            data: { goals },
          };
        }

        if (action === "pause") {
          if (!id) {
            return {
              status: "needs_input" as const,
              message:
                "Which savings goal would you like to pause? Please provide the goal ID.",
            };
          }
          const paused = yield* goalService.pauseGoal(id).pipe(
            Effect.catchAll((err) =>
              Effect.fail(new Error(`Failed to pause goal: ${err.message}`))
            )
          );
          return {
            status: "success" as const,
            message: `Savings goal "${paused.name}" has been paused.`,
            data: { goal: paused },
          };
        }

        if (action === "resume") {
          if (!id) {
            return {
              status: "needs_input" as const,
              message:
                "Which savings goal would you like to resume? Please provide the goal ID.",
            };
          }
          const resumed = yield* goalService.resumeGoal(id).pipe(
            Effect.catchAll((err) =>
              Effect.fail(new Error(`Failed to resume goal: ${err.message}`))
            )
          );
          return {
            status: "success" as const,
            message: `Savings goal "${resumed.name}" has been resumed.`,
            data: { goal: resumed },
          };
        }

        if (action === "cancel") {
          if (!id) {
            return {
              status: "needs_input" as const,
              message:
                "Which savings goal would you like to cancel? Please provide the goal ID.",
            };
          }
          const cancelled = yield* goalService.cancelGoal(id).pipe(
            Effect.catchAll((err) =>
              Effect.fail(
                new Error(`Failed to cancel goal: ${err.message}`)
              )
            )
          );
          return {
            status: "success" as const,
            message: `Savings goal "${cancelled.name}" has been cancelled.`,
            data: { goal: cancelled },
          };
        }

        if (action === "update") {
          if (!id) {
            return {
              status: "needs_input" as const,
              message:
                "Which savings goal would you like to update? Please provide the goal ID.",
            };
          }
          const updateParams: Record<string, unknown> = {};
          if (params.name !== undefined) updateParams.name = String(params.name);
          if (params.description !== undefined)
            updateParams.description = String(params.description);
          if (params.depositAmount !== undefined)
            updateParams.depositAmount = String(params.depositAmount);
          if (params.frequency !== undefined)
            updateParams.frequency = String(params.frequency);

          if (Object.keys(updateParams).length === 0) {
            return {
              status: "needs_input" as const,
              message:
                "What would you like to change? You can update the name, description, deposit amount, or frequency.",
            };
          }

          const updated = yield* goalService
            .updateGoal(id, updateParams as any)
            .pipe(
              Effect.catchAll((err) =>
                Effect.fail(
                  new Error(`Failed to update goal: ${err.message}`)
                )
              )
            );
          return {
            status: "success" as const,
            message: `Savings goal "${updated.name}" has been updated.`,
            data: { goal: updated },
          };
        }

        if (action === "create") {
          return {
            status: "needs_confirmation" as const,
            message:
              "To create a savings goal, I need: a name, target amount, and optionally a recurring deposit amount and frequency.",
            data: { action: "create", domain: "goals", params },
          };
        }

        return {
          status: "error" as const,
          message: `Unsupported action "${action}" for savings goals. Valid actions: list, create, update, pause, resume, cancel.`,
        };
      }

      // ── Groups ───────────────────────────────────────────────────

      if (domain === "groups") {
        const groupService = yield* GroupAccountService;

        if (action === "list") {
          const groups = yield* groupService
            .getMyGroups(ctx.userId)
            .pipe(
              Effect.catchAll(() =>
                Effect.succeed([] as Array<unknown>)
              )
            );

          if (groups.length === 0) {
            return {
              status: "success" as const,
              message:
                "You are not a member of any group accounts. Would you like to create one?",
              data: { groups: [] },
            };
          }

          return {
            status: "success" as const,
            message: `You are a member of ${groups.length} group account${groups.length > 1 ? "s" : ""}.`,
            data: { groups },
          };
        }

        if (action === "create") {
          const name = params.name ? String(params.name) : undefined;
          const members = params.members as string[] | undefined;

          if (!name) {
            return {
              status: "needs_input" as const,
              message:
                "What should the group be called? Please provide a name for the group account.",
            };
          }

          if (!members || members.length === 0) {
            return {
              status: "needs_input" as const,
              message:
                "Who should be in this group? Please provide a list of usernames or addresses to add as members.",
            };
          }

          return {
            status: "needs_confirmation" as const,
            message: `Create group "${name}" with ${members.length} member${members.length > 1 ? "s" : ""}: ${members.join(", ")}?`,
            data: {
              action: "create",
              domain: "groups",
              name,
              description: params.description
                ? String(params.description)
                : undefined,
              members,
            },
          };
        }

        if (action === "delete" || action === "cancel") {
          return {
            status: "error" as const,
            message:
              "Group accounts cannot be deleted directly. Please contact support if you need to close a group account.",
          };
        }

        return {
          status: "error" as const,
          message: `Unsupported action "${action}" for groups. Valid actions: list, create.`,
        };
      }

      // ── Categories ───────────────────────────────────────────────

      if (domain === "categories") {
        return {
          status: "success" as const,
          message:
            "Transaction categories can be managed through the wallet interface. You can assign categories when sending or reviewing transactions.",
          data: { domain: "categories" },
        };
      }

      // ── Settings ─────────────────────────────────────────────────

      if (domain === "settings") {
        const profile = ctx.profile ?? {};
        return {
          status: "success" as const,
          message: `Current settings: Country: ${profile.country ?? "not set"}, Currency: ${profile.currency ?? "not set"}, Communication style: ${profile.communicationStyle ?? "default"}, Knowledge level: ${profile.knowledgeLevel ?? "not set"}.`,
          data: {
            domain: "settings",
            currentSettings: {
              country: profile.country,
              currency: profile.currency,
              communicationStyle: profile.communicationStyle,
              knowledgeLevel: profile.knowledgeLevel,
              riskTolerance: profile.riskTolerance,
              onboardingComplete: profile.onboardingComplete,
            },
          },
        };
      }

      // ── Security ─────────────────────────────────────────────────

      if (domain === "security") {
        return {
          status: "success" as const,
          message:
            "Security settings are managed through the wallet interface for safety. You can update your PIN, manage passkeys, and review connected sessions from the Security section in Settings.",
          data: { domain: "security" },
        };
      }

      return {
        status: "error" as const,
        message: `Unknown management domain "${domain}". Valid domains: recurring, goals, categories, groups, settings, security.`,
      };
    }).pipe(
      Effect.catchAll((err: unknown) =>
        Effect.succeed({
          status: "error" as const,
          message: `Failed to process management request: ${err instanceof Error ? err.message : String(err)}`,
        })
      )
    ),
};

// ── Export ────────────────────────────────────────────────────────────

/**
 * Returns all super tool definitions that can be registered as
 * server-side tools for the AI agent.
 */
export function getSuperTools(): SuperToolDefinition[] {
  return [sendTool, buySellTool, swapTool, earnTool, manageTool];
}
