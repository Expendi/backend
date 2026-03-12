import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow, TokenAmount, Address } from "./components";

// ─── list_supported_countries ────────────────────────────────────────────────

const listSupportedCountriesTool: ToolConfig = {
  name: "list_supported_countries",
  description:
    "List all countries supported by Pretium for on/off ramp. Shows country code, name, currency, and available payment types.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/pretium/countries");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── get_country_config ──────────────────────────────────────────────────────

const getCountryConfigTool: ToolConfig = {
  name: "get_country_config",
  description:
    "Get payment configuration for a specific country. Shows supported payment types, mobile networks, currency details, and bank transfer availability.",
  inputSchema: z.object({
    code: z.string().describe("Country code (e.g. KE, NG, GH, TZ, UG)"),
  }),
  async do(input) {
    try {
      const data = await callApi(`/api/pretium/countries/${input.code}`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── get_exchange_rate ───────────────────────────────────────────────────────

const getExchangeRateTool: ToolConfig = {
  name: "get_exchange_rate",
  description:
    "Get the current USDC exchange rate for a fiat currency. Use currency codes like KES, NGN, GHS, TZS, UGX.",
  inputSchema: z.object({
    currency: z.string().describe("Fiat currency code (e.g. KES, NGN, GHS)"),
  }),
  async do(input) {
    try {
      const data = await callApi(`/api/pretium/exchange-rate/${input.currency}`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── list_offramp_transactions ───────────────────────────────────────────────

const listOfframpTransactionsTool: ToolConfig = {
  name: "list_offramp_transactions",
  description:
    "List the current user's offramp (USDC to fiat) transactions. Shows status, amounts, currency, and date.",
  inputSchema: z.object({
    limit: z.number().optional().describe("Max results (default 50)"),
    offset: z.number().optional().describe("Pagination offset"),
  }),
  async do(input) {
    try {
      const data = await callApi("/pretium/offramp", {
        query: input as Record<string, string | number | undefined>,
      });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── get_offramp_transaction ─────────────────────────────────────────────────

const getOfframpTransactionTool: ToolConfig = {
  name: "get_offramp_transaction",
  description: "Get full details of a specific offramp transaction by ID.",
  inputSchema: z.object({
    id: z.string().describe("Offramp transaction ID"),
  }),
  async do(input) {
    try {
      const data = await callApi(`/api/pretium/offramp/${input.id}`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── initiate_offramp ────────────────────────────────────────────────────────

const initiateOfframpTool = defineTool({
  name: "initiate_offramp",
  description:
    "Initiate an offramp: convert USDC to fiat and disburse via mobile money or bank transfer. Requires the user's wallet ID, USDC amount, country, phone number, and mobile network. For bank transfers, also provide bank details.",
  inputSchema: z.object({
    walletId: z.string().describe("User wallet ID to debit USDC from"),
    amount: z.string().describe("USDC amount to offramp (e.g. '10' for 10 USDC)"),
    currency: z.string().describe("Target fiat currency code (e.g. KES, NGN)"),
    country: z.string().describe("Country code (e.g. KE, NG)"),
    paymentType: z
      .enum(["MOBILE", "BANK_TRANSFER", "BUY_GOODS", "PAYBILL"])
      .describe("Payment method"),
    recipient: z.string().describe("Recipient phone number in local format without country code (e.g. '0712345678'), or account number for bank transfers"),
    network: z.string().optional().describe("Mobile network (e.g. Safaricom, MTN). Required for MOBILE payments."),
    bankCode: z.string().optional().describe("Bank code for BANK_TRANSFER payments"),
    bankName: z.string().optional().describe("Bank name for BANK_TRANSFER payments"),
    accountName: z.string().optional().describe("Account holder name for BANK_TRANSFER payments"),
  }),
  displayPropsSchema: z.object({
    walletId: z.string(),
    amount: z.string(),
    currency: z.string(),
    country: z.string(),
    paymentType: z.string(),
    recipient: z.string(),
    network: z.string().optional(),
    bankName: z.string().optional(),
    accountName: z.string().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait({
      walletId: input.walletId,
      amount: input.amount,
      currency: input.currency,
      country: input.country,
      paymentType: input.paymentType,
      recipient: input.recipient,
      network: input.network,
      bankName: input.bankName,
      accountName: input.accountName,
    });
    if (!confirmed) {
      return { status: "success", data: "Offramp cancelled." };
    }
    try {
      const body: Record<string, unknown> = {
        walletId: input.walletId,
        usdcAmount: Number(input.amount),
        country: input.country,
        phoneNumber: input.recipient,
        mobileNetwork: input.network ?? "",
        paymentType: input.paymentType,
      };
      if (input.paymentType === "BANK_TRANSFER") {
        body.accountNumber = input.recipient;
        body.bankCode = input.bankCode;
        body.bankName = input.bankName;
        body.accountName = input.accountName;
      }
      const data = await callApi("/pretium/offramp", { method: "POST", body });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    const isBankTransfer = props.paymentType === "BANK_TRANSFER";
    return (
      <ConfirmDialog title="Confirm Offramp" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="USDC Amount" value={<TokenAmount amount={props.amount} symbol="USDC" />} />
        <KVRow label="Target Currency" value={props.currency} />
        <KVRow label="Country" value={props.country} />
        <KVRow label="Payment Method" value={props.paymentType} />
        <KVRow label={isBankTransfer ? "Account" : "Recipient"} value={props.recipient} mono />
        {props.network && <KVRow label="Network" value={props.network} />}
        {props.bankName && <KVRow label="Bank" value={props.bankName} />}
        {props.accountName && <KVRow label="Account Name" value={props.accountName} />}
        <KVRow label="Wallet" value={<Address value={props.walletId} />} />
      </ConfirmDialog>
    );
  },
});

// ─── list_onramp_transactions ────────────────────────────────────────────────

const listOnrampTransactionsTool: ToolConfig = {
  name: "list_onramp_transactions",
  description:
    "List the current user's onramp (fiat to USDC) transactions. Shows status, amounts, and date.",
  inputSchema: z.object({
    limit: z.number().optional().describe("Max results (default 50)"),
    offset: z.number().optional().describe("Pagination offset"),
  }),
  async do(input) {
    try {
      const data = await callApi("/pretium/onramp", {
        query: input as Record<string, string | number | undefined>,
      });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── get_onramp_transaction ──────────────────────────────────────────────────

const getOnrampTransactionTool: ToolConfig = {
  name: "get_onramp_transaction",
  description: "Get full details of a specific onramp transaction by ID.",
  inputSchema: z.object({
    id: z.string().describe("Onramp transaction ID"),
  }),
  async do(input) {
    try {
      const data = await callApi(`/api/pretium/onramp/${input.id}`);
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── initiate_onramp ─────────────────────────────────────────────────────────

const initiateOnrampTool = defineTool({
  name: "initiate_onramp",
  description:
    "Initiate an onramp: convert fiat to stablecoin (USDC). The user pays via mobile money and receives USDC in their wallet. Requires wallet ID, fiat amount, country, phone number, and mobile network.",
  inputSchema: z.object({
    walletId: z.string().describe("User wallet ID to receive the stablecoin"),
    amount: z.string().describe("Fiat amount to convert (e.g. '1000' for 1000 KES)"),
    currency: z.string().describe("Fiat currency code (e.g. KES, NGN)"),
    country: z.string().describe("Country code (e.g. KE, NG)"),
    asset: z.string().describe("Target asset (e.g. USDC)"),
    phoneNumber: z.string().describe("Phone number in local format without country code (e.g. '0712345678')"),
    network: z.string().optional().describe("Mobile network (e.g. Safaricom, MTN)"),
  }),
  displayPropsSchema: z.object({
    walletId: z.string(),
    amount: z.string(),
    currency: z.string(),
    country: z.string(),
    asset: z.string(),
    phoneNumber: z.string(),
    network: z.string().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait({
      walletId: input.walletId,
      amount: input.amount,
      currency: input.currency,
      country: input.country,
      asset: input.asset,
      phoneNumber: input.phoneNumber,
      network: input.network,
    });
    if (!confirmed) {
      return { status: "success", data: "Onramp cancelled." };
    }
    try {
      const data = await callApi("/pretium/onramp", {
        method: "POST",
        body: {
          walletId: input.walletId,
          fiatAmount: Number(input.amount),
          country: input.country,
          phoneNumber: input.phoneNumber,
          mobileNetwork: input.network ?? "",
          asset: input.asset,
        },
      });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Confirm Onramp" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow
          label="Fiat Amount"
          value={
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
              {Number(props.amount).toLocaleString()} {props.currency}
            </span>
          }
        />
        <KVRow label="Target Asset" value={props.asset} mono />
        <KVRow label="Country" value={props.country} />
        <KVRow label="Phone" value={props.phoneNumber} mono />
        {props.network && <KVRow label="Network" value={props.network} />}
        <KVRow label="Wallet" value={<Address value={props.walletId} />} />
      </ConfirmDialog>
    );
  },
});

// ─── refresh_offramp_status ──────────────────────────────────────────────────

const refreshOfframpStatusTool: ToolConfig = {
  name: "refresh_offramp_status",
  description:
    "Poll Pretium for the latest status of an offramp transaction and update the local record. Use this to check if an offramp has completed or failed.",
  inputSchema: z.object({
    id: z.string().describe("Offramp transaction ID"),
  }),
  async do(input) {
    try {
      const data = await callApi(`/api/pretium/offramp/${input.id}/refresh`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── refresh_onramp_status ───────────────────────────────────────────────────

const refreshOnrampStatusTool: ToolConfig = {
  name: "refresh_onramp_status",
  description:
    "Poll Pretium for the latest status of an onramp transaction and update the local record. Use this to check if an onramp has completed or failed.",
  inputSchema: z.object({
    id: z.string().describe("Onramp transaction ID"),
  }),
  async do(input) {
    try {
      const data = await callApi(`/api/pretium/onramp/${input.id}/refresh`, { method: "POST" });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── Export ───────────────────────────────────────────────────────────────────

export const pretiumTools: ToolConfig[] = [
  listSupportedCountriesTool,
  getCountryConfigTool,
  getExchangeRateTool,
  listOfframpTransactionsTool,
  getOfframpTransactionTool,
  initiateOfframpTool,
  listOnrampTransactionsTool,
  getOnrampTransactionTool,
  initiateOnrampTool,
  refreshOfframpStatusTool,
  refreshOnrampStatusTool,
];
