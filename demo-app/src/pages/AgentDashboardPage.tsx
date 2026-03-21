import { useState, useEffect, useRef, useCallback } from "react";
import { useApi, ApiRequestError } from "../hooks/useApi";
import { useApprovalContext } from "../context/ApprovalContext";
import { useDashboard } from "../context/DashboardContext";
import { usePreferences } from "../context/PreferencesContext";
import { ONRAMP_COUNTRIES, OFFRAMP_COUNTRIES, ONRAMP_ASSETS } from "../lib/constants";
import type { OnrampTransaction, OfframpTransaction, FeeEstimate } from "../lib/types";
import "../styles/agent-dashboard.css";

/* ─── Types ──────────────────────────────────────────────────────── */

interface AgentWalletBalance {
  walletId: string;
  address: string;
  balances: { ETH: string; USDC: string };
}

interface AgentProfile {
  id: string;
  trustTier: TrustTier;
  budgetLimit: string;
  interests: string[];
  goals: string[];
  riskTolerance: RiskTolerance;
  knowledgeLevel: KnowledgeLevel;
  customInstructions: string;
}

/** Flatten the raw API response into our AgentProfile shape */
function parseAgentProfile(raw: Record<string, unknown>): AgentProfile {
  const profile = (raw.profile ?? {}) as Record<string, unknown>;
  return {
    id: String(raw.id ?? ""),
    trustTier: (raw.trustTier ?? "observe") as TrustTier,
    budgetLimit: String(raw.agentBudget ?? raw.budgetLimit ?? "0"),
    interests: Array.isArray(profile.interests) ? profile.interests : [],
    goals: Array.isArray(profile.goals) ? profile.goals : [],
    riskTolerance: (profile.riskTolerance ?? "moderate") as RiskTolerance,
    knowledgeLevel: (profile.knowledgeLevel ?? "beginner") as KnowledgeLevel,
    customInstructions: String(profile.customInstructions ?? ""),
  };
}

type TrustTier = "observe" | "notify" | "act_within_limits" | "full";
type RiskTolerance = "conservative" | "moderate" | "aggressive";
type KnowledgeLevel = "beginner" | "intermediate" | "advanced";

interface MandateTrigger {
  type: string;
  frequency?: string;
  token?: string;
  condition?: string;
  value?: number;
  wallet?: string;
}

interface MandateAction {
  type: string;
  from?: string;
  to?: string;
  amount?: string;
  message?: string;
  goalId?: string;
  phone?: string;
  country?: string;
}

type AutomationFlowStep = "idle" | "picking_template" | "filling_form" | "confirming";
type TemplateKey = "dca" | "price_alert" | "auto_cashout" | "auto_save" | "custom";

interface DcaFormState {
  token: string;
  amount: string;
  frequency: string;
  name: string;
}

interface PriceAlertFormState {
  token: string;
  condition: string;
  price: string;
  name: string;
}

interface AutoCashoutFormState {
  threshold: string;
  phone: string;
  name: string;
}

interface AutoSaveFormState {
  amount: string;
  frequency: string;
  goalName: string;
  name: string;
}

interface CustomFormState {
  name: string;
  triggerType: string;
  triggerFrequency: string;
  triggerToken: string;
  triggerCondition: string;
  triggerValue: string;
  triggerWallet: string;
  actionType: string;
  actionFrom: string;
  actionTo: string;
  actionAmount: string;
  actionMessage: string;
  actionGoalId: string;
  actionPhone: string;
}

interface Mandate {
  id: string;
  name: string;
  type: string;
  status: "active" | "paused" | "expired" | "revoked";
  executionCount: number;
  createdAt: string;
  lastExecutedAt?: string;
  description?: string;
  trigger?: MandateTrigger;
  action?: MandateAction;
}

interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description?: string;
  createdAt: string;
}

interface PendingRequest {
  id: string;
  title: string;
  description: string;
  type: string;
  createdAt: string;
}

/* ─── Constants ──────────────────────────────────────────────────── */

const TRUST_TIER_LABELS: Record<TrustTier, string> = {
  observe: "Observe",
  notify: "Notify",
  act_within_limits: "Act (Limited)",
  full: "Full Access",
};

const TRUST_TIER_DESCRIPTIONS: Record<TrustTier, string> = {
  observe: "The agent monitors your portfolio and market conditions but takes no actions. You stay fully in control.",
  notify: "The agent monitors and sends you notifications with suggestions, but waits for your approval before acting.",
  act_within_limits: "The agent can execute transactions within your budget limits and rules without asking first.",
  full: "The agent has full authority to manage your portfolio, execute trades, and make decisions on your behalf.",
};

const TRUST_TIERS: TrustTier[] = ["observe", "notify", "act_within_limits", "full"];
const RISK_LEVELS: RiskTolerance[] = ["conservative", "moderate", "aggressive"];
const KNOWLEDGE_LEVELS: KnowledgeLevel[] = ["beginner", "intermediate", "advanced"];

/* ─── Helpers ────────────────────────────────────────────────────── */

function formatBaseUnits(raw: string, decimals: number): string {
  const n = BigInt(raw || "0");
  const divisor = BigInt(10 ** decimals);
  const whole = n / divisor;
  const frac = n % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

function toBaseUnits(humanAmount: string, decimals: number): string {
  const parts = humanAmount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac)).toString();
}

function friendlyFrequency(freq?: string): string {
  if (!freq) return "on a schedule";
  switch (freq) {
    case "1d": return "daily";
    case "7d": return "every week";
    case "30d": return "every month";
    default: return `every ${freq}`;
  }
}

function friendlyFrequencyAdverb(freq?: string): string {
  if (!freq) return "periodically";
  switch (freq) {
    case "1d": return "daily";
    case "7d": return "weekly";
    case "30d": return "monthly";
    default: return `every ${freq}`;
  }
}

function formatUsdValue(value?: number): string {
  if (value === undefined || value === null) return "$?";
  return `$${value.toLocaleString()}`;
}

function summarizeMandate(trigger?: MandateTrigger, action?: MandateAction): string {
  if (!trigger && !action) return "Manual automation";

  if (action?.type === "swap" && trigger?.type === "schedule") {
    const amt = action.amount ? formatBaseUnits(action.amount, 6) : "?";
    return `Buy ${amt} ${action.from ?? "USDC"} of ${action.to ?? "?"} ${friendlyFrequency(trigger.frequency)}`;
  }

  if (action?.type === "notify" && trigger?.type === "price") {
    const direction = trigger.condition === "below" ? "drops below" : "rises above";
    return `Notify when ${trigger.token ?? "?"} ${direction} ${formatUsdValue(trigger.value)}`;
  }

  if (action?.type === "offramp" && trigger?.type === "balance") {
    const threshold = trigger.value !== undefined ? formatBaseUnits(String(trigger.value), 0) : "?";
    return `Auto cash-out when ${trigger.token ?? "USDC"} > ${threshold}`;
  }

  if (action?.type === "goal_deposit" && trigger?.type === "schedule") {
    const amt = action.amount ? formatBaseUnits(action.amount, 6) : "?";
    return `Save ${amt} USDC ${friendlyFrequencyAdverb(trigger.frequency)}`;
  }

  const triggerStr = summarizeTrigger(trigger);
  const actionStr = summarizeAction(action);
  return `${triggerStr} → ${actionStr}`;
}

function summarizeTrigger(trigger?: MandateTrigger): string {
  if (!trigger) return "Manual";
  switch (trigger.type) {
    case "schedule":
      return friendlyFrequency(trigger.frequency).replace(/^./, (c) => c.toUpperCase());
    case "price": {
      const direction = trigger.condition === "below" ? "drops below" : "rises above";
      return `When ${trigger.token ?? "?"} ${direction} ${formatUsdValue(trigger.value)}`;
    }
    case "balance": {
      const threshold = trigger.value !== undefined ? String(trigger.value) : "?";
      return `When ${trigger.token ?? "USDC"} balance exceeds ${threshold}`;
    }
    default:
      return trigger.type;
  }
}

function summarizeAction(action?: MandateAction): string {
  if (!action) return "No action";
  switch (action.type) {
    case "swap": {
      const amt = action.amount ? formatBaseUnits(action.amount, 6) : "?";
      return `Buy ${amt} ${action.from ?? "USDC"} of ${action.to ?? "?"}`;
    }
    case "notify":
      return action.message ?? "Send notification";
    case "goal_deposit": {
      const amt = action.amount ? formatBaseUnits(action.amount, 6) : "?";
      return `Deposit ${amt} USDC to goal`;
    }
    case "offramp":
      return `Cash out to ${action.phone ?? "phone"}`;
    default:
      return action.type;
  }
}

function formatTimeAgo(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getActivityIconClass(type: string): string {
  switch (type) {
    case "swap": return "swap";
    case "transfer": case "send": return "transfer";
    case "approval": case "approval_request": return "approval";
    case "alert": case "warning": return "alert";
    default: return "insight";
  }
}

/* ─── SVG Icons ──────────────────────────────────────────────────── */

const SwapIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);

const SendIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" />
  </svg>
);

const BellIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const AlertIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const LightbulbIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18h6" /><path d="M10 22h4" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
  </svg>
);

const PauseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
  </svg>
);

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const RepeatIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);

const BellLargeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const CashOutIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="15" /><polyline points="16 11 12 15 8 11" /><path d="M20 21H4" /><path d="M20 17H4" />
  </svg>
);

const PiggyBankIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2" />
    <path d="M2 9.5a1 1 0 0 1 1-1 1.5 1.5 0 0 1 0 3 1 1 0 0 1-1-1" /><circle cx="12.5" cy="9.5" r="1" />
  </svg>
);

const WrenchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const WarningIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

function ActivityTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "swap": return <SwapIcon />;
    case "transfer": case "send": return <SendIcon />;
    case "approval": case "approval_request": return <BellIcon />;
    case "alert": case "warning": return <AlertIcon />;
    default: return <LightbulbIcon />;
  }
}

/* ─── Agent Wallet Card ──────────────────────────────────────────── */

type WalletModalMode = "fund" | "withdraw" | null;
type WalletModalTab = "transfer" | "buy" | "sell";
type WalletModalStep = "input" | "review" | "processing" | "success" | "error";
type TransferToken = "USDC" | "ETH";
type TransferWalletType = "user" | "server";

const TOKEN_DECIMALS_MAP: Record<TransferToken, number> = { USDC: 6, ETH: 18 };

const PAYMENT_TYPE_LABELS_WALLET: Record<string, string> = {
  MOBILE: "Mobile Money",
  BUY_GOODS: "Buy Goods (Till)",
  PAYBILL: "Paybill",
  BANK_TRANSFER: "Bank Transfer",
};

const WALLET_LABELS: Record<TransferWalletType, string> = {
  user: "Personal",
  server: "Custodial",
};

