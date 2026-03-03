Here's the fully expanded consolidated reference, now including all sections from the Pretium docs:

---

# Pretium API — Complete Consolidated Reference

**Base URL:** `{{uri}}` / `{{url}}` (your Pretium API base URI)

**Authentication:** All endpoints require the header `x-api-key: {{consumer_key}}`. Requests without it or with an invalid key return `401 Unauthorized`.

```json
// 401 Unauthorized
{
  "code": 401,
  "message": "Unauthorized"
}
```

---

## Table of Contents
1. [Introduction](#introduction)
2. [API Reference](#api-reference)
   - Account Details
   - Wallet Balance
   - Supported Countries
   - Exchange Rate
3. [On / Off-Ramps](#on--off-ramps)
   - Kenya (Supported Banks, Bank Transfer, Disburse/Pay, Onramp)
   - Nigeria (Supported Banks, Account Detail, Bank Transfer)
   - Ghana (Disburse, Onramp)
   - Uganda (Disburse, Onramp)
   - DR Congo (Disburse, Onramp)
   - Malawi (Disburse, Onramp)
4. [Payout / Payin](#payout--payin)
5. [Fee Field](#fee-field)
6. [Webhooks](#webhooks)
7. [Utilities](#utilities)
   - Transaction Status
   - All Transactions
   - Phone Number Verification
   - Refund
   - Networks
   - MNOs
   - Limits

---

## Introduction

Pretium APIs provide a unified API that simplifies access to fragmented fiat/crypto payment rails across Africa. With this API your organization can accept crypto payments and disburse crypto payouts.

**Onboarding:** Complete the onboarding form or book a meeting with the Pretium team. Once onboarded, you receive API credentials and sandbox access to test crypto transactions securely.

---

## API Reference

### Account Details
Retrieve full partner account information including wallets and supported networks.

**Endpoint:** `POST {{uri}}/account/detail`

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Account Information",
  "data": {
    "id": 9,
    "name": "DEV Account",
    "email": "derrick@pretium.africa",
    "status": "ACTIVE",
    "wallets": [
      { "id": 8, "balance": "298", "currency": "KES", "country_name": "Kenya" },
      { "id": 9, "balance": "1000", "currency": "UGX", "country_name": "Uganda" }
    ],
    "networks": [
      {
        "name": "Base",
        "icon": "https://xwift.africa/coins/base.svg",
        "settlement_wallet_address": "0x8005ee53e57ab11e11eaa4efe07ee3835dc02f98",
        "assets": [
          { "name": "USDC", "icon": "https://xwift.africa/coins/usdc.svg" }
        ]
      },
      {
        "name": "Celo",
        "icon": "https://xwift.africa/coins/celo.webp",
        "settlement_wallet_address": "0x8005ee53e57ab11e11eaa4efe07ee3835dc02f98",
        "assets": [
          { "name": "USDC", "icon": "https://xwift.africa/coins/usdc.svg" },
          { "name": "cUSD", "icon": "https://xwift.africa/coins/cUSD.svg" },
          { "name": "USDT", "icon": "https://xwift.africa/coins/usdt.png" }
        ]
      }
    ],
    "created_at": "2025-07-08T18:51:21.000000Z"
  }
}
```

**Response — 400 Bad Request:**
```json
{ "code": 400, "message": "Failed - Bad Request" }
```

---

### Wallet Balance
Get wallet balance for a specific country.

**Endpoint:** `POST {{uri}}/account/wallet/{country_id}`

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Wallet Balance",
  "data": {
    "id": 1,
    "balance": "1000",
    "currency": "KES",
    "country_name": "Kenya"
  }
}
```

**Response — 400 Bad Request:**
```json
{ "code": 400, "message": "Failed - Bad Request" }
```

---

### Supported Countries
Get a list of all countries supported by Pretium APIs.

**Endpoint:** `POST {{uri}}/account/countries`

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Supported Countries",
  "data": [
    { "id": 1, "name": "Kenya", "currency_code": "KES", "phone_code": "254" },
    { "id": 2, "name": "Uganda", "currency_code": "UGX", "phone_code": "256" }
  ]
}
```

**Response — 400 Bad Request:**
```json
{ "code": 400, "message": "Failed - Bad Request" }
```

---

### Exchange Rate
Retrieve exchange rates to calculate fiat equivalent for a given stablecoin amount, or vice versa.

**Endpoint:** `POST {{uri}}/v1/exchange-rate`

**Body:**
```json
{ "currency_code": "{{currency_code}}" }
```

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Exchange rates",
  "data": {
    "buying_rate": 128.15,
    "selling_rate": 130.75,
    "quoted_rate": 129.2
  }
}
```

**Response — 400 Bad Request:**
```json
{ "code": 400, "message": "Failed - Bad Request" }
```

---

## On / Off-Ramps

### Kenya

#### Supported Banks
Get a list of Kenyan banks supported by Pretium APIs.

**Endpoint:** `POST {{uri}}/v1/banks/KES`

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "List of banks",
  "data": [
    { "Code": "000019", "Name": "Equity Bank" }
  ]
}
```

---

#### Bank Transfer (Disburse)
Verifies payment to settlement wallet and settles to a recipient bank account.

**Endpoint:** `POST {{uri}}/v1/pay/KES`

| Name | Type | Description |
|---|---|---|
| type | String | `BANK_TRANSFER` |
| account_number | String | Recipient bank account number |
| bank_code | String | Central bank code assigned to each bank |
| amount | Integer | Amount to disburse |
| fee | Integer | Fee amount |
| chain | String | e.g. `CELO` |
| transaction_hash | String | On-chain transaction hash |
| callback_url | URL | URL to receive payment notification |

**Sample Request:**
```json
{
  "type": "BANK_TRANSFER",
  "account_number": "001918181",
  "bank_code": "247247",
  "amount": "500",
  "fee": "10",
  "chain": "CELO",
  "transaction_hash": "0x55a572efe1720250e442f38741477a4fc3f7f152e5cd208cc52f8222a1c2a13b",
  "callback_url": "https://pretium.africa/callback"
}
```

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Disburse initiated",
  "data": { "status": "PENDING", "transaction_code": "TSALX", "message": "Success! Processing payment." }
}
```

---

#### Disburse / Pay (Mobile, Buy Goods, Paybill)
Verifies payment to settlement wallet and releases equivalent fiat via mobile money, till, or paybill.

**Endpoint:** `POST {{uri}}/v1/pay/KES`

| Name | Type | Description |
|---|---|---|
| type | String | `MOBILE`, `BUY_GOODS`, or `PAYBILL` |
| shortcode | String | Recipient mobile number, till number, or paybill number |
| account_number | String | Required if type is `PAYBILL` |
| amount | Integer | Amount to disburse |
| fee | Integer | Fee amount |
| mobile_network | String | e.g. `Safaricom` |
| chain | String | e.g. `CELO` |
| transaction_hash | String | On-chain transaction hash |
| callback_url | URL | URL to receive payment notification |

**Sample Request:**
```json
{
  "type": "MOBILE",
  "shortcode": "0799770833",
  "amount": "500",
  "fee": "10",
  "mobile_network": "Safaricom",
  "chain": "CELO",
  "transaction_hash": "0x55a572efe1720250e442f38741477a4fc3f7f152e5cd208cc52f8222a1c2a13b",
  "callback_url": "https://pretium.africa/callback"
}
```

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Disburse initiated",
  "data": { "status": "PENDING", "transaction_code": "TSALX", "message": "Success! Processing payment." }
}
```

---

#### Onramp
Initiates cash collection from the user, confirms receipt via mobile money or bank transfer, and releases equivalent stablecoins.

**Endpoint:** `POST {{uri}}/v1/onramp/KES`

| Name | Type | Description |
|---|---|---|
| shortcode | String | Customer's phone number |
| amount | Integer | Amount to collect |
| mobile_network | String | e.g. `Safaricom`, `Airtel` |
| chain | String | e.g. `CELO`, `BASE` |
| fee | Integer | Fee amount |
| asset | String | `USDT`, `USDC`, or `CUSD` |
| address | String | Recipient wallet address |
| callback_url | URL | URL to receive payment notification |

**Sample Request:**
```json
{
  "shortcode": "0725212418",
  "amount": 1000,
  "mobile_network": "Safaricom",
  "chain": "BASE",
  "fee": 10,
  "asset": "USDC",
  "address": "0x3Eaab84B42F9fCf2A9B3f2FDB83572B4153eE958",
  "callback_url": "https://pretium.africa/b2c/log-test"
}
```

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Prompt sent",
  "data": { "status": "PENDING", "transaction_code": "DDM6D", "message": "Success! Processing payment..." }
}
```

---

### Nigeria

#### Supported Banks
Get a list of Nigerian banks supported by Pretium APIs.

**Endpoint:** `POST {{uri}}/v1/banks`

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "List of banks",
  "data": [
    { "Code": "000019", "Name": "Enterprise Bank" }
  ]
}
```

---

#### Account Detail (Validation)
Validates an account number and returns the registered account name as provided by the bank or mobile money wallet.

**Endpoint:** `POST {{uri}}/v1/validation/NGN`

**Body:**
```json
{
  "account_number": "0536243713",
  "bank_code": 232
}
```

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Validation results",
  "data": {
    "status": "COMPLETE",
    "account_name": "JOHN DOE",
    "account_number": "90154195756",
    "bank_name": "Opay",
    "bank_code": "100004"
  }
}
```

---

#### Bank Transfer (Disburse)
Verifies payment to settlement wallet and releases equivalent fiat to a bank account.

**Endpoint:** `POST {{uri}}/v1/pay/NGN`

| Name | Type | Description |
|---|---|---|
| account_name | String | Recipient's name |
| account_number | String | Recipient bank account number |
| amount | Integer | Amount to disburse |
| fee | Integer | Fee amount |
| bank_name | String | Name of the bank |
| bank_code | String | Central bank code assigned to each bank |
| chain | String | e.g. `CELO` |
| transaction_hash | String | On-chain transaction hash |
| callback_url | URL | URL to receive payment notification |

**Sample Request:**
```json
{
  "type": "BANK_TRANSFER",
  "account_name": "John Doe",
  "account_number": "001918181",
  "bank_name": "Sterlin Bank",
  "bank_code": "123455",
  "amount": "500",
  "fee": "10",
  "chain": "CELO",
  "transaction_hash": "0x55a572efe1720250e442f38741477a4fc3f7f152e5cd208cc52f8222a1c2a13b",
  "callback_url": "https://pretium.africa/callback"
}
```

---

### Ghana

#### Disburse
Verifies payment to settlement wallet and releases equivalent fiat via mobile money.

**Endpoint:** `POST {{uri}}/v1/pay/GHS`

| Name | Type | Description |
|---|---|---|
| shortcode | String | Recipient mobile number |
| account_name | String | Recipient name |
| amount | Integer | Amount to disburse |
| fee | Integer | Fee amount |
| mobile_network | String | e.g. `Airtel go` |
| chain | String | e.g. `CELO` |
| transaction_hash | String | On-chain transaction hash |
| callback_url | URL | URL to receive payment notification |

**Sample Request:**
```json
{
  "shortcode": "0799770833",
  "account_name": "John Doe",
  "amount": "500",
  "fee": "10",
  "mobile_network": "Airtel go",
  "chain": "CELO",
  "transaction_hash": "0x55a572efe1720250e442f38741477a4fc3f7f152e5cd208cc52f8222a1c2a13b",
  "callback_url": "https://pretium.africa/callback"
}
```

---

#### Onramp

**Endpoint:** `POST {{uri}}/v1/onramp/GHS`

| Name | Type | Description |
|---|---|---|
| shortcode | String | Customer's phone number |
| amount | Integer | Amount to collect |
| mobile_network | String | e.g. `MTN MoMo`, `AirtelTigo Money`, `Telecel Cash` |
| chain | String | e.g. `CELO`, `BASE` |
| fee | Integer | Fee amount |
| asset | String | `USDT`, `USDC`, or `CUSD` |
| address | String | Recipient wallet address |
| callback_url | URL | URL to receive payment notification |

**Sample Request:**
```json
{
  "shortcode": "0525212418",
  "amount": 50,
  "mobile_network": "MTN MoMo",
  "chain": "BASE",
  "fee": 10,
  "asset": "USDC",
  "address": "0x3Eaab84B42F9fCf2A9B3f2FDB83572B4153eE958",
  "callback_url": "https://pretium.africa/b2c/log-test"
}
```

---

### Uganda

#### Disburse

**Endpoint:** `POST {{uri}}/v1/pay/UGX`

| Name | Type | Description |
|---|---|---|
| shortcode | String | Recipient mobile number |
| amount | Integer | Amount to disburse |
| fee | Integer | Fee amount |
| mobile_network | String | e.g. `MTN`, `Airtel` |
| chain | String | e.g. `CELO` |
| transaction_hash | String | On-chain transaction hash |
| callback_url | URL | URL to receive payment notification |

**Sample Request:**
```json
{
  "shortcode": "0799770833",
  "amount": "500",
  "fee": "10",
  "mobile_network": "MTN",
  "chain": "CELO",
  "transaction_hash": "0x55a572efe1720250e442f38741477a4fc3f7f152e5cd208cc52f8222a1c2a13b",
  "callback_url": "https://pretium.africa/callback"
}
```

---

#### Onramp

**Endpoint:** `POST {{uri}}/v1/onramp/UGX`

| Name | Type | Description |
|---|---|---|
| shortcode | String | Customer's phone number |
| amount | Integer | Amount to collect |
| mobile_network | String | e.g. `MTN`, `Airtel` |
| chain | String | e.g. `CELO`, `BASE` |
| fee | Integer | Fee amount |
| asset | String | `USDT`, `USDC`, or `CUSD` |
| address | String | Recipient wallet address |
| callback_url | URL | URL to receive payment notification |

**Sample Request:**
```json
{
  "shortcode": "0725212418",
  "amount": 1000,
  "mobile_network": "MTN",
  "chain": "BASE",
  "fee": 10,
  "asset": "USDC",
  "address": "0x3Eaab84B42F9fCf2A9B3f2FDB83572B4153eE958",
  "callback_url": "https://pretium.africa/b2c/log-test"
}
```

---

### DR Congo

#### Disburse

**Endpoint:** `POST {{uri}}/v1/pay/CDF`

| Name | Type | Description |
|---|---|---|
| shortcode | String | Recipient mobile number |
| amount | Integer | Amount to disburse |
| fee | Integer | Fee amount |
| mobile_network | String | e.g. `Airtel Money`, `Mpesa`, `Orange Money` |
| chain | String | e.g. `CELO` |
| transaction_hash | String | On-chain transaction hash |
| callback_url | URL | URL to receive payment notification |

**Sample Request:**
```json
{
  "shortcode": "0799770833",
  "amount": "500",
  "fee": "10",
  "mobile_network": "Telebirr",
  "chain": "CELO",
  "transaction_hash": "0x55a572efe1720250e442f38741477a4fc3f7f152e5cd208cc52f8222a1c2a13b",
  "callback_url": "https://pretium.africa/callback"
}
```

---

#### Onramp

**Endpoint:** `POST {{uri}}/v1/onramp/CDF`

| Name | Type | Description |
|---|---|---|
| shortcode | String | Customer's phone number |
| amount | Integer | Amount to collect |
| mobile_network | String | e.g. `MPESA` |
| chain | String | e.g. `CELO`, `BASE` |
| fee | Integer | Fee amount |
| asset | String | `USDC`, `USDT`, or `CUSD` |
| address | String | Recipient wallet address |
| callback_url | URL | URL to receive payment notification |

**Sample Request:**
```json
{
  "shortcode": "0725212418",
  "amount": 1000,
  "mobile_network": "MPESA",
  "chain": "BASE",
  "fee": 10,
  "asset": "USDC",
  "address": "0x3Eaab84B42F9fCf2A9B3f2FDB83572B4153eE958",
  "callback_url": "https://pretium.africa/b2c/log-test"
}
```

---

### Malawi

#### Disburse (Mobile Money Payout)

**Endpoint:** `POST {{uri}}/v1/pay/MWK`

| Name | Type | Description |
|---|---|---|
| shortcode | String | Recipient mobile number |
| amount | Integer | Amount to disburse |
| fee | Integer | Fee amount |
| mobile_network | String | e.g. `Airtel Money` |
| chain | String | e.g. `CELO` |
| transaction_hash | String | On-chain transaction hash |
| callback_url | URL | URL to receive payment notification |

**Sample Request:**
```json
{
  "shortcode": "0799770833",
  "amount": "500",
  "fee": "10",
  "mobile_network": "Airtel Money",
  "chain": "CELO",
  "transaction_hash": "0x55a572efe1720250e442f38741477a4fc3f7f152e5cd208cc52f8222a1c2a13b",
  "callback_url": "https://pretium.africa/callback"
}
```

---

#### Onramp

**Endpoint:** `POST {{uri}}/v1/onramp/MWK`

| Name | Type | Description |
|---|---|---|
| shortcode | String | Customer's phone number |
| amount | Integer | Amount to collect |
| mobile_network | String | e.g. `Airtel Money` |
| chain | String | e.g. `CELO`, `BASE` |
| fee | Integer | Fee amount |
| asset | String | `USDT`, `USDC`, or `CUSD` |
| address | String | Recipient wallet address |
| callback_url | URL | URL to receive payment notification |

**Sample Request:**
```json
{
  "shortcode": "0725212418",
  "amount": 1000,
  "mobile_network": "Airtel Money",
  "chain": "BASE",
  "fee": 10,
  "asset": "USDC",
  "address": "0x3Eaab84B42F9fCf2A9B3f2FDB83572B4153eE958",
  "callback_url": "https://pretium.africa/b2c/log-test"
}
```

---

## Payout / Payin

Payout and Payin work identically to off-ramp and on-ramp, except **`transaction_hash` and `chain` are not included** in the request body.

### Disbursement (Payout)

**Endpoint:** `POST {{url}}/{{currencyCode}}/disburse`

| Name | Type | Description |
|---|---|---|
| type | String | `MOBILE`, `BUY_GOODS`, or `PAYBILL` |
| shortcode | String | Recipient mobile number, till, or paybill number |
| account_number | String | Required if type is `PAYBILL` |
| amount | Integer | Amount to disburse |
| mobile_network | String | e.g. `Safaricom`, `Airtel` |
| callback_url | URL | URL to receive payment notification |

**Sample Request:**
```json
{
  "amount": "50",
  "shortcode": "0700123456",
  "type": "MOBILE",
  "mobile_network": "Safaricom",
  "callback_url": "https://pretium.africa/b2c/log-test"
}
```

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Message",
  "data": { "status": "PENDING", "transaction_code": "DDM6D", "message": "Success! Processing payment..." }
}
```

---

### Collection (Payin)

**Endpoint:** `POST {{url}}/{{currencyCode}}/collect`

**Sample Request:**
```json
{
  "type": "BANK_TRANSFER",
  "account_number": "001918181",
  "bank_code": "247247",
  "amount": "500",
  "fee": "10",
  "callback_url": "https://pretium.africa/callback"
}
```

---

### Bank Transfer (Payout)

**Endpoint:** `POST {{uri}}/v1/pay/{{currencyCode}}`

**Sample Request:**
```json
{
  "amount": "50",
  "shortcode": "0700123456",
  "mobile_network": "Safaricom",
  "callback_url": "https://pretium.africa/b2c/log-test"
}
```

---

### Validation (Payout/Payin)

**Endpoint:** `POST {{url}}/{{currencyCode}}/validation`

**Sample Request:**
```json
{
  "shortcode": "0700123456",
  "type": "MOBILE",
  "network": "Safaricom"
}
```

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Validation results",
  "data": { "status": "COMPLETE", "shortcode": "0700123456", "public_name": "JOHN DOE" }
}
```

---

### Transaction Status (Payout/Payin)

**Endpoint:** `POST {{url}}/{{currencyCode}}/status`

**Sample Request:**
```json
{ "transaction_code": "fg464gggshshkkk" }
```

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Transaction",
  "data": {
    "id": 51215,
    "transaction_code": "045c1753-4e5b-4fa8-997b-ee52b78a96fa",
    "status": "COMPLETE",
    "amount": "20",
    "type": "MOBILE",
    "shortcode": "0700123456",
    "account_number": null,
    "public_name": "JOHN DOE",
    "receipt_number": "TIMCW5AK69",
    "category": "DISBURSEMENT",
    "message": "Transaction processed successfully.",
    "currency_code": "KES",
    "created_at": "2025-09-22T08:08:18.000000Z"
  }
}
```

---

## Fee Field

The `fee` field allows Pretium to collect fees on your behalf.

**How it works (Offramp example):** If your UI charges a 1% facilitation fee and a user wants to offramp KES 1,000 (KES 10 fee), deduct KES 1,010 from the user's wallet and send:

```json
{ "amount": 1010, "fee": 10 }
```

Pretium's protocol sends KES 1,000 to the user and credits KES 10 to your fiat wallet.

**How it works (Onramp example):** If a user wants to onramp KES 1,000 with a fee of 10, Pretium initiates a collection of KES 1,010 from the user, credits KES 10 to your fiat wallet, and releases assets equivalent to KES 1,000 to the user's address.

---

## Webhooks

Pretium sends **two webhook notifications** with payment states for every successful transaction.

### Payouts / Offramp Notification
Sent when a transaction is completed. Delivered to the `callback_url` set in the request body.

```json
{
  "status": "COMPLETE",
  "transaction_code": "e37c02ca-2170-4a82-ad06-d2def781cc8e",
  "receipt_number": "TKTQRBEO7A",
  "public_name": "John Doe",
  "message": "Transaction processed successfully."
}
```

### Onramp Notifications
Two callbacks are sent during the onramp flow.

**1. Payment Confirmation** — sent when Pretium successfully collects funds from the user:
```json
{
  "status": "COMPLETE",
  "transaction_code": "43cfb5f7-df7e-4d49-8749-81a128b41179",
  "receipt_number": "TKT23BLSNK",
  "public_name": "John Doe",
  "message": "Transaction processed successfully."
}
```

**2. Asset Release Notification** — sent once the user's asset has been fully released to their wallet. Use this event to mark the transaction as finalized on your platform:
```json
{
  "is_released": true,
  "transaction_code": "e37c02ca-2170-4a82-ad06-d2def781cc8e",
  "transaction_hash": "0x35ccb0b05158452a8373fe2823b0e989cbc0689bf44ff1786bc0383aadddf2a5"
}
```

---

## Utilities

### Transaction Status
Fetch a transaction by its transaction code.

**Endpoint:** `POST {{url}}/v1/status/{currency_code}`

**Body:**
```json
{ "transaction_code": "DCS3E45D" }
```

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Transaction",
  "data": {
    "id": 45229,
    "transaction_code": "DCS3E45D",
    "status": "COMPLETE",
    "amount": "287541",
    "amount_in_usd": "2229.98",
    "type": "MOBILE",
    "shortcode": "0700123456",
    "account_number": null,
    "public_name": "PUBLIC NAME",
    "receipt_number": "TI292XGAY9",
    "category": "DISBURSEMENT",
    "chain": "CELO",
    "asset": null,
    "transaction_hash": null,
    "message": "Transaction processed successfully.",
    "currency_code": "KES",
    "is_released": false,
    "created_at": "2025-09-02T12:46:13.000000Z"
  }
}
```

