import { Hono } from "hono";
import { Effect } from "effect";
import { eq, and, desc } from "drizzle-orm";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { PretiumService, SETTLEMENT_ADDRESS } from "../services/pretium/pretium-service.js";
import { ExchangeRateService } from "../services/pretium/exchange-rate-service.js";
import { TransactionService } from "../services/transaction/transaction-service.js";
import { ConfigService } from "../config.js";
import { DatabaseService } from "../db/client.js";
import { pretiumTransactions, wallets, userProfiles } from "../db/schema/index.js";
import type { UserPreferences } from "../db/schema/user-profiles.js";
import type { AuthVariables } from "../middleware/auth.js";
import type {
  SupportedCountry,
  FiatPaymentType,
  BankTransferCountry,
  OnrampSupportedCountry,
  OnrampAsset,
} from "../services/pretium/pretium-service.js";
import { getFiatDisbursementFee, getAllFiatFeeTiers } from "../services/pretium/fee-tiers.js";
import {
  ONRAMP_SUPPORTED_COUNTRIES,
  ONRAMP_SUPPORTED_ASSETS,
} from "../services/pretium/pretium-service.js";
import type { PretiumTransaction } from "../db/schema/pretium-transactions.js";

// ── Helper: format offramp response with separate feeFiatAmount ──────

/**
 * Ensures `fiatAmount` is the net amount (excluding fee) and adds
 * `feeFiatAmount` as a separate field.
 *
 * Three categories of records exist:
 *
 * 1. **Post-PR** (feeFiatAmount column populated): both `fiatAmount`
 *    (net) and `feeFiatAmount` are authoritative — use directly.
 *
 * 2. **Post-EXP-60, pre-PR** (feeFiatAmount is null, fee is in fiat):
 *    `fee` is already a fiat amount (from the tiered fee schedule) and
 *    `fiatAmount` is net.  Fiat fees from the tier table are always ≥ 1,
 *    while legacy USDC fees are fractional (< 1), so `fee >= 1` reliably
 *    distinguishes this category.
 *
 * 3. **Pre-EXP-60 legacy** (feeFiatAmount is null, fee is USDC):
 *    `fee` is in USDC (always < 1) and `fiatAmount` is the gross amount
 *    including the fee.  Derive fiat fee via `fee × exchangeRate`.
 */
const formatOfframpResponse = (record: PretiumTransaction) => {
  const fee = Number(record.fee ?? 0);
  const exchangeRate = Number(record.exchangeRate);

  let feeFiat: number;
  let netFiat: number;

  if (record.feeFiatAmount != null) {
    // Category 1: new record – both fields are authoritative
    feeFiat = Number(record.feeFiatAmount);
    netFiat = Number(record.fiatAmount);
  } else if (fee >= 1) {
    // Category 2: post-EXP-60 – fee is already in fiat, fiatAmount is net
    feeFiat = fee;
    netFiat = Number(record.fiatAmount);
  } else {
    // Category 3: pre-EXP-60 legacy – fee is USDC, fiatAmount is gross
    feeFiat = Math.round(fee * exchangeRate * 100) / 100;
    netFiat = Math.round((Number(record.fiatAmount) - feeFiat) * 100) / 100;
  }

  return {
    ...record,
    fiatAmount: netFiat.toFixed(2),
    feeFiatAmount: feeFiat.toFixed(2),
  };
};

// ── Helper: persist phone number & network to user preferences ───────

const savePhoneToPreferences = (
  db: Parameters<typeof eq>[0] extends never ? never : any,
  userId: string,
  phoneNumber: string,
  mobileNetwork: string,
  country: string
) =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({ preferences: userProfiles.preferences })
        .from(userProfiles)
        .where(eq(userProfiles.privyUserId, userId))
        .limit(1);
      const existing = (rows[0]?.preferences ?? {}) as UserPreferences;
      if (
        existing.phoneNumber === phoneNumber &&
        existing.mobileNetwork === mobileNetwork &&
        existing.country === country
      ) {
        return; // already up to date
      }
      await db
        .update(userProfiles)
        .set({
          preferences: {
            ...existing,
            phoneNumber,
            mobileNetwork,
            country,
          },
          updatedAt: new Date(),
        })
        .where(eq(userProfiles.privyUserId, userId));
    },
    catch: () => {
      /* best-effort — don't fail the transaction */
    },
  });

// ── Public Pretium routes (behind Privy auth) ────────────────────────