function AgentWalletCard() {
  const { request } = useApi();
  const approvalCtx = useApprovalContext();
  const { walletBalances, refresh: refreshDashboard } = useDashboard();
  const { preferences } = usePreferences();

  const [balance, setBalance] = useState<AgentWalletBalance | null>(null);
  const [budgetLimit, setBudgetLimit] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalMode, setModalMode] = useState<WalletModalMode>(null);
  const [modalClosing, setModalClosing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [balData, profileData] = await Promise.all([
        request<AgentWalletBalance>("/agent/wallet/balance"),
        request<Record<string, unknown>>("/agent/profile").then(parseAgentProfile),
      ]);
      setBalance(balData);
      setBudgetLimit(profileData.budgetLimit ?? "0");
    } catch {
      // Leave as null to show empty state
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openModal = (mode: WalletModalMode) => {
    setModalMode(mode);
    setModalClosing(false);
  };

  const closeModal = useCallback(() => {
    setModalClosing(true);
    setTimeout(() => {
      setModalMode(null);
      setModalClosing(false);
    }, 200);
  }, []);

  const handleSuccess = useCallback(() => {
    fetchData();
    refreshDashboard();
  }, [fetchData, refreshDashboard]);

  if (loading) {
    return (
      <div className="ad-card">
        <div className="ad-card-header">
          <span className="ad-card-title">Agent Wallet</span>
        </div>
        <div className="ad-loading">
          <div className="ad-skeleton lg" />
          <div className="ad-skeleton md" />
          <div className="ad-skeleton sm" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="ad-card">
        <div className="ad-card-header">
          <span className="ad-card-title">Agent Wallet</span>
        </div>
        <div className="ad-wallet-balances">
          <div className="ad-wallet-row">
            <span className="ad-wallet-token">USDC</span>
            <span className="ad-wallet-amount">{balance?.balances?.USDC ? formatBaseUnits(balance.balances.USDC, 6) : "0"}</span>
          </div>
          <div className="ad-wallet-row">
            <span className="ad-wallet-token">ETH</span>
            <span className="ad-wallet-amount">{balance?.balances?.ETH ? formatBaseUnits(balance.balances.ETH, 18) : "0"}</span>
          </div>
        </div>
        {budgetLimit && budgetLimit !== "0" && (
          <div className="ad-wallet-budget">
            <span className="ad-wallet-budget-label">Budget Limit</span>
            <span className="ad-wallet-budget-value">{budgetLimit} USDC</span>
          </div>
        )}
        <div className="ad-wallet-actions">
          <button className="btn-exo btn-primary" onClick={() => openModal("fund")}>Fund</button>
          <button className="btn-exo btn-secondary" onClick={() => openModal("withdraw")}>Withdraw</button>
        </div>
      </div>

      {modalMode && (
        <AgentWalletModal
          mode={modalMode}
          closing={modalClosing}
          onClose={closeModal}
          onSuccess={handleSuccess}
          agentBalance={balance}
          walletBalances={walletBalances}
          preferences={preferences}
          request={request}
          approvalCtx={approvalCtx}
        />
      )}
    </>
  );
}

/* ─── Agent Wallet Modal ─────────────────────────────────────────── */

interface AgentWalletModalProps {
  mode: "fund" | "withdraw";
  closing: boolean;
  onClose: () => void;
  onSuccess: () => void;
  agentBalance: AgentWalletBalance | null;
  walletBalances: { walletId: string; type: string; address: string; balances: Record<string, string> }[];
  preferences: { country?: string; currency?: string; phoneNumber?: string; mobileNetwork?: string };
  request: <T>(path: string, options?: { method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; body?: unknown; approvalToken?: string | null; query?: Record<string, string | number | undefined> }) => Promise<T>;
  approvalCtx: ReturnType<typeof useApprovalContext>;
}

function AgentWalletModal({
  mode, closing, onClose, onSuccess,
  agentBalance, walletBalances, preferences,
  request, approvalCtx,
}: AgentWalletModalProps) {
  const isFund = mode === "fund";
  const defaultTab: WalletModalTab = isFund ? "transfer" : "transfer";
  const [tab, setTab] = useState<WalletModalTab>(defaultTab);
  const [step, setStep] = useState<WalletModalStep>("input");

  // Transfer state
  const [transferToken, setTransferToken] = useState<TransferToken>("USDC");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferWallet, setTransferWallet] = useState<TransferWalletType>("user");
  const [transferError, setTransferError] = useState("");
  const [transferTxHash, setTransferTxHash] = useState<string | null>(null);

  // Buy (onramp) state
  type OnrampCountryCode = typeof ONRAMP_COUNTRIES[number]["code"];
  type OfframpCountryCode = typeof OFFRAMP_COUNTRIES[number]["code"];
  const defaultBuyCountry = ONRAMP_COUNTRIES.find(c => c.code === preferences.country) ?? ONRAMP_COUNTRIES[0];
  const [buyCountry, setBuyCountry] = useState<OnrampCountryCode>(defaultBuyCountry.code);
  const [buyFiatAmount, setBuyFiatAmount] = useState("");
  const [buyPhone, setBuyPhone] = useState(preferences.phoneNumber ?? "");
  const [buyNetwork, setBuyNetwork] = useState(preferences.mobileNetwork ?? defaultBuyCountry.networks[0] ?? "");
  const [buyAsset, setBuyAsset] = useState<string>("USDC");
  const [buyError, setBuyError] = useState("");
  const [buyResult, setBuyResult] = useState<OnrampTransaction | null>(null);

  // Sell (offramp) state
  const defaultSellCountry = OFFRAMP_COUNTRIES.find(c => c.code === preferences.country) ?? OFFRAMP_COUNTRIES[0];
  const [sellCountry, setSellCountry] = useState<OfframpCountryCode>(defaultSellCountry.code);
  const [sellUsdcAmount, setSellUsdcAmount] = useState("");
  const [sellPhone, setSellPhone] = useState(preferences.phoneNumber ?? "");
  const [sellNetwork, setSellNetwork] = useState(preferences.mobileNetwork ?? defaultSellCountry.networks[0] ?? "");
  const [sellPaymentType, setSellPaymentType] = useState<string>(defaultSellCountry.paymentTypes[0] ?? "MOBILE");
  const [sellError, setSellError] = useState("");
  const [sellResult, setSellResult] = useState<OfframpTransaction | null>(null);

  // Bank transfer fields
  const [sellBankAccount, setSellBankAccount] = useState("");
  const [sellBankCode, setSellBankCode] = useState("");
  const [sellBankName, setSellBankName] = useState("");
  const [sellAccountName, setSellAccountName] = useState("");
  const [sellAccountNumber, setSellAccountNumber] = useState("");
  const [banks, setBanks] = useState<{ Code: string; Name: string }[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);

  // Exchange rate state
  const [buyingRate, setBuyingRate] = useState<number | null>(null);
  const [sellingRate, setSellingRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  // Fee state
  const [buyFee, setBuyFee] = useState<number | null>(null);
  const [buyNetAmount, setBuyNetAmount] = useState<number | null>(null);
  const [sellFee, setSellFee] = useState<number | null>(null);
  const [sellNetAmount, setSellNetAmount] = useState<number | null>(null);

  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
  }, []);

  // Request with approval support
  const requestWithApproval = useCallback(
    async <T,>(path: string, options?: { method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; body?: unknown }) => {
      try {
        return await request<T>(path, options);
      } catch (err) {
        if (err instanceof ApiRequestError && err._tag === "TransactionApprovalRequired" && approvalCtx) {
          const token = await approvalCtx.requestApproval(err.method ?? "pin");
          if (!token) throw new Error("Approval cancelled");
          return request<T>(path, { ...options, approvalToken: token });
        }
        throw err;
      }
    },
    [request, approvalCtx]
  );

  // Country objects
  const buyCountryObj = ONRAMP_COUNTRIES.find(c => c.code === buyCountry) ?? ONRAMP_COUNTRIES[0];
  const sellCountryObj = OFFRAMP_COUNTRIES.find(c => c.code === sellCountry) ?? OFFRAMP_COUNTRIES[0];

  // Fetch exchange rate
  const fetchRate = useCallback(async (currency: string) => {
    setRateLoading(true);
    try {
      const data = await request<{ buyingRate: number; sellingRate: number }>(`/pretium/exchange-rate/${currency}`);
      setBuyingRate(data.buyingRate);
      setSellingRate(data.sellingRate);
    } catch {
      setBuyingRate(null);
      setSellingRate(null);
    } finally {
      setRateLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (tab === "buy") fetchRate(buyCountryObj.currency);
    if (tab === "sell") fetchRate(sellCountryObj.currency);
  }, [tab, buyCountry, sellCountry, fetchRate, buyCountryObj.currency, sellCountryObj.currency]);

  // Update network when buy country changes
  useEffect(() => {
    setBuyNetwork(buyCountryObj.networks[0] ?? "");
  }, [buyCountry, buyCountryObj.networks]);

  // Update sell fields when country/payment type changes
  useEffect(() => {
    setSellNetwork(sellCountryObj.networks[0] ?? "");
    setSellPaymentType(sellCountryObj.paymentTypes[0] ?? "MOBILE");
    setSellBankAccount("");
    setSellBankCode("");
    setSellBankName("");
    setSellAccountName("");
    setSellAccountNumber("");
    setSellPhone(preferences.phoneNumber ?? "");
  }, [sellCountry, sellCountryObj.networks, sellCountryObj.paymentTypes, preferences.phoneNumber]);

  useEffect(() => {
    setSellBankAccount("");
    setSellBankCode("");
    setSellBankName("");
    setSellAccountName("");
    setSellAccountNumber("");
    if (sellPaymentType === "MOBILE") {
      setSellPhone(preferences.phoneNumber ?? "");
    } else {
      setSellPhone("");
    }
  }, [sellPaymentType, preferences.phoneNumber]);

  // Fetch banks for bank transfer
  useEffect(() => {
    if (sellPaymentType !== "BANK_TRANSFER" || (sellCountry !== "KE" && sellCountry !== "NG")) {
      setBanks([]);
      return;
    }
    let cancelled = false;
    setBanksLoading(true);
    request<{ Code: string; Name: string }[]>(`/pretium/banks/${sellCountry}`)
      .then(data => {
        if (!cancelled) {
          setBanks(data);
          if (data.length > 0) {
            setSellBankCode(data[0].Code);
            setSellBankName(data[0].Name);
          }
        }
      })
      .catch(() => { if (!cancelled) setBanks([]); })
      .finally(() => { if (!cancelled) setBanksLoading(false); });
    return () => { cancelled = true; };
  }, [sellPaymentType, sellCountry, request]);

  // Conversions
  const buyConversion = buyingRate && buyFiatAmount && Number(buyFiatAmount) > 0
    ? (Number(buyFiatAmount) / buyingRate).toFixed(2) : null;
  const sellConversion = sellingRate && sellUsdcAmount && Number(sellUsdcAmount) > 0
    ? (Number(sellUsdcAmount) * sellingRate).toFixed(0) : null;

  // Buy fee estimate
  useEffect(() => {
    if (!buyFiatAmount || Number(buyFiatAmount) <= 0) { setBuyFee(null); setBuyNetAmount(null); return; }
    let cancelled = false;
    request<FeeEstimate>(`/pretium/fee-estimate`, { query: { amount: buyFiatAmount } })
      .then(data => { if (!cancelled) { setBuyFee(data.fee); setBuyNetAmount(data.netAmount); } })
      .catch(() => { if (!cancelled) { setBuyFee(null); setBuyNetAmount(null); } });
    return () => { cancelled = true; };
  }, [buyFiatAmount, request]);

  // Sell fee estimate
  useEffect(() => {
    if (!sellConversion || Number(sellConversion) <= 0) { setSellFee(null); setSellNetAmount(null); return; }
    let cancelled = false;
    request<FeeEstimate>(`/pretium/fee-estimate`, { query: { amount: sellConversion } })
      .then(data => { if (!cancelled) { setSellFee(data.fee); setSellNetAmount(data.netAmount); } })
      .catch(() => { if (!cancelled) { setSellFee(null); setSellNetAmount(null); } });
    return () => { cancelled = true; };
  }, [sellConversion, request]);

  // Get source/dest wallet balance for transfer tab
  const getWalletBalance = (walletType: string, token: TransferToken): string => {
    if (walletType === "agent") {
      return agentBalance?.balances?.[token] ?? "0";
    }
    const wallet = walletBalances.find(w => w.type === walletType);
    return wallet?.balances?.[token] ?? "0";
  };

  const transferSourceType = isFund ? transferWallet : "agent";
  const transferDestType = isFund ? "agent" : transferWallet;
  const transferSourceBalance = getWalletBalance(transferSourceType, transferToken);
  const transferSourceBalanceHuman = formatBaseUnits(transferSourceBalance, TOKEN_DECIMALS_MAP[transferToken]);
  const transferMaxAmount = formatBaseUnits(transferSourceBalance, TOKEN_DECIMALS_MAP[transferToken]);

  // Agent wallet ID for onramp/offramp
  const agentWalletId = agentBalance?.walletId ?? "";
  const agentAddress = agentBalance?.address ?? "";

  // Transfer validation
  const transferValidationError = (() => {
    if (!transferAmount || Number(transferAmount) <= 0) return "Enter an amount";
    const amountBase = BigInt(toBaseUnits(transferAmount, TOKEN_DECIMALS_MAP[transferToken]));
    const balBase = BigInt(transferSourceBalance);
    if (amountBase > balBase) return "Insufficient balance";
    if (amountBase === 0n) return "Amount must be greater than zero";
    return null;
  })();

  // Sell validation
  const isSellValid = (() => {
    if (!sellUsdcAmount || Number(sellUsdcAmount) <= 0) return false;
    switch (sellPaymentType) {
      case "MOBILE": return !!sellPhone && !!sellNetwork;
      case "BUY_GOODS": return !!sellPhone;
      case "PAYBILL": return !!sellPhone && !!sellAccountNumber;
      case "BANK_TRANSFER":
        if (sellCountry === "NG") return !!sellBankAccount && !!sellBankCode && !!sellAccountName;
        return !!sellBankAccount && !!sellBankCode;
      default: return false;
    }
  })();

  // Handle transfer
  const handleTransfer = async () => {
    setStep("processing");
    setTransferError("");
    setTransferTxHash(null);
    try {
      const body: Record<string, string> = {
        from: transferSourceType,
        to: transferDestType,
        amount: toBaseUnits(transferAmount, TOKEN_DECIMALS_MAP[transferToken]),
      };
      if (transferToken === "USDC") body.token = "usdc";
      const result = await requestWithApproval<{ txHash?: string }>("/wallets/transfer", { method: "POST", body });
      setTransferTxHash(result.txHash ?? null);
      setStep("success");
      onSuccess();
      autoCloseRef.current = setTimeout(onClose, 4000);
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Transfer failed");
      setStep("error");
    }
  };

  // Handle buy (onramp to agent wallet)
  const handleBuy = async () => {
    setStep("processing");
    setBuyError("");
    try {
      const result = await requestWithApproval<OnrampTransaction>("/pretium/onramp", {
        method: "POST",
        body: {
          country: buyCountry,
          walletId: agentWalletId,
          fiatAmount: Number(buyFiatAmount),
          phoneNumber: buyPhone,
          mobileNetwork: buyNetwork,
          asset: buyAsset,
          address: agentAddress,
        },
      });
      setBuyResult(result);
      setStep("success");
      onSuccess();
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : "Transaction failed");
      setStep("error");
    }
  };

  // Handle sell (offramp from agent wallet)
  const handleSell = async () => {
    setStep("processing");
    setSellError("");
    try {
      const body: Record<string, unknown> = {
        country: sellCountry,
        walletId: agentWalletId,
        usdcAmount: Number(sellUsdcAmount),
        phoneNumber: sellPhone,
        mobileNetwork: sellNetwork,
        paymentType: sellPaymentType,
      };
      if (sellPaymentType === "BANK_TRANSFER") {
        body.bankAccount = sellBankAccount;
        body.bankCode = sellBankCode;
        body.bankName = sellBankName;
        if (sellCountry === "NG") body.accountName = sellAccountName;
      }
      if (sellPaymentType === "PAYBILL") body.accountNumber = sellAccountNumber;
      const result = await requestWithApproval<OfframpTransaction>("/pretium/offramp", { method: "POST", body });
      setSellResult(result);
      setStep("success");
      onSuccess();
    } catch (err) {
      setSellError(err instanceof Error ? err.message : "Transaction failed");
      setStep("error");
    }
  };

  // Reset step when switching tabs
  const handleTabChange = (newTab: WalletModalTab) => {
    setTab(newTab);
    setStep("input");
    setTransferError("");
    setBuyError("");
    setSellError("");
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && step !== "processing") onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "processing") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  const currentError = tab === "transfer" ? transferError : tab === "buy" ? buyError : sellError;

  return (
    <div className={`awm-overlay${closing ? " closing" : ""}`} onClick={handleOverlayClick} role="dialog" aria-modal="true">
      <div className="awm-card">
        {/* Header */}
        <div className="awm-header">
          <span className="awm-title">{isFund ? "Fund Agent Wallet" : "Withdraw from Agent Wallet"}</span>
          {step !== "processing" && (
            <button className="awm-close" onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Tab selector */}
        {step === "input" && (
          <div className="awm-tabs">
            <button className={`awm-tab${tab === "transfer" ? " active" : ""}`} onClick={() => handleTabChange("transfer")}>Transfer</button>
            <button
              className={`awm-tab${tab === (isFund ? "buy" : "sell") ? " active" : ""}`}
              onClick={() => handleTabChange(isFund ? "buy" : "sell")}
            >
              {isFund ? "Buy" : "Sell"}
            </button>
          </div>
        )}

        <div className="awm-body">
          {/* ─── Processing ─── */}
          {step === "processing" && (
            <div className="awm-feedback">
              <div className="awm-spinner" />
              <div className="awm-feedback-title">Processing...</div>
              <div className="awm-feedback-sub">
                {tab === "transfer" ? "Transferring between wallets" : tab === "buy" ? "Check your phone for the payment prompt" : "Sending USDC and initiating payout"}
              </div>
            </div>
          )}

          {/* ─── Success ─── */}
          {step === "success" && (
            <div className="awm-feedback">
              <div className="awm-success-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="awm-feedback-title">
                {tab === "transfer" ? "Transfer complete" : tab === "buy" ? "Funding initiated" : "Withdrawal initiated"}
              </div>
              {tab === "transfer" && transferTxHash && (
                <a className="awm-tx-link" href={`https://basescan.org/tx/${transferTxHash}`} target="_blank" rel="noopener noreferrer">
                  {transferTxHash.slice(0, 10)}...{transferTxHash.slice(-6)}
                </a>
              )}
              {tab === "buy" && buyResult && (
                <div className="awm-feedback-sub">{buyResult.fiatAmount} {buyResult.currency} for {buyAsset}</div>
              )}
              {tab === "sell" && sellResult && (
                <div className="awm-feedback-sub">{sellResult.usdcAmount} USDC for {sellResult.fiatAmount} {sellResult.currency}</div>
              )}
              <div className="awm-actions">
                <button className="btn-exo btn-secondary" onClick={onClose}>Close</button>
              </div>
            </div>
          )}

          {/* ─── Error ─── */}
          {step === "error" && (
            <div className="awm-feedback">
              <div className="awm-error-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <div className="awm-feedback-title">Transaction failed</div>
              <div className="awm-feedback-sub">{currentError}</div>
              <div className="awm-actions">
                <button className="btn-exo btn-secondary" onClick={() => setStep("review")}>Back to review</button>
                <button className="btn-exo btn-primary" onClick={() => {
                  if (tab === "transfer") handleTransfer();
                  else if (tab === "buy") handleBuy();
                  else handleSell();
                }}>Retry</button>
              </div>
            </div>
          )}

          {/* ─── Review ─── */}
          {step === "review" && (
            <div className="awm-review">
              {tab === "transfer" && (
                <>
                  <div className="awm-review-amount">
                    <span className="awm-review-amount-value">{transferAmount}</span>
                    <span className="awm-review-amount-symbol">{transferToken}</span>
                  </div>
                  <div className="awm-review-details">
                    <div className="awm-review-row"><span className="awm-review-label">Token</span><span className="awm-review-value">{transferToken}</span></div>
                    <div className="awm-review-row"><span className="awm-review-label">From</span><span className="awm-review-value">{isFund ? WALLET_LABELS[transferWallet] : "Agent"} wallet</span></div>
                    <div className="awm-review-row"><span className="awm-review-label">To</span><span className="awm-review-value">{isFund ? "Agent" : WALLET_LABELS[transferWallet]} wallet</span></div>
                    <div className="awm-review-row"><span className="awm-review-label">Network</span><span className="awm-review-value">Base</span></div>
                  </div>
                  <div className="awm-actions">
                    <button className="btn-exo btn-secondary" onClick={() => setStep("input")}>Back</button>
                    <button className="btn-exo btn-primary" onClick={handleTransfer}>Confirm transfer</button>
                  </div>
                </>
              )}

              {tab === "buy" && (
                <>
                  <div className="awm-review-details">
                    <div className="awm-review-row"><span className="awm-review-label">You Pay</span><span className="awm-review-value">{Number(buyFiatAmount).toLocaleString()} {buyCountryObj.currency}</span></div>
                    {buyFee !== null && (
                      <div className="awm-review-row"><span className="awm-review-label">Fee</span><span className="awm-review-value">{buyFee.toLocaleString()} {buyCountryObj.currency}</span></div>
                    )}
                    {buyNetAmount !== null && (
                      <div className="awm-review-row"><span className="awm-review-label">Net Amount</span><span className="awm-review-value">{buyNetAmount.toLocaleString()} {buyCountryObj.currency}</span></div>
                    )}
                    <div className="awm-review-row"><span className="awm-review-label">You Receive</span><span className="awm-review-value" style={{ color: "var(--exo-lime)" }}>~{buyConversion} {buyAsset}</span></div>
                    <div className="awm-review-row"><span className="awm-review-label">Rate</span><span className="awm-review-value">1 USD = {buyingRate} {buyCountryObj.currency}</span></div>
                    <div className="awm-review-row"><span className="awm-review-label">Phone</span><span className="awm-review-value">{buyPhone}</span></div>
                    <div className="awm-review-row"><span className="awm-review-label">Network</span><span className="awm-review-value">{buyNetwork}</span></div>
                    <div className="awm-review-row"><span className="awm-review-label">Destination</span><span className="awm-review-value">Agent wallet</span></div>
                  </div>
                  <div className="awm-actions">
                    <button className="btn-exo btn-secondary" onClick={() => setStep("input")}>Back</button>
                    <button className="btn-exo btn-primary" onClick={handleBuy}>Add funding</button>
                  </div>
                </>
              )}

              {tab === "sell" && (
                <>
                  <div className="awm-review-details">
                    <div className="awm-review-row"><span className="awm-review-label">You Sell</span><span className="awm-review-value">{sellUsdcAmount} USDC</span></div>
                    <div className="awm-review-row"><span className="awm-review-label">Gross Amount</span><span className="awm-review-value">~{Number(sellConversion).toLocaleString()} {sellCountryObj.currency}</span></div>
                    {sellFee !== null && (
                      <div className="awm-review-row"><span className="awm-review-label">Fee</span><span className="awm-review-value">{sellFee.toLocaleString()} {sellCountryObj.currency}</span></div>
                    )}
                    <div className="awm-review-row">
                      <span className="awm-review-label">You Receive</span>
                      <span className="awm-review-value" style={{ color: "var(--exo-lime)" }}>
                        ~{sellNetAmount !== null ? sellNetAmount.toLocaleString() : Number(sellConversion).toLocaleString()} {sellCountryObj.currency}
                      </span>
                    </div>
                    <div className="awm-review-row"><span className="awm-review-label">Rate</span><span className="awm-review-value">1 USD = {sellingRate} {sellCountryObj.currency}</span></div>
                    <div className="awm-review-row"><span className="awm-review-label">Payment</span><span className="awm-review-value">{PAYMENT_TYPE_LABELS_WALLET[sellPaymentType] ?? sellPaymentType}</span></div>
                    <div className="awm-review-row"><span className="awm-review-label">Source</span><span className="awm-review-value">Agent wallet</span></div>

                    {sellPaymentType === "MOBILE" && (
                      <>
                        <div className="awm-review-row"><span className="awm-review-label">Phone</span><span className="awm-review-value">{sellPhone}</span></div>
                        <div className="awm-review-row"><span className="awm-review-label">Network</span><span className="awm-review-value">{sellNetwork}</span></div>
                      </>
                    )}
                    {sellPaymentType === "BUY_GOODS" && (
                      <div className="awm-review-row"><span className="awm-review-label">Till Number</span><span className="awm-review-value">{sellPhone}</span></div>
                    )}
                    {sellPaymentType === "PAYBILL" && (
                      <>
                        <div className="awm-review-row"><span className="awm-review-label">Paybill Number</span><span className="awm-review-value">{sellPhone}</span></div>
                        <div className="awm-review-row"><span className="awm-review-label">Account Number</span><span className="awm-review-value">{sellAccountNumber}</span></div>
                      </>
                    )}
                    {sellPaymentType === "BANK_TRANSFER" && (
                      <>
                        <div className="awm-review-row"><span className="awm-review-label">Bank</span><span className="awm-review-value">{sellBankName}</span></div>
                        {sellCountry === "NG" && (
                          <div className="awm-review-row"><span className="awm-review-label">Account Name</span><span className="awm-review-value">{sellAccountName}</span></div>
                        )}
                        <div className="awm-review-row"><span className="awm-review-label">Account Number</span><span className="awm-review-value">{sellBankAccount}</span></div>
                      </>
                    )}
                  </div>
                  <div className="awm-actions">
                    <button className="btn-exo btn-secondary" onClick={() => setStep("input")}>Back</button>
                    <button className="btn-exo btn-primary" onClick={handleSell}>Confirm withdrawal</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ─── Input: Transfer Tab ─── */}
          {step === "input" && tab === "transfer" && (
            <div className="awm-form">
              {/* Token selector */}
              <div className="awm-token-selector">
                {(["USDC", "ETH"] as TransferToken[]).map(t => (
                  <button key={t} className={`awm-token-pill${transferToken === t ? " active" : ""}`} onClick={() => { setTransferToken(t); setTransferAmount(""); }}>
                    {t}
                  </button>
                ))}
              </div>

              {/* Amount input */}
              <div className="awm-amount-section">
                <input
                  className="awm-amount-input"
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={transferAmount}
                  onChange={e => {
                    const val = e.target.value;
                    const maxDec = TOKEN_DECIMALS_MAP[transferToken];
                    const parts = val.split(".");
                    if (parts[1] && parts[1].length > maxDec) return;
                    if (Number(val) < 0) return;
                    setTransferAmount(val);
                  }}
                  aria-label={`Amount in ${transferToken}`}
                />
                <div className="awm-balance-row">
                  <span className="awm-balance-label">
                    {isFund ? WALLET_LABELS[transferWallet] : "Agent"} wallet:
                  </span>
                  <span className="awm-balance-value">{transferSourceBalanceHuman} {transferToken}</span>
                  <button className="awm-max-btn" onClick={() => setTransferAmount(transferMaxAmount)} aria-label="Set maximum amount">MAX</button>
                </div>
              </div>

              {/* Wallet selector */}
              <div className="awm-field-group">
                <span className="awm-field-label">{isFund ? "Source Wallet" : "Destination Wallet"}</span>
                <div className="awm-wallet-options">
                  {(["user", "server"] as TransferWalletType[]).map(wt => (
                    <button
                      key={wt}
                      className={`awm-wallet-opt${transferWallet === wt ? " active" : ""}`}
                      onClick={() => { setTransferWallet(wt); setTransferAmount(""); }}
                    >
                      {WALLET_LABELS[wt]}
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="btn-exo btn-primary awm-submit-btn"
                disabled={transferValidationError !== null}
                onClick={() => setStep("review")}
                title={transferValidationError ?? undefined}
              >
                Review transfer
              </button>
            </div>
          )}

          {/* ─── Input: Buy Tab ─── */}
          {step === "input" && tab === "buy" && (
            <div className="awm-form">
              <div className="awm-field-group">
                <span className="awm-field-label">Country</span>
                <select className="awm-select" value={buyCountry} onChange={e => setBuyCountry(e.target.value as OnrampCountryCode)}>
                  {ONRAMP_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </div>
              <div className="awm-field-group">
                <span className="awm-field-label">Network</span>
                <select className="awm-select" value={buyNetwork} onChange={e => setBuyNetwork(e.target.value)}>
                  {buyCountryObj.networks.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="awm-amount-section">
                <input
                  className="awm-amount-input"
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={buyFiatAmount}
                  onChange={e => setBuyFiatAmount(e.target.value)}
                />
                <div className="awm-balance-row">
                  <span className="awm-balance-label">{buyCountryObj.currency} amount to spend</span>
                </div>
                {buyConversion && (
                  <div className="awm-conversion">~ {buyConversion} {buyAsset}</div>
                )}
                {buyFee !== null && buyNetAmount !== null && (
                  <div className="awm-fee-hint">
                    Fee: {buyFee.toLocaleString()} {buyCountryObj.currency} | Net: {buyNetAmount.toLocaleString()} {buyCountryObj.currency}
                  </div>
                )}
                {rateLoading && <div className="awm-fee-hint">Loading rate...</div>}
              </div>
              <div className="awm-field-group">
                <span className="awm-field-label">Phone Number</span>
                <input className="awm-input" value={buyPhone} onChange={e => setBuyPhone(e.target.value)} placeholder="0712345678" inputMode="tel" />
              </div>
              <div className="awm-field-group">
                <span className="awm-field-label">Receive Asset</span>
                <div className="awm-token-selector">
                  {ONRAMP_ASSETS.map(a => (
                    <button key={a} className={`awm-token-pill${buyAsset === a ? " active" : ""}`} onClick={() => setBuyAsset(a)}>{a}</button>
                  ))}
                </div>
              </div>
              <div className="awm-destination-hint">Funds will be deposited into the agent wallet</div>
              <button
                className="btn-exo btn-primary awm-submit-btn"
                disabled={!buyFiatAmount || !buyPhone || Number(buyFiatAmount) <= 0}
                onClick={() => setStep("review")}
              >
                Review funding
              </button>
            </div>
          )}

          {/* ─── Input: Sell Tab ─── */}
          {step === "input" && tab === "sell" && (
            <div className="awm-form">
              <div className="awm-field-group">
                <span className="awm-field-label">Country</span>
                <select className="awm-select" value={sellCountry} onChange={e => setSellCountry(e.target.value as OfframpCountryCode)}>
                  {OFFRAMP_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </div>
              {sellCountryObj.paymentTypes.length > 1 && (
                <div className="awm-field-group">
                  <span className="awm-field-label">Payment Type</span>
                  <div className="awm-token-selector">
                    {sellCountryObj.paymentTypes.map(t => (
                      <button key={t} className={`awm-token-pill${sellPaymentType === t ? " active" : ""}`} onClick={() => setSellPaymentType(t)}>
                        {PAYMENT_TYPE_LABELS_WALLET[t] ?? t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="awm-amount-section">
                <input
                  className="awm-amount-input"
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={sellUsdcAmount}
                  onChange={e => setSellUsdcAmount(e.target.value)}
                />
                <div className="awm-balance-row">
                  <span className="awm-balance-label">USDC amount to withdraw</span>
                  <span className="awm-balance-value">{agentBalance?.balances?.USDC ? formatBaseUnits(agentBalance.balances.USDC, 6) : "0"} available</span>
                </div>
                {sellConversion && (
                  <div className="awm-conversion">~ {Number(sellConversion).toLocaleString()} {sellCountryObj.currency}</div>
                )}
                {sellFee !== null && sellNetAmount !== null && (
                  <div className="awm-fee-hint">
                    Fee: {sellFee.toLocaleString()} {sellCountryObj.currency} | You receive: {sellNetAmount.toLocaleString()} {sellCountryObj.currency}
                  </div>
                )}
              </div>

              {/* Payment type specific fields */}
              {sellPaymentType === "MOBILE" && (
                <>
                  <div className="awm-field-group">
                    <span className="awm-field-label">Phone Number</span>
                    <input className="awm-input" value={sellPhone} onChange={e => setSellPhone(e.target.value)} placeholder="0712345678" inputMode="tel" />
                  </div>
                  <div className="awm-field-group">
                    <span className="awm-field-label">Network</span>
                    <select className="awm-select" value={sellNetwork} onChange={e => setSellNetwork(e.target.value)}>
                      {sellCountryObj.networks.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </>
              )}
              {sellPaymentType === "BUY_GOODS" && (
                <div className="awm-field-group">
                  <span className="awm-field-label">Till Number</span>
                  <input className="awm-input" value={sellPhone} onChange={e => setSellPhone(e.target.value)} placeholder="123456" inputMode="numeric" />
                </div>
              )}
              {sellPaymentType === "PAYBILL" && (
                <>
                  <div className="awm-field-group">
                    <span className="awm-field-label">Paybill Number</span>
                    <input className="awm-input" value={sellPhone} onChange={e => setSellPhone(e.target.value)} placeholder="888880" inputMode="numeric" />
                  </div>
                  <div className="awm-field-group">
                    <span className="awm-field-label">Account Number</span>
                    <input className="awm-input" value={sellAccountNumber} onChange={e => setSellAccountNumber(e.target.value)} placeholder="Account number" />
                  </div>
                </>
              )}
              {sellPaymentType === "BANK_TRANSFER" && (
                <>
                  <div className="awm-field-group">
                    <span className="awm-field-label">Bank</span>
                    {banksLoading ? (
                      <div className="awm-loading-hint">Loading banks...</div>
                    ) : (
                      <select
                        className="awm-select"
                        value={sellBankCode}
                        onChange={e => {
                          const selected = banks.find(b => b.Code === e.target.value);
                          setSellBankCode(e.target.value);
                          setSellBankName(selected?.Name ?? "");
                        }}
                      >
                        {banks.length === 0 && <option value="">No banks available</option>}
                        {banks.map(b => <option key={b.Code} value={b.Code}>{b.Name}</option>)}
                      </select>
                    )}
                  </div>
                  {sellCountry === "NG" && (
                    <div className="awm-field-group">
                      <span className="awm-field-label">Account Name</span>
                      <input className="awm-input" value={sellAccountName} onChange={e => setSellAccountName(e.target.value)} placeholder="Full name on account" />
                    </div>
                  )}
                  <div className="awm-field-group">
                    <span className="awm-field-label">Account Number</span>
                    <input className="awm-input" value={sellBankAccount} onChange={e => setSellBankAccount(e.target.value)} placeholder="Bank account number" inputMode="numeric" />
                  </div>
                </>
              )}

              <div className="awm-destination-hint">USDC will be sold from the agent wallet</div>
              <button
                className="btn-exo btn-primary awm-submit-btn"
                disabled={!isSellValid}
                onClick={() => setStep("review")}
              >
                Review withdrawal
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Trust Tier Card ────────────────────────────────────────────── */

function TrustTierCard() {
  const { request } = useApi();
  const [tier, setTier] = useState<TrustTier | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    request<Record<string, unknown>>("/agent/profile").then(parseAgentProfile)
      .then((p) => setTier(p.trustTier))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [request]);

  const handleChangeTier = async (newTier: TrustTier) => {
    if (newTier === tier || saving) return;
    setSaving(true);
    try {
      await request("/agent/profile/trust-tier", {
        method: "PATCH",
        body: { tier: newTier },
      });
      setTier(newTier);
    } catch {
      // Revert on failure is not needed since we only update on success
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="ad-card">
        <div className="ad-card-header">
          <span className="ad-card-title">Trust Tier</span>
        </div>
        <div className="ad-loading">
          <div className="ad-skeleton md" />
          <div className="ad-skeleton lg" />
        </div>
      </div>
    );
  }

  const currentTier = tier ?? "observe";
  const showWarning = currentTier === "act_within_limits" || currentTier === "full";

  return (
    <div className="ad-card">
      <div className="ad-card-header">
        <span className="ad-card-title">Trust Tier</span>
      </div>
      <div className="ad-tier-current">
        <span className={`ad-tier-badge ${currentTier}`}>
          {TRUST_TIER_LABELS[currentTier]}
        </span>
      </div>
      <div className="ad-tier-desc">{TRUST_TIER_DESCRIPTIONS[currentTier]}</div>
      <div className="ad-segmented">
        {TRUST_TIERS.map((t) => (
          <button
            key={t}
            className={`ad-segmented-btn ${currentTier === t ? "active" : ""}`}
            onClick={() => handleChangeTier(t)}
            disabled={saving}
          >
            {TRUST_TIER_LABELS[t]}
          </button>
        ))}
      </div>
      {showWarning && (
        <div className="ad-tier-warning">
          <span className="ad-tier-warning-icon"><WarningIcon /></span>
          <span className="ad-tier-warning-text">
            {currentTier === "full"
              ? "Full access grants the agent unrestricted control over your wallet. Only enable this if you fully trust the agent configuration."
              : "The agent will execute transactions automatically within your budget limits. Review your limits before enabling."}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Automations (Mandates) Card ────────────────────────────────── */

const TEMPLATE_OPTIONS: { key: TemplateKey; title: string; description: string; icon: React.ReactNode }[] = [
  { key: "dca", title: "Buy crypto regularly", description: "Automatically buy a token on a schedule", icon: <RepeatIcon /> },
  { key: "price_alert", title: "Price alert", description: "Get notified when a token hits a price", icon: <BellLargeIcon /> },
  { key: "auto_cashout", title: "Auto cash-out", description: "Cash out when your balance exceeds a threshold", icon: <CashOutIcon /> },
  { key: "auto_save", title: "Auto-save", description: "Automatically deposit to a savings goal", icon: <PiggyBankIcon /> },
  { key: "custom", title: "Custom", description: "Set up a custom automation", icon: <WrenchIcon /> },
];

const FREQUENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "1d", label: "Daily" },
  { value: "7d", label: "Weekly" },
  { value: "30d", label: "Monthly" },
];

const DCA_TOKEN_OPTIONS = ["ETH", "WETH", "USDC"];
const PRICE_TOKEN_OPTIONS = ["ETH", "WETH", "USDC", "BTC"];
const CONDITION_OPTIONS = ["Below", "Above"];

const INITIAL_DCA_FORM: DcaFormState = { token: "ETH", amount: "", frequency: "7d", name: "" };
const INITIAL_PRICE_FORM: PriceAlertFormState = { token: "ETH", condition: "below", price: "", name: "" };
const INITIAL_CASHOUT_FORM: AutoCashoutFormState = { threshold: "", phone: "", name: "" };
const INITIAL_SAVE_FORM: AutoSaveFormState = { amount: "", frequency: "7d", goalName: "", name: "" };
const INITIAL_CUSTOM_FORM: CustomFormState = {
  name: "", triggerType: "schedule", triggerFrequency: "7d", triggerToken: "ETH",
  triggerCondition: "below", triggerValue: "", triggerWallet: "user",
  actionType: "swap", actionFrom: "USDC", actionTo: "ETH", actionAmount: "",
  actionMessage: "", actionGoalId: "", actionPhone: "",
};

function buildDcaPayload(form: DcaFormState): { name: string; type: string; trigger: MandateTrigger; action: MandateAction } {
  const name = form.name.trim() || `${form.frequency === "1d" ? "Daily" : form.frequency === "7d" ? "Weekly" : "Monthly"} ${form.token} DCA`;
  return {
    name,
    type: "dca",
    trigger: { type: "schedule", frequency: form.frequency },
    action: { type: "swap", from: "USDC", to: form.token, amount: toBaseUnits(form.amount, 6) },
  };
}

function buildPriceAlertPayload(form: PriceAlertFormState): { name: string; type: string; trigger: MandateTrigger; action: MandateAction } {
  const priceNum = parseFloat(form.price);
  const direction = form.condition === "below" ? "drops below" : "rises above";
  const name = form.name.trim() || `${form.token} ${direction} $${form.price}`;
  return {
    name,
    type: "price_alert",
    trigger: { type: "price", token: form.token, condition: form.condition, value: priceNum },
    action: { type: "notify", message: `${form.token} ${direction} $${form.price}` },
  };
}

function buildCashoutPayload(form: AutoCashoutFormState): { name: string; type: string; trigger: MandateTrigger; action: MandateAction } {
  const name = form.name.trim() || `Auto cash-out above ${form.threshold} USDC`;
  return {
    name,
    type: "auto_cashout",
    trigger: { type: "balance", wallet: "user", token: "USDC", condition: "above", value: parseInt(form.threshold, 10) },
    action: { type: "offramp", amount: "auto", phone: form.phone, country: "KE" },
  };
}

function buildSavePayload(form: AutoSaveFormState): { name: string; type: string; trigger: MandateTrigger; action: MandateAction } {
  const freqLabel = form.frequency === "1d" ? "daily" : form.frequency === "7d" ? "weekly" : "monthly";
  const name = form.name.trim() || `Save ${form.amount} USDC ${freqLabel}${form.goalName ? ` to ${form.goalName}` : ""}`;
  return {
    name,
    type: "auto_save",
    trigger: { type: "schedule", frequency: form.frequency },
    action: { type: "goal_deposit", goalId: form.goalName, amount: toBaseUnits(form.amount, 6) },
  };
}

function buildCustomPayload(form: CustomFormState): { name: string; type: string; trigger: MandateTrigger; action: MandateAction } {
  const trigger: MandateTrigger = { type: form.triggerType };
  if (form.triggerType === "schedule") {
    trigger.frequency = form.triggerFrequency;
  } else if (form.triggerType === "price") {
    trigger.token = form.triggerToken;
    trigger.condition = form.triggerCondition;
    trigger.value = parseFloat(form.triggerValue) || 0;
  } else if (form.triggerType === "balance") {
    trigger.wallet = form.triggerWallet;
    trigger.token = "USDC";
    trigger.condition = "above";
    trigger.value = parseInt(form.triggerValue, 10) || 0;
  }

  const action: MandateAction = { type: form.actionType };
  if (form.actionType === "swap") {
    action.from = form.actionFrom;
    action.to = form.actionTo;
    action.amount = toBaseUnits(form.actionAmount || "0", 6);
  } else if (form.actionType === "notify") {
    action.message = form.actionMessage;
  } else if (form.actionType === "goal_deposit") {
    action.goalId = form.actionGoalId;
    action.amount = toBaseUnits(form.actionAmount || "0", 6);
  } else if (form.actionType === "transfer") {
    action.to = form.actionTo;
    action.amount = toBaseUnits(form.actionAmount || "0", 6);
  }

  return {
    name: form.name.trim() || "Custom automation",
    type: "custom",
    trigger,
    action,
  };
}

function buildConfirmationSummary(template: TemplateKey, payload: { trigger: MandateTrigger; action: MandateAction }): string {
  return summarizeMandate(payload.trigger, payload.action);
}

function isFormValid(template: TemplateKey, dcaForm: DcaFormState, priceForm: PriceAlertFormState, cashoutForm: AutoCashoutFormState, saveForm: AutoSaveFormState, customForm: CustomFormState): boolean {
  switch (template) {
    case "dca": {
      const amt = parseFloat(dcaForm.amount);
      return !isNaN(amt) && amt > 0;
    }
    case "price_alert": {
      const p = parseFloat(priceForm.price);
      return !isNaN(p) && p > 0;
    }
    case "auto_cashout": {
      const t = parseFloat(cashoutForm.threshold);
      return !isNaN(t) && t > 0 && cashoutForm.phone.trim().length > 0;
    }
    case "auto_save": {
      const a = parseFloat(saveForm.amount);
      return !isNaN(a) && a > 0;
    }
    case "custom":
      return customForm.name.trim().length > 0;
  }
}

function AutomationsCard() {
  const { request } = useApi();
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  /* ── Creation flow state machine ── */
  const [flowStep, setFlowStep] = useState<AutomationFlowStep>("idle");
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  /* ── Template form states ── */
  const [dcaForm, setDcaForm] = useState<DcaFormState>(INITIAL_DCA_FORM);
  const [priceForm, setPriceForm] = useState<PriceAlertFormState>(INITIAL_PRICE_FORM);
  const [cashoutForm, setCashoutForm] = useState<AutoCashoutFormState>(INITIAL_CASHOUT_FORM);
  const [saveForm, setSaveForm] = useState<AutoSaveFormState>(INITIAL_SAVE_FORM);
  const [customForm, setCustomForm] = useState<CustomFormState>(INITIAL_CUSTOM_FORM);

  /* ── Pending payload for confirmation step ── */
  const [pendingPayload, setPendingPayload] = useState<{ name: string; type: string; trigger: MandateTrigger; action: MandateAction } | null>(null);

  const fetchMandates = useCallback(async () => {
    try {
      const data = await request<Mandate[]>("/agent/mandates");
      setMandates(data);
    } catch {
      setMandates([]);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { fetchMandates(); }, [fetchMandates]);

  const resetFlow = () => {
    setFlowStep("idle");
    setSelectedTemplate(null);
    setDcaForm(INITIAL_DCA_FORM);
    setPriceForm(INITIAL_PRICE_FORM);
    setCashoutForm(INITIAL_CASHOUT_FORM);
    setSaveForm(INITIAL_SAVE_FORM);
    setCustomForm(INITIAL_CUSTOM_FORM);
    setPendingPayload(null);
  };

  const handleToggle = async (mandate: Mandate) => {
    const isPausing = mandate.status === "active";
    const endpoint = isPausing
      ? `/agent/mandates/${mandate.id}/pause`
      : `/agent/mandates/${mandate.id}/resume`;
    try {
      await request(endpoint, { method: "POST" });
      setMandates((prev) =>
        prev.map((m) =>
          m.id === mandate.id ? { ...m, status: isPausing ? "paused" : "active" } : m
        )
      );
    } catch {
      // Keep current state on failure
    }
  };

  const handleCancelMandate = async (id: string) => {
    try {
      await request(`/agent/mandates/${id}`, { method: "DELETE" });
      setMandates((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: "revoked" } : m))
      );
    } catch {
      // Keep current state on failure
    } finally {
      setConfirmCancel(null);
    }
  };

  const handleSelectTemplate = (key: TemplateKey) => {
    setSelectedTemplate(key);
    setFlowStep("filling_form");
  };

  const handleProceedToConfirm = () => {
    if (!selectedTemplate) return;
    let payload: { name: string; type: string; trigger: MandateTrigger; action: MandateAction };
    switch (selectedTemplate) {
      case "dca": payload = buildDcaPayload(dcaForm); break;
      case "price_alert": payload = buildPriceAlertPayload(priceForm); break;
      case "auto_cashout": payload = buildCashoutPayload(cashoutForm); break;
      case "auto_save": payload = buildSavePayload(saveForm); break;
      case "custom": payload = buildCustomPayload(customForm); break;
    }
    setPendingPayload(payload);
    setFlowStep("confirming");
  };

  const handleConfirmCreate = async () => {
    if (!pendingPayload) return;
    setCreateLoading(true);
    try {
      await request("/agent/mandates", {
        method: "POST",
        body: {
          name: pendingPayload.name,
          type: pendingPayload.type,
          trigger: pendingPayload.trigger,
          action: pendingPayload.action,
        },
      });
      resetFlow();
      await fetchMandates();
    } catch {
      // Keep confirmation visible so user can retry
    } finally {
      setCreateLoading(false);
    }
  };

  const handleStartCreate = () => {
    if (flowStep === "idle") {
      setFlowStep("picking_template");
    } else {
      resetFlow();
    }
  };

  const handleBack = () => {
    if (flowStep === "confirming") {
      setFlowStep("filling_form");
      setPendingPayload(null);
    } else if (flowStep === "filling_form") {
      setFlowStep("picking_template");
      setSelectedTemplate(null);
    } else {
      resetFlow();
    }
  };

  if (loading) {
    return (
      <div className="ad-card">
        <div className="ad-card-header">
          <span className="ad-card-title">Automations</span>
        </div>
        <div className="ad-loading">
          <div className="ad-skeleton md" />
          <div className="ad-skeleton lg" />
          <div className="ad-skeleton sm" />
        </div>
      </div>
    );
  }

  const activeMandates = mandates.filter((m) => m.status !== "revoked");
  const isCreating = flowStep !== "idle";
  const canProceed = selectedTemplate ? isFormValid(selectedTemplate, dcaForm, priceForm, cashoutForm, saveForm, customForm) : false;

  return (
    <div className="ad-card">
      <div className="ad-card-header">
        <span className="ad-card-title">Automations</span>
        <button className="ad-card-action" onClick={handleStartCreate}>
          {isCreating ? "Cancel" : "+ Create"}
        </button>
      </div>

      {/* ── Step 1: Template Selection ── */}
      {flowStep === "picking_template" && (
        <div className="ad-template-grid">
          {TEMPLATE_OPTIONS.map((t) => (
            <button
              key={t.key}
              className="ad-template-card"
              onClick={() => handleSelectTemplate(t.key)}
            >
              <span className="ad-template-card-icon">{t.icon}</span>
              <span className="ad-template-card-title">{t.title}</span>
              <span className="ad-template-card-desc">{t.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Step 2: Template-Specific Form ── */}
      {flowStep === "filling_form" && selectedTemplate && (
        <div className="ad-template-form">
          <button className="ad-template-back" onClick={handleBack}>
            <ChevronLeftIcon /> Back
          </button>

          {selectedTemplate === "dca" && (
            <>
              <div className="ad-form-field">
                <label className="ad-form-label">Token to buy</label>
                <div className="ad-segmented">
                  {DCA_TOKEN_OPTIONS.map((tok) => (
                    <button
                      key={tok}
                      className={`ad-segmented-btn ${dcaForm.token === tok ? "active" : ""}`}
                      onClick={() => setDcaForm((f) => ({ ...f, token: tok }))}
                    >
                      {tok}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ad-form-field">
                <label className="ad-form-label">Amount per buy</label>
                <div className="ad-form-input-wrap">
                  <input
                    className="ad-create-input"
                    type="number"
                    inputMode="decimal"
                    placeholder="10"
                    value={dcaForm.amount}
                    onChange={(e) => setDcaForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                  <span className="ad-form-suffix">USDC</span>
                </div>
              </div>
              <div className="ad-form-field">
                <label className="ad-form-label">Frequency</label>
                <div className="ad-segmented">
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`ad-segmented-btn ${dcaForm.frequency === opt.value ? "active" : ""}`}
                      onClick={() => setDcaForm((f) => ({ ...f, frequency: opt.value }))}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ad-form-field">
                <label className="ad-form-label">Name (optional)</label>
                <input
                  className="ad-create-input"
                  placeholder={`${dcaForm.frequency === "1d" ? "Daily" : dcaForm.frequency === "7d" ? "Weekly" : "Monthly"} ${dcaForm.token} DCA`}
                  value={dcaForm.name}
                  onChange={(e) => setDcaForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
            </>
          )}

          {selectedTemplate === "price_alert" && (
            <>
              <div className="ad-form-field">
                <label className="ad-form-label">Token</label>
                <div className="ad-segmented">
                  {PRICE_TOKEN_OPTIONS.map((tok) => (
                    <button
                      key={tok}
                      className={`ad-segmented-btn ${priceForm.token === tok ? "active" : ""}`}
                      onClick={() => setPriceForm((f) => ({ ...f, token: tok }))}
                    >
                      {tok}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ad-form-field">
                <label className="ad-form-label">Condition</label>
                <div className="ad-segmented">
                  {CONDITION_OPTIONS.map((c) => (
                    <button
                      key={c}
                      className={`ad-segmented-btn ${priceForm.condition === c.toLowerCase() ? "active" : ""}`}
                      onClick={() => setPriceForm((f) => ({ ...f, condition: c.toLowerCase() }))}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ad-form-field">
                <label className="ad-form-label">Price</label>
                <div className="ad-form-input-wrap">
                  <span className="ad-form-prefix">$</span>
                  <input
                    className="ad-create-input ad-input-with-prefix"
                    type="number"
                    inputMode="decimal"
                    placeholder="2000"
                    value={priceForm.price}
                    onChange={(e) => setPriceForm((f) => ({ ...f, price: e.target.value }))}
                  />
                </div>
              </div>
              <div className="ad-form-field">
                <label className="ad-form-label">Name (optional)</label>
                <input
                  className="ad-create-input"
                  placeholder={`${priceForm.token} price alert`}
                  value={priceForm.name}
                  onChange={(e) => setPriceForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
            </>
          )}

          {selectedTemplate === "auto_cashout" && (
            <>
              <div className="ad-form-field">
                <label className="ad-form-label">When USDC balance exceeds</label>
                <div className="ad-form-input-wrap">
                  <input
                    className="ad-create-input"
                    type="number"
                    inputMode="decimal"
                    placeholder="100"
                    value={cashoutForm.threshold}
                    onChange={(e) => setCashoutForm((f) => ({ ...f, threshold: e.target.value }))}
                  />
                  <span className="ad-form-suffix">USDC</span>
                </div>
              </div>
              <div className="ad-form-field">
                <label className="ad-form-label">Cash out to (phone number)</label>
                <input
                  className="ad-create-input"
                  type="tel"
                  inputMode="tel"
                  placeholder="0712345678"
                  value={cashoutForm.phone}
                  onChange={(e) => setCashoutForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="ad-form-field">
                <label className="ad-form-label">Name (optional)</label>
                <input
                  className="ad-create-input"
                  placeholder="Auto cash-out"
                  value={cashoutForm.name}
                  onChange={(e) => setCashoutForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
            </>
          )}

          {selectedTemplate === "auto_save" && (
            <>
              <div className="ad-form-field">
                <label className="ad-form-label">Amount</label>
                <div className="ad-form-input-wrap">
                  <input
                    className="ad-create-input"
                    type="number"
                    inputMode="decimal"
                    placeholder="50"
                    value={saveForm.amount}
                    onChange={(e) => setSaveForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                  <span className="ad-form-suffix">USDC</span>
                </div>
              </div>
              <div className="ad-form-field">
                <label className="ad-form-label">Frequency</label>
                <div className="ad-segmented">
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`ad-segmented-btn ${saveForm.frequency === opt.value ? "active" : ""}`}
                      onClick={() => setSaveForm((f) => ({ ...f, frequency: opt.value }))}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ad-form-field">
                <label className="ad-form-label">Goal name</label>
                <input
                  className="ad-create-input"
                  placeholder="Emergency Fund"
                  value={saveForm.goalName}
                  onChange={(e) => setSaveForm((f) => ({ ...f, goalName: e.target.value }))}
                />
              </div>
              <div className="ad-form-field">
                <label className="ad-form-label">Name (optional)</label>
                <input
                  className="ad-create-input"
                  placeholder={`Auto-save ${saveForm.amount || "50"} USDC`}
                  value={saveForm.name}
                  onChange={(e) => setSaveForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
            </>
          )}

          {selectedTemplate === "custom" && (
            <>
              <div className="ad-form-field">
                <label className="ad-form-label">Name</label>
                <input
                  className="ad-create-input"
                  placeholder="My automation"
                  value={customForm.name}
                  onChange={(e) => setCustomForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="ad-form-field">
                <label className="ad-form-label">Trigger</label>
                <div className="ad-segmented">
                  {(["schedule", "price", "balance"] as const).map((tt) => (
                    <button
                      key={tt}
                      className={`ad-segmented-btn ${customForm.triggerType === tt ? "active" : ""}`}
                      onClick={() => setCustomForm((f) => ({ ...f, triggerType: tt }))}
                    >
                      {tt === "schedule" ? "Schedule" : tt === "price" ? "Price" : "Balance"}
                    </button>
                  ))}
                </div>
              </div>
              {customForm.triggerType === "schedule" && (
                <div className="ad-form-field">
                  <label className="ad-form-label">Frequency</label>
                  <div className="ad-segmented">
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        className={`ad-segmented-btn ${customForm.triggerFrequency === opt.value ? "active" : ""}`}
                        onClick={() => setCustomForm((f) => ({ ...f, triggerFrequency: opt.value }))}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {customForm.triggerType === "price" && (
                <>
                  <div className="ad-form-field">
                    <label className="ad-form-label">Token</label>
                    <div className="ad-segmented">
                      {PRICE_TOKEN_OPTIONS.map((tok) => (
                        <button
                          key={tok}
                          className={`ad-segmented-btn ${customForm.triggerToken === tok ? "active" : ""}`}
                          onClick={() => setCustomForm((f) => ({ ...f, triggerToken: tok }))}
                        >
                          {tok}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="ad-form-field">
                    <label className="ad-form-label">Condition</label>
                    <div className="ad-segmented">
                      {CONDITION_OPTIONS.map((c) => (
                        <button
                          key={c}
                          className={`ad-segmented-btn ${customForm.triggerCondition === c.toLowerCase() ? "active" : ""}`}
                          onClick={() => setCustomForm((f) => ({ ...f, triggerCondition: c.toLowerCase() }))}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="ad-form-field">
                    <label className="ad-form-label">Price</label>
                    <div className="ad-form-input-wrap">
                      <span className="ad-form-prefix">$</span>
                      <input
                        className="ad-create-input ad-input-with-prefix"
                        type="number"
                        inputMode="decimal"
                        placeholder="2000"
                        value={customForm.triggerValue}
                        onChange={(e) => setCustomForm((f) => ({ ...f, triggerValue: e.target.value }))}
                      />
                    </div>
                  </div>
                </>
              )}
              {customForm.triggerType === "balance" && (
                <div className="ad-form-field">
                  <label className="ad-form-label">Balance threshold</label>
                  <div className="ad-form-input-wrap">
                    <input
                      className="ad-create-input"
                      type="number"
                      inputMode="decimal"
                      placeholder="100"
                      value={customForm.triggerValue}
                      onChange={(e) => setCustomForm((f) => ({ ...f, triggerValue: e.target.value }))}
                    />
                    <span className="ad-form-suffix">USDC</span>
                  </div>
                </div>
              )}
              <div className="ad-form-field">
                <label className="ad-form-label">Action</label>
                <div className="ad-segmented">
                  {(["swap", "notify", "goal_deposit", "transfer"] as const).map((at) => (
                    <button
                      key={at}
                      className={`ad-segmented-btn ${customForm.actionType === at ? "active" : ""}`}
                      onClick={() => setCustomForm((f) => ({ ...f, actionType: at }))}
                    >
                      {at === "swap" ? "Swap" : at === "notify" ? "Notify" : at === "goal_deposit" ? "Save" : "Transfer"}
                    </button>
                  ))}
                </div>
              </div>
              {customForm.actionType === "swap" && (
                <>
                  <div className="ad-form-field">
                    <label className="ad-form-label">Amount</label>
                    <div className="ad-form-input-wrap">
                      <input
                        className="ad-create-input"
                        type="number"
                        inputMode="decimal"
                        placeholder="10"
                        value={customForm.actionAmount}
                        onChange={(e) => setCustomForm((f) => ({ ...f, actionAmount: e.target.value }))}
                      />
                      <span className="ad-form-suffix">{customForm.actionFrom}</span>
                    </div>
                  </div>
                  <div className="ad-form-field">
                    <label className="ad-form-label">Swap to</label>
                    <div className="ad-segmented">
                      {DCA_TOKEN_OPTIONS.map((tok) => (
                        <button
                          key={tok}
                          className={`ad-segmented-btn ${customForm.actionTo === tok ? "active" : ""}`}
                          onClick={() => setCustomForm((f) => ({ ...f, actionTo: tok }))}
                        >
                          {tok}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {customForm.actionType === "notify" && (
                <div className="ad-form-field">
                  <label className="ad-form-label">Message</label>
                  <input
                    className="ad-create-input"
                    placeholder="Alert triggered"
                    value={customForm.actionMessage}
                    onChange={(e) => setCustomForm((f) => ({ ...f, actionMessage: e.target.value }))}
                  />
                </div>
              )}
              {customForm.actionType === "goal_deposit" && (
                <>
                  <div className="ad-form-field">
                    <label className="ad-form-label">Amount</label>
                    <div className="ad-form-input-wrap">
                      <input
                        className="ad-create-input"
                        type="number"
                        inputMode="decimal"
                        placeholder="50"
                        value={customForm.actionAmount}
                        onChange={(e) => setCustomForm((f) => ({ ...f, actionAmount: e.target.value }))}
                      />
                      <span className="ad-form-suffix">USDC</span>
                    </div>
                  </div>
                  <div className="ad-form-field">
                    <label className="ad-form-label">Goal name</label>
                    <input
                      className="ad-create-input"
                      placeholder="Emergency Fund"
                      value={customForm.actionGoalId}
                      onChange={(e) => setCustomForm((f) => ({ ...f, actionGoalId: e.target.value }))}
                    />
                  </div>
                </>
              )}
              {customForm.actionType === "transfer" && (
                <>
                  <div className="ad-form-field">
                    <label className="ad-form-label">Amount</label>
                    <div className="ad-form-input-wrap">
                      <input
                        className="ad-create-input"
                        type="number"
                        inputMode="decimal"
                        placeholder="10"
                        value={customForm.actionAmount}
                        onChange={(e) => setCustomForm((f) => ({ ...f, actionAmount: e.target.value }))}
                      />
                      <span className="ad-form-suffix">USDC</span>
                    </div>
                  </div>
                  <div className="ad-form-field">
                    <label className="ad-form-label">Recipient</label>
                    <input
                      className="ad-create-input"
                      placeholder="Address or phone"
                      value={customForm.actionTo}
                      onChange={(e) => setCustomForm((f) => ({ ...f, actionTo: e.target.value }))}
                    />
                  </div>
                </>
              )}
            </>
          )}

          <div className="ad-create-actions">
            <button
              className="btn-exo btn-primary"
              onClick={handleProceedToConfirm}
              disabled={!canProceed}
            >
              Review
            </button>
            <button className="btn-exo btn-secondary" onClick={resetFlow}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Confirmation ── */}
      {flowStep === "confirming" && pendingPayload && selectedTemplate && (
        <div className="ad-template-form">
          <button className="ad-template-back" onClick={handleBack}>
            <ChevronLeftIcon /> Edit
          </button>
          <div className="ad-confirm-summary">
            {buildConfirmationSummary(selectedTemplate, pendingPayload)}
          </div>
          <div className="ad-confirm-summary-name">{pendingPayload.name}</div>
          <div className="ad-create-actions">
            <button
              className="btn-exo btn-primary"
              onClick={handleConfirmCreate}
              disabled={createLoading}
            >
              {createLoading ? "Creating..." : "Confirm"}
            </button>
            <button
              className="btn-exo btn-secondary"
              onClick={resetFlow}
              disabled={createLoading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Mandate list ── */}
      {activeMandates.length === 0 && flowStep === "idle" ? (
        <div className="ad-empty">
          <span className="ad-empty-text">No automations configured</span>
          <span className="ad-empty-hint">Create one to let your agent act on your behalf</span>
        </div>
      ) : flowStep === "idle" ? (
        <div className="ad-mandate-list">
          {activeMandates.map((m) => (
            <div key={m.id} className="ad-mandate-item">
              <div className="ad-mandate-info">
                <div className="ad-mandate-name">
                  {m.name}
                  <span className={`ad-badge ${m.status}`}>{m.status}</span>
                </div>
                <div className="ad-mandate-meta">
                  {summarizeMandate(m.trigger, m.action)}
                </div>
                <div className="ad-mandate-meta">
                  {m.executionCount} execution{m.executionCount !== 1 ? "s" : ""}
                  {m.lastExecutedAt && <> &middot; Last run {formatTimeAgo(m.lastExecutedAt)}</>}
                </div>
              </div>
              <div className="ad-mandate-actions">
                {(m.status === "active" || m.status === "paused") && (
                  <button
                    className="ad-mandate-toggle"
                    onClick={() => handleToggle(m)}
                    title={m.status === "active" ? "Pause" : "Resume"}
                  >
                    {m.status === "active" ? <PauseIcon /> : <PlayIcon />}
                  </button>
                )}
                {m.status !== "revoked" && m.status !== "expired" && (
                  <button
                    className="ad-mandate-cancel"
                    onClick={() => setConfirmCancel(m.id)}
                    title="Cancel automation"
                  >
                    <XIcon />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {confirmCancel && (
        <div className="ad-confirm-overlay" onClick={(e) => { if (e.target === e.currentTarget) setConfirmCancel(null); }}>
          <div className="ad-confirm-dialog">
            <div className="ad-confirm-title">Cancel Automation?</div>
            <div className="ad-confirm-text">
              This will permanently revoke the automation. The agent will no longer execute it.
            </div>
            <div className="ad-confirm-actions">
              <button className="btn-exo btn-secondary" onClick={() => setConfirmCancel(null)}>
                Keep
              </button>
              <button className="btn-exo btn-danger" onClick={() => handleCancelMandate(confirmCancel)}>
                Cancel It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Preferences Card ───────────────────────────────────────────── */

function PreferencesCard() {
  const { request } = useApi();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newInterest, setNewInterest] = useState("");
  const [newGoal, setNewGoal] = useState("");

  useEffect(() => {
    request<Record<string, unknown>>("/agent/profile").then(parseAgentProfile)
      .then(setProfile)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [request]);

  const saveProfile = async (updates: Partial<AgentProfile>) => {
    if (!profile) return;
    setSaving(true);
    try {
      const merged = { ...profile, ...updates };
      await request("/agent/profile", {
        method: "PATCH",
        body: {
          interests: merged.interests,
          goals: merged.goals,
          riskTolerance: merged.riskTolerance,
          knowledgeLevel: merged.knowledgeLevel,
        },
      });
      setProfile(merged);
    } catch {
      // Keep current state on failure
    } finally {
      setSaving(false);
    }
  };

  const addInterest = () => {
    const val = newInterest.trim();
    if (!val || !profile || profile.interests.includes(val)) return;
    const updated = [...profile.interests, val];
    setNewInterest("");
    saveProfile({ interests: updated });
  };

  const removeInterest = (interest: string) => {
    if (!profile) return;
    saveProfile({ interests: profile.interests.filter((i) => i !== interest) });
  };

  const addGoal = () => {
    const val = newGoal.trim();
    if (!val || !profile || profile.goals.includes(val)) return;
    const updated = [...profile.goals, val];
    setNewGoal("");
    saveProfile({ goals: updated });
  };

  const removeGoal = (goal: string) => {
    if (!profile) return;
    saveProfile({ goals: profile.goals.filter((g) => g !== goal) });
  };

  if (loading) {
    return (
      <div className="ad-card">
        <div className="ad-card-header">
          <span className="ad-card-title">Preferences</span>
        </div>
        <div className="ad-loading">
          <div className="ad-skeleton md" />
          <div className="ad-skeleton lg" />
          <div className="ad-skeleton sm" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="ad-card">
        <div className="ad-card-header">
          <span className="ad-card-title">Preferences</span>
        </div>
        <div className="ad-empty">
          <span className="ad-empty-text">Could not load preferences</span>
        </div>
      </div>
    );
  }

  return (
    <div className="ad-card">
      <div className="ad-card-header">
        <span className="ad-card-title">Preferences</span>
        {saving && <span className="ad-card-title" style={{ color: "var(--accent)" }}>Saving...</span>}
      </div>

      <div className="ad-pref-group">
        <div className="ad-pref-label">Interests</div>
        <div className="ad-tags">
          {profile.interests.map((interest) => (
            <span key={interest} className="ad-tag">
              {interest}
              <button className="ad-tag-remove" onClick={() => removeInterest(interest)} aria-label={`Remove ${interest}`}>
                <XIcon />
              </button>
            </span>
          ))}
          <div className="ad-tag-input-wrap">
            <input
              className="ad-tag-input"
              placeholder="Add interest"
              value={newInterest}
              onChange={(e) => setNewInterest(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addInterest(); }}
            />
            <button className="ad-tag-add-btn" onClick={addInterest} aria-label="Add interest">+</button>
          </div>
        </div>
      </div>

      <div className="ad-pref-group">
        <div className="ad-pref-label">Goals</div>
        <div className="ad-tags">
          {profile.goals.map((goal) => (
            <span key={goal} className="ad-tag">
              {goal}
              <button className="ad-tag-remove" onClick={() => removeGoal(goal)} aria-label={`Remove ${goal}`}>
                <XIcon />
              </button>
            </span>
          ))}
          <div className="ad-tag-input-wrap">
            <input
              className="ad-tag-input"
              placeholder="Add goal"
              value={newGoal}
              onChange={(e) => setNewGoal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addGoal(); }}
            />
            <button className="ad-tag-add-btn" onClick={addGoal} aria-label="Add goal">+</button>
          </div>
        </div>
      </div>

      <div className="ad-pref-group">
        <div className="ad-pref-label">Risk Tolerance</div>
        <div className="ad-segmented">
          {RISK_LEVELS.map((level) => (
            <button
              key={level}
              className={`ad-segmented-btn ${profile.riskTolerance === level ? "active" : ""}`}
              onClick={() => saveProfile({ riskTolerance: level })}
              disabled={saving}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <div className="ad-pref-group">
        <div className="ad-pref-label">Knowledge Level</div>
        <div className="ad-segmented">
          {KNOWLEDGE_LEVELS.map((level) => (
            <button
              key={level}
              className={`ad-segmented-btn ${profile.knowledgeLevel === level ? "active" : ""}`}
              onClick={() => saveProfile({ knowledgeLevel: level })}
              disabled={saving}
            >
              {level}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Custom Instructions Card ───────────────────────────────────── */

function CustomInstructionsCard() {
  const { request } = useApi();
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(true);
  const [showSaved, setShowSaved] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    request<Record<string, unknown>>("/agent/profile").then(parseAgentProfile)
      .then((p) => setInstructions(p.customInstructions ?? ""))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [request]);

  const saveInstructions = useCallback(
    async (value: string) => {
      try {
        await request("/agent/profile", {
          method: "PATCH",
          body: { customInstructions: value },
        });
        setShowSaved(true);
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
        savedTimeoutRef.current = setTimeout(() => setShowSaved(false), 2000);
      } catch {
        // Silent failure - the user will see lack of "Saved" indicator
      }
    },
    [request]
  );

  const handleChange = (value: string) => {
    setInstructions(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => saveInstructions(value), 1000);
  };

  const handleBlur = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    saveInstructions(instructions);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  if (loading) {
    return (
      <div className="ad-card">
        <div className="ad-card-header">
          <span className="ad-card-title">Custom Instructions</span>
        </div>
        <div className="ad-loading">
          <div className="ad-skeleton lg" />
          <div className="ad-skeleton md" />
        </div>
      </div>
    );
  }

  return (
    <div className="ad-card">
      <div className="ad-card-header">
        <span className="ad-card-title">Custom Instructions</span>
      </div>
      <textarea
        className="ad-instructions-textarea"
        value={instructions}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder="Add custom rules for your agent (e.g. 'Never buy meme coins', 'Always notify me before swaps over $50')"
      />
      <div className={`ad-instructions-saved ${showSaved ? "visible" : ""}`}>
        Saved
      </div>
    </div>
  );
}

/* ─── Inbox Types ────────────────────────────────────────────────── */

type InboxCategory = "research" | "request" | "alert" | "news" | "suggestion" | "mandate_update";
type InboxPriority = "urgent" | "high" | "medium" | "low";
type InboxStatus = "unread" | "read" | "actioned" | "dismissed";

interface InboxItem {
  id: string;
  category: InboxCategory;
  title: string;
  body: string;
  priority: InboxPriority;
  status: InboxStatus;
  actionType: string | null;
  actionPayload: Record<string, unknown> | null;
  createdAt: string;
}

interface InboxUnreadCounts {
  total: number;
  research: number;
  request: number;
  alert: number;
  news: number;
  suggestion: number;
  mandate_update: number;
}

const INBOX_CATEGORIES: { key: InboxCategory | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "research", label: "Research" },
  { key: "request", label: "Requests" },
  { key: "alert", label: "Alerts" },
  { key: "news", label: "News" },
  { key: "suggestion", label: "Suggestions" },
  { key: "mandate_update", label: "Updates" },
];

/* ─── Inbox Icons ────────────────────────────────────────────────── */

const SearchCircleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const NewspaperIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
    <path d="M18 14h-8" /><path d="M15 18h-5" /><path d="M10 6h8v4h-8V6Z" />
  </svg>
);

const RobotIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" />
    <line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" />
  </svg>
);

const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

function InboxCategoryIcon({ category }: { category: InboxCategory }) {
  switch (category) {
    case "research": return <SearchCircleIcon />;
    case "alert": return <AlertIcon />;
    case "suggestion": return <LightbulbIcon />;
    case "news": return <NewspaperIcon />;
    case "request": return <RobotIcon />;
    case "mandate_update": return <GearIcon />;
  }
}

function getInboxIconClass(category: InboxCategory): string {
  switch (category) {
    case "research": return "research";
    case "alert": return "alert";
    case "suggestion": return "suggestion";
    case "news": return "news";
    case "request": return "request";
    case "mandate_update": return "mandate-update";
  }
}

function getPriorityClass(priority: InboxPriority): string {
  switch (priority) {
    case "urgent": return "urgent";
    case "high": return "high";
    case "medium": return "medium";
    case "low": return "low";
  }
}

function getPriorityLabel(priority: InboxPriority): string {
  switch (priority) {
    case "urgent": return "Urgent";
    case "high": return "High";
    case "medium": return "Medium";
    case "low": return "Low";
  }
}

/* ─── Inbox Card ─────────────────────────────────────────────────── */

function InboxCard() {
  const { request } = useApi();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [activeCategory, setActiveCategory] = useState<InboxCategory | "all">("all");
  const [unreadCounts, setUnreadCounts] = useState<InboxUnreadCounts>({
    total: 0, research: 0, request: 0, alert: 0, news: 0, suggestion: 0, mandate_update: 0,
  });
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const limit = 20;

  const fetchUnreadCounts = useCallback(async () => {
    try {
      const counts = await request<InboxUnreadCounts>("/agent/inbox/unread");
      setUnreadCounts(counts);
    } catch {
      // Keep existing counts on failure
    }
  }, [request]);

  const fetchItems = useCallback(async (category: InboxCategory | "all", append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);
    try {
      const query: Record<string, string | number | undefined> = { limit };
      if (category !== "all") query.category = category;
      if (append) query.offset = items.length;
      const data = await request<InboxItem[]>("/agent/inbox", { query });
      if (append) {
        setItems((prev) => [...prev, ...data]);
      } else {
        setItems(data);
      }
      setHasMore(data.length === limit);
    } catch {
      if (!append) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [request, items.length]);

  useEffect(() => {
    fetchItems(activeCategory);
    fetchUnreadCounts();
  }, [activeCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCategoryChange = (category: InboxCategory | "all") => {
    if (category === activeCategory) return;
    setActiveCategory(category);
    setHasMore(true);
  };

  const handleMarkRead = async (item: InboxItem) => {
    if (item.status === "read") return;
    try {
      await request(`/agent/inbox/${item.id}/read`, { method: "POST" });
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: "read" } : i));
      setUnreadCounts((prev) => ({
        ...prev,
        total: Math.max(0, prev.total - 1),
        [item.category]: Math.max(0, prev[item.category] - 1),
      }));
    } catch {
      // Keep current state on failure
    }
  };

  const handleDismiss = async (id: string, category: InboxCategory, wasUnread: boolean) => {
    try {
      await request(`/agent/inbox/${id}/dismiss`, { method: "POST" });
      setItems((prev) => prev.filter((i) => i.id !== id));
      if (wasUnread) {
        setUnreadCounts((prev) => ({
          ...prev,
          total: Math.max(0, prev.total - 1),
          [category]: Math.max(0, prev[category] - 1),
        }));
      }
    } catch {
      // Keep current state on failure
    }
  };

  const handleAction = async (id: string, approved: boolean) => {
    setActionLoadingId(id);
    try {
      await request(`/agent/inbox/${id}/action`, {
        method: "POST",
        body: { approved },
      });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch {
      // Keep current state on failure
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await request("/agent/inbox/read-all", { method: "POST" });
      setItems((prev) => prev.map((i) => ({ ...i, status: "read" as InboxStatus })));
      setUnreadCounts({ total: 0, research: 0, request: 0, alert: 0, news: 0, suggestion: 0, mandate_update: 0 });
    } catch {
      // Keep current state on failure
    }
  };

  return (
    <div className="ad-card inbox-card">
      {/* Header */}
      <div className="ad-card-header">
        <div className="inbox-header-left">
          <span className="ad-card-title">Inbox</span>
          {unreadCounts.total > 0 && (
            <span className="inbox-unread-badge">{unreadCounts.total}</span>
          )}
        </div>
        {unreadCounts.total > 0 && (
          <button className="ad-card-action" onClick={handleMarkAllRead}>
            Mark all read
          </button>
        )}
      </div>

      {/* Category filter pills */}
      <div className="inbox-categories">
        {INBOX_CATEGORIES.map((cat) => {
          const hasUnread = cat.key === "all"
            ? unreadCounts.total > 0
            : cat.key in unreadCounts && unreadCounts[cat.key as InboxCategory] > 0;
          return (
            <button
              key={cat.key}
              className={`inbox-category-pill ${activeCategory === cat.key ? "active" : ""}`}
              onClick={() => handleCategoryChange(cat.key)}
            >
              {cat.label}
              {hasUnread && <span className="inbox-pill-dot" />}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div className="ad-loading">
          <div className="ad-skeleton md" />
          <div className="ad-skeleton lg" />
          <div className="ad-skeleton sm" />
          <div className="ad-skeleton md" />
        </div>
      ) : items.length === 0 ? (
        <div className="ad-empty">
          <span className="ad-empty-text">Your inbox is empty</span>
          <span className="ad-empty-hint">
            As exo monitors markets and learns your patterns, insights will appear here.
          </span>
        </div>
      ) : (
        <>
          <div className="inbox-list">
            {items.map((item) => (
              <div
                key={item.id}
                className={`inbox-item ${item.status === "unread" ? "unread" : ""}`}
                onClick={() => handleMarkRead(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleMarkRead(item); } }}
              >
                <div className={`inbox-item-icon ${getInboxIconClass(item.category)}`}>
                  <InboxCategoryIcon category={item.category} />
                </div>
                <div className="inbox-item-content">
                  <div className="inbox-item-title">{item.title}</div>
                  <div className="inbox-item-body">{item.body}</div>
                  <div className="inbox-item-time">{formatTimeAgo(item.createdAt)}</div>
                </div>
                <div className="inbox-item-right">
                  <span className={`inbox-priority-badge ${getPriorityClass(item.priority)}`}>
                    {getPriorityLabel(item.priority)}
                  </span>
                  {!!item.actionType && item.category === "request" && (
                    <div className="inbox-item-actions">
                      <button
                        className="inbox-action-btn approve"
                        onClick={(e) => { e.stopPropagation(); handleAction(item.id, true); }}
                        disabled={actionLoadingId === item.id}
                        aria-label="Approve"
                      >
                        {actionLoadingId === item.id ? "..." : "Approve"}
                      </button>
                      <button
                        className="inbox-action-btn reject"
                        onClick={(e) => { e.stopPropagation(); handleAction(item.id, false); }}
                        disabled={actionLoadingId === item.id}
                        aria-label="Reject"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  <button
                    className="inbox-dismiss-btn"
                    onClick={(e) => { e.stopPropagation(); handleDismiss(item.id, item.category, item.status === "unread"); }}
                    aria-label="Dismiss"
                    title="Dismiss"
                  >
                    <XIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              className="ad-card-action"
              onClick={() => fetchItems(activeCategory, true)}
              disabled={loadingMore}
              style={{ width: "100%", textAlign: "center", marginTop: 12, padding: "10px" }}
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Pending Requests Card ──────────────────────────────────────── */

function PendingRequestsCard() {
  const { request } = useApi();
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  useEffect(() => {
    request<PendingRequest[]>("/agent/activity/pending")
      .then(setPending)
      .catch(() => setPending([]))
      .finally(() => setLoading(false));
  }, [request]);

  const handleRespond = async (id: string, approved: boolean) => {
    setRespondingId(id);
    try {
      await request(`/agent/activity/${id}/respond`, {
        method: "POST",
        body: { approved },
      });
      setPending((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // Keep the item in the list on failure
    } finally {
      setRespondingId(null);
    }
  };

  if (loading) {
    return null; // Don't show skeleton for pending requests, only show when there are items
  }

  if (pending.length === 0) {
    return null; // Only render if there are pending items
  }

  return (
    <div className="ad-card" style={{ borderColor: "color-mix(in srgb, var(--exo-peach) 30%, var(--border))" }}>
      <div className="ad-card-header">
        <span className="ad-card-title">Pending Requests</span>
        <span className="ad-badge pending">{pending.length}</span>
      </div>
      {pending.map((item) => (
        <div key={item.id} className="ad-pending-item">
          <div className="ad-pending-title">{item.title}</div>
          <div className="ad-pending-desc">{item.description}</div>
          <div className="ad-pending-actions">
            <button
              className="btn-exo btn-primary"
              onClick={() => handleRespond(item.id, true)}
              disabled={respondingId === item.id}
            >
              {respondingId === item.id ? "..." : "Approve"}
            </button>
            <button
              className="btn-exo btn-secondary"
              onClick={() => handleRespond(item.id, false)}
              disabled={respondingId === item.id}
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Overview: Compact Wallet Summary ───────────────────────────── */

function WalletSummary() {
  const { request } = useApi();
  const [balance, setBalance] = useState<AgentWalletBalance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request<AgentWalletBalance>("/agent/wallet/balance")
      .then(setBalance)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [request]);

  if (loading) {
    return (
      <div className="ad-card ad-wallet-summary">
        <div className="ad-loading"><div className="ad-skeleton md" /></div>
      </div>
    );
  }

  const usdc = balance?.balances?.USDC ? formatBaseUnits(balance.balances.USDC, 6) : "0";
  const eth = balance?.balances?.ETH ? formatBaseUnits(balance.balances.ETH, 18) : "0";

  return (
    <div className="ad-card ad-wallet-summary">
      <div className="ad-card-header">
        <span className="ad-card-title">Agent Wallet</span>
      </div>
      <div className="ad-wallet-summary-row">
        <div className="ad-wallet-summary-item">
          <span className="ad-wallet-token">USDC</span>
          <span className="ad-wallet-amount">{usdc}</span>
        </div>
        <div className="ad-wallet-summary-divider" />
        <div className="ad-wallet-summary-item">
          <span className="ad-wallet-token">ETH</span>
          <span className="ad-wallet-amount" style={{ fontSize: 18 }}>{eth}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Overview: Compact Inbox Preview ────────────────────────────── */

function InboxPreview({ onSeeAll }: { onSeeAll: () => void }) {
  const { request } = useApi();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadTotal, setUnreadTotal] = useState(0);

  useEffect(() => {
    Promise.all([
      request<InboxItem[]>("/agent/inbox", { query: { limit: 4 } }),
      request<InboxUnreadCounts>("/agent/inbox/unread"),
    ])
      .then(([inboxItems, counts]) => {
        setItems(inboxItems);
        setUnreadTotal(counts.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [request]);

  if (loading) {
    return (
      <div className="ad-card">
        <div className="ad-card-header">
          <span className="ad-card-title">Inbox</span>
        </div>
        <div className="ad-loading">
          <div className="ad-skeleton md" />
          <div className="ad-skeleton sm" />
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="ad-card">
      <div className="ad-card-header">
        <div className="inbox-header-left">
          <span className="ad-card-title">Inbox</span>
          {unreadTotal > 0 && <span className="inbox-unread-badge">{unreadTotal}</span>}
        </div>
        <button className="ad-card-action" onClick={onSeeAll}>See all</button>
      </div>
      <div className="inbox-list">
        {items.slice(0, 4).map((item) => (
          <div key={item.id} className={`inbox-item inbox-item--compact ${item.status === "unread" ? "unread" : ""}`}>
            <div className={`inbox-item-icon ${getInboxIconClass(item.category)}`}>
              <InboxCategoryIcon category={item.category} />
            </div>
            <div className="inbox-item-content">
              <div className="inbox-item-title">{item.title}</div>
              <div className="inbox-item-time">{formatTimeAgo(item.createdAt)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Overview: Quick Status ─────────────────────────────────────── */

function QuickStatus() {
  const { request } = useApi();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [mandateCount, setMandateCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      request<Record<string, unknown>>("/agent/profile").then(parseAgentProfile),
      request<Mandate[]>("/agent/mandates").catch(() => [] as Mandate[]),
    ])
      .then(([p, mandates]) => {
        setProfile(p);
        setMandateCount(mandates.filter((m) => m.status === "active").length);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [request]);

  if (loading || !profile) {
    return null;
  }

  return (
    <div className="ad-quick-status">
      <div className="ad-status-chip">
        <span className="ad-status-chip-label">Trust</span>
        <span className={`ad-tier-badge ${profile.trustTier}`}>
          {TRUST_TIER_LABELS[profile.trustTier]}
        </span>
      </div>
      <div className="ad-status-chip">
        <span className="ad-status-chip-label">Automations</span>
        <span className="ad-status-chip-value">{mandateCount} active</span>
      </div>
      <div className="ad-status-chip">
        <span className="ad-status-chip-label">Risk</span>
        <span className="ad-status-chip-value">{profile.riskTolerance}</span>
      </div>
    </div>
  );
}

/* ─── Dashboard Tabs ─────────────────────────────────────────────── */

type DashboardTab = "overview" | "inbox" | "automations" | "settings";

const DASHBOARD_TABS: { key: DashboardTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "inbox", label: "Inbox" },
  { key: "automations", label: "Automations" },
  { key: "settings", label: "Settings" },
];

/* ─── Page ───────────────────────────────────────────────────────── */

export function AgentDashboardPage() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const tabBarRef = useRef<HTMLDivElement>(null);

  /* scroll the active tab pill into view when it changes */
  useEffect(() => {
    if (!tabBarRef.current) return;
    const activeEl = tabBarRef.current.querySelector(".ad-tab-pill.active");
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeTab]);

  const switchToInbox = useCallback(() => setActiveTab("inbox"), []);

  return (
    <div className="agent-dash">
      <div className="agent-dash-header">
        <h1 className="agent-dash-title">Agent</h1>
        <p className="agent-dash-subtitle">Configure and monitor your AI assistant</p>
      </div>

      {/* ── Sticky Tab Bar ── */}
      <div className="ad-tab-bar-wrapper">
        <div className="ad-tab-bar" ref={tabBarRef} role="tablist" aria-label="Dashboard sections">
          {DASHBOARD_TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls={`ad-panel-${tab.key}`}
              className={`ad-tab-pill ${activeTab === tab.key ? "active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Panels ── */}
      <div className="ad-tab-content">
        {activeTab === "overview" && (
          <div id="ad-panel-overview" role="tabpanel" className="ad-tab-panel">
            <PendingRequestsCard />
            <WalletSummary />
            <QuickStatus />
            <InboxPreview onSeeAll={switchToInbox} />
          </div>
        )}

        {activeTab === "inbox" && (
          <div id="ad-panel-inbox" role="tabpanel" className="ad-tab-panel">
            <InboxCard />
          </div>
        )}

        {activeTab === "automations" && (
          <div id="ad-panel-automations" role="tabpanel" className="ad-tab-panel">
            <AutomationsCard />
          </div>
        )}

        {activeTab === "settings" && (
          <div id="ad-panel-settings" role="tabpanel" className="ad-tab-panel">
            <AgentWalletCard />
            <TrustTierCard />
            <PreferencesCard />
            <CustomInstructionsCard />
          </div>
        )}
      </div>
    </div>
  );
}