---

### All Transactions
Retrieve all transactions within a specified date range (up to 3-day period).

**Endpoint:** `POST {{url}}/v1/transactions/{currency_code}`

**Body:**
```json
{
  "start_date": "2025-02-19",
  "end_date": "2025-07-20"
}
```

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Transactions",
  "data": [
    {
      "id": 52146,
      "transaction_code": "9ecb7d1f-94c8-499e-ba0c-8aa951d8c65d",
      "status": "COMPLETE",
      "amount": "20",
      "amount_in_usd": "1.00",
      "type": "MOBILE",
      "shortcode": "0700123456",
      "account_number": null,
      "public_name": "PUBLIC NAME",
      "receipt_number": "TIOQR5GQRM",
      "category": "DISBURSEMENT",
      "chain": "CELO",
      "asset": "USDT",
      "transaction_hash": "0x2cc419f14f6f1fefdb58e0359480fa3451866a10668513488e71677c345339f27",
      "message": "Transaction processed successfully.",
      "currency_code": "KES",
      "is_released": false,
      "created_at": "2025-09-24T20:21:51.000000Z"
    }
  ]
}
```

---

### Phone Number Verification
Validates a phone number and returns the registered individual's name as provided by MNOs. Note: reliability varies by country — avoid heavy dependence on this for validation.

**Endpoint:** `POST {{url}}/v1/validation/{currency_code}`

**Body:**
```json
{
  "shortcode": "0700123456",
  "type": "MOBILE",
  "network": "Safaricom"
}
```

**Response — 200 Success:**
```json
{
  "code": 200,
  "message": "Validation results",
  "data": {
    "status": "COMPLETE",
    "shortcode": "0700123456",
    "public_name": "JOHN DOE"
  }
}
```

**Response — 400 Bad Request:**
```json
{ "code": 400, "message": "Failed - Bad Request" }
```

---

### Refund
Refund assets from a failed transaction that has not been confirmed by Pretium.

**Endpoint:** `POST {{uri}}/v1/refund`

| Name | Type | Description |
|---|---|---|
| chain | String | e.g. `CELO` |
| transaction_hash | String | On-chain transaction hash of the failed transaction |

**Sample Request:**
```json
{
  "chain": "CELO",
  "transaction_hash": "0xe483455c21e6eb70796f805519504295f75be608d2cc35a982013ac1bcd2c997"
}
```

**Response — 200 Success:**
```json
{
  "status": "success",
  "message": "Txn refunded.",
  "data": {
    "hash": "0xabc123def456...",
    "amount": 150,
    "token": "USDT",
    "address": "0x9f8e7d6c5b4a..."
  }
}
```

**Response — 400 (already processed):**
```json
{
  "code": 400,
  "message": "This transaction hash has already been processed."
}
```

---

### Networks
Supported blockchain networks and their corresponding assets.

| Network | Assets |
|---|---|
| CELO | USDT, USDC, CUSD |
| BASE | USDC |
| STELLAR | USDC |
| TRON | USDT |
| SCROLL | USDT |
| SOLANA | USDT, USDC |
| POLYGON | USDT, USDC |
| ETHEREUM | USDT, USDC |

---

### MNOs (Mobile Network Operators)
Supported mobile networks by country.

| Country | MNOs |
|---|---|
| Kenya | Safaricom, Airtel + All banks |
| DR Congo | Airtel Money, Mpesa, Orange Money |
| Uganda | MTN, Airtel |
| Malawi | Airtel, TNM Mpamba |
| Nigeria | All Banks |
| Ghana | MTN, AirtelTigo, Telecel |

---

### Limits
Transaction limits per country.

| Country | Lower Limit | Upper Limit |
|---|---|---|
| Kenya | KES 20 | KES 250,000 |
| Nigeria | NGN 100 | NGN 1,000,000 |
| Malawi | MWK 100 | MWK 5,000,000 |
| Uganda | UGX 500 | UGX 5,000,000 |
| Ghana | GHS 5 | GHS 5,000 |
| DR Congo | CDF 2,800 | CDF 280,000 |
| Ethiopia | ETB 10 | ETB 100,000 |

---

## Quick Reference — Endpoint Summary

| Section | Endpoint |
|---|---|
| **Account** | `POST /account/detail` |
| **Wallet Balance** | `POST /account/wallet/{country_id}` |
| **Countries** | `POST /account/countries` |
| **Exchange Rate** | `POST /v1/exchange-rate` |
| **Kenya Banks** | `POST /v1/banks/KES` |
| **Nigeria Banks** | `POST /v1/banks` |
| **Kenya Disburse (mobile/goods/paybill)** | `POST /v1/pay/KES` |
| **Kenya Bank Transfer** | `POST /v1/pay/KES` |
| **Kenya Onramp** | `POST /v1/onramp/KES` |
| **Nigeria Account Validation** | `POST /v1/validation/NGN` |
| **Nigeria Bank Transfer** | `POST /v1/pay/NGN` |
| **Ghana Disburse** | `POST /v1/pay/GHS` |
| **Ghana Onramp** | `POST /v1/onramp/GHS` |
| **Uganda Disburse** | `POST /v1/pay/UGX` |
| **Uganda Onramp** | `POST /v1/onramp/UGX` |
| **DR Congo Disburse** | `POST /v1/pay/CDF` |
| **DR Congo Onramp** | `POST /v1/onramp/CDF` |
| **Malawi Disburse** | `POST /v1/pay/MWK` |
| **Malawi Onramp** | `POST /v1/onramp/MWK` |
| **Payout Disbursement** | `POST /{{currencyCode}}/disburse` |
| **Payin Collection** | `POST /{{currencyCode}}/collect` |
| **Payout/Payin Validation** | `POST /{{currencyCode}}/validation` |
| **Payout/Payin Status** | `POST /{{currencyCode}}/status` |
| **Transaction Status** | `POST /v1/status/{currency_code}` |
| **All Transactions** | `POST /v1/transactions/{currency_code}` |
| **Phone Verification** | `POST /v1/validation/{currency_code}` |
| **Refund** | `POST /v1/refund` |

---

That's the complete picture — every section from the Pretium docs in one place. A couple of things worth flagging for your integration:

- **Ethiopia** appears in the Limits table but has no on/off-ramp endpoints documented yet — likely coming soon.
- The **Payout/Payin** section uses different URL patterns (`/{{currencyCode}}/disburse`) vs. the on/off-ramp section (`/v1/pay/{{currencyCode}}`), so double-check which flow you're integrating.
- The **`is_released` field** in transaction responses is specifically relevant for onramp flows — use it alongside the asset release webhook to confirm end-to-end completion.