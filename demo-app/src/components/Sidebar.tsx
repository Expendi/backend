import { NavLink, useNavigate } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useAuth } from "../context/AuthContext";

const NAV_SECTIONS = [
  {
    label: "Account",
    links: [
      { to: "/onboarding", icon: "\u2192", label: "Onboarding" },
      { to: "/wallets", icon: "\u25CB", label: "Wallets" },
      { to: "/security", icon: "\u26A1", label: "Security" },
    ],
  },
  {
    label: "Finance",
    links: [
      { to: "/transactions", icon: "\u2194", label: "Transactions" },
      { to: "/categories", icon: "\u25A0", label: "Categories" },
      { to: "/recurring", icon: "\u27F3", label: "Recurring" },
      { to: "/transfer", icon: "\u2197", label: "Transfer" },
    ],
  },
  {
    label: "DeFi",
    links: [
      { to: "/yield", icon: "\u2191", label: "Yield" },
      { to: "/uniswap", icon: "\u21C4", label: "Uniswap" },
      { to: "/swap-automations", icon: "\u2699", label: "Swap Auto" },
    ],
  },
  {
    label: "Fiat",
    links: [
      { to: "/pretium", icon: "\u20B5", label: "Pretium" },
    ],
  },
  {
    label: "Social",
    links: [
      { to: "/groups", icon: "\u229A", label: "Groups" },
      { to: "/split-expenses", icon: "\u00F7", label: "Split" },
      { to: "/goal-savings", icon: "\u2605", label: "Goals" },
    ],
  },
  {
    label: "AI",
    links: [
      { to: "/chat", icon: "\u25C6", label: "AI Chat" },
    ],
  },
];

export function Sidebar() {
  const { logout, user } = usePrivy();
  const { theme, toggleTheme } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          exo<span className="dot">.</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>
            demo
          </span>
        </div>
        <button className="theme-toggle-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === "dark" ? "\u2600" : "\u263E"}
        </button>
      </div>

      <div className="sidebar-nav">
        {NAV_SECTIONS.map((section) => (
          <div className="nav-section" key={section.label}>
            <div className="nav-section-label">{section.label}</div>
            {section.links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
              >
                <span className="nav-icon">{link.icon}</span>
                {link.label}
              </NavLink>
            ))}
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        {user && (
          <div className="sidebar-user">
            <span className="user-dot" />
            <span className="user-id">{user.id}</span>
          </div>
        )}
        <button className="btn-exo btn-secondary btn-sm" onClick={handleLogout} style={{ width: "100%" }}>
          Logout
        </button>
      </div>
    </nav>
  );
}
