import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate, Outlet } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useAuth } from "../context/AuthContext";
import { useDashboard } from "../context/DashboardContext";
import { useAppMode } from "../context/AppModeContext";
import { SecuritySettings } from "./SecuritySettings";
import { PageTransition } from "./PageTransition";
import { BottomSheet } from "./BottomSheet";
import "../styles/app-shell.css";

/* ─── Tab Types ─────────────────────────────────────────────────── */

type SimpleTab = "home" | "expenses" | "explore" | "settings";
type AgentTab = "chat" | "portfolio" | "activity" | "settings";

/* ─── Explore Sheet ──────────────────────────────────────────────── */

const EXPLORE_LINKS = [
  {
    label: "Fund & Withdraw",
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
    label: "Split",
    hint: "Split expenses",
    path: "/split-expenses",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M11 18H8a2 2 0 0 1-2-2V9" />
      </svg>
    ),
    color: "var(--exo-peach)",
  },
  {
    label: "Activity",
    hint: "Transaction history",
    path: "/activity",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    color: "var(--exo-sky)",
  },
];

/* ─── Mode Toggle ───────────────────────────────────────────────── */

function ModeToggle() {
  const { mode, setMode } = useAppMode();

  return (
    <div className="mode-toggle" role="radiogroup" aria-label="App mode">
      <button
        className={`mode-toggle-option ${mode === "simple" ? "active" : ""}`}
        onClick={() => setMode("simple")}
        role="radio"
        aria-checked={mode === "simple"}
      >
        Simple
      </button>
      <button
        className={`mode-toggle-option ${mode === "agent" ? "active" : ""}`}
        onClick={() => setMode("agent")}
        role="radio"
        aria-checked={mode === "agent"}
      >
        Agent
      </button>
      <div
        className="mode-toggle-indicator"
        style={{ transform: mode === "agent" ? "translateX(100%)" : "translateX(0)" }}
      />
    </div>
  );
}

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

/* ─── SVG Icons ──────────────────────────────────────────────────── */

const HomeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

const ActivityIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const ExploreIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

const ChatIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const ExpensesIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" />
  </svg>
);

const PortfolioIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
  </svg>
);

/* ─── AppShell ────────────────────────────────────────────────────── */

