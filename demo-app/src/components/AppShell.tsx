import { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate, Outlet } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useAuth } from "../context/AuthContext";
import { useDashboard } from "../context/DashboardContext";
import { SecuritySettings } from "./SecuritySettings";
import "../styles/app-shell.css";

/* ─── Tab Type ───────────────────────────────────────────────────── */

type BottomTab = "home" | "activity" | "agent" | "explore" | "settings";

/* ─── Explore Sheet ──────────────────────────────────────────────── */

const EXPLORE_LINKS = [
  {
    label: "Buy & Sell",
    hint: "Add or cash out",
    path: "/buy",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
      </svg>
    ),
    color: "var(--exo-lime)",
  },
  {
    label: "Swap",
    hint: "Trade tokens",
    path: "/swap",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    ),
    color: "var(--exo-sky)",
  },
  {
    label: "Earn",
    hint: "Grow your money",
    path: "/earn",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
      </svg>
    ),
    color: "var(--exo-violet)",
  },
  {
    label: "Goals",
    hint: "Save smarter",
    path: "/goals",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
      </svg>
    ),
    color: "var(--exo-lime)",
  },
  {
    label: "Autopay",
    hint: "Set it & forget it",
    path: "/recurring",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    color: "var(--exo-peach)",
  },
  {
    label: "Transfer",
    hint: "Move between wallets",
    path: "/transfer",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
      </svg>
    ),
    color: "var(--exo-sky)",
  },
  {
    label: "Categories",
    hint: "Spending & limits",
    path: "/categories",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      </svg>
    ),
    color: "var(--exo-peach)",
  },
  {
    label: "Receive",
    hint: "Your address",
    path: "/receive",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="17" y1="7" x2="7" y2="17" /><polyline points="17 17 7 17 7 7" />
      </svg>
    ),
    color: "var(--text-secondary)",
  },
];

/* ─── User Menu Component ────────────────────────────────────────── */

