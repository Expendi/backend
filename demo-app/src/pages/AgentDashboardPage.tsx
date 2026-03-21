import { useState, useEffect, useRef, useCallback } from "react";
import { useApi } from "../hooks/useApi";
import "../styles/agent-dashboard.css";

/* ─── Types ──────────────────────────────────────────────────────── */

interface AgentWalletBalance {
  usdc: string;
  eth: string;
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

type TrustTier = "observe" | "notify" | "act_within_limits" | "full";
type RiskTolerance = "conservative" | "moderate" | "aggressive";
type KnowledgeLevel = "beginner" | "intermediate" | "advanced";

interface Mandate {
  id: string;
  name: string;
  type: string;
  status: "active" | "paused" | "revoked" | "completed";
  executionCount: number;
  createdAt: string;
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
  const [showFund, setShowFund] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [balData, profileData] = await Promise.all([
        request<AgentWalletBalance>("/agent/wallet/balance"),
        request<AgentProfile>("/agent/profile"),
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
      await request("/agent/wallet/fund", {
        method: "POST",
        body: { amount: fundAmount },
      });
      setFundAmount("");
      setShowFund(false);
      await fetchData();
    } catch {
      // Silently handle - the API will return errors
    } finally {
      setActionLoading(false);
    }
  };

  const handleWithdraw = async () => {
    setActionLoading(true);
    try {
      await request("/agent/wallet/withdraw", { method: "POST" });
      await fetchData();
    } catch {
      // Silently handle
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
          <span className="ad-wallet-amount">{balance?.usdc ?? "0"}</span>
        </div>
        <div className="ad-wallet-row">
          <span className="ad-wallet-token">ETH</span>
          <span className="ad-wallet-amount">{balance?.eth ?? "0"}</span>
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
            {actionLoading ? "..." : "Confirm"}
          </button>
        </div>
      )}
      <div className="ad-wallet-actions">
        <button
          className="btn-exo btn-primary"
          onClick={() => setShowFund(!showFund)}
          disabled={actionLoading}
        >
          Fund
        </button>
        <button
          className="btn-exo btn-secondary"
          onClick={handleWithdraw}
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
    request<AgentProfile>("/agent/profile")
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
        body: { trustTier: newTier },
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
    const newStatus = mandate.status === "active" ? "paused" : "active";
    try {
      await request(`/agent/mandates/${mandate.id}/status`, {
        method: "PATCH",
        body: { status: newStatus },
      });
      setMandates((prev) =>
        prev.map((m) => (m.id === mandate.id ? { ...m, status: newStatus } : m))
      );
    } catch {
      // Keep current state on failure
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await request(`/agent/mandates/${id}/status`, {
        method: "PATCH",
        body: { status: "revoked" },
      });
      setMandates((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: "revoked" } : m))
      );
    } catch {
      // Keep current state on failure
    } finally {
      setConfirmCancel(null);
    }
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreateLoading(true);
    try {
      await request("/agent/mandates", {
        method: "POST",
        body: { name: createName.trim(), type: createType },
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
                  {m.executionCount} execution{m.executionCount !== 1 ? "s" : ""}
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
    request<AgentProfile>("/agent/profile")
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
    request<AgentProfile>("/agent/profile")
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

/* ─── Activity Feed Card ─────────────────────────────────────────── */

function ActivityFeedCard() {
  const { request } = useApi();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const limit = 10;

  useEffect(() => {
    request<ActivityItem[]>("/agent/activity", {
      query: { limit },
    })
      .then((data) => {
        setActivities(data);
        setHasMore(data.length === limit);
        setOffset(data.length);
      })
      .catch(() => setActivities([]))
      .finally(() => setLoading(false));
  }, [request]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await request<ActivityItem[]>("/agent/activity", {
        query: { limit, offset },
      });
      setActivities((prev) => [...prev, ...data]);
      setHasMore(data.length === limit);
      setOffset((prev) => prev + data.length);
    } catch {
      // Keep existing data on failure
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <div className="ad-card">
        <div className="ad-card-header">
          <span className="ad-card-title">Activity</span>
        </div>
        <div className="ad-loading">
          <div className="ad-skeleton md" />
          <div className="ad-skeleton lg" />
          <div className="ad-skeleton sm" />
        </div>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="ad-card">
        <div className="ad-card-header">
          <span className="ad-card-title">Activity</span>
        </div>
        <div className="ad-empty">
          <span className="ad-empty-text">No agent activity yet</span>
          <span className="ad-empty-hint">Activity will appear here once the agent starts working</span>
        </div>
      </div>
    );
  }

  return (
    <div className="ad-card">
      <div className="ad-card-header">
        <span className="ad-card-title">Activity</span>
      </div>
      <div className="ad-activity-list">
        {activities.map((item) => (
          <div key={item.id} className="ad-activity-item">
            <div className={`ad-activity-icon ${getActivityIconClass(item.type)}`}>
              <ActivityTypeIcon type={item.type} />
            </div>
            <div className="ad-activity-info">
              <div className="ad-activity-title">{item.title}</div>
              <div className="ad-activity-time">{formatTimeAgo(item.createdAt)}</div>
            </div>
            <span className={`ad-badge type`}>{item.type.replace(/_/g, " ")}</span>
          </div>
        ))}
      </div>
      {hasMore && (
        <button
          className="ad-card-action"
          onClick={loadMore}
          disabled={loadingMore}
          style={{ width: "100%", textAlign: "center", marginTop: 12, padding: "10px" }}
        >
          {loadingMore ? "Loading..." : "Load More"}
        </button>
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
      <ActivityFeedCard />
    </div>
  );
}
