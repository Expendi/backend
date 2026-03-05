import { Effect, Context, Layer, Data } from "effect";
import { ConfigService } from "../../config.js";

// ── Error type ───────────────────────────────────────────────────────

export class PretiumError extends Data.TaggedError("PretiumError")<{
  readonly message: string;
  readonly code: PretiumErrorCode;
  readonly details?: Record<string, unknown>;
}> {}

export type PretiumErrorCode =
  | "INVALID_PHONE_NUMBER"
  | "UNSUPPORTED_COUNTRY"
  | "UNSUPPORTED_NETWORK"
  | "INVALID_TRANSACTION_HASH"
  | "TRANSACTION_NOT_FOUND"
  | "INSUFFICIENT_DEPOSIT"
  | "NETWORK_ERROR"
  | "API_ERROR"
  | "AUTHENTICATION_FAILED"
  | "VALIDATION_ERROR"
  | "UNKNOWN_ERROR";

// ── Constants ────────────────────────────────────────────────────────

/** Settlement wallet address -- send USDC here before calling disburse */
export const SETTLEMENT_ADDRESS =
  "0x8005ee53E57aB11E11eAA4EFe07Ee3835Dc02F98";

export const SUPPORTED_COUNTRIES = {
  KE: { currency: "KES", endpoint: "/v1/pay/KES", onrampEndpoint: "/v1/onramp/KES", name: "Kenya" },
  NG: { currency: "NGN", endpoint: "/v1/pay/NGN", onrampEndpoint: null, name: "Nigeria" },
  GH: { currency: "GHS", endpoint: "/v1/pay/GHS", onrampEndpoint: "/v1/onramp/GHS", name: "Ghana" },
  UG: { currency: "UGX", endpoint: "/v1/pay/UGX", onrampEndpoint: "/v1/onramp/UGX", name: "Uganda" },
  CD: { currency: "CDF", endpoint: "/v1/pay/CDF", onrampEndpoint: "/v1/onramp/CDF", name: "DR Congo" },
  MW: { currency: "MWK", endpoint: "/v1/pay/MWK", onrampEndpoint: "/v1/onramp/MWK", name: "Malawi" },
  ET: { currency: "ETB", endpoint: "/v1/pay/ETB", onrampEndpoint: null, name: "Ethiopia" },
} as const;

export type SupportedCountry = keyof typeof SUPPORTED_COUNTRIES;

export const SUPPORTED_NETWORKS = {
  KE: ["safaricom", "airtel"] as const,
  NG: [] as const,
  GH: ["mtn", "vodafone", "airtel"] as const,
  UG: ["mtn", "airtel"] as const,
  CD: ["vodacom", "airtel", "orange"] as const,
  MW: ["airtel", "tnm"] as const,
  ET: ["telebirr"] as const,
} as const;

export const VALIDATION_SUPPORTED_COUNTRIES = ["KE", "GH", "UG"] as const;
export const BANK_VALIDATION_SUPPORTED_COUNTRIES = ["NG"] as const;
export const BANK_TRANSFER_COUNTRIES = ["NG", "KE"] as const;
export type BankTransferCountry = (typeof BANK_TRANSFER_COUNTRIES)[number];

export const ONRAMP_SUPPORTED_COUNTRIES = ["KE", "GH", "UG", "CD", "MW"] as const;
export type OnrampSupportedCountry = (typeof ONRAMP_SUPPORTED_COUNTRIES)[number];

export const ONRAMP_SUPPORTED_ASSETS = ["USDC", "USDT", "CUSD"] as const;
export type OnrampAsset = (typeof ONRAMP_SUPPORTED_ASSETS)[number];

export const FIAT_PAYMENT_TYPES = [
  "MOBILE",
  "BUY_GOODS",
  "PAYBILL",
  "BANK_TRANSFER",
] as const;
export type FiatPaymentType = (typeof FIAT_PAYMENT_TYPES)[number];

