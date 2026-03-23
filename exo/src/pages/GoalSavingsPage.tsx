import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useApi } from "../hooks/useApi";
import {
  useGoalsQuery,
  useCreateGoalMutation,
  useUpdateGoalMutation,
  useGoalDepositMutation,
  useGoalActionMutation,
} from "../hooks/queries";
import { ActionPanel } from "../components/ActionPanel";
import { JsonViewer } from "../components/JsonViewer";
import { StatusTag } from "../components/StatusTag";
import { Spinner } from "../components/Spinner";
import {
  createGoalSchema,
  updateGoalSchema,
  goalDepositSchema,
  type CreateGoalFormData,
  type UpdateGoalFormData,
  type GoalDepositFormData,
} from "../lib/schemas";
import type { GoalSaving } from "../lib/types";
import { FREQUENCY_OPTIONS, WALLET_TYPES } from "../lib/constants";

export function GoalSavingsPage() {
  const { request } = useApi();
  const { data: goals = [], isLoading, refetch } = useGoalsQuery();
  const createGoalMutation = useCreateGoalMutation();
  const updateGoalMutation = useUpdateGoalMutation();
  const depositMutation = useGoalDepositMutation();
  const actionMutation = useGoalActionMutation();

  const [selected, setSelected] = useState<GoalSaving | null>(null);
  const [goalId, setGoalId] = useState("");

  // Create form
  const createForm = useForm<CreateGoalFormData>({
    resolver: zodResolver(createGoalSchema),
    defaultValues: {
      name: "",
      description: "",
      targetAmount: "",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      walletType: "server",
      vaultId: "",
      depositAmount: "",
      unlockTimeOffsetSeconds: 2592000,
      frequency: "7d",
      startDate: "",
      endDate: "",
    },
  });

  // Update form
  const updateForm = useForm<UpdateGoalFormData>({
    resolver: zodResolver(updateGoalSchema),
    defaultValues: { goalId: "", name: "", description: "", depositAmount: "", frequency: "" },
  });

  // Deposit form
  const depositForm = useForm<GoalDepositFormData>({
    resolver: zodResolver(goalDepositSchema),
    defaultValues: { goalId: "", amount: "", walletType: "server", vaultId: "" },
  });

  const onCreateGoal = async (data: CreateGoalFormData) => {
    const body: Record<string, unknown> = {
      name: data.name,
      targetAmount: data.targetAmount,
      tokenAddress: data.tokenAddress,
      tokenSymbol: data.tokenSymbol,
      tokenDecimals: data.tokenDecimals,
    };
    if (data.description) body.description = data.description;
    if (data.walletType) body.walletType = data.walletType;
    if (data.vaultId) body.vaultId = data.vaultId;
    if (data.depositAmount) body.depositAmount = data.depositAmount;
    if (data.unlockTimeOffsetSeconds) body.unlockTimeOffsetSeconds = data.unlockTimeOffsetSeconds;
    if (data.frequency) body.frequency = data.frequency;
    if (data.startDate) body.startDate = new Date(data.startDate).toISOString();
    if (data.endDate) body.endDate = new Date(data.endDate).toISOString();
    await createGoalMutation.mutateAsync(body);
    createForm.reset();
  };

  const onUpdateGoal = async (data: UpdateGoalFormData) => {
    const body: Record<string, unknown> = {};
    if (data.name) body.name = data.name;
    if (data.description) body.description = data.description;
    if (data.depositAmount) body.depositAmount = data.depositAmount;
    if (data.frequency) body.frequency = data.frequency;
    await updateGoalMutation.mutateAsync({ id: data.goalId, ...body });
  };

  const onDeposit = async (data: GoalDepositFormData) => {
    const body: Record<string, unknown> = { amount: data.amount };
    if (data.walletType) body.walletType = data.walletType;
    if (data.vaultId) body.vaultId = data.vaultId;
    await depositMutation.mutateAsync({ goalId: data.goalId, ...body });
  };

  return (
    <div>
      <div className="page-header">
        <h1>Goal Savings</h1>
        <p>Savings goals with optional automated deposits into yield pools</p>
      </div>

      <ActionPanel title="List Goals" method="GET" path="/api/goal-savings">
        <button className="btn-exo btn-primary btn-sm" onClick={() => refetch()} disabled={isLoading}>
          {isLoading ? <Spinner /> : "Refresh"}
        </button>
        {goals.filter(g => g.status !== "cancelled").length > 0 && (
          <div className="data-list" style={{ marginTop: 12 }}>
            {goals.filter(g => g.status !== "cancelled").map((g) => (
              <div key={g.id} className="data-list-item" onClick={() => { setSelected(g); setGoalId(g.id); updateForm.setValue("goalId", g.id); depositForm.setValue("goalId", g.id); }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StatusTag status={g.status} />
                  <strong>{g.name}</strong>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" }}>
                    {g.accumulatedAmount}/{g.targetAmount} {g.tokenSymbol}
                  </span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>{g.id.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        )}
        {selected && (
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 8, background: "var(--bg-elevated)", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
              <div
                style={{
                  height: "100%",
                  background: "var(--exo-lime)",
                  width: `${Math.min(100, (Number(selected.accumulatedAmount) / Number(selected.targetAmount)) * 100)}%`,
                  transition: "width 0.5s ease",
                }}
              />
            </div>
            <JsonViewer data={selected} label="Selected Goal" />
          </div>
        )}
      </ActionPanel>

      <ActionPanel title="Create Goal" method="POST" path="/api/goal-savings">
        <form onSubmit={createForm.handleSubmit(onCreateGoal)}>
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input className="input-exo" {...createForm.register("name")} placeholder="House Fund" />
              {createForm.formState.errors.name && <span className="msg-error">{createForm.formState.errors.name.message}</span>}
            </div>
            <div className="form-group">
              <label>Description (optional)</label>
              <input className="input-exo" {...createForm.register("description")} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Target Amount (raw units)</label>
              <input className="input-exo" {...createForm.register("targetAmount")} placeholder="1000000000" />
              {createForm.formState.errors.targetAmount && <span className="msg-error">{createForm.formState.errors.targetAmount.message}</span>}
            </div>
            <div className="form-group">
              <label>Token Symbol</label>
              <input className="input-exo" {...createForm.register("tokenSymbol")} placeholder="USDC" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Token Address</label>
              <input className="input-exo" {...createForm.register("tokenAddress")} />
            </div>
            <div className="form-group">
              <label>Token Decimals</label>
              <input className="input-exo" type="number" {...createForm.register("tokenDecimals")} />
            </div>
          </div>

          <div style={{ margin: "12px 0", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
            Automation Settings (optional)
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Wallet Type</label>
              <select className="input-exo" {...createForm.register("walletType")}>
                <option value="">None</option>
                {WALLET_TYPES.filter((t) => t !== "user").map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Vault ID</label>
              <input className="input-exo" {...createForm.register("vaultId")} placeholder="uuid" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Deposit Amount (per cycle)</label>
              <input className="input-exo" {...createForm.register("depositAmount")} placeholder="50000000" />
            </div>
            <div className="form-group">
              <label>Frequency</label>
              <select className="input-exo" {...createForm.register("frequency")}>
                <option value="">Manual only</option>
                {FREQUENCY_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Unlock Offset (seconds)</label>
              <input className="input-exo" type="number" {...createForm.register("unlockTimeOffsetSeconds")} />
            </div>
            <div className="form-group">
              <label>Start Date (optional)</label>
              <input className="input-exo" type="datetime-local" {...createForm.register("startDate")} />
            </div>
          </div>
          <div className="form-group">
            <label>End Date (optional)</label>
            <input className="input-exo" type="datetime-local" {...createForm.register("endDate")} />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-exo btn-primary" disabled={createGoalMutation.isPending}>
              {createGoalMutation.isPending ? <Spinner /> : "Create Goal"}
            </button>
          </div>
          {createGoalMutation.error && <div className="msg-error">{createGoalMutation.error instanceof Error ? createGoalMutation.error.message : "Failed"}</div>}
        </form>
      </ActionPanel>

      <ActionPanel title="Get Goal" method="GET" path="/api/goal-savings/:id">
        <form onSubmit={async (e) => { e.preventDefault(); const data = await request(`/goal-savings/${goalId}`); setSelected(data as GoalSaving); }}>
          <div className="form-group">
            <label>Goal ID</label>
            <input className="input-exo" value={goalId} onChange={(e) => setGoalId(e.target.value)} placeholder="uuid" />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-exo btn-primary">Get</button>
          </div>
        </form>
      </ActionPanel>

      <ActionPanel title="Update Goal" method="PATCH" path="/api/goal-savings/:id">
        <form onSubmit={updateForm.handleSubmit(onUpdateGoal)}>
          <div className="form-group">
            <label>Goal ID</label>
            <input className="input-exo" {...updateForm.register("goalId")} placeholder="uuid" />
            {updateForm.formState.errors.goalId && <span className="msg-error">{updateForm.formState.errors.goalId.message}</span>}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input className="input-exo" {...updateForm.register("name")} />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input className="input-exo" {...updateForm.register("description")} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Deposit Amount</label>
              <input className="input-exo" {...updateForm.register("depositAmount")} />
            </div>
            <div className="form-group">
              <label>Frequency</label>
              <select className="input-exo" {...updateForm.register("frequency")}>
                <option value="">No change</option>
                {FREQUENCY_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-exo btn-primary" disabled={updateGoalMutation.isPending}>
              {updateGoalMutation.isPending ? <Spinner /> : "Update"}
            </button>
          </div>
          {updateGoalMutation.error && <div className="msg-error">{updateGoalMutation.error instanceof Error ? updateGoalMutation.error.message : "Failed"}</div>}
        </form>
      </ActionPanel>

      <ActionPanel title="Manual Deposit" method="POST" path="/api/goal-savings/:id/deposit">
        <form onSubmit={depositForm.handleSubmit(onDeposit)}>
          <div className="form-group">
            <label>Goal ID</label>
            <input className="input-exo" {...depositForm.register("goalId")} placeholder="uuid" />
            {depositForm.formState.errors.goalId && <span className="msg-error">{depositForm.formState.errors.goalId.message}</span>}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Amount</label>
              <input className="input-exo" {...depositForm.register("amount")} placeholder="100000000" />
              {depositForm.formState.errors.amount && <span className="msg-error">{depositForm.formState.errors.amount.message}</span>}
            </div>
            <div className="form-group">
              <label>Wallet Type</label>
              <select className="input-exo" {...depositForm.register("walletType")}>
                {WALLET_TYPES.filter((t) => t !== "user").map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Vault ID (optional, falls back to goal's vault)</label>
            <input className="input-exo" {...depositForm.register("vaultId")} placeholder="uuid" />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-exo btn-primary" disabled={depositMutation.isPending}>
              {depositMutation.isPending ? <Spinner /> : "Deposit"}
            </button>
          </div>
          {depositMutation.error && <div className="msg-error">{depositMutation.error instanceof Error ? depositMutation.error.message : "Failed"}</div>}
        </form>
      </ActionPanel>

      <ActionPanel title="Deposit History" method="GET" path="/api/goal-savings/:id/deposits">
        <form onSubmit={async (e) => { e.preventDefault(); await request(`/goal-savings/${goalId}/deposits`, { query: { limit: "50" } }); }}>
          <div className="form-group">
            <label>Goal ID</label>
            <input className="input-exo" value={goalId} onChange={(e) => setGoalId(e.target.value)} placeholder="uuid" />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-exo btn-primary">Get Deposits</button>
          </div>
        </form>
      </ActionPanel>

      <ActionPanel title="Pause / Resume / Cancel" method="POST" path="/api/goal-savings/:id/...">
        <div className="form-group">
          <label>Goal ID</label>
          <input className="input-exo" value={goalId} onChange={(e) => setGoalId(e.target.value)} placeholder="uuid" />
        </div>
        <div className="form-actions">
          <button className="btn-exo btn-secondary" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ id: goalId, action: "pause" })}>Pause</button>
          <button className="btn-exo btn-primary" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ id: goalId, action: "resume" })}>Resume</button>
          <button className="btn-exo btn-danger" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ id: goalId, action: "cancel" })}>Cancel</button>
        </div>
        {actionMutation.error && <div className="msg-error">{actionMutation.error instanceof Error ? actionMutation.error.message : "Failed"}</div>}
      </ActionPanel>
    </div>
  );
}
