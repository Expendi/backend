import { useState, useEffect, useCallback } from "react";
import { useApi } from "../hooks/useApi";
import { Spinner } from "../components/Spinner";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { Category, CategoryLimit } from "../lib/types";
import "../styles/pages.css";

type Tab = "categories" | "spending";

interface SpendingRow {
  categoryId: string;
  categoryName: string;
  txCount: number;
  totalSpent: string;
  limit: { monthlyLimit: string; tokenSymbol: string; tokenDecimals: number } | null;
}

interface DailySpendingRow {
  date: string;
  categoryId: string;
  categoryName: string;
  totalAmount: string;
  txCount: number;
}

const CHART_COLORS = [
  "#8b5cf6", "#6366f1", "#3b82f6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#a855f7", "#14b8a6",
];

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_SYMBOL = "USDC";
const USDC_DECIMALS = 6;

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
  const { request } = useApi();

  const [tab, setTab] = useState<Tab>("categories");
  const [categories, setCategories] = useState<Category[]>([]);
  const [limits, setLimits] = useState<CategoryLimit[]>([]);
  const [loading, setLoading] = useState(false);

  // Category create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createLimit, setCreateLimit] = useState("");
  const [createWallet, setCreateWallet] = useState<"user" | "server" | "agent">("user");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");

  // Category detail modal
  const [selected, setSelected] = useState<Category | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLimit, setEditLimit] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");


  // Spending analytics
  const [spending, setSpending] = useState<SpendingRow[]>([]);
  const [dailySpending, setDailySpending] = useState<DailySpendingRow[]>([]);
  const [spendingLoading, setSpendingLoading] = useState(false);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await request<(Omit<Category, "isGlobal"> & { userId: string | null })[]>("/categories");
      setCategories(raw.map(c => ({ ...c, isGlobal: c.userId === null })));
    } catch { /* handled by useApi */ }
    setLoading(false);
  }, [request]);

  const fetchLimits = useCallback(async () => {
    try {
      const data = await request<CategoryLimit[]>("/categories/limits");
      setLimits(data);
    } catch { /* handled by useApi */ }
  }, [request]);

  const fetchSpending = useCallback(async () => {
    setSpendingLoading(true);
    try {
      const [spendingData, dailyData] = await Promise.all([
        request<SpendingRow[]>("/categories/spending"),
        request<DailySpendingRow[]>("/categories/spending/daily", { query: { days: "30" } }),
      ]);
      setSpending(spendingData);
      setDailySpending(dailyData);
    } catch { /* handled by useApi */ }
    setSpendingLoading(false);
  }, [request]);

  useEffect(() => {
    fetchCategories();
    fetchLimits();
    fetchSpending();
  }, [fetchCategories, fetchLimits, fetchSpending]);

  const handleCreateCategory = async () => {
    if (!createName.trim()) return;
    setCreateLoading(true);
    setCreateError("");
    try {
      const body: Record<string, string> = { name: createName.trim() };
      if (createDesc.trim()) body.description = createDesc.trim();
      const created = await request<{ id: string }>("/categories", { method: "POST", body });

      // If a monthly limit was specified, create it for this category
      if (createLimit.trim() && parseFloat(createLimit) > 0) {
        const rawLimit = Math.round(parseFloat(createLimit) * Math.pow(10, USDC_DECIMALS)).toString();
        await request(`/categories/${created.id}/limit`, {
          method: "PUT",
          body: {
            monthlyLimit: rawLimit,
            tokenAddress: USDC_ADDRESS,
            tokenSymbol: USDC_SYMBOL,
            tokenDecimals: USDC_DECIMALS,
          },
        });
      }

      setCreateName("");
      setCreateDesc("");
      setCreateLimit("");
      setCreateWallet("user");
      setShowCreateForm(false);
      fetchCategories();
      fetchLimits();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create category");
    }
    setCreateLoading(false);
  };

  const handleUpdateCategory = async () => {
    if (!selected) return;
    setEditLoading(true);
    setEditError("");
    try {
      const body: Record<string, string> = {};
      if (editName.trim() && editName.trim() !== selected.name) body.name = editName.trim();
      if (editDesc.trim() !== (selected.description ?? "")) body.description = editDesc.trim();
      if (Object.keys(body).length > 0) {
        await request(`/categories/${selected.id}`, { method: "PUT", body });
      }

      // Update limit if changed
      const existingLimit = limits.find(l => l.categoryId === selected.id);
      const existingLimitHuman = existingLimit
        ? (Number(existingLimit.monthlyLimit) / Math.pow(10, existingLimit.tokenDecimals)).toString()
        : "";
      if (editLimit.trim() !== existingLimitHuman) {
        if (editLimit.trim() && parseFloat(editLimit) > 0) {
          const rawLimit = Math.round(parseFloat(editLimit) * Math.pow(10, USDC_DECIMALS)).toString();
          await request(`/categories/${selected.id}/limit`, {
            method: "PUT",
            body: {
              monthlyLimit: rawLimit,
              tokenAddress: USDC_ADDRESS,
              tokenSymbol: USDC_SYMBOL,
              tokenDecimals: USDC_DECIMALS,
            },
          });
        } else if (!editLimit.trim() && existingLimit) {
          await request(`/categories/${selected.id}/limit`, {
            method: "DELETE",
            query: { tokenAddress: USDC_ADDRESS },
          });
        }
      }

      setEditMode(false);
      fetchCategories();
      fetchLimits();
      const updated: Category = {
        ...selected,
        name: editName.trim() || selected.name,
        description: editDesc.trim() || selected.description,
      };
      setSelected(updated);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update category");
    }
    setEditLoading(false);
  };

  const handleDeleteCategory = async () => {
    if (!selected) return;
    setDeleteLoading(true);
    setDeleteError("");
    try {
      await request(`/categories/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      fetchCategories();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete category");
    }
    setDeleteLoading(false);
  };


  const openCategoryModal = (cat: Category) => {
    setSelected(cat);
    setEditMode(false);
    setEditName(cat.name);
    setEditDesc(cat.description ?? "");
    const catLimit = limits.find(l => l.categoryId === cat.id);
    setEditLimit(catLimit ? (Number(catLimit.monthlyLimit) / Math.pow(10, catLimit.tokenDecimals)).toString() : "");
    setEditError("");
    setDeleteError("");
  };

  const closeCategoryModal = () => {
    setSelected(null);
    setEditMode(false);
    setEditError("");
    setDeleteError("");
  };

  const userCategories = categories.filter(c => !c.isGlobal);
  const globalCategories = categories.filter(c => c.isGlobal);

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
          {loading ? (
            <div className="exo-inline-spinner"><Spinner /></div>
          ) : (
            <div className="exo-animate-in">
              {categories.length === 0 && !showCreateForm ? (
                <div className="exo-empty">
                  <div className="exo-empty-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                    </svg>
                  </div>
                  <div className="exo-empty-text">No categories yet</div>
                  <div className="exo-empty-hint">Create categories to organize your transactions</div>
                  <button className="btn-exo btn-primary btn-sm" onClick={() => setShowCreateForm(true)}>Add Category</button>
                </div>
              ) : (
                <>
                  {!showCreateForm && (
                    <button
                      className="btn-exo btn-primary"
                      style={{ width: "100%", padding: "12px", marginBottom: 16 }}
                      onClick={() => { setShowCreateForm(true); setCreateError(""); }}
                    >
                      Add Category
                    </button>
                  )}

                  {showCreateForm && (
                    <div className="exo-form-card" style={{ marginBottom: 16 }}>
                      <div className="exo-form-card-title">New Category</div>
                      <div className="form-group">
                        <label>Name</label>
                        <input
                          className="input-exo"
                          value={createName}
                          onChange={e => setCreateName(e.target.value)}
                          placeholder="Food & Dining"
                        />
                      </div>
                      <div className="form-group">
                        <label>Description (optional)</label>
                        <input
                          className="input-exo"
                          value={createDesc}
                          onChange={e => setCreateDesc(e.target.value)}
                          placeholder="Meals, groceries, and restaurants"
                        />
                      </div>
                      <div className="form-group">
                        <label>Monthly Limit — USDC (optional)</label>
                        <input
                          className="input-exo"
                          value={createLimit}
                          onChange={e => setCreateLimit(e.target.value)}
                          placeholder="500.00"
                          inputMode="decimal"
                        />
                      </div>
                      <div className="form-group">
                        <label>Wallet</label>
                        <select className="input-exo" value={createWallet} onChange={e => setCreateWallet(e.target.value as typeof createWallet)}>
                          <option value="user">User Wallet</option>
                          <option value="server">Server Wallet</option>
                          <option value="agent">Agent Wallet</option>
                        </select>
                      </div>
                      {createError && (
                        <div className="msg-error" style={{ marginBottom: 8 }}>{createError}</div>
                      )}
                      <div className="exo-actions">
                        <button
                          className="btn-exo btn-secondary"
                          onClick={() => { setShowCreateForm(false); setCreateName(""); setCreateDesc(""); setCreateLimit(""); setCreateWallet("user"); setCreateError(""); }}
                          disabled={createLoading}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn-exo btn-primary"
                          disabled={!createName.trim() || createLoading}
                          onClick={handleCreateCategory}
                        >
                          {createLoading ? "Creating..." : "Create"}
                        </button>
                      </div>
                    </div>
                  )}

                  {userCategories.length > 0 && (
                    <>
                      <div className="exo-form-card-title" style={{ marginBottom: 8 }}>Your Categories</div>
                      <div className="exo-list" style={{ marginBottom: 20 }}>
                        {userCategories.map(c => {
                          const catLimit = limits.find(l => l.categoryId === c.id);
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
                        {globalCategories.map(c => (
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
            <div className="exo-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) closeCategoryModal(); }}>
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
                              const catLimit = limits.find(l => l.categoryId === selected.id);
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

                      {deleteError && (
                        <div className="msg-error" style={{ marginBottom: 12 }}>{deleteError}</div>
                      )}

                      <div className="exo-actions">
                        {!selected.isGlobal && (
                          <>
                            <button
                              className="btn-exo btn-secondary"
                              onClick={() => {
                                setEditMode(true);
                                setEditName(selected.name);
                                setEditDesc(selected.description ?? "");
                                setEditError("");
                              }}
                            >
                              Edit
                            </button>
                            <button
                              className="btn-exo btn-danger"
                              disabled={deleteLoading}
                              onClick={handleDeleteCategory}
                            >
                              {deleteLoading ? "Deleting..." : "Delete"}
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="exo-form-card" style={{ marginBottom: 16 }}>
                        <div className="exo-form-card-title">Edit Category</div>
                        <div className="form-group">
                          <label>Name</label>
                          <input
                            className="input-exo"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>Description</label>
                          <input
                            className="input-exo"
                            value={editDesc}
                            onChange={e => setEditDesc(e.target.value)}
                            placeholder="Add a description"
                          />
                        </div>
                        <div className="form-group">
                          <label>Monthly Limit — USDC</label>
                          <input
                            className="input-exo"
                            value={editLimit}
                            onChange={e => setEditLimit(e.target.value)}
                            placeholder="500.00"
                            inputMode="decimal"
                          />
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                            Leave empty to remove limit
                          </div>
                        </div>
                      </div>

                      {editError && (
                        <div className="msg-error" style={{ marginBottom: 12 }}>{editError}</div>
                      )}

                      <div className="exo-actions">
                        <button
                          className="btn-exo btn-secondary"
                          onClick={() => { setEditMode(false); setEditError(""); }}
                          disabled={editLoading}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn-exo btn-primary"
                          disabled={!editName.trim() || editLoading}
                          onClick={handleUpdateCategory}
                        >
                          {editLoading ? "Saving..." : "Save Changes"}
                        </button>
                      </div>
                    </>
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
                  {/* Pie chart: spending by category */}
                  <div className="exo-form-card" style={{ marginBottom: 16, padding: 16 }}>
                    <div className="exo-form-card-title">This Month by Category</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={spending.map(s => ({
                            name: s.categoryName,
                            value: Number(s.totalSpent) / 1e6,
                          }))}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value.toFixed(2)}`}
                          labelLine={false}
                        >
                          {spending.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => `${Number(v).toFixed(2)} USDC`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Spending vs limits */}
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
                                  <div
                                    className="exo-progress-fill"
                                    style={{
                                      width: `${Math.min(pct, 100)}%`,
                                      background: overBudget ? "var(--exo-error, #ef4444)" : undefined,
                                    }}
                                  />
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                                    {pct.toFixed(0)}% of limit
                                  </span>
                                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                                    {limitVal!.toFixed(2)} USDC
                                  </span>
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

                  {/* Daily spending bar chart */}
                  {dailySpending.length > 0 && (() => {
                    // Pivot daily data: { date, [categoryName]: amount }
                    const categoryNames = [...new Set(dailySpending.map(d => d.categoryName))];
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