export const COUNTRY_PAYMENT_CONFIG = {
  KE: {
    paymentTypes: ["MOBILE", "BUY_GOODS", "PAYBILL", "BANK_TRANSFER"] as const,
    config: {
      MOBILE: {
        label: "M-Pesa / Airtel Money",
        requiredFields: ["phoneNumber", "network"],
        description: "Send directly to mobile money account",
      },
      BUY_GOODS: {
        label: "Buy Goods (Till)",
        requiredFields: ["phoneNumber"],
        description: "Pay to a till number",
      },
      PAYBILL: {
        label: "Paybill",
        requiredFields: ["phoneNumber", "accountNumber"],
        description: "Pay to a paybill with account number",
      },
      BANK_TRANSFER: {
        label: "Bank Transfer",
        requiredFields: ["bankAccount", "bankCode"],
        description: "Transfer to a bank account",
      },
    },
  },
  NG: {
    paymentTypes: ["BANK_TRANSFER"] as const,
    config: {
      BANK_TRANSFER: {
        label: "Bank Transfer",
        requiredFields: [
          "accountName",
          "bankAccount",
          "bankCode",
          "bankName",
        ],
        description: "Transfer to a bank account",
      },
    },
  },
  GH: {
    paymentTypes: ["MOBILE"] as const,
    config: {
      MOBILE: {
        label: "Mobile Money",
        requiredFields: ["phoneNumber", "network", "accountName"],
        description: "MTN, Vodafone, or AirtelTigo mobile money",
      },
    },
  },
  UG: {
    paymentTypes: ["MOBILE"] as const,
    config: {
      MOBILE: {
        label: "Mobile Money",
        requiredFields: ["phoneNumber", "network"],
        description: "MTN or Airtel mobile money",
      },
    },
  },
  CD: {
    paymentTypes: ["MOBILE"] as const,
    config: {
      MOBILE: {
        label: "Mobile Money",
        requiredFields: ["phoneNumber", "network"],
        description: "Vodacom, Airtel, or Orange mobile money",
      },
    },
  },
  MW: {
    paymentTypes: ["MOBILE"] as const,
    config: {
      MOBILE: {
        label: "Mobile Money",
        requiredFields: ["phoneNumber", "network"],
        description: "Airtel Money or TNM Mpamba",
      },
    },
  },
  ET: {
    paymentTypes: ["MOBILE"] as const,
    config: {
      MOBILE: {
        label: "Telebirr",
        requiredFields: ["phoneNumber", "network"],
        description: "Telebirr mobile money",
      },
    },
  },
} as const;

// ── Request / Response types ─────────────────────────────────────────

export interface DisburseRequest {
  readonly country: SupportedCountry;
  readonly amount: number;
  readonly phoneNumber: string;
  readonly mobileNetwork: string;
  readonly transactionHash: string;
  readonly callbackUrl?: string;
  readonly fee?: number;
  readonly paymentType?: FiatPaymentType;
  readonly accountNumber?: string;
  readonly accountName?: string;
  readonly accountNumber_bank?: string;
  readonly bankName?: string;
  readonly bankCode?: string;
}

export interface DisburseResponse {
  readonly code: number;
  readonly message: string;
  readonly data: {
    readonly status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
    readonly transaction_code: string;
    readonly message: string;
  };
}

export type PretiumTransactionStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "COMPLETE"
  | "FAILED"
  | "REVERSED";

export interface TransactionStatusResult {
  readonly success: boolean;
  readonly status?: PretiumTransactionStatus;
  readonly completedAt?: string;
  readonly failureReason?: string;
  readonly receiptNumber?: string;
  readonly error?: { readonly code: PretiumErrorCode; readonly message: string };
}

export interface BankInfo {
  readonly Code: string;
  readonly Name: string;
}

