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
import { TransactionApprovalServiceLive } from "../services/transaction-approval/transaction-approval-service.js";
import { AgentConversationServiceLive } from "../services/agent/agent-conversation-service.js";
import { AgentProfileServiceLive } from "../services/agent/agent-profile-service.js";
import { AgentMandateServiceLive } from "../services/agent/agent-mandate-service.js";
import { AgentActivityServiceLive } from "../services/agent/agent-activity-service.js";
import { AgentInboxServiceLive } from "../services/agent/agent-inbox-service.js";
import { CoinGeckoAdapterLive } from "../services/adapters/coingecko.js";
import { AgentAutonomyServiceLive } from "../services/agent/agent-autonomy-service.js";
import { AgentPatternServiceLive } from "../services/agent/agent-pattern-service.js";
import { MarketResearchServiceLive } from "../services/agent/market-research-service.js";
import { WebSearchServiceLive } from "../services/agent/web-search-service.js";
import { NotificationServiceLive } from "../services/notification/notification-service.js";

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
  Layer.provide(WalletServiceLayer),
  Layer.provide(ConfigLayer)
);

const LedgerServiceLayer = LedgerServiceLive.pipe(
  Layer.provide(DatabaseLayer)
);

const TransactionServiceLayer = TransactionServiceLive.pipe(
  Layer.provide(LedgerServiceLayer),
  Layer.provide(ContractExecutorLayer),
  Layer.provide(ContractRegistryLayer),
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
  Layer.provide(TransactionServiceLayer),
  Layer.provide(ConfigLayer)
);

const OnboardingServiceLayer = OnboardingServiceLive.pipe(
  Layer.provide(WalletServiceLayer),
  Layer.provide(DatabaseLayer)
);

const OfframpAdapterRegistryLayer = OfframpAdapterRegistryLive;

const PretiumServiceLayer = PretiumServiceLive.pipe(
  Layer.provide(ConfigLayer)
);

const ExchangeRateServiceLayer = ExchangeRateServiceLive.pipe(
  Layer.provide(ConfigLayer)
);

const RecurringPaymentServiceLayer = RecurringPaymentServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(TransactionServiceLayer),
  Layer.provide(ConfigLayer),
  Layer.provide(OfframpAdapterRegistryLayer),
  Layer.provide(PretiumServiceLayer),
  Layer.provide(ExchangeRateServiceLayer)
);

const YieldServiceLayer = YieldServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(TransactionServiceLayer),
  Layer.provide(ContractExecutorLayer),
  Layer.provide(ContractRegistryLayer),
  Layer.provide(WalletServiceLayer),
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

const NotificationServiceLayer = NotificationServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(ConfigLayer)
);

const GoalSavingsServiceLayer = GoalSavingsServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(YieldServiceLayer),
  Layer.provide(OnboardingServiceLayer),
  Layer.provide(ConfigLayer),
  Layer.provide(NotificationServiceLayer)
);

const TransactionApprovalServiceLayer = TransactionApprovalServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(ConfigLayer)
);

const AgentConversationServiceLayer = AgentConversationServiceLive.pipe(
  Layer.provide(DatabaseLayer)
);

const AgentProfileServiceLayer = AgentProfileServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(ConfigLayer)
);

const AgentMandateServiceLayer = AgentMandateServiceLive.pipe(
  Layer.provide(DatabaseLayer)
);

const AgentActivityServiceLayer = AgentActivityServiceLive.pipe(
  Layer.provide(DatabaseLayer)
);

const AgentInboxServiceLayer = AgentInboxServiceLive.pipe(
  Layer.provide(DatabaseLayer)
);

const MarketIntelligenceServiceLayer = CoinGeckoAdapterLive;

const MarketResearchServiceLayer = MarketResearchServiceLive.pipe(
  Layer.provide(MarketIntelligenceServiceLayer)
);

const WebSearchServiceLayer = WebSearchServiceLive;

const AgentAutonomyServiceLayer = AgentAutonomyServiceLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(AdapterServiceLayer),
  Layer.provide(WalletServiceLayer),
  Layer.provide(AgentMandateServiceLayer),
  Layer.provide(AgentProfileServiceLayer),
  Layer.provide(AgentActivityServiceLayer),
  Layer.provide(AgentInboxServiceLayer),
  Layer.provide(MarketResearchServiceLayer)
);

const AgentPatternServiceLayer = AgentPatternServiceLive.pipe(
  Layer.provide(DatabaseLayer)
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
  GoalSavingsServiceLayer,
  TransactionApprovalServiceLayer,
  AgentConversationServiceLayer,
  AgentProfileServiceLayer,
  AgentMandateServiceLayer,
  AgentActivityServiceLayer,
  MarketIntelligenceServiceLayer,
  AgentAutonomyServiceLayer,
  AgentPatternServiceLayer,
  MarketResearchServiceLayer,
  AgentInboxServiceLayer,
  WebSearchServiceLayer,
  NotificationServiceLayer
);
