import { Layer } from "effect";
import { ConfigLive } from "../config.js";
import { DatabaseLive } from "../db/client.js";
import { PrivyLive } from "../services/wallet/privy-layer.js";
import { WalletServiceLive } from "../services/wallet/wallet-service-live.js";
import { WalletResolverLive } from "../services/wallet/wallet-resolver.js";
import { ContractRegistryLive } from "../services/contract/contract-registry.js";
import { ContractExecutorLive } from "../services/contract/contract-executor.js";
import { LedgerServiceLive } from "../services/ledger/ledger-service.js";
import { TransactionServiceLive } from "../services/transaction/transaction-service.js";
import { JobberServiceLive } from "../services/jobber/jobber-service.js";
import { HeartbeatServiceLive } from "../services/heartbeat/heartbeat-service.js";
import { CoinMarketCapAdapterLive } from "../services/adapters/coinmarketcap.js";
import { OnboardingServiceLive } from "../services/onboarding/onboarding-service.js";
import { RecurringPaymentServiceLive } from "../services/recurring-payment/recurring-payment-service.js";
import { OfframpAdapterRegistryLive } from "../services/offramp/index.js";
import { YieldServiceLive } from "../services/yield/yield-service.js";
import { PretiumServiceLive } from "../services/pretium/pretium-service.js";
import { ExchangeRateServiceLive } from "../services/pretium/exchange-rate-service.js";
import { UniswapServiceLive } from "../services/uniswap/uniswap-service.js";
import { SwapAutomationServiceLive } from "../services/swap-automation/swap-automation-service.js";
import { GroupAccountServiceLive } from "../services/group-account/group-account-service.js";
import { SplitExpenseServiceLive } from "../services/split-expense/split-expense-service.js";
import { GoalSavingsServiceLive } from "../services/goal-savings/goal-savings-service.js";

const ConfigLayer = ConfigLive;

const DatabaseLayer = DatabaseLive.pipe(Layer.provide(ConfigLayer));

const PrivyLayer = PrivyLive.pipe(Layer.provide(ConfigLayer));

const WalletServiceLayer = WalletServiceLive.pipe(
  Layer.provide(PrivyLayer),
  Layer.provide(DatabaseLayer)
);

const WalletResolverLayer = WalletResolverLive.pipe(
  Layer.provide(WalletServiceLayer)
);

const ContractRegistryLayer = ContractRegistryLive;

const ContractExecutorLayer = ContractExecutorLive.pipe(
  Layer.provide(ContractRegistryLayer),
  Layer.provide(WalletServiceLayer)
);

const LedgerServiceLayer = LedgerServiceLive.pipe(
  Layer.provide(DatabaseLayer)
);

const TransactionServiceLayer = TransactionServiceLive.pipe(
  Layer.provide(LedgerServiceLayer),
  Layer.provide(ContractExecutorLayer),
  Layer.provide(WalletServiceLayer)
);

const AdapterServiceLayer = CoinMarketCapAdapterLive.pipe(
  Layer.provide(ConfigLayer)
);

const JobberServiceLayer = JobberServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(TransactionServiceLayer)
);

const HeartbeatServiceLayer = HeartbeatServiceLive.pipe(
  Layer.provide(AdapterServiceLayer),
  Layer.provide(TransactionServiceLayer)
);

const OnboardingServiceLayer = OnboardingServiceLive.pipe(
  Layer.provide(WalletServiceLayer),
  Layer.provide(DatabaseLayer)
);

const OfframpAdapterRegistryLayer = OfframpAdapterRegistryLive;

const RecurringPaymentServiceLayer = RecurringPaymentServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(TransactionServiceLayer),
  Layer.provide(ConfigLayer),
  Layer.provide(OfframpAdapterRegistryLayer)
);

const YieldServiceLayer = YieldServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(TransactionServiceLayer),
  Layer.provide(ContractExecutorLayer),
  Layer.provide(ConfigLayer)
);

const PretiumServiceLayer = PretiumServiceLive.pipe(
  Layer.provide(ConfigLayer)
);

const ExchangeRateServiceLayer = ExchangeRateServiceLive.pipe(
  Layer.provide(ConfigLayer)
);

const UniswapServiceLayer = UniswapServiceLive.pipe(
  Layer.provide(ConfigLayer)
);

const SwapAutomationServiceLayer = SwapAutomationServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(TransactionServiceLayer),
  Layer.provide(UniswapServiceLayer),
  Layer.provide(AdapterServiceLayer),
  Layer.provide(WalletServiceLayer),
  Layer.provide(ConfigLayer)
);

const GroupAccountServiceLayer = GroupAccountServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(TransactionServiceLayer),
  Layer.provide(OnboardingServiceLayer),
  Layer.provide(WalletServiceLayer),
  Layer.provide(ConfigLayer)
);

const SplitExpenseServiceLayer = SplitExpenseServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(TransactionServiceLayer),
  Layer.provide(OnboardingServiceLayer)
);

const GoalSavingsServiceLayer = GoalSavingsServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(YieldServiceLayer),
  Layer.provide(OnboardingServiceLayer),
  Layer.provide(ConfigLayer)
);

export const MainLayer = Layer.mergeAll(
  ConfigLayer,
  DatabaseLayer,
  PrivyLayer,
  WalletServiceLayer,
  WalletResolverLayer,
  ContractRegistryLayer,
  ContractExecutorLayer,
  LedgerServiceLayer,
  TransactionServiceLayer,
  AdapterServiceLayer,
  JobberServiceLayer,
  HeartbeatServiceLayer,
  OnboardingServiceLayer,
  RecurringPaymentServiceLayer,
  OfframpAdapterRegistryLayer,
  YieldServiceLayer,
  PretiumServiceLayer,
  ExchangeRateServiceLayer,
  UniswapServiceLayer,
  SwapAutomationServiceLayer,
  GroupAccountServiceLayer,
  SplitExpenseServiceLayer,
  GoalSavingsServiceLayer
);