export function createPretiumRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // ── Country & Payment Info ─────────────────────────────────────────

  /** List all supported countries with currency and payment configs */
  app.get("/countries", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const pretium = yield* PretiumService;
        const countries = pretium.getSupportedCountries();
        const result = Object.entries(countries).map(([code, config]) => ({
          code,
          ...config,
          paymentConfig: pretium.getCountryPaymentConfig(code),
        }));
        return result;
      }),
      c
    )
  );

  /** Get payment config for a specific country */
  app.get("/countries/:code", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const code = c.req.param("code").toUpperCase();
        const pretium = yield* PretiumService;

        if (!pretium.isCountrySupported(code)) {
          return yield* Effect.fail(
            new Error(`Country ${code} is not supported`)
          );
        }

        const countries = pretium.getSupportedCountries();
        const countryInfo = countries[code as SupportedCountry];
        const paymentConfig = pretium.getCountryPaymentConfig(code);

        return { code, ...countryInfo, paymentConfig };
      }),
      c
    )
  );

  // ── Exchange Rates ─────────────────────────────────────────────────

  /** Get exchange rate for a currency */
  app.get("/exchange-rate/:currency", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const currency = c.req.param("currency").toUpperCase();
        const exchangeRateService = yield* ExchangeRateService;
        return yield* exchangeRateService.getExchangeRate(currency);
      }),
      c
    )
  );

  /** Convert USDC to fiat */
  app.post("/convert/usdc-to-fiat", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{ usdcAmount: number; currency: string }>(),
          catch: () => new Error("Invalid request body"),
        });
        const exchangeRateService = yield* ExchangeRateService;
        return yield* exchangeRateService.convertUsdcToFiat(
          body.usdcAmount,
          body.currency
        );
      }),
      c
    )
  );

  /** Convert fiat to USDC */
  app.post("/convert/fiat-to-usdc", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{ fiatAmount: number; currency: string }>(),
          catch: () => new Error("Invalid request body"),
        });
        const exchangeRateService = yield* ExchangeRateService;
        return yield* exchangeRateService.convertFiatToUsdc(
          body.fiatAmount,
          body.currency
        );
      }),
      c
    )
  );

  // ── Validation ─────────────────────────────────────────────────────

  /** Validate a mobile phone number with MNO (name lookup) */
  app.post("/validate/phone", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              country: string;
              phoneNumber: string;
              network: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });
        const pretium = yield* PretiumService;
        return yield* pretium.validatePhoneWithMno(
          body.country as SupportedCountry,
          body.phoneNumber,
          body.network
        );
      }),
      c
    )
  );

  /** Validate a bank account number (name lookup) */
  app.post("/validate/bank-account", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              country: string;
              accountNumber: string;
              bankCode: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });
        const pretium = yield* PretiumService;
        return yield* pretium.validateBankAccount(
          body.country as SupportedCountry,
          body.accountNumber,
          body.bankCode
        );
      }),
      c
    )
  );

  // ── Banks ──────────────────────────────────────────────────────────

  /** Get list of supported banks for a country */
  app.get("/banks/:country", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const country = c.req.param("country").toUpperCase();
        const pretium = yield* PretiumService;

        const bankCountries = ["NG", "KE"];
        if (!bankCountries.includes(country)) {
          return yield* Effect.fail(
            new Error(
              `Bank list not available for ${country}. Supported: ${bankCountries.join(", ")}`
            )
          );
        }

        return yield* pretium.getBanksForCountry(
          country as BankTransferCountry
        );
      }),
      c
    )
  );

  // ── Settlement ─────────────────────────────────────────────────────

  /** Get the USDC settlement address */
  app.get("/settlement-address", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const pretium = yield* PretiumService;
        return { address: pretium.getSettlementAddress(), chain: "BASE" };
      }),
      c
    )
  );

  // ── Offramp ────────────────────────────────────────────────────────

  /** Initiate an offramp: transfer USDC to settlement, then disburse fiat */
  app.post("/offramp", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              country: string;
              walletId: string;
              usdcAmount: number;
              phoneNumber: string;
              mobileNetwork: string;
              paymentType?: string;
              accountNumber?: string;
              accountName?: string;
              bankAccount?: string;
              bankCode?: string;
              bankName?: string;
              callbackUrl?: string;
              categoryId?: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const pretium = yield* PretiumService;
        const exchangeRateService = yield* ExchangeRateService;
        const txService = yield* TransactionService;
        const config = yield* ConfigService;
        const { db } = yield* DatabaseService;

        // Validate country
        if (!pretium.isCountrySupported(body.country)) {
          return yield* Effect.fail(
            new Error(`Country ${body.country} is not supported`)
          );
        }

        const country = body.country as SupportedCountry;
        const countries = pretium.getSupportedCountries();
        const countryConfig = countries[country];

        // Resolve wallet type from walletId
        const [walletRecord] = yield* Effect.tryPromise({
          try: () =>
            db.select().from(wallets).where(eq(wallets.id, body.walletId)),
          catch: (error) => new Error(`Failed to resolve wallet: ${error}`),
        });

        if (!walletRecord) {
          return yield* Effect.fail(
            new Error(`Wallet not found: ${body.walletId}`)
          );
        }
        
        // Transfer USDC to Pretium settlement address via the usdc connector
        // body.usdcAmount is human-readable (e.g. 5 for 5 USDC)
        // Multiply by 1e6 to get raw USDC units for the contract
        const rawUsdcAmount = Math.floor(body.usdcAmount * 1e6);
        const transferTx = yield* txService.submitContractTransaction({
          walletId: body.walletId,
          walletType: walletRecord.type as "user" | "server" | "agent",
          contractName: "usdc",
          chainId: config.defaultChainId,
          method: "send",
          args: [
            SETTLEMENT_ADDRESS,
            rawUsdcAmount,
          ],
          userId,
        });

        // Auto-generate callback URL if not provided
        const callbackUrl =
          body.callbackUrl ||
          `${config.serverBaseUrl}/webhooks/pretium`;

        // Get exchange rate for fiat amount calculation
        const conversion = yield* exchangeRateService.convertUsdcToFiat(
          body.usdcAmount,
          countryConfig.currency
        );

        // Compute fee server-side from tiered schedule
        const fee = getFiatDisbursementFee(conversion.amount);

        // Call Pretium disburse — pass gross amount, Pretium deducts the fee
        const disburseResult = yield* pretium.disburse({
          country,
          amount: conversion.amount,
          phoneNumber: body.phoneNumber,
          mobileNetwork: body.mobileNetwork,
          transactionHash: transferTx.txHash!,
          callbackUrl,
          fee,
          paymentType: body.paymentType as FiatPaymentType | undefined,
          accountNumber: body.accountNumber,
          accountName: body.accountName,
          accountNumber_bank: body.bankAccount,
          bankCode: body.bankCode,
          bankName: body.bankName,
        });
        
        // Store transaction in DB
        const paymentType = (body.paymentType ||
          (country === "NG" ? "BANK_TRANSFER" : "MOBILE")) as
          | "MOBILE"
          | "BUY_GOODS"
          | "PAYBILL"
          | "BANK_TRANSFER";

        const [record] = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(pretiumTransactions)
              .values({
                userId,
                walletId: body.walletId,
                countryCode: country,
                fiatCurrency: countryConfig.currency,
                usdcAmount: String(body.usdcAmount),
                fiatAmount: String(conversion.amount - fee),
                exchangeRate: String(conversion.exchangeRate),
                fee: String(fee),
                feeFiatAmount: String(fee),
                paymentType,
                status: "pending",
                onChainTxHash: transferTx.txHash!,
                pretiumTransactionCode:
                  disburseResult.data.transaction_code,
                phoneNumber: body.phoneNumber,
                mobileNetwork: body.mobileNetwork,
                accountNumber: body.accountNumber,
                bankCode: body.bankCode,
                bankName: body.bankName,
                accountName: body.accountName,
                categoryId: body.categoryId,
                callbackUrl,
              })
              .returning(),
          catch: (error) =>
            new Error(`Failed to store pretium transaction: ${error}`),
        });

        // Save phone details to user preferences for next time
        yield* savePhoneToPreferences(
          db,
          userId,
          body.phoneNumber,
          body.mobileNetwork,
          body.country
        );

        return {
          transaction: formatOfframpResponse(record!),
          pretiumResponse: disburseResult,
          appliedFee: fee,
          feeCurrency: countryConfig.currency,
        };
      }),
      c,
      201
    )
  );

  /** Get offramp transaction status */
  app.get("/offramp/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;

        const [record] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(pretiumTransactions)
              .where(
                and(
                  eq(pretiumTransactions.id, id),
                  eq(pretiumTransactions.userId, userId)
                )
              ),
          catch: (error) =>
            new Error(`Failed to get pretium transaction: ${error}`),
        });

        if (!record) {
          return yield* Effect.fail(new Error("Transaction not found"));
        }

        return formatOfframpResponse(record);
      }),
      c
    )
  );

  /** Poll Pretium for latest status and update local record */
  app.post("/offramp/:id/refresh", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const pretium = yield* PretiumService;
        const { db } = yield* DatabaseService;

        const [record] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(pretiumTransactions)
              .where(
                and(
                  eq(pretiumTransactions.id, id),
                  eq(pretiumTransactions.userId, userId)
                )
              ),
          catch: (error) =>
            new Error(`Failed to get pretium transaction: ${error}`),
        });

        if (!record) {
          return yield* Effect.fail(new Error("Transaction not found"));
        }

        if (!record.pretiumTransactionCode) {
          return yield* Effect.fail(
            new Error("Transaction has no Pretium transaction code")
          );
        }

        const statusResult = yield* pretium.getTransactionStatus(
          record.pretiumTransactionCode,
          record.fiatCurrency
        );

        if (statusResult.success && statusResult.status) {
          const normalizedStatus = statusResult.status.toLowerCase() as
            | "pending"
            | "processing"
            | "completed"
            | "failed"
            | "reversed";

          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(pretiumTransactions)
                .set({
                  status: normalizedStatus,
                  pretiumReceiptNumber: statusResult.receiptNumber ?? null,
                  failureReason: statusResult.failureReason ?? null,
                  completedAt:
                    normalizedStatus === "completed"
                      ? new Date()
                      : null,
                  updatedAt: new Date(),
                })
                .where(eq(pretiumTransactions.id, id))
                .returning(),
            catch: (error) =>
              new Error(`Failed to update pretium transaction: ${error}`),
          });

          return { transaction: formatOfframpResponse(updated!), pretiumStatus: statusResult };
        }

        return { transaction: formatOfframpResponse(record), pretiumStatus: statusResult };
      }),
      c
    )
  );

  /** List user's offramp transactions */
  app.get("/offramp", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const limit = Number(c.req.query("limit") ?? "50");
        const offset = Number(c.req.query("offset") ?? "0");
        const { db } = yield* DatabaseService;

        const results = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(pretiumTransactions)
              .where(
                and(
                  eq(pretiumTransactions.userId, userId),
                  eq(pretiumTransactions.direction, "offramp")
                )
              )
              .orderBy(desc(pretiumTransactions.createdAt))
              .limit(limit)
              .offset(offset),
          catch: (error) =>
            new Error(`Failed to list pretium transactions: ${error}`),
        });

        return results.map(formatOfframpResponse);
      }),
      c
    )
  );

  // ── Onramp ─────────────────────────────────────────────────────────

  /** List onramp-supported countries */
  app.get("/onramp/countries", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const pretium = yield* PretiumService;
        const countries = pretium.getSupportedCountries();
        return ONRAMP_SUPPORTED_COUNTRIES.map((code) => ({
          code,
          ...countries[code],
          supportedAssets: [...ONRAMP_SUPPORTED_ASSETS],
        }));
      }),
      c
    )
  );

  /** Initiate an onramp (fiat → stablecoin) */
  app.post("/onramp", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              country: string;
              walletId: string;
              fiatAmount: number;
              phoneNumber: string;
              mobileNetwork: string;
              asset: string;
              fee?: number;
              callbackUrl?: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const pretium = yield* PretiumService;
        const exchangeRateService = yield* ExchangeRateService;
        const config = yield* ConfigService;
        const { db } = yield* DatabaseService;

        // Validate country supports onramp
        if (
          !ONRAMP_SUPPORTED_COUNTRIES.includes(
            body.country as OnrampSupportedCountry
          )
        ) {
          return yield* Effect.fail(
            new Error(
              `Onramp is not supported for country ${body.country}`
            )
          );
        }

        const country = body.country as OnrampSupportedCountry;
        const countries = pretium.getSupportedCountries();
        const countryConfig = countries[country];

        // Resolve wallet address from walletId
        const [walletRecord] = yield* Effect.tryPromise({
          try: () =>
            db.select().from(wallets).where(eq(wallets.id, body.walletId)),
          catch: (error) => new Error(`Failed to resolve wallet: ${error}`),
        });

        if (!walletRecord?.address) {
          return yield* Effect.fail(
            new Error(`Wallet not found or has no address: ${body.walletId}`)
          );
        }

        const address = walletRecord.address as `0x${string}`;

        // Auto-generate callback URL if not provided
        const callbackUrl =
          body.callbackUrl ||
          `${config.serverBaseUrl}/webhooks/pretium`;

        // Get exchange rate — use selling rate for onramp (Pretium sells USDC to user)
        const conversion = yield* exchangeRateService.convertFiatToUsdc(
          body.fiatAmount,
          countryConfig.currency,
          "selling"
        );

        // Call Pretium onramp
        const onrampResult = yield* pretium.onramp({
          country,
          phoneNumber: body.phoneNumber,
          mobileNetwork: body.mobileNetwork,
          amount: body.fiatAmount,
          chain: "BASE",
          fee: body.fee,
          asset: body.asset as OnrampAsset,
          address,
          callbackUrl,
        });

        // Store transaction in DB
        const [record] = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(pretiumTransactions)
              .values({
                userId,
                walletId: body.walletId,
                countryCode: country,
                fiatCurrency: countryConfig.currency,
                usdcAmount: String(conversion.amount),
                fiatAmount: String(body.fiatAmount),
                exchangeRate: String(conversion.exchangeRate),
                fee: body.fee ? String(body.fee) : "0",
                paymentType: "MOBILE",
                status: "pending",
                direction: "onramp",
                asset: body.asset,
                recipientAddress: address,
                pretiumTransactionCode:
                  onrampResult.data.transaction_code,
                phoneNumber: body.phoneNumber,
                mobileNetwork: body.mobileNetwork,
                callbackUrl,
              })
              .returning(),
          catch: (error) =>
            new Error(`Failed to store pretium transaction: ${error}`),
        });

        // Save phone details to user preferences for next time
        yield* savePhoneToPreferences(
          db,
          userId,
          body.phoneNumber,
          body.mobileNetwork,
          body.country
        );

        return {
          transaction: record,
          pretiumResponse: onrampResult,
        };
      }),
      c,
      201
    )
  );

  /** Get specific onramp transaction */
  app.get("/onramp/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;

        const [record] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(pretiumTransactions)
              .where(
                and(
                  eq(pretiumTransactions.id, id),
                  eq(pretiumTransactions.userId, userId),
                  eq(pretiumTransactions.direction, "onramp")
                )
              ),
          catch: (error) =>
            new Error(`Failed to get pretium transaction: ${error}`),
        });

        if (!record) {
          return yield* Effect.fail(new Error("Transaction not found"));
        }

        return record;
      }),
      c
    )
  );

  /** Poll onramp transaction status and update DB */
  app.post("/onramp/:id/refresh", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const pretium = yield* PretiumService;
        const { db } = yield* DatabaseService;

        const [record] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(pretiumTransactions)
              .where(
                and(
                  eq(pretiumTransactions.id, id),
                  eq(pretiumTransactions.userId, userId),
                  eq(pretiumTransactions.direction, "onramp")
                )
              ),
          catch: (error) =>
            new Error(`Failed to get pretium transaction: ${error}`),
        });

        if (!record) {
          return yield* Effect.fail(new Error("Transaction not found"));
        }

        if (!record.pretiumTransactionCode) {
          return yield* Effect.fail(
            new Error("Transaction has no Pretium transaction code")
          );
        }

        const statusResult = yield* pretium.getTransactionStatus(
          record.pretiumTransactionCode,
          record.fiatCurrency
        );

        if (statusResult.success && statusResult.status) {
          const normalizedStatus = statusResult.status.toLowerCase() as
            | "pending"
            | "processing"
            | "completed"
            | "failed"
            | "reversed";

          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(pretiumTransactions)
                .set({
                  status: normalizedStatus,
                  pretiumReceiptNumber: statusResult.receiptNumber ?? null,
                  failureReason: statusResult.failureReason ?? null,
                  completedAt:
                    normalizedStatus === "completed"
                      ? new Date()
                      : null,
                  updatedAt: new Date(),
                })
                .where(eq(pretiumTransactions.id, id))
                .returning(),
            catch: (error) =>
              new Error(`Failed to update pretium transaction: ${error}`),
          });

          return { transaction: updated, pretiumStatus: statusResult };
        }

        return { transaction: record, pretiumStatus: statusResult };
      }),
      c
    )
  );

  /** List user's onramp transactions */
  app.get("/onramp", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const limit = Number(c.req.query("limit") ?? "50");
        const offset = Number(c.req.query("offset") ?? "0");
        const { db } = yield* DatabaseService;

        const results = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(pretiumTransactions)
              .where(
                and(
                  eq(pretiumTransactions.userId, userId),
                  eq(pretiumTransactions.direction, "onramp")
                )
              )
              .orderBy(desc(pretiumTransactions.createdAt))
              .limit(limit)
              .offset(offset),
          catch: (error) =>
            new Error(`Failed to list pretium transactions: ${error}`),
        });

        return results;
      }),
      c
    )
  );

  // ── Fee Schedule ───────────────────────────────────────────────────

  /** Get the full fee tier schedule */
  app.get("/fee-tiers", (c) =>
    runEffect(
      runtime,
      Effect.succeed(getAllFiatFeeTiers()),
      c
    )
  );

  /** Estimate fee for a given fiat amount */
  app.get("/fee-estimate", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const amountStr = c.req.query("amount");
        if (!amountStr) {
          return yield* Effect.fail(new Error("amount query parameter is required"));
        }
        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount < 0) {
          return yield* Effect.fail(new Error("amount must be a positive number"));
        }
        const fee = getFiatDisbursementFee(amount);
        return {
          grossAmount: amount,
          fee,
          netAmount: amount - fee,
        };
      }),
      c
    )
  );

  return app;
}

