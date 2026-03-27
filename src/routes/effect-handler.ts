import { Effect, ManagedRuntime, type ConfigError } from "effect";
import type { Context as HonoContext } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { WalletService } from "../services/wallet/wallet-service.js";
import type { WalletResolver } from "../services/wallet/wallet-resolver.js";
import type { ContractRegistry } from "../services/contract/contract-registry.js";
import type { ContractExecutor } from "../services/contract/contract-executor.js";
import type { LedgerService } from "../services/ledger/ledger-service.js";
import type { TransactionService } from "../services/transaction/transaction-service.js";
import type { JobberService } from "../services/jobber/jobber-service.js";
import type { HeartbeatService } from "../services/heartbeat/heartbeat-service.js";
import type { AdapterService } from "../services/adapters/adapter-service.js";
import type { DatabaseService } from "../db/client.js";
import type { ConfigService } from "../config.js";
import type { PrivyService } from "../services/wallet/privy-layer.js";
import type { OnboardingService } from "../services/onboarding/onboarding-service.js";
import type { RecurringPaymentService } from "../services/recurring-payment/recurring-payment-service.js";
import type { OfframpAdapterRegistry } from "../services/offramp/index.js";
import type { YieldService } from "../services/yield/yield-service.js";
import type { PretiumService } from "../services/pretium/pretium-service.js";
import type { ExchangeRateService } from "../services/pretium/exchange-rate-service.js";
import type { UniswapService } from "../services/uniswap/uniswap-service.js";
import type { SwapAutomationService } from "../services/swap-automation/swap-automation-service.js";
import type { GroupAccountService } from "../services/group-account/group-account-service.js";
import type { SplitExpenseService } from "../services/split-expense/split-expense-service.js";
import type { GoalSavingsService } from "../services/goal-savings/goal-savings-service.js";
import type { TransactionApprovalService } from "../services/transaction-approval/transaction-approval-service.js";
import type { AgentConversationService } from "../services/agent/agent-conversation-service.js";
import type { AgentProfileService } from "../services/agent/agent-profile-service.js";
import type { AgentMandateService } from "../services/agent/agent-mandate-service.js";
import type { AgentActivityService } from "../services/agent/agent-activity-service.js";
import type { AgentInboxService } from "../services/agent/agent-inbox-service.js";
import type { MarketIntelligenceService } from "../services/adapters/coingecko.js";
import type { AgentAutonomyService } from "../services/agent/agent-autonomy-service.js";
import type { AgentPatternService } from "../services/agent/agent-pattern-service.js";
import type { MarketResearchService } from "../services/agent/market-research-service.js";
import type { WebSearchService } from "../services/agent/web-search-service.js";
import type { CctpService } from "../services/cctp/cctp-service.js";

export type AppDeps =
  | WalletService
  | WalletResolver
  | ContractRegistry
  | ContractExecutor
  | LedgerService
  | TransactionService
  | JobberService
  | HeartbeatService
  | AdapterService
  | DatabaseService
  | ConfigService
  | PrivyService
  | OnboardingService
  | RecurringPaymentService
  | OfframpAdapterRegistry
  | YieldService
  | PretiumService
  | ExchangeRateService
  | UniswapService
  | SwapAutomationService
  | GroupAccountService
  | SplitExpenseService
  | GoalSavingsService
  | TransactionApprovalService
  | AgentConversationService
  | AgentProfileService
  | AgentMandateService
  | AgentActivityService
  | MarketIntelligenceService
  | AgentAutonomyService
  | AgentPatternService
  | MarketResearchService
  | AgentInboxService
  | WebSearchService
  | CctpService;

export type AppRuntime = ManagedRuntime.ManagedRuntime<AppDeps, ConfigError.ConfigError>;

export function runEffect<A, E>(
  runtime: AppRuntime,
  effect: Effect.Effect<A, E, NoInfer<AppDeps>>,
  c: HonoContext,
  statusCode: ContentfulStatusCode = 200
): Promise<Response> {
  return runtime
    .runPromise(
      effect.pipe(
        Effect.map((data) => ({ success: true as const, data })),
        Effect.catchAll((error) =>
          Effect.succeed({
            success: false as const,
            error: {
              _tag: (error as { _tag?: string })?._tag ?? "UnknownError",
              message: String(error),
            },
          })
        )
      )
    )
    .then((result) => {
      if (result.success) {
        return c.json(result, statusCode);
      }
      return c.json(result, 400);
    })
    .catch((error) =>
      c.json(
        {
          success: false,
          error: { _tag: "InternalError", message: String(error) },
        },
        500
      )
    );
}
