import { Hono } from "hono";
import { Effect } from "effect";
import { eq, and, desc } from "drizzle-orm";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { PretiumService } from "../services/pretium/pretium-service.js";
import { ExchangeRateService } from "../services/pretium/exchange-rate-service.js";
import { DatabaseService } from "../db/client.js";
import { pretiumTransactions } from "../db/schema/index.js";
import type { AuthVariables } from "../middleware/auth.js";
import type {
  SupportedCountry,
  FiatPaymentType,
  BankTransferCountry,
} from "../services/pretium/pretium-service.js";

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

  /** Initiate an offramp (disburse fiat after USDC is sent to settlement) */
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
              transactionHash: string;
              paymentType?: string;
              accountNumber?: string;
              accountName?: string;
              bankAccount?: string;
              bankCode?: string;
              bankName?: string;
              callbackUrl?: string;
              fee?: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        const pretium = yield* PretiumService;
        const exchangeRateService = yield* ExchangeRateService;
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

        // Get exchange rate for fiat amount calculation
        const conversion = yield* exchangeRateService.convertUsdcToFiat(
          body.usdcAmount,
          countryConfig.currency
        );

        // Call Pretium disburse
        const disburseResult = yield* pretium.disburse({
          country,
          amount: conversion.amount,
          phoneNumber: body.phoneNumber,
          mobileNetwork: body.mobileNetwork,
          transactionHash: body.transactionHash,
          callbackUrl: body.callbackUrl,
          fee: body.fee,
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
                fiatAmount: String(conversion.amount),
                exchangeRate: String(conversion.exchangeRate),
                fee: body.fee ? String(body.fee) : "0",
                paymentType,
                status: "pending",
                onChainTxHash: body.transactionHash,
                pretiumTransactionCode:
                  disburseResult.data.transaction_code,
                phoneNumber: body.phoneNumber,
                mobileNetwork: body.mobileNetwork,
                accountNumber: body.accountNumber,
                bankCode: body.bankCode,
                bankName: body.bankName,
                accountName: body.accountName,
                callbackUrl: body.callbackUrl,
              })
              .returning(),
          catch: (error) =>
            new Error(`Failed to store pretium transaction: ${error}`),
        });

        return {
          transaction: record,
          pretiumResponse: disburseResult,
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

        return record;
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

          return { transaction: updated, pretiumStatus: statusResult };
        }

        return { transaction: record, pretiumStatus: statusResult };
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
              .where(eq(pretiumTransactions.userId, userId))
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

  return app;
}

// ── Webhook routes (no auth -- called by Pretium) ────────────────────

export function createPretiumWebhookRoutes(runtime: AppRuntime) {
  const app = new Hono();

  /**
   * Pretium payment status callback.
   * Pretium does not use webhook signatures, so this endpoint should be
   * protected by IP allowlisting or a shared secret in production.
   */
  app.post("/pretium", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              transaction_code: string;
              status: string;
              receipt_number?: string;
              failure_reason?: string;
              amount?: string;
              currency_code?: string;
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
          // Unknown transaction -- acknowledge but log
          return { received: true, matched: false };
        }

        // Normalize status
        const rawStatus = body.status.toUpperCase();
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

        const [updated] = yield* Effect.tryPromise({
          try: () =>
            db
              .update(pretiumTransactions)
              .set({
                status: normalizedStatus,
                pretiumReceiptNumber: body.receipt_number ?? null,
                failureReason: body.failure_reason ?? null,
                completedAt:
                  normalizedStatus === "completed" ? new Date() : null,
                updatedAt: new Date(),
              })
              .where(eq(pretiumTransactions.id, record.id))
              .returning(),
          catch: (error) =>
            new Error(
              `Failed to update pretium transaction: ${error}`
            ),
        });

        return { received: true, matched: true, transaction: updated };
      }),
      c
    )
  );

  return app;
}