// ── Webhook routes (no auth -- called by Pretium) ────────────────────

export function createPretiumWebhookRoutes(runtime: AppRuntime) {
  const app = new Hono();

  /**
   * Pretium payment status callback.
   * Handles two callback shapes:
   *   1. Status update (offramp + onramp payment confirmation):
   *      { status, transaction_code, receipt_number?, ... }
   *   2. Onramp asset release notification:
   *      { is_released: true, transaction_code, transaction_hash }
   */
  app.post("/pretium", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              transaction_code: string;
              status?: string;
              receipt_number?: string;
              failure_reason?: string;
              amount?: string;
              currency_code?: string;
              is_released?: boolean;
              transaction_hash?: string;
              public_name?: string;
              message?: string;
            }>(),
          catch: () => new Error("Invalid webhook payload"),
        });

        const { db } = yield* DatabaseService;

        // Find the transaction by Pretium transaction code
        const [record] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(pretiumTransactions)
              .where(
                eq(
                  pretiumTransactions.pretiumTransactionCode,
                  body.transaction_code
                )
              ),
          catch: (error) =>
            new Error(
              `Failed to find pretium transaction: ${error}`
            ),
        });

        if (!record) {
          return { received: true, matched: false };
        }

        // ── Onramp asset release callback ───────────────────────
        if (body.is_released && body.transaction_hash) {
          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(pretiumTransactions)
                .set({
                  status: "completed",
                  onChainTxHash: body.transaction_hash!,
                  ...(body.public_name && { recipientName: body.public_name }),
                  completedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(pretiumTransactions.id, record.id))
                .returning(),
            catch: (error) =>
              new Error(
                `Failed to update pretium transaction: ${error}`
              ),
          });

          return {
            received: true,
            matched: true,
            type: "asset_release",
            transaction: updated,
          };
        }

        // ── Standard status callback (offramp + onramp payment) ─
        const rawStatus = (body.status ?? "PROCESSING").toUpperCase();
        const statusMap: Record<string, string> = {
          PENDING: "pending",
          PROCESSING: "processing",
          COMPLETED: "completed",
          COMPLETE: "completed",
          FAILED: "failed",
          REVERSED: "reversed",
        };

        const normalizedStatus = (statusMap[rawStatus] ??
          "processing") as
          | "pending"
          | "processing"
          | "completed"
          | "failed"
          | "reversed";

        // For onramp, the first "COMPLETE" callback means payment
        // was collected — mark as "processing" since assets aren't
        // released yet (wait for is_released callback).
        const effectiveStatus =
          record.direction === "onramp" &&
          normalizedStatus === "completed"
            ? "processing"
            : normalizedStatus;

        const [updated] = yield* Effect.tryPromise({
          try: () =>
            db
              .update(pretiumTransactions)
              .set({
                status: effectiveStatus,
                pretiumReceiptNumber: body.receipt_number ?? null,
                failureReason: body.failure_reason ?? null,
                ...(body.public_name && { recipientName: body.public_name }),
                completedAt:
                  effectiveStatus === "completed" ? new Date() : null,
                updatedAt: new Date(),
              })
              .where(eq(pretiumTransactions.id, record.id))
              .returning(),
          catch: (error) =>
            new Error(
              `Failed to update pretium transaction: ${error}`
            ),
        });

        return {
          received: true,
          matched: true,
          type: "status_update",
          transaction: updated,
        };
      }),
      c
    )
  );

  return app;
}