function UserMenu({ theme, onToggleTheme }: { theme: "dark" | "light"; onToggleTheme: () => void }) {
  const { logout, user } = usePrivy();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);

  const displayName = profile?.username ?? "User";
  const displayInitial = displayName.charAt(0).toUpperCase();
  const userId = user?.id ?? "";

  return (
    <div className="user-menu-wrapper">
      <button
        className="user-menu-trigger"
        onClick={() => setOpen((prev) => !prev)}
        title="Account menu"
        aria-label="Open account menu"
      >
        {displayInitial}
      </button>

      {open && (
        <>
          <div className="user-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="user-menu-dropdown" role="menu">
            <div className="user-menu-dropdown-header">
              <div className="user-name">{displayName}</div>
              <div className="user-id-display">{userId}</div>
            </div>
            <button
              className="user-menu-item"
              onClick={() => { onToggleTheme(); setOpen(false); }}
              role="menuitem"
            >
              <span className="menu-icon">
                {theme === "dark" ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                )}
              </span>
              {theme === "dark" ? "Light Mode" : "Dark Mode"}
            </button>
            <button
              className="user-menu-item"
              onClick={() => { setOpen(false); navigate("/settings"); }}
              role="menuitem"
            >
              <span className="menu-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </span>
              Settings
            </button>
            <button
              className="user-menu-item"
              onClick={() => { setOpen(false); setSecurityOpen(true); }}
              role="menuitem"
            >
              <span className="menu-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </span>
              Security
            </button>
            <button className="user-menu-item danger" onClick={() => { setOpen(false); logout(); }} role="menuitem">
              <span className="menu-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </span>
              Sign Out
            </button>
          </div>
        </>
      )}

      {securityOpen && (
        <div className="security-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setSecurityOpen(false); }}>
          <div className="security-modal">
            <div className="security-modal-header">
              <span className="security-modal-title">Security</span>
              <button className="security-modal-close" onClick={() => setSecurityOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <SecuritySettings onClose={() => setSecurityOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── AppShell ────────────────────────────────────────────────────── */

export function AppShell() {
  const { theme, toggleTheme } = useAuth();
  const { loading: dashLoading, refresh } = useDashboard();
  const location = useLocation();
  const navigate = useNavigate();
  const [exploreOpen, setExploreOpen] = useState(false);

  const [viewportWidth, setViewportWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const isMobile = viewportWidth < 768;

  const getTabFromPath = (path: string): BottomTab => {
    if (path.startsWith("/agent")) return "agent";
    if (path.startsWith("/activity")) return "activity";
    if (path.startsWith("/settings")) return "settings";
    if (["/buy", "/swap", "/earn", "/goals", "/recurring", "/receive", "/transfer", "/categories"].some((p) => path.startsWith(p)))
      return "explore";
    return "home";
  };

  const activeTab = getTabFromPath(location.pathname);

  const navigateTab = useCallback(
    (tab: BottomTab) => {
      if (tab === "explore") {
        setExploreOpen((prev) => !prev);
        return;
      }
      setExploreOpen(false);
      switch (tab) {
        case "home": navigate("/"); break;
        case "activity": navigate("/activity"); break;
        case "agent": navigate("/agent"); break;
        case "settings": navigate("/settings"); break;
      }
    },
    [navigate]
  );

  // Close explore sheet on navigation
  useEffect(() => {
    setExploreOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <header className="shell-header">
        <div className="shell-header-left">
          <button className="shell-logo-btn" onClick={() => navigate("/")}>
            exo<span className="dot">.</span>
          </button>
        </div>
        <div className="shell-header-center">
          <button className="balance-pill" onClick={refresh} title="Refresh">
            <span className="balance-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            {dashLoading ? <span className="balance-loading" /> : <span>exo</span>}
          </button>
        </div>
        <div className="shell-header-right">
          {!isMobile && (
            <div className="quick-actions">
              <button className="quick-action-btn" onClick={toggleTheme} title={theme === "dark" ? "Light mode" : "Dark mode"}>
                {theme === "dark" ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                )}
              </button>
            </div>
          )}
          <UserMenu theme={theme} onToggleTheme={toggleTheme} />
        </div>
      </header>

      <div className="shell-main">
        <Outlet />
      </div>

      {/* Explore Bottom Sheet */}
      {exploreOpen && (
        <>
          <div className="explore-backdrop" onClick={() => setExploreOpen(false)} />
          <div className="explore-sheet">
            <div className="explore-sheet-handle" />
            <div className="explore-sheet-grid">
              {EXPLORE_LINKS.map((link) => (
                <button
                  key={link.path}
                  className="explore-sheet-item"
                  onClick={() => navigate(link.path)}
                >
                  <span className="explore-sheet-icon" style={{ color: link.color }}>
                    {link.icon}
                  </span>
                  <span className="explore-sheet-label">{link.label}</span>
                  <span className="explore-sheet-hint">{link.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {isMobile && (
        <nav className="bottom-tabs" aria-label="Main navigation">
          <button className={`bottom-tab ${activeTab === "home" ? "active" : ""}`} onClick={() => navigateTab("home")} aria-label="Home">
            <span className="bottom-tab-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </span>
            <span className="bottom-tab-label">Home</span>
          </button>
          <button className={`bottom-tab ${activeTab === "activity" ? "active" : ""}`} onClick={() => navigateTab("activity")} aria-label="Activity">
            <span className="bottom-tab-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </span>
            <span className="bottom-tab-label">Activity</span>
          </button>
          <button className={`bottom-tab ${activeTab === "explore" || exploreOpen ? "active" : ""}`} onClick={() => navigateTab("explore")} aria-label="Explore">
            <span className="bottom-tab-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
              </svg>
            </span>
            <span className="bottom-tab-label">Explore</span>
          </button>
          <button className={`bottom-tab ${activeTab === "agent" ? "active" : ""}`} onClick={() => navigateTab("agent")} aria-label="Agent">
            <span className="bottom-tab-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <span className="bottom-tab-label">exo AI</span>
          </button>
          <button className={`bottom-tab ${activeTab === "settings" ? "active" : ""}`} onClick={() => navigateTab("settings")} aria-label="Settings">
            <span className="bottom-tab-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </span>
            <span className="bottom-tab-label">Settings</span>
          </button>
        </nav>
      )}
    </div>
  );
}

// Re-export for backward compatibility
export { useDashboard } from "../context/DashboardContext";
export { useChatActions } from "../context/ChatActionsContext";
