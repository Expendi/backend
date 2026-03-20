export interface FiatFeeTier {
  minAmount: number;
  maxAmount: number;
  fee: number;
}

export const FIAT_FEE_TIERS: FiatFeeTier[] = [
  { minAmount: 0,      maxAmount: 100,    fee: 1   },
  { minAmount: 101,    maxAmount: 500,    fee: 6   },
  { minAmount: 501,    maxAmount: 1000,   fee: 12  },
  { minAmount: 1001,   maxAmount: 1500,   fee: 20  },
  { minAmount: 1501,   maxAmount: 2500,   fee: 22  },
  { minAmount: 2501,   maxAmount: 3500,   fee: 25  },
  { minAmount: 3501,   maxAmount: 5000,   fee: 27  },
  { minAmount: 5001,   maxAmount: 7500,   fee: 30  },
  { minAmount: 7501,   maxAmount: 10000,  fee: 55  },
  { minAmount: 10001,  maxAmount: 15000,  fee: 64  },
  { minAmount: 15001,  maxAmount: 20000,  fee: 86  },
  { minAmount: 20001,  maxAmount: 25000,  fee: 94  },
  { minAmount: 25001,  maxAmount: 30000,  fee: 115 },
  { minAmount: 30001,  maxAmount: 35000,  fee: 150 },
  { minAmount: 35001,  maxAmount: 40000,  fee: 186 },
  { minAmount: 40001,  maxAmount: 45000,  fee: 224 },
  { minAmount: 45001,  maxAmount: 50000,  fee: 250 },
  { minAmount: 50001,  maxAmount: 70000,  fee: 320 },
  { minAmount: 70001,  maxAmount: 250000, fee: 350 },
];

export const getFiatDisbursementFee = (localCurrencyAmount: number): number => {
  const tier = FIAT_FEE_TIERS.find(
    (t) => localCurrencyAmount >= t.minAmount && localCurrencyAmount <= t.maxAmount
  );
  if (!tier) return localCurrencyAmount > 250000 ? 350 : 0;
  return tier.fee;
};

export const getFiatFeeTier = (localCurrencyAmount: number): FiatFeeTier | null => {
  const tier = FIAT_FEE_TIERS.find(
    (t) => localCurrencyAmount >= t.minAmount && localCurrencyAmount <= t.maxAmount
  );
  if (!tier && localCurrencyAmount > 250000) {
    return { minAmount: 70001, maxAmount: 250000, fee: 350 };
  }
  return tier ?? null;
};

export const getAllFiatFeeTiers = (): FiatFeeTier[] => [...FIAT_FEE_TIERS];
