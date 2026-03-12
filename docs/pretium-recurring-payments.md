# Pretium Recurring Offramp Payments

Create recurring payments that automatically convert USDC to fiat and disburse via mobile money or bank transfer across Africa.

**Endpoint:** `POST /api/recurring-payments`
**Auth:** Privy access token (or `X-Dev-User-Id` in dev)

---

## New Format (Recommended)

All new-format requests use `type: "offramp"`. The amount is **fiat by default** — the backend converts to USDC at execution time using the live exchange rate.

### 1. Mobile Money — Fiat Amount (Default)

Send 1000 KES every day via M-Pesa:

```json
{
  "type": "offramp",
  "amount": "1000",
  "frequency": "1d",
  "recipient": {
    "country": "KE",
    "phoneNumber": "0712345678",
    "mobileNetwork": "safaricom"
  }
}
```

- `amount` is in local fiat currency (KES in this case)
- `currency` is auto-resolved from `recipient.country` (KE → KES)
- `wallet` defaults to `"server"`
- The backend converts fiat → USDC at each execution using the live Pretium exchange rate

### 2. Mobile Money — USDC Amount

Send 5 USDC worth of KES every week:

```json
{
  "type": "offramp",
  "amount": "5",
  "amountInUsdc": true,
  "frequency": "7d",
  "recipient": {
    "country": "KE",
    "phoneNumber": "0712345678",
    "mobileNetwork": "safaricom"
  }
}
```

- `amountInUsdc: true` tells the backend the amount is USDC, not fiat
- The fiat equivalent is calculated at execution time

### 3. Mobile Money — Explicit Currency

Override the default currency (useful when testing):

```json
{
  "type": "offramp",
  "amount": "50000",
  "currency": "UGX",
  "frequency": "30d",
  "recipient": {
    "country": "UG",
    "phoneNumber": "0771234567",
    "mobileNetwork": "mtn"
  }
}
```

### 4. Kenya Paybill Payment

```json
{
  "type": "offramp",
  "amount": "2000",
  "frequency": "30d",
  "recipient": {
    "country": "KE",
    "phoneNumber": "0712345678",
    "mobileNetwork": "safaricom",
    "paymentMethod": "PAYBILL",
    "accountNumber": "123456"
  }
}
```

### 5. Kenya Buy Goods Payment

```json
{
  "type": "offramp",
  "amount": "500",
  "frequency": "7d",
  "recipient": {
    "country": "KE",
    "phoneNumber": "0712345678",
    "mobileNetwork": "safaricom",
    "paymentMethod": "BUY_GOODS"
  }
}
```

### 6. Nigeria Bank Transfer

```json
{
  "type": "offramp",
  "amount": "50000",
  "frequency": "30d",
  "recipient": {
    "country": "NG",
    "phoneNumber": "08012345678",
    "mobileNetwork": "mtn",
    "paymentMethod": "BANK_TRANSFER",
    "bankAccount": "0123456789",
    "bankCode": "058",
    "bankName": "GTBank",
    "accountName": "John Doe"
  }
}
```

### 7. Using Saved Preferences (Minimal Request)

If the user has saved `country`, `phoneNumber`, and `mobileNetwork` in their profile preferences, you can omit the `recipient` entirely:

```json
{
  "type": "offramp",
  "amount": "1000",
  "frequency": "7d"
}
```

The backend falls back to the user's stored preferences for any missing recipient fields.

### 8. All Optional Fields

```json
{
  "type": "offramp",
  "wallet": "server",
  "walletId": "uuid-here",
  "amount": "1000",
  "currency": "KES",
  "amountInUsdc": false,
  "token": "usdc",
  "chainId": 8453,
  "frequency": "7d",
  "startDate": "2026-03-15T00:00:00Z",
  "endDate": "2026-12-31T23:59:59Z",
  "maxRetries": 3,
  "categoryId": "uuid-here",
  "executeImmediately": true,
  "recipient": {
    "country": "KE",
    "phoneNumber": "0712345678",
    "mobileNetwork": "safaricom",
    "paymentMethod": "MOBILE",
    "accountNumber": null,
    "accountName": null,
    "bankAccount": null,
    "bankCode": null,
    "bankName": null
  }
}
```

---

## Supported Countries

| Country    | Code | Currency | Mobile Networks              | Payment Methods                          |
|------------|------|----------|------------------------------|------------------------------------------|
| Kenya      | KE   | KES      | safaricom, airtel            | MOBILE, BUY_GOODS, PAYBILL, BANK_TRANSFER |
| Nigeria    | NG   | NGN      | —                            | BANK_TRANSFER                            |
| Ghana      | GH   | GHS      | mtn, vodafone, airtel        | MOBILE                                   |
| Uganda     | UG   | UGX      | mtn, airtel                  | MOBILE                                   |
| DR Congo   | CD   | CDF      | vodacom, airtel, orange      | MOBILE                                   |
| Malawi     | MW   | MWK      | airtel, tnm                  | MOBILE                                   |
| Ethiopia   | ET   | ETB      | telebirr                     | MOBILE                                   |

---

## Frequency Format

`"<number><unit>"` where unit is:

| Unit | Meaning  | Example |
|------|----------|---------|
| `m`  | minutes  | `"30m"` |
| `h`  | hours    | `"1h"`  |
| `d`  | days     | `"1d"`  |
| `w`  | weeks    | `"1w"`  |

Common values: `"1d"` (daily), `"7d"` (weekly), `"30d"` (monthly)

---

## How Execution Works

1. At each scheduled execution, the backend checks if the amount is fiat-denominated or USDC-denominated
2. **Fiat-denominated** (`amountInUsdc` is false or omitted): the stored fiat amount is converted to USDC using the live Pretium exchange rate, then that USDC is sent on-chain and disbursed as fiat
3. **USDC-denominated** (`amountInUsdc: true`): the stored USDC amount is sent on-chain, then converted to fiat at the live rate for disbursement
4. The recipient receives the fiat amount via their mobile money or bank account

---

## Managing Schedules

```
POST /api/recurring-payments/:id/pause    — pause
POST /api/recurring-payments/:id/resume   — resume
POST /api/recurring-payments/:id/cancel   — cancel
GET  /api/recurring-payments/:id/executions?limit=50  — execution history
GET  /api/recurring-payments              — list all
GET  /api/recurring-payments/:id          — get one
```

---

## Phone Number Format

Pretium expects **local phone numbers without the country code prefix**. Use `0712345678` not `+254712345678` or `254712345678`.