export function AppShell() {
  const { theme, toggleTheme } = useAuth();
  const { loading: dashLoading, refresh } = useDashboard();
  const { mode } = useAppMode();
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

  // Navigate to the right default route when mode changes
  useEffect(() => {
    if (mode === "agent") {
      // In agent mode, default to chat
      if (location.pathname === "/") {
        navigate("/agent");
      }
    } else {
      // In simple mode, redirect away from agent page
      if (location.pathname === "/agent") {
        navigate("/");
      }
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Simple Mode tab logic ──────────────────────────────────────── */

  const getSimpleTab = (path: string): SimpleTab => {
    if (path.startsWith("/categories")) return "expenses";
    if (path.startsWith("/settings")) return "settings";
    if (["/buy", "/swap", "/earn", "/goals", "/recurring", "/receive", "/transfer", "/activity", "/groups", "/split-expenses", "/swap-automations", "/security", "/wallets", "/transactions"].some((p) => path.startsWith(p)))
      return "explore";
    return "home";
  };

  /* ── Agent Mode tab logic ───────────────────────────────────────── */

  const getAgentTab = (path: string): AgentTab => {
    if (path.startsWith("/activity")) return "activity";
    if (path.startsWith("/settings")) return "settings";
    if (path === "/") return "portfolio";
    return "chat";
  };

  const simpleTab = getSimpleTab(location.pathname);
  const agentTab = getAgentTab(location.pathname);

  /* ── Directional tab tracking ─────────────────────────────────── */

  const SIMPLE_TAB_ORDER: SimpleTab[] = ["home", "expenses", "explore", "settings"];
  const AGENT_TAB_ORDER: AgentTab[] = ["chat", "portfolio", "activity", "settings"];

  const prevSimpleIdxRef = useRef(SIMPLE_TAB_ORDER.indexOf(simpleTab));
  const prevAgentIdxRef = useRef(AGENT_TAB_ORDER.indexOf(agentTab));
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(null);

  useEffect(() => {
    if (mode === "simple") {
      const newIdx = SIMPLE_TAB_ORDER.indexOf(simpleTab);
      const prevIdx = prevSimpleIdxRef.current;
      if (newIdx !== prevIdx) {
        setSlideDirection(newIdx > prevIdx ? "right" : "left");
        prevSimpleIdxRef.current = newIdx;
      }
    } else {
      const newIdx = AGENT_TAB_ORDER.indexOf(agentTab);
      const prevIdx = prevAgentIdxRef.current;
      if (newIdx !== prevIdx) {
        setSlideDirection(newIdx > prevIdx ? "right" : "left");
        prevAgentIdxRef.current = newIdx;
      }
    }
  }, [simpleTab, agentTab, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateSimpleTab = useCallback(
    (tab: SimpleTab) => {
      if (tab === "explore") {
        setExploreOpen((prev) => !prev);
        return;
      }
      setExploreOpen(false);
      switch (tab) {
        case "home": navigate("/"); break;
        case "expenses": navigate("/categories"); break;
        case "settings": navigate("/settings"); break;
      }
    },
    [navigate]
  );

  const navigateAgentTab = useCallback(
    (tab: AgentTab) => {
      setExploreOpen(false);
      switch (tab) {
        case "chat": navigate("/agent"); break;
        case "portfolio": navigate("/"); break;
        case "activity": navigate("/activity"); break;
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
    <div className={`app-shell ${mode === "agent" ? "agent-mode" : "simple-mode"}`}>
      <header className="shell-header">
        <div className="shell-header-left">
          <button className="shell-logo-btn" onClick={() => navigate(mode === "agent" ? "/agent" : "/")}>
            exo<span className="dot">.</span>
          </button>
        </div>
        <div className="shell-header-center">
          <ModeToggle />
        </div>
        <div className="shell-header-right">
          {!isMobile && (
            <div className="quick-actions">
              <button
                className="quick-action-btn"
                onClick={refresh}
                title="Refresh"
              >
                {dashLoading ? (
                  <span className="balance-loading" style={{ width: 14, height: 14, borderRadius: "50%" }} />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                )}
              </button>
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
        <PageTransition>
          <Outlet />
        </PageTransition>
      </div>

      {/* Explore Tray (Simple mode only) */}
      <BottomSheet open={exploreOpen && mode === "simple"} onClose={() => setExploreOpen(false)} title="Explore">
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
      </BottomSheet>

      {/* Bottom Tab Bars — different for each mode */}
      {isMobile && mode === "simple" && (
        <nav className="bottom-tabs" aria-label="Main navigation">
          <button className={`bottom-tab ${simpleTab === "home" ? "active" : ""}`} onClick={() => navigateSimpleTab("home")} aria-label="Home">
            <span className="bottom-tab-icon"><HomeIcon /></span>
            <span className="bottom-tab-label">Home</span>
          </button>
          <button className={`bottom-tab ${simpleTab === "expenses" ? "active" : ""}`} onClick={() => navigateSimpleTab("expenses")} aria-label="Expenses">
            <span className="bottom-tab-icon"><ExpensesIcon /></span>
            <span className="bottom-tab-label">Expenses</span>
          </button>
          <button className={`bottom-tab ${simpleTab === "explore" || exploreOpen ? "active" : ""}`} onClick={() => navigateSimpleTab("explore")} aria-label="Explore">
            <span className="bottom-tab-icon"><ExploreIcon /></span>
            <span className="bottom-tab-label">Explore</span>
          </button>
          <button className={`bottom-tab ${simpleTab === "settings" ? "active" : ""}`} onClick={() => navigateSimpleTab("settings")} aria-label="Settings">
            <span className="bottom-tab-icon"><SettingsIcon /></span>
            <span className="bottom-tab-label">Settings</span>
          </button>
        </nav>
      )}

      {isMobile && mode === "agent" && (
        <nav className="bottom-tabs" aria-label="Main navigation">
          <button className={`bottom-tab ${agentTab === "chat" ? "active" : ""}`} onClick={() => navigateAgentTab("chat")} aria-label="Chat">
            <span className="bottom-tab-icon"><ChatIcon /></span>
            <span className="bottom-tab-label">Chat</span>
          </button>
          <button className={`bottom-tab ${agentTab === "portfolio" ? "active" : ""}`} onClick={() => navigateAgentTab("portfolio")} aria-label="Portfolio">
            <span className="bottom-tab-icon"><PortfolioIcon /></span>
            <span className="bottom-tab-label">Portfolio</span>
          </button>
          <button className={`bottom-tab ${agentTab === "activity" ? "active" : ""}`} onClick={() => navigateAgentTab("activity")} aria-label="Activity">
            <span className="bottom-tab-icon"><ActivityIcon /></span>
            <span className="bottom-tab-label">Activity</span>
          </button>
          <button className={`bottom-tab ${agentTab === "settings" ? "active" : ""}`} onClick={() => navigateAgentTab("settings")} aria-label="Settings">
            <span className="bottom-tab-icon"><SettingsIcon /></span>
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
