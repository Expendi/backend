import { Hono } from "hono";
import { Effect } from "effect";
import { eq, and } from "drizzle-orm";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { RecurringPaymentService, type CreateScheduleParams, type OfframpDetails } from "../services/recurring-payment/recurring-payment-service.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import { ConfigService } from "../config.js";
import { DatabaseService } from "../db/client.js";
import { wallets, userProfiles } from "../db/schema/index.js";
import type { UserPreferences } from "../db/schema/user-profiles.js";
import type { AuthVariables } from "../middleware/auth.js";
import { SUPPORTED_COUNTRIES, SETTLEMENT_ADDRESS, type SupportedCountry } from "../services/pretium/pretium-service.js";

// ── New clean request body types ────────────────────────────────────

/** Offramp recipient — Pretium mobile money or bank details */
interface OfframpRecipient {
  phoneNumber?: string;
  mobileNetwork?: string;
  country?: string;
  paymentMethod?: string; // "MOBILE" | "BUY_GOODS" | "PAYBILL" | "BANK_TRANSFER"
  accountNumber?: string;
  accountName?: string;
  bankAccount?: string;
  bankCode?: string;
  bankName?: string;
}

/** New shape: Pretium offramp */
interface OfframpBody {
  type: "offramp";
  name?: string;
  wallet?: "user" | "server" | "agent";
  walletId?: string;
  amount: string;          // fiat amount by default (e.g. "1000" KES)
  currency?: string;       // e.g. "KES", "NGN" — resolved from recipient.country if omitted
  amountInUsdc?: boolean;  // set true if `amount` is USDC instead of fiat
  recipient?: OfframpRecipient;
  token?: string;          // defaults to "usdc"
  chainId?: number;
  frequency: string;
  startDate?: string;
  endDate?: string;
  maxRetries?: number;
  categoryId?: string;
  executeImmediately?: boolean;
}

/** New shape: ERC-20 token transfer */
interface TransferBody {
  type: "transfer";
  name?: string;
  wallet?: "user" | "server" | "agent";
  walletId?: string;
  to: string;              // recipient address
  amount: string;          // token amount in base units
  token?: string;          // defaults to "usdc"
  chainId?: number;
  frequency: string;
  startDate?: string;
  endDate?: string;
  maxRetries?: number;
  categoryId?: string;
  executeImmediately?: boolean;
}

/** New shape: raw ETH/native transfer */
interface RawTransferBody {
  type: "raw_transfer";
  name?: string;
  wallet?: "user" | "server" | "agent";
  walletId?: string;
  to: string;
  amount: string;          // value in wei
  chainId?: number;
  frequency: string;
  startDate?: string;
  endDate?: string;
  maxRetries?: number;
  categoryId?: string;
  executeImmediately?: boolean;
}

/** New shape: arbitrary contract call */
interface ContractCallBody {
  type: "contract_call";
  name?: string;
  wallet?: "user" | "server" | "agent";
  walletId?: string;
  to?: string;             // recipient address (optional, used for recipientAddress)
  contract: string;        // contract name in registry
  method: string;
  args?: unknown[];
  amount?: string;         // value in wei (defaults to "0")
  token?: string;
  chainId?: number;
  frequency: string;
  startDate?: string;
  endDate?: string;
  maxRetries?: number;
  categoryId?: string;
  executeImmediately?: boolean;
}

type NewRequestBody = OfframpBody | TransferBody | RawTransferBody | ContractCallBody;

/** Legacy request body — kept for backward compatibility */
interface LegacyRequestBody {
  name?: string;
  walletId?: string;
  walletType: "user" | "server" | "agent";
  recipientAddress: string;
  paymentType: "erc20_transfer" | "raw_transfer" | "contract_call" | "offramp";
  amount: string;
  tokenContractName?: string;
  contractName?: string;
  contractMethod?: string;
  contractArgs?: unknown[];
  chainId?: number;
  frequency: string;
  startDate?: string;
  endDate?: string;
  maxRetries?: number;
  offramp?: {
    currency: string;
    fiatAmount: string;
    provider: string;
    destinationId: string;
    metadata?: Record<string, unknown>;
  };
  country?: string;
  phoneNumber?: string;
  mobileNetwork?: string;
  paymentMethod?: string;
  accountNumber?: string;
  accountName?: string;
  bankAccount?: string;
  bankCode?: string;
  bankName?: string;
  categoryId?: string;
  executeImmediately?: boolean;
  fiatAmount?: string;
  currency?: string;
}

