import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useCategoriesQuery,
  useCategoryLimitsQuery,
  useSpendingQuery,
  useDailySpendingQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useDeleteCategoryMutation,
  useBatchCreateCategoriesMutation,
} from "../hooks/queries";
import { Spinner } from "../components/Spinner";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  createCategorySchema,
  editCategorySchema,
  type CreateCategoryFormData,
  type EditCategoryFormData,
} from "../lib/schemas";
import type { Category } from "../lib/types";
import "../styles/pages.css";

type Tab = "categories" | "spending";

const CHART_COLORS = [
  "#8b5cf6", "#6366f1", "#3b82f6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#a855f7", "#14b8a6",
];

const PRESET_CATEGORIES: { name: string; description: string }[] = [
  { name: "Food & Dining", description: "Meals, groceries, and restaurants" },
  { name: "Transport", description: "Rides, fuel, and public transit" },
  { name: "Bills & Utilities", description: "Rent, electricity, internet, and subscriptions" },
  { name: "Entertainment", description: "Movies, games, events, and streaming" },
  { name: "Shopping", description: "Clothing, electronics, and general purchases" },
  { name: "Health", description: "Medical, pharmacy, and wellness" },
  { name: "Education", description: "Courses, books, and tuition" },
  { name: "Savings", description: "Deposits into savings and investments" },
  { name: "Transfers", description: "Peer-to-peer and account transfers" },
  { name: "Other", description: "Uncategorized transactions" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTokenAmount(raw: string, decimals: number): string {
  const num = Number(raw);
  if (isNaN(num) || num === 0) return "0";
  const divisor = Math.pow(10, decimals);
  return (num / divisor).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CategoriesPage() {
  const { data: categories = [], isLoading } = useCategoriesQuery();
  const { data: limits = [] } = useCategoryLimitsQuery();
  const { data: spending = [], isLoading: spendingLoading } = useSpendingQuery();
  const { data: dailySpending = [] } = useDailySpendingQuery(30);

  const createMutation = useCreateCategoryMutation();
  const updateMutation = useUpdateCategoryMutation();
  const deleteMutation = useDeleteCategoryMutation();
  const batchMutation = useBatchCreateCategoriesMutation();

  const [tab, setTab] = useState<Tab>("categories");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selected, setSelected] = useState<Category | null>(null);
  const [editMode, setEditMode] = useState(false);

  // Quick setup
  const [quickSetupSelected, setQuickSetupSelected] = useState<Set<number>>(
    () => new Set(PRESET_CATEGORIES.map((_, i) => i))
  );

  // Create form
  const createForm = useForm<CreateCategoryFormData>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: { name: "", description: "", monthlyLimit: "", wallet: "user" },
  });

  // Edit form
  const editForm = useForm<EditCategoryFormData>({
    resolver: zodResolver(editCategorySchema),
    defaultValues: { name: "", description: "", monthlyLimit: "" },
  });

  const onCreateCategory = async (data: CreateCategoryFormData) => {
    await createMutation.mutateAsync({
      name: data.name,
      description: data.description,
      monthlyLimit: data.monthlyLimit,
    });
    createForm.reset();
    setShowCreateForm(false);
  };

  const onUpdateCategory = async (data: EditCategoryFormData) => {
    if (!selected) return;
    const existingLimit = limits.find((l) => l.categoryId === selected.id) ?? null;
    await updateMutation.mutateAsync({
      id: selected.id,
      name: data.name !== selected.name ? data.name : undefined,
      description: data.description !== (selected.description ?? "") ? data.description : undefined,
      monthlyLimit: data.monthlyLimit,
      existingLimit,
    });
    setEditMode(false);
    setSelected({ ...selected, name: data.name, description: data.description ?? null });
  };

  const handleDeleteCategory = async () => {
    if (!selected) return;
    await deleteMutation.mutateAsync(selected.id);
    setSelected(null);
  };

  const toggleQuickSetupPreset = (index: number) => {
    setQuickSetupSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleBatchCreate = async () => {
    if (quickSetupSelected.size === 0) return;
    const payload = PRESET_CATEGORIES
      .filter((_, i) => quickSetupSelected.has(i))
      .map(({ name, description }) => ({ name, description }));
    await batchMutation.mutateAsync(payload);
  };

  const openCategoryModal = useCallback(
    (cat: Category) => {
      setSelected(cat);
      setEditMode(false);
      const catLimit = limits.find((l) => l.categoryId === cat.id);
      editForm.reset({
        name: cat.name,
        description: cat.description ?? "",
        monthlyLimit: catLimit
          ? (Number(catLimit.monthlyLimit) / Math.pow(10, catLimit.tokenDecimals)).toString()
          : "",
      });
    },
    [limits, editForm]
  );

  const closeCategoryModal = () => {
    setSelected(null);
    setEditMode(false);
  };

  const userCategories = categories.filter((c) => !c.isGlobal);
  const globalCategories = categories.filter((c) => c.isGlobal);

  return (
    <div className="exo-page">
      <div className="exo-page-header">
        <h1 className="exo-page-title">Categories</h1>
        <p className="exo-page-subtitle">Organize and track your spending</p>
      </div>

      <div className="exo-tabs">
        <button className={`exo-tab ${tab === "categories" ? "active" : ""}`} onClick={() => setTab("categories")}>Categories</button>
        <button className={`exo-tab ${tab === "spending" ? "active" : ""}`} onClick={() => setTab("spending")}>Spending</button>
      </div>

      {/* ─── CATEGORIES TAB ─── */}
      {tab === "categories" && (
        <>
          {isLoading ? (
            <div className="exo-inline-spinner"><Spinner /></div>
          ) : (
            <div className="exo-animate-in">
              {categories.length === 0 && !showCreateForm ? (
                <div className="exo-animate-in">
                  <div className="exo-form-card" style={{ marginBottom: 16 }}>
                    <div className="exo-form-card-title">Quick Setup</div>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px" }}>
                      Select common categories to get started quickly, or add your own below.
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                      {PRESET_CATEGORIES.map((preset, i) => {
                        const isSelected = quickSetupSelected.has(i);
                        return (
                          <button
                            key={preset.name}
                            type="button"
                            onClick={() => toggleQuickSetupPreset(i)}
                            disabled={batchMutation.isPending}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 16,
                              border: isSelected ? "1.5px solid var(--exo-accent, #8b5cf6)" : "1.5px solid var(--border-color, #333)",
                              background: isSelected ? "var(--exo-accent-dim, rgba(139,92,246,0.15))" : "transparent",
                              color: isSelected ? "var(--exo-accent, #8b5cf6)" : "var(--text-muted)",
                              fontSize: 13, fontWeight: 500,
                              cursor: batchMutation.isPending ? "not-allowed" : "pointer",
                              transition: "all 0.15s ease",
                              fontFamily: "inherit",
                            }}
                          >
                            {preset.name}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button className="btn-exo btn-primary" disabled={quickSetupSelected.size === 0 || batchMutation.isPending} onClick={handleBatchCreate} style={{ flex: 1 }}>
                        {batchMutation.isPending ? "Creating..." : `Create ${quickSetupSelected.size} ${quickSetupSelected.size === 1 ? "Category" : "Categories"}`}
                      </button>
                      <button className="btn-exo btn-secondary" onClick={() => { setQuickSetupSelected(new Set()); setShowCreateForm(true); }} disabled={batchMutation.isPending}>
                        Custom
                      </button>
                    </div>
                    {batchMutation.error && <div className="msg-error" style={{ marginTop: 8 }}>{batchMutation.error instanceof Error ? batchMutation.error.message : "Failed"}</div>}
                  </div>
                </div>
              ) : (
                <>
                  {!showCreateForm && (
                    <button className="btn-exo btn-primary" style={{ width: "100%", padding: "12px", marginBottom: 16 }} onClick={() => setShowCreateForm(true)}>
                      Add Category
                    </button>
                  )}

                  {showCreateForm && (
                    <form className="exo-form-card" style={{ marginBottom: 16 }} onSubmit={createForm.handleSubmit(onCreateCategory)}>
                      <div className="exo-form-card-title">New Category</div>
                      <div className="form-group">
                        <label>Name</label>
                        <input className="input-exo" {...createForm.register("name")} placeholder="Food & Dining" />
                        {createForm.formState.errors.name && <span className="msg-error">{createForm.formState.errors.name.message}</span>}
                      </div>
                      <div className="form-group">
                        <label>Description (optional)</label>
                        <input className="input-exo" {...createForm.register("description")} placeholder="Meals, groceries, and restaurants" />
                      </div>
                      <div className="form-group">
                        <label>Monthly Limit — USDC (optional)</label>
                        <input className="input-exo" {...createForm.register("monthlyLimit")} placeholder="500.00" inputMode="decimal" />
                      </div>
                      <div className="form-group">
                        <label>Wallet</label>
                        <select className="input-exo" {...createForm.register("wallet")}>
                          <option value="user">User Wallet</option>
                          <option value="server">Server Wallet</option>
                          <option value="agent">Agent Wallet</option>
                        </select>
                      </div>
                      {createMutation.error && <div className="msg-error" style={{ marginBottom: 8 }}>{createMutation.error instanceof Error ? createMutation.error.message : "Failed"}</div>}
                      <div className="exo-actions">
                        <button type="button" className="btn-exo btn-secondary" onClick={() => { setShowCreateForm(false); createForm.reset(); }} disabled={createMutation.isPending}>
                          Cancel
                        </button>
                        <button type="submit" className="btn-exo btn-primary" disabled={createMutation.isPending}>
                          {createMutation.isPending ? "Creating..." : "Create"}
                        </button>
                      </div>
                    </form>
                  )}

                  {userCategories.length > 0 && (
                    <>
                      <div className="exo-form-card-title" style={{ marginBottom: 8 }}>Your Categories</div>
                      <div className="exo-list" style={{ marginBottom: 20 }}>
                        {userCategories.map((c) => {
                          const catLimit = limits.find((l) => l.categoryId === c.id);
                          return (
                            <div key={c.id} className="exo-list-item" onClick={() => openCategoryModal(c)}>
                              <div className="exo-list-item-left">
                                <span className="exo-list-item-title">{c.name}</span>
                                <span className="exo-list-item-sub">
                                  {c.description ?? "No description"}
                                  {catLimit && ` · ${formatTokenAmount(catLimit.monthlyLimit, catLimit.tokenDecimals)} ${catLimit.tokenSymbol}/mo`}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {globalCategories.length > 0 && (
                    <>
                      <div className="exo-form-card-title" style={{ marginBottom: 8 }}>Global Categories</div>
                      <div className="exo-list">
                        {globalCategories.map((c) => (
                          <div key={c.id} className="exo-list-item" onClick={() => openCategoryModal(c)}>
                            <div className="exo-list-item-left">
                              <span className="exo-list-item-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {c.name}
                                <span className="tag-exo" style={{ fontSize: 9 }}>global</span>
                              </span>
                              <span className="exo-list-item-sub">{c.description ?? "No description"}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Category detail modal */}
          {selected && (
            <div className="exo-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) closeCategoryModal(); }}>
              <div className="exo-modal">
                <div className="exo-modal-header">
                  <span className="exo-modal-title">{selected.name}</span>
                  <button className="exo-modal-close" onClick={closeCategoryModal}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
                <div className="exo-modal-body">
                  {!editMode ? (
                    <>
                      <div className="exo-review" style={{ marginBottom: 16 }}>
                        <div className="exo-review-row">
                          <span className="exo-review-label">Name</span>
                          <span className="exo-review-value">{selected.name}</span>
                        </div>
                        <div className="exo-review-row">
                          <span className="exo-review-label">Description</span>
                          <span className="exo-review-value">{selected.description ?? "None"}</span>
                        </div>
                        <div className="exo-review-row">
                          <span className="exo-review-label">Type</span>
                          <span className="exo-review-value">
                            <span className={`tag-exo ${selected.isGlobal ? "status-active" : ""}`}>
                              {selected.isGlobal ? "Global" : "Custom"}
                            </span>
                          </span>
                        </div>
                        <div className="exo-review-row">
                          <span className="exo-review-label">Monthly Limit</span>
                          <span className="exo-review-value">
                            {(() => {
                              const catLimit = limits.find((l) => l.categoryId === selected.id);
                              return catLimit
                                ? `${formatTokenAmount(catLimit.monthlyLimit, catLimit.tokenDecimals)} ${catLimit.tokenSymbol}`
                                : "None";
                            })()}
                          </span>
                        </div>
                        <div className="exo-review-row">
                          <span className="exo-review-label">Created</span>
                          <span className="exo-review-value">{formatDate(selected.createdAt)}</span>
                        </div>
                      </div>

                      {deleteMutation.error && <div className="msg-error" style={{ marginBottom: 12 }}>{deleteMutation.error instanceof Error ? deleteMutation.error.message : "Failed"}</div>}

                      <div className="exo-actions">
                        {!selected.isGlobal && (
                          <>
                            <button className="btn-exo btn-secondary" onClick={() => setEditMode(true)}>Edit</button>
                            <button className="btn-exo btn-danger" disabled={deleteMutation.isPending} onClick={handleDeleteCategory}>
                              {deleteMutation.isPending ? "Deleting..." : "Delete"}
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <form onSubmit={editForm.handleSubmit(onUpdateCategory)}>
                      <div className="exo-form-card" style={{ marginBottom: 16 }}>
                        <div className="exo-form-card-title">Edit Category</div>
                        <div className="form-group">
                          <label>Name</label>
                          <input className="input-exo" {...editForm.register("name")} />
                          {editForm.formState.errors.name && <span className="msg-error">{editForm.formState.errors.name.message}</span>}
                        </div>
                        <div className="form-group">
                          <label>Description</label>
                          <input className="input-exo" {...editForm.register("description")} placeholder="Add a description" />
                        </div>
                        <div className="form-group">
                          <label>Monthly Limit — USDC</label>
                          <input className="input-exo" {...editForm.register("monthlyLimit")} placeholder="500.00" inputMode="decimal" />
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                            Leave empty to remove limit
                          </div>
                        </div>
                      </div>

                      {updateMutation.error && <div className="msg-error" style={{ marginBottom: 12 }}>{updateMutation.error instanceof Error ? updateMutation.error.message : "Failed"}</div>}

                      <div className="exo-actions">
                        <button type="button" className="btn-exo btn-secondary" onClick={() => setEditMode(false)} disabled={updateMutation.isPending}>
                          Cancel
                        </button>
                        <button type="submit" className="btn-exo btn-primary" disabled={updateMutation.isPending}>
                          {updateMutation.isPending ? "Saving..." : "Save Changes"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── SPENDING TAB ─── */}
      {tab === "spending" && (
        <>
          {spendingLoading ? (
            <div className="exo-inline-spinner"><Spinner /></div>
          ) : (
            <div className="exo-animate-in">
              {spending.length === 0 ? (
                <div className="exo-empty">
                  <div className="exo-empty-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" />
                    </svg>
                  </div>
                  <div className="exo-empty-text">No spending data yet</div>
                  <div className="exo-empty-hint">Assign categories to your transactions to see spending breakdowns</div>
                </div>
              ) : (
                <>
                  <div className="exo-form-card" style={{ marginBottom: 16, padding: 16 }}>
                    <div className="exo-form-card-title">This Month by Category</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={spending.map((s) => ({ name: s.categoryName, value: Number(s.totalSpent) / 1e6 }))}
                          cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value"
                          label={({ name, value }) => `${name}: ${value.toFixed(2)}`} labelLine={false}
                        >
                          {spending.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => `${Number(v).toFixed(2)} USDC`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="exo-form-card" style={{ marginBottom: 16, padding: 16 }}>
                    <div className="exo-form-card-title">Spending vs Limits</div>
                    <div className="exo-list">
                      {spending.map((s, i) => {
                        const spent = Number(s.totalSpent) / 1e6;
                        const limitVal = s.limit ? Number(s.limit.monthlyLimit) / Math.pow(10, s.limit.tokenDecimals) : null;
                        const pct = limitVal ? Math.min(100, (spent / limitVal) * 100) : null;
                        const overBudget = pct !== null && pct >= 100;
                        return (
                          <div key={s.categoryId} className="exo-list-item" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ width: 10, height: 10, borderRadius: "50%", background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                                <span className="exo-list-item-title">{s.categoryName}</span>
                              </span>
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: overBudget ? "var(--exo-error, #ef4444)" : "inherit" }}>
                                {spent.toFixed(2)} USDC
                              </span>
                            </div>
                            {pct !== null && (
                              <>
                                <div className="exo-progress" style={{ height: 6 }}>
                                  <div className="exo-progress-fill" style={{ width: `${Math.min(pct, 100)}%`, background: overBudget ? "var(--exo-error, #ef4444)" : undefined }} />
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>{pct.toFixed(0)}% of limit</span>
                                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>{limitVal!.toFixed(2)} USDC</span>
                                </div>
                              </>
                            )}
                            {pct === null && (
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                                No limit set · {s.txCount} transaction{s.txCount !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {dailySpending.length > 0 && (() => {
                    const categoryNames = [...new Set(dailySpending.map((d) => d.categoryName))];
                    const dateMap = new Map<string, Record<string, number>>();
                    for (const row of dailySpending) {
                      if (!dateMap.has(row.date)) dateMap.set(row.date, { date: 0 } as unknown as Record<string, number>);
                      const entry = dateMap.get(row.date)!;
                      entry[row.categoryName] = Number(row.totalAmount) / 1e6;
                    }
                    const barData = [...dateMap.entries()].map(([date, vals]) => ({
                      date: new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                      ...vals,
                    }));

                    return (
                      <div className="exo-form-card" style={{ padding: 16 }}>
                        <div className="exo-form-card-title">Daily Spending (30 days)</div>
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={barData}>
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip formatter={(v) => `${Number(v).toFixed(2)} USDC`} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            {categoryNames.map((name, i) => (
                              <Bar key={name} dataKey={name} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
