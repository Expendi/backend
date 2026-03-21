import { useState, useEffect, useRef, useCallback } from "react";
import { useApi } from "../hooks/useApi";
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
}

interface MandateAction {
  type: string;
  from?: string;
  to?: string;
  amount?: string;
  message?: string;
  goalId?: string;
}

interface Mandate {
  id: string;
  name: string;
  type: string;
  status: "active" | "paused" | "revoked" | "completed";
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

function summarizeTrigger(trigger?: MandateTrigger): string {
  if (!trigger) return "Manual";
  switch (trigger.type) {
    case "schedule":
      return `Every ${trigger.frequency ?? "?"}`;
    case "price":
      return `When ${trigger.token ?? "?"} ${trigger.condition ?? "?"} $${trigger.value ?? "?"}`;
    default:
      return trigger.type;
  }
}

function summarizeAction(action?: MandateAction): string {
  if (!action) return "No action";
  switch (action.type) {
    case "swap": {
      const amt = action.amount ? formatBaseUnits(action.amount, 6) : "?";
      return `Swap ${amt} ${action.from ?? "?"} to ${action.to ?? "?"}`;
    }
    case "notify":
      return action.message ?? "Notify";
    case "goal_deposit": {
      const amt = action.amount ? formatBaseUnits(action.amount, 6) : "?";
      return `Deposit ${amt} USDC to goal`;
    }
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

function AgentWalletCard() {
  const { request } = useApi();
  const [balance, setBalance] = useState<AgentWalletBalance | null>(null);
  const [budgetLimit, setBudgetLimit] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [fundAmount, setFundAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [showFund, setShowFund] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

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

  const handleFund = async () => {
    const amt = parseFloat(fundAmount);
    if (!amt || amt <= 0) return;
    setActionLoading(true);
    try {
      await request("/wallets/transfer", {
        method: "POST",
        body: {
          from: "user",
          to: "agent",
          amount: toBaseUnits(fundAmount, 6),
          token: "USDC",
        },
      });
      setFundAmount("");
      setShowFund(false);
      await fetchData();
    } catch {
      // Keep current state on failure
    } finally {
      setActionLoading(false);
    }
  };

  const handleWithdraw = async () => {
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt <= 0) return;
    setActionLoading(true);
    try {
      await request("/wallets/transfer", {
        method: "POST",
        body: {
          from: "agent",
          to: "user",
          amount: toBaseUnits(withdrawAmount, 6),
          token: "USDC",
        },
      });
      setWithdrawAmount("");
      setShowWithdraw(false);
      await fetchData();
    } catch {
      // Keep current state on failure
    } finally {
      setActionLoading(false);
    }
  };

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
      {budgetLimit && (
        <div className="ad-wallet-budget">
          <span className="ad-wallet-budget-label">Budget Limit</span>
          <span className="ad-wallet-budget-value">{budgetLimit} USDC</span>
        </div>
      )}
      {showFund && (
        <div className="ad-fund-row">
          <input
            className="ad-fund-input"
            type="number"
            inputMode="decimal"
            placeholder="Amount (USDC)"
            value={fundAmount}
            onChange={(e) => setFundAmount(e.target.value)}
            disabled={actionLoading}
          />
          <button
            className="btn-exo btn-primary"
            onClick={handleFund}
            disabled={actionLoading || !fundAmount || parseFloat(fundAmount) <= 0}
            style={{ padding: "10px 20px" }}
          >
            {actionLoading ? "..." : "Confirm Fund"}
          </button>
        </div>
      )}
      {showWithdraw && (
        <div className="ad-fund-row">
          <input
            className="ad-fund-input"
            type="number"
            inputMode="decimal"
            placeholder="Amount (USDC)"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            disabled={actionLoading}
          />
          <button
            className="btn-exo btn-secondary"
            onClick={handleWithdraw}
            disabled={actionLoading || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
            style={{ padding: "10px 20px" }}
          >
            {actionLoading ? "..." : "Confirm Withdraw"}
          </button>
        </div>
      )}
      <div className="ad-wallet-actions">
        <button
          className="btn-exo btn-primary"
          onClick={() => { setShowFund(!showFund); setShowWithdraw(false); }}
          disabled={actionLoading}
        >
          Fund
        </button>
        <button
          className="btn-exo btn-secondary"
          onClick={() => { setShowWithdraw(!showWithdraw); setShowFund(false); }}
          disabled={actionLoading}
        >
          Withdraw
        </button>
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

function AutomationsCard() {
  const { request } = useApi();
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState("recurring_swap");
  const [createLoading, setCreateLoading] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

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

  const handleCancel = async (id: string) => {
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

  const buildMandateDefaults = (type: string): { trigger: MandateTrigger; action: MandateAction } => {
    switch (type) {
      case "dca":
        return {
          trigger: { type: "schedule", frequency: "7d" },
          action: { type: "swap", from: "USDC", to: "ETH", amount: "10000000" },
        };
      case "limit_order":
        return {
          trigger: { type: "price", token: "ETH", condition: "below", value: 2000 },
          action: { type: "notify", message: "Price alert triggered" },
        };
      case "yield_harvest":
        return {
          trigger: { type: "schedule", frequency: "30d" },
          action: { type: "goal_deposit", goalId: "", amount: "5000000" },
        };
      case "recurring_swap":
        return {
          trigger: { type: "schedule", frequency: "7d" },
          action: { type: "swap", from: "USDC", to: "ETH", amount: "10000000" },
        };
      case "rebalance":
        return {
          trigger: { type: "schedule", frequency: "30d" },
          action: { type: "swap", from: "USDC", to: "ETH", amount: "50000000" },
        };
      default:
        return {
          trigger: { type: "schedule", frequency: "7d" },
          action: { type: "swap", from: "USDC", to: "ETH", amount: "10000000" },
        };
    }
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreateLoading(true);
    try {
      const defaults = buildMandateDefaults(createType);
      await request("/agent/mandates", {
        method: "POST",
        body: {
          name: createName.trim(),
          type: createType,
          trigger: defaults.trigger,
          action: defaults.action,
        },
      });
      setCreateName("");
      setShowCreate(false);
      await fetchMandates();
    } catch {
      // Keep form open on failure so user can retry
    } finally {
      setCreateLoading(false);
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

  return (
    <div className="ad-card">
      <div className="ad-card-header">
        <span className="ad-card-title">Automations</span>
        <button className="ad-card-action" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "+ Create"}
        </button>
      </div>

      {showCreate && (
        <div className="ad-create-form">
          <input
            className="ad-create-input"
            placeholder="Automation name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            disabled={createLoading}
          />
          <div className="ad-create-form-row">
            <select
              className="ad-create-select"
              value={createType}
              onChange={(e) => setCreateType(e.target.value)}
              disabled={createLoading}
            >
              <option value="recurring_swap">Recurring Swap</option>
              <option value="limit_order">Limit Order</option>
              <option value="dca">DCA Strategy</option>
              <option value="rebalance">Portfolio Rebalance</option>
              <option value="yield_harvest">Yield Harvest</option>
            </select>
          </div>
          <div className="ad-create-actions">
            <button
              className="btn-exo btn-primary"
              onClick={handleCreate}
              disabled={createLoading || !createName.trim()}
            >
              {createLoading ? "Creating..." : "Create"}
            </button>
            <button
              className="btn-exo btn-secondary"
              onClick={() => { setShowCreate(false); setCreateName(""); }}
              disabled={createLoading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {activeMandates.length === 0 && !showCreate ? (
        <div className="ad-empty">
          <span className="ad-empty-text">No automations configured</span>
          <span className="ad-empty-hint">Create one to let your agent act on your behalf</span>
        </div>
      ) : (
        <div className="ad-mandate-list">
          {activeMandates.map((m) => (
            <div key={m.id} className="ad-mandate-item">
              <div className="ad-mandate-info">
                <div className="ad-mandate-name">
                  {m.name}
                  <span className={`ad-badge type`}>{m.type.replace(/_/g, " ")}</span>
                  <span className={`ad-badge ${m.status}`}>{m.status}</span>
                </div>
                <div className="ad-mandate-meta">
                  {summarizeTrigger(m.trigger)} &rarr; {summarizeAction(m.action)}
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
                {m.status !== "revoked" && m.status !== "completed" && (
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
      )}

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
              <button className="btn-exo btn-danger" onClick={() => handleCancel(confirmCancel)}>
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
type InboxStatus = "unread" | "read" | "dismissed";

interface InboxItem {
  id: string;
  category: InboxCategory;
  title: string;
  body: string;
  priority: InboxPriority;
  status: InboxStatus;
  actionable: boolean;
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
                  {item.actionable && item.category === "request" && (
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

/* ─── Page ───────────────────────────────────────────────────────── */

export function AgentDashboardPage() {
  return (
    <div className="agent-dash">
      <div className="agent-dash-header">
        <h1 className="agent-dash-title">Agent</h1>
        <p className="agent-dash-subtitle">Configure and monitor your AI assistant</p>
      </div>

      <PendingRequestsCard />
      <AgentWalletCard />
      <TrustTierCard />
      <AutomationsCard />
      <PreferencesCard />
      <CustomInstructionsCard />
      <InboxCard />
    </div>
  );
}