/** Detect whether the request body is the legacy format */
function isLegacyBody(body: Record<string, unknown>): boolean {
  return "paymentType" in body || "walletType" in body;
}

/**
 * Public recurring payment routes -- all behind Privy auth middleware.
 * Every operation is scoped to the authenticated user.
 */
export function createRecurringPaymentRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // List the authenticated user's recurring payment schedules
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const rpService = yield* RecurringPaymentService;
        return yield* rpService.listSchedulesByUser(userId);
      }),
      c
    )
  );

  // Get a single schedule -- verify the authenticated user owns it
  app.get("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const rpService = yield* RecurringPaymentService;
        const schedule = yield* rpService.getSchedule(id);
        if (!schedule) {
          return yield* Effect.fail(new Error("Schedule not found"));
        }
        if (schedule.userId !== userId) {
          return yield* Effect.fail(new Error("Schedule not found"));
        }
        return schedule;
      }),
      c
    )
  );

  // Create a new recurring payment schedule
  app.post("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const config = yield* ConfigService;
        const rawBody = yield* Effect.tryPromise({
          try: () => c.req.json<Record<string, unknown>>(),
          catch: () => new Error("Invalid request body"),
        });

        // ── Normalize: detect legacy vs new format ──────────────────
        let name: string | undefined;
        let walletType: "user" | "server" | "agent";
        let walletId: string | undefined;
        let recipientAddress: string;
        let paymentType: "erc20_transfer" | "raw_transfer" | "contract_call" | "offramp";
        let amount: string;
        let tokenContractName: string | undefined;
        let contractName: string | undefined;
        let contractMethod: string | undefined;
        let contractArgs: unknown[] | undefined;
        let chainId: number;
        let frequency: string;
        let startDate: Date | undefined;
        let endDate: Date | undefined;
        let maxRetries: number | undefined;
        let offramp: OfframpDetails | undefined;
        let categoryId: string | undefined;
        let executeImmediately: boolean | undefined;

        if (isLegacyBody(rawBody)) {
          // ── LEGACY FORMAT — backward compatible path ───────────────
          const body = rawBody as unknown as LegacyRequestBody;
          name = body.name;
          walletType = body.walletType;
          walletId = body.walletId;
          recipientAddress = body.recipientAddress;
          paymentType = body.paymentType;
          amount = body.amount;
          tokenContractName = body.tokenContractName;
          contractName = body.contractName;
          contractMethod = body.contractMethod;
          contractArgs = body.contractArgs;
          chainId = body.chainId ?? config.defaultChainId;
          frequency = body.frequency;
          startDate = body.startDate ? new Date(body.startDate) : undefined;
          endDate = body.endDate ? new Date(body.endDate) : undefined;
          maxRetries = body.maxRetries;
          categoryId = body.categoryId;
          executeImmediately = body.executeImmediately;

          // Build offramp details for legacy Pretium shorthand
          offramp = body.offramp;
          if (body.paymentType === "offramp" && !offramp) {
            let country = body.country;
            let phoneNumber = body.phoneNumber;
            let mobileNetwork = body.mobileNetwork;

            const { db } = yield* DatabaseService;
            if (!country || !phoneNumber || !mobileNetwork) {
              const rows = yield* Effect.tryPromise({
                try: () =>
                  db
                    .select({ preferences: userProfiles.preferences })
                    .from(userProfiles)
                    .where(eq(userProfiles.privyUserId, userId))
                    .limit(1),
                catch: () => new Error("Failed to fetch preferences"),
              });
              const prefs = (rows[0]?.preferences ?? {}) as UserPreferences;
              country = country || prefs.country;
              phoneNumber = phoneNumber || prefs.phoneNumber;
              mobileNetwork = mobileNetwork || prefs.mobileNetwork;
            }

            if (!country || !phoneNumber || !mobileNetwork) {
              return yield* Effect.fail(
                new Error(
                  "Pretium offramp requires country, phoneNumber, and mobileNetwork"
                )
              );
            }

            const countryConfig = SUPPORTED_COUNTRIES[country as SupportedCountry];
            if (!countryConfig) {
              return yield* Effect.fail(
                new Error(`Country ${country} is not supported by Pretium`)
              );
            }
            const resolvedCurrency = body.currency ?? countryConfig.currency;

            offramp = {
              currency: resolvedCurrency,
              fiatAmount: body.fiatAmount ?? body.amount,
              provider: "pretium",
              destinationId: phoneNumber,
              metadata: {
                country,
                phoneNumber,
                mobileNetwork,
                paymentType: body.paymentMethod,
                accountNumber: body.accountNumber,
                accountName: body.accountName,
                bankAccount: body.bankAccount,
                bankCode: body.bankCode,
                bankName: body.bankName,
                amountInFiat: !!body.fiatAmount,
              },
            };
          }
        } else {
          // ── NEW FORMAT — clean, use-case-driven shapes ─────────────
          const body = rawBody as unknown as NewRequestBody;

          if (!body.type) {
            return yield* Effect.fail(new Error("Missing required field: type"));
          }
          if (!body.frequency) {
            return yield* Effect.fail(new Error("Missing required field: frequency"));
          }

          name = body.name;
          walletType = body.wallet ?? "server";
          walletId = body.walletId;
          chainId = body.chainId ?? config.defaultChainId;
          frequency = body.frequency;
          startDate = body.startDate ? new Date(body.startDate) : undefined;
          endDate = body.endDate ? new Date(body.endDate) : undefined;
          maxRetries = body.maxRetries;
          categoryId = body.categoryId;
          executeImmediately = body.executeImmediately;

          switch (body.type) {
            case "offramp": {
              paymentType = "offramp";
              tokenContractName = body.token ?? "usdc";
              recipientAddress = SETTLEMENT_ADDRESS;

              // Resolve recipient fields from body or user preferences
              let country = body.recipient?.country;
              let phoneNumber = body.recipient?.phoneNumber;
              let mobileNetwork = body.recipient?.mobileNetwork;

              const { db } = yield* DatabaseService;
              if (!country || !phoneNumber || !mobileNetwork) {
                const rows = yield* Effect.tryPromise({
                  try: () =>
                    db
                      .select({ preferences: userProfiles.preferences })
                      .from(userProfiles)
                      .where(eq(userProfiles.privyUserId, userId))
                      .limit(1),
                  catch: () => new Error("Failed to fetch preferences"),
                });
                const prefs = (rows[0]?.preferences ?? {}) as UserPreferences;
                country = country || prefs.country;
                phoneNumber = phoneNumber || prefs.phoneNumber;
                mobileNetwork = mobileNetwork || prefs.mobileNetwork;
              }

              if (!country || !phoneNumber || !mobileNetwork) {
                return yield* Effect.fail(
                  new Error(
                    "Offramp requires recipient.country, recipient.phoneNumber, and recipient.mobileNetwork (or saved preferences)"
                  )
                );
              }

              const countryConfig = SUPPORTED_COUNTRIES[country as SupportedCountry];
              if (!countryConfig) {
                return yield* Effect.fail(
                  new Error(`Country ${country} is not supported by Pretium`)
                );
              }
              const resolvedCurrency = body.currency ?? countryConfig.currency;

              // By default, amount is in fiat. If amountInUsdc is true, it's USDC.
              const isFiatDenominated = !body.amountInUsdc;
              amount = isFiatDenominated ? "0" : body.amount;

              offramp = {
                currency: resolvedCurrency,
                fiatAmount: body.amount,
                provider: "pretium",
                destinationId: phoneNumber,
                metadata: {
                  country,
                  phoneNumber,
                  mobileNetwork,
                  paymentType: body.recipient?.paymentMethod,
                  accountNumber: body.recipient?.accountNumber,
                  accountName: body.recipient?.accountName,
                  bankAccount: body.recipient?.bankAccount,
                  bankCode: body.recipient?.bankCode,
                  bankName: body.recipient?.bankName,
                  amountInFiat: isFiatDenominated,
                },
              };
              break;
            }

            case "transfer": {
              if (!body.to) {
                return yield* Effect.fail(new Error("Missing required field: to (recipient address)"));
              }
              paymentType = "erc20_transfer";
              recipientAddress = body.to;
              amount = body.amount;
              tokenContractName = body.token ?? "usdc";
              break;
            }

            case "raw_transfer": {
              if (!body.to) {
                return yield* Effect.fail(new Error("Missing required field: to (recipient address)"));
              }
              paymentType = "raw_transfer";
              recipientAddress = body.to;
              amount = body.amount;
              break;
            }

            case "contract_call": {
              if (!body.contract) {
                return yield* Effect.fail(new Error("Missing required field: contract"));
              }
              if (!body.method) {
                return yield* Effect.fail(new Error("Missing required field: method"));
              }
              paymentType = "contract_call";
              recipientAddress = body.to ?? "0x0000000000000000000000000000000000000000";
              amount = body.amount ?? "0";
              contractName = body.contract;
              contractMethod = body.method;
              contractArgs = body.args;
              tokenContractName = body.token;
              break;
            }

            default:
              return yield* Effect.fail(
                new Error(`Unknown type: ${(body as any).type}. Expected: offramp, transfer, raw_transfer, or contract_call`)
              );
          }
        }

        // ── Resolve walletId from wallet type ───────────────────────
        let resolvedWalletId = walletId;
        if (!resolvedWalletId) {
          const onboarding = yield* OnboardingService;
          const profile = yield* onboarding.getProfile(userId);
          if (walletType === "user") {
            resolvedWalletId = profile.userWalletId;
          } else if (walletType === "server") {
            resolvedWalletId = profile.serverWalletId;
          } else {
            resolvedWalletId = profile.agentWalletId;
          }
        }

        // Verify the user owns the wallet
        const { db } = yield* DatabaseService;
        const [walletRecord] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(
                and(
                  eq(wallets.id, resolvedWalletId!),
                  eq(wallets.ownerId, userId)
                )
              ),
          catch: (error) =>
            new Error(`Failed to verify wallet ownership: ${error}`),
        });
        if (!walletRecord) {
          return yield* Effect.fail(
            new Error(
              "Wallet not found or not owned by the authenticated user"
            )
          );
        }

        const rpService = yield* RecurringPaymentService;
        return yield* rpService.createSchedule({
          userId,
          name,
          walletId: resolvedWalletId!,
          walletType,
          recipientAddress,
          paymentType,
          amount,
          tokenContractName,
          contractName,
          contractMethod,
          contractArgs,
          chainId,
          frequency,
          startDate,
          endDate,
          maxRetries,
          offramp,
          categoryId,
          executeImmediately,
        });
      }),
      c,
      201
    )
  );

  // Pause a schedule
  app.post("/:id/pause", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const rpService = yield* RecurringPaymentService;
        const schedule = yield* rpService.getSchedule(id);
        if (!schedule || schedule.userId !== userId) {
          return yield* Effect.fail(new Error("Schedule not found"));
        }
        return yield* rpService.pauseSchedule(id);
      }),
      c
    )
  );

  // Resume a schedule
  app.post("/:id/resume", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const rpService = yield* RecurringPaymentService;
        const schedule = yield* rpService.getSchedule(id);
        if (!schedule || schedule.userId !== userId) {
          return yield* Effect.fail(new Error("Schedule not found"));
        }
        return yield* rpService.resumeSchedule(id);
      }),
      c
    )
  );

  // Cancel a schedule
  app.post("/:id/cancel", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const rpService = yield* RecurringPaymentService;
        const schedule = yield* rpService.getSchedule(id);
        if (!schedule || schedule.userId !== userId) {
          return yield* Effect.fail(new Error("Schedule not found"));
        }
        return yield* rpService.cancelSchedule(id);
      }),
      c
    )
  );

  // Get execution history for a schedule
  app.get("/:id/executions", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const rpService = yield* RecurringPaymentService;
        const schedule = yield* rpService.getSchedule(id);
        if (!schedule || schedule.userId !== userId) {
          return yield* Effect.fail(new Error("Schedule not found"));
        }
        const limit = Number(c.req.query("limit") ?? "50");
        return yield* rpService.getExecutionHistory(id, limit);
      }),
      c
    )
  );

  return app;
}