export interface ValidationResult {
  readonly success: boolean;
  readonly validatedName?: string;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface BankValidationResult {
  readonly success: boolean;
  readonly accountName?: string;
  readonly bankName?: string;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

// ── Onramp types ────────────────────────────────────────────────────

export interface OnrampRequest {
  readonly country: OnrampSupportedCountry;
  readonly phoneNumber: string;
  readonly mobileNetwork: string;
  readonly amount: number;
  readonly chain: string;
  readonly fee?: number;
  readonly asset: OnrampAsset;
  readonly address: string;
  readonly callbackUrl?: string;
}

export type OnrampResponse = DisburseResponse;

// ── Service interface ────────────────────────────────────────────────

export interface PretiumServiceApi {
  /** Disburse fiat to a mobile money or bank account */
  readonly disburse: (
    request: DisburseRequest
  ) => Effect.Effect<DisburseResponse, PretiumError>;

  /** Get transaction status from Pretium */
  readonly getTransactionStatus: (
    transactionCode: string,
    currencyCode: string
  ) => Effect.Effect<TransactionStatusResult, PretiumError>;

  /** Validate a mobile phone number with MNO */
  readonly validatePhoneWithMno: (
    country: SupportedCountry,
    phoneNumber: string,
    network: string
  ) => Effect.Effect<ValidationResult, PretiumError>;

  /** Validate a bank account number */
  readonly validateBankAccount: (
    country: SupportedCountry,
    accountNumber: string,
    bankCode: string
  ) => Effect.Effect<BankValidationResult, PretiumError>;

  /** Get list of supported banks for a country */
  readonly getBanksForCountry: (
    country: BankTransferCountry
  ) => Effect.Effect<ReadonlyArray<BankInfo>, PretiumError>;

  /** Get settlement address for USDC deposits */
  readonly getSettlementAddress: () => string;

  /** Get supported countries with their configs */
  readonly getSupportedCountries: () => typeof SUPPORTED_COUNTRIES;

  /** Get payment config for a country */
  readonly getCountryPaymentConfig: (
    country: string
  ) => (typeof COUNTRY_PAYMENT_CONFIG)[SupportedCountry] | undefined;

  /** Check if a country is supported */
  readonly isCountrySupported: (
    country: string
  ) => country is SupportedCountry;

  /** Initiate an onramp (fiat → stablecoin) */
  readonly onramp: (
    request: OnrampRequest
  ) => Effect.Effect<OnrampResponse, PretiumError>;
}

export class PretiumService extends Context.Tag("PretiumService")<
  PretiumService,
  PretiumServiceApi
>() {}

// ── Helpers ──────────────────────────────────────────────────────────

const isCountrySupported = (
  country: string
): country is SupportedCountry => {
  return country in SUPPORTED_COUNTRIES;
};

const formatPhoneNumber = (phoneNumber: string): string => {
  return phoneNumber.replace(/[\s\-+]/g, "");
};

const normalizeGhanaNetwork = (network: string): string => {
  const lower = network.toLowerCase();
  if (lower.includes("mtn")) return "MTN";
  if (lower.includes("vodafone")) return "Vodafone";
  if (lower.includes("airtel")) return "Airtel go";
  return network;
};

const normalizeNetworkForValidation = (
  network: string,
  country: SupportedCountry
): string => {
  const lower = network.toLowerCase();

  if (country === "KE") {
    if (lower.includes("safaricom") || lower.includes("mpesa"))
      return "Safaricom";
    if (lower.includes("airtel")) return "Airtel";
    return "Safaricom";
  }

  if (country === "GH") {
    if (lower.includes("mtn")) return "MTN";
    if (lower.includes("vodafone")) return "Vodafone";
    if (lower.includes("airtel")) return "Airtel";
    return "MTN";
  }

  if (country === "UG") {
    if (lower.includes("mtn")) return "MTN";
    if (lower.includes("airtel")) return "Airtel";
    return "MTN";
  }

  return network;
};

const buildDisburseRequestBody = (
  request: DisburseRequest
): Record<string, unknown> => {
  const baseBody = {
    shortcode: request.phoneNumber,
    amount: Math.floor(request.amount),
    fee: request.fee || 0,
    chain: "BASE",
    transaction_hash: request.transactionHash,
    callback_url: request.callbackUrl,
  };

  // Kenya
  if (request.country === "KE") {
    const paymentType = request.paymentType || "MOBILE";

    if (paymentType === "BANK_TRANSFER") {
      return {
        type: "BANK_TRANSFER",
        account_number: request.accountNumber_bank,
        bank_code: request.bankCode,
        amount: Math.floor(request.amount),
        fee: request.fee || 0,
        chain: "BASE",
        transaction_hash: request.transactionHash,
        callback_url: request.callbackUrl,
      };
    }

    return {
      ...baseBody,
      type: paymentType,
      mobile_network: normalizeNetworkForValidation(request.mobileNetwork, "KE"),
      ...(paymentType === "PAYBILL" && {
        account_number: request.accountNumber,
      }),
    };
  }

  // Nigeria -- bank transfer only
  if (request.country === "NG") {
    return {
      type: "BANK_TRANSFER",
      account_name: request.accountName,
      account_number: request.accountNumber_bank,
      bank_name: request.bankName,
      bank_code: request.bankCode,
      amount: Math.floor(request.amount),
      fee: request.fee || 0,
      chain: "BASE",
      transaction_hash: request.transactionHash,
      callback_url: request.callbackUrl,
    };
  }

  // Ghana
  if (request.country === "GH") {
    return {
      ...baseBody,
      account_name: request.accountName || "",
      mobile_network: normalizeGhanaNetwork(request.mobileNetwork),
    };
  }

  // Uganda, DR Congo, Malawi, Ethiopia -- standard mobile money
  return {
    ...baseBody,
    mobile_network: request.mobileNetwork,
  };
};

const buildOnrampRequestBody = (
  request: OnrampRequest
): Record<string, unknown> => ({
  shortcode: request.phoneNumber,
  // this exists as a big int and needs to be converted back to an int for Pretium
  amount: parseInt(request.amount.toString()),
  mobile_network: request.mobileNetwork,
  chain: request.chain || "BASE",
  fee: request.fee || 0,
  asset: request.asset,
  address: request.address,
  callback_url: request.callbackUrl
});

// ── Fetch helper ─────────────────────────────────────────────────────

const pretiumFetch = <T>(
  baseUri: string,
  apiKey: string,
  path: string,
  body: unknown
): Effect.Effect<T, PretiumError> =>
  Effect.tryPromise({
    try: async () => {
      console.log("Transaction body:", body)
      const response = await fetch(`${baseUri}${path}`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      console.log("Done submitting transaction", response)

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        const status = response.status;

        if (status === 401) {
          throw new PretiumError({
            message: "Pretium API authentication failed - check x-api-key",
            code: "AUTHENTICATION_FAILED",
            details: { status, data },
          });
        }

        if (status === 400) {
          console.log("Rejected with status 400", data)
          throw new PretiumError({
            message:
              (data?.message as string) || "Invalid request parameters",
            code: "VALIDATION_ERROR",
            details: { status, data },
          });
        }

        throw new PretiumError({
          message:
            (data?.message as string) || `Pretium API error: ${status}`,
          code: "API_ERROR",
          details: { status, data },
        });
      }

      return (await response.json()) as T;
    },
    catch: (error) => {
      if (error instanceof PretiumError) return error;
      return new PretiumError({
        message:
          error instanceof Error
            ? error.message
            : "Network error communicating with Pretium API",
        code: "NETWORK_ERROR",
        details: {
          originalError:
            error instanceof Error ? error.message : String(error),
        },
      });
    },
  });

// ── Live implementation ──────────────────────────────────────────────

export const PretiumServiceLive: Layer.Layer<
  PretiumService,
  never,
  ConfigService
> = Layer.effect(
  PretiumService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const baseUri = config.pretiumBaseUri;
    const apiKey = config.pretiumApiKey;

    const callApi = <T>(path: string, body: unknown) =>
      pretiumFetch<T>(baseUri, apiKey, path, body);

    return {
      disburse: (request: DisburseRequest) =>
        Effect.gen(function* () {
          // Validate country
          if (!SUPPORTED_COUNTRIES[request.country]) {
            return yield* Effect.fail(
              new PretiumError({
                message: `Country ${request.country} is not supported`,
                code: "UNSUPPORTED_COUNTRY",
                details: {
                  supportedCountries: Object.keys(SUPPORTED_COUNTRIES),
                },
              })
            );
          }

          const countryConfig = SUPPORTED_COUNTRIES[request.country];
          const supportedNetworks = SUPPORTED_NETWORKS[request.country];

          // Validate network (skip for bank transfers and Kenya non-MOBILE)
          const skipNetworkValidation =
            request.country === "NG" ||
            (request.country === "KE" &&
              (request.paymentType === "BUY_GOODS" ||
                request.paymentType === "PAYBILL" ||
                request.paymentType === "BANK_TRANSFER"));

          if (!skipNetworkValidation) {
            const normalizedNetwork = (
              request.mobileNetwork || ""
            ).toLowerCase();
            if (
              !normalizedNetwork ||
              !supportedNetworks.some((n) => normalizedNetwork.includes(n))
            ) {
              return yield* Effect.fail(
                new PretiumError({
                  message: `Network ${request.mobileNetwork} is not supported in ${countryConfig.name}`,
                  code: "UNSUPPORTED_NETWORK",
                  details: { supportedNetworks: [...supportedNetworks] },
                })
              );
            }
          }

          const body = buildDisburseRequestBody(request);
          return yield* callApi<DisburseResponse>(countryConfig.endpoint, body);
        }),

      getTransactionStatus: (
        transactionCode: string,
        currencyCode: string
      ) =>
        Effect.gen(function* () {
          interface StatusApiResponse {
            code: number;
            message: string;
            data: {
              transaction_code: string;
              status: PretiumTransactionStatus;
              amount: string;
              currency_code: string;
              shortcode?: string;
              account_number?: string;
              public_name?: string;
              receipt_number?: string;
              message?: string;
              created_at: string;
              completed_at?: string;
              failure_reason?: string;
            } | null;
          }

          const response = yield* callApi<StatusApiResponse>(
            `/v1/status/${currencyCode}`,
            { transaction_code: transactionCode }
          );

          const transaction = response.data;

          if (!transaction) {
            return {
              success: false as const,
              error: {
                code: "TRANSACTION_NOT_FOUND" as const,
                message: "Transaction not found in Pretium response",
              },
            };
          }

          const normalizedStatus: PretiumTransactionStatus =
            transaction.status === "COMPLETE"
              ? "COMPLETED"
              : transaction.status;

          return {
            success: true as const,
            status: normalizedStatus,
            completedAt: transaction.completed_at ?? transaction.created_at,
            failureReason: transaction.failure_reason,
            receiptNumber: transaction.receipt_number,
          };
        }),

      validatePhoneWithMno: (
        country: SupportedCountry,
        phoneNumber: string,
        network: string
      ) =>
        Effect.gen(function* () {
          if (
            !VALIDATION_SUPPORTED_COUNTRIES.includes(
              country as (typeof VALIDATION_SUPPORTED_COUNTRIES)[number]
            )
          ) {
            return {
              success: false as const,
              error: {
                code: "UNSUPPORTED_COUNTRY",
                message: `MNO validation is not supported for ${country}. Supported: ${VALIDATION_SUPPORTED_COUNTRIES.join(", ")}`,
              },
            };
          }

          const countryConfig = SUPPORTED_COUNTRIES[country];
          const normalizedNetwork = normalizeNetworkForValidation(
            network,
            country
          );
          const formattedPhone = formatPhoneNumber(phoneNumber);

          interface ValidationApiResponse {
            code: number;
            message: string;
            data: {
              status: "COMPLETE" | "FAILED" | "NOT_FOUND";
              shortcode: string;
              public_name?: string;
              mobile_network: string;
            };
          }

          const response = yield* callApi<ValidationApiResponse>(
            `/v1/validation/${countryConfig.currency}`,
            {
              type: "MOBILE",
              shortcode: formattedPhone,
              mobile_network: normalizedNetwork,
            }
          );

          const { data } = response;

          if (data.status === "COMPLETE" && data.public_name) {
            return {
              success: true as const,
              validatedName: data.public_name,
            };
          }

          return {
            success: false as const,
            error: {
              code: "NAME_NOT_FOUND",
              message: "No registered name found for this phone number",
            },
          };
        }),

      validateBankAccount: (
        country: SupportedCountry,
        accountNumber: string,
        bankCode: string
      ) =>
        Effect.gen(function* () {
          if (
            !BANK_VALIDATION_SUPPORTED_COUNTRIES.includes(
              country as (typeof BANK_VALIDATION_SUPPORTED_COUNTRIES)[number]
            )
          ) {
            return {
              success: false as const,
              error: {
                code: "UNSUPPORTED_COUNTRY",
                message: `Bank account validation is not supported for ${country}. Supported: ${BANK_VALIDATION_SUPPORTED_COUNTRIES.join(", ")}`,
              },
            };
          }

          const countryConfig = SUPPORTED_COUNTRIES[country];

          interface BankValidationApiResponse {
            code: number;
            message: string;
            data: {
              status: string;
              account_name: string;
              account_number: string;
              bank_name: string;
              bank_code: string;
            };
          }

          const response = yield* callApi<BankValidationApiResponse>(
            `/v1/validation/${countryConfig.currency}`,
            {
              account_number: accountNumber,
              bank_code: bankCode,
            }
          );

          if (response.data.account_name) {
            return {
              success: true as const,
              accountName: response.data.account_name,
              bankName: response.data.bank_name,
            };
          }

          return {
            success: false as const,
            error: {
              code: "NAME_NOT_FOUND",
              message: "Could not resolve account holder name",
            },
          };
        }),

      getBanksForCountry: (country: BankTransferCountry) =>
        Effect.gen(function* () {
          const currencyMap: Record<BankTransferCountry, string> = {
            NG: "NGN",
            KE: "KES",
          };

          interface BankListApiResponse {
            code: number;
            message: string;
            data: Array<{ Code: string; Name: string }>;
          }

          const response = yield* callApi<BankListApiResponse>(
            `/v1/banks/${currencyMap[country]}`,
            {}
          );

          return response.data;
        }),

      onramp: (request: OnrampRequest) =>
        Effect.gen(function* () {
          if (
            !ONRAMP_SUPPORTED_COUNTRIES.includes(
              request.country as OnrampSupportedCountry
            )
          ) {
            return yield* Effect.fail(
              new PretiumError({
                message: `Onramp is not supported for country ${request.country}`,
                code: "UNSUPPORTED_COUNTRY",
                details: {
                  supportedCountries: [...ONRAMP_SUPPORTED_COUNTRIES],
                },
              })
            );
          }

          if (
            !ONRAMP_SUPPORTED_ASSETS.includes(
              request.asset as OnrampAsset
            )
          ) {
            return yield* Effect.fail(
              new PretiumError({
                message: `Asset ${request.asset} is not supported for onramp`,
                code: "VALIDATION_ERROR",
                details: {
                  supportedAssets: [...ONRAMP_SUPPORTED_ASSETS],
                },
              })
            );
          }

          const countryConfig = SUPPORTED_COUNTRIES[request.country];
          const onrampEndpoint = countryConfig.onrampEndpoint as string | null;

          if (!onrampEndpoint) {
            return yield* Effect.fail(
              new PretiumError({
                message: `Onramp endpoint not configured for ${countryConfig.name as string}`,
                code: "UNSUPPORTED_COUNTRY",
              })
            );
          }

          // Validate network
          const supportedNetworks = SUPPORTED_NETWORKS[request.country] as readonly string[];
          const normalizedNetwork = (
            request.mobileNetwork || ""
          ).toLowerCase();
          if (
            !normalizedNetwork ||
            !supportedNetworks.some((n) => normalizedNetwork.includes(n))
          ) {
            return yield* Effect.fail(
              new PretiumError({
                message: `Network ${request.mobileNetwork} is not supported in ${countryConfig.name}`,
                code: "UNSUPPORTED_NETWORK",
                details: { supportedNetworks: [...supportedNetworks] },
              })
            );
          }

          const body = buildOnrampRequestBody(request);
          return yield* callApi<OnrampResponse>(onrampEndpoint, body);
        }),

      getSettlementAddress: () => SETTLEMENT_ADDRESS,

      getSupportedCountries: () => SUPPORTED_COUNTRIES,

      getCountryPaymentConfig: (country: string) => {
        if (!isCountrySupported(country)) return undefined;
        return COUNTRY_PAYMENT_CONFIG[country];
      },

      isCountrySupported,
    };
  })
);
