import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";
import { SecuritySettings } from "../components/SecuritySettings";
import "../styles/wallet-home.css";

const COUNTRY_OPTIONS = [
  { code: "KE", name: "Kenya", currency: "KES", networks: ["Safaricom", "Airtel"] },
  { code: "NG", name: "Nigeria", currency: "NGN", networks: ["MTN", "Airtel", "Glo", "9mobile"] },
  { code: "GH", name: "Ghana", currency: "GHS", networks: ["MTN", "Vodafone", "AirtelTigo"] },
  { code: "TZ", name: "Tanzania", currency: "TZS", networks: ["Vodacom", "Airtel", "Tigo"] },
  { code: "UG", name: "Uganda", currency: "UGX", networks: ["MTN", "Airtel"] },
];

export function SettingsPage() {
  const { logout, user } = usePrivy();
  const { profile, theme, toggleTheme } = useAuth();
  const { preferences, updatePreferences } = usePreferences();
  const [saving, setSaving] = useState(false);

  const displayName = profile?.username ?? "User";
  const userId = user?.id ?? "";

  const selectedCountry = COUNTRY_OPTIONS.find((c) => c.code === preferences.country);

  const handleCountryChange = async (code: string) => {
    const country = COUNTRY_OPTIONS.find((c) => c.code === code);
    if (!country) return;
    setSaving(true);
    try {
      await updatePreferences({
        country: country.code,
        currency: country.currency,
        mobileNetwork: country.networks[0],
      });
    } finally {
      setSaving(false);
    }
  };

  const handleNetworkChange = async (network: string) => {
    setSaving(true);
    try {
      await updatePreferences({ mobileNetwork: network });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wallet-home">
      <div className="wh-section" style={{ paddingTop: 24 }}>
        {/* Profile Card */}
        <div className="wh-wallet-card" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "var(--accent)",
            color: "var(--accent-text)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-display)",
            fontWeight: 900,
            fontSize: 20,
            flexShrink: 0,
          }}>
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{displayName}</div>
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>{userId}</div>
          </div>
        </div>

        {/* Preferences */}
        <div className="wh-section-header" style={{ marginTop: 24 }}>
          <span className="wh-section-title">Preferences</span>
        </div>

        <button className="settings-item" onClick={toggleTheme}>
          <span className="settings-item-icon">
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </span>
          <span className="settings-item-label">{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
        </button>

        {/* Region & Payment */}
        <div className="wh-section-header" style={{ marginTop: 24 }}>
          <span className="wh-section-title">Region & Payment</span>
        </div>

        <div className="settings-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, cursor: "default" }}>
          <label style={{ fontSize: 13, color: "var(--text-muted)" }}>Country</label>
          <select
            value={preferences.country ?? ""}
            onChange={(e) => handleCountryChange(e.target.value)}
            disabled={saving}
            style={{
              background: "var(--surface-2)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 14,
              fontFamily: "var(--font-body)",
            }}
          >
            <option value="">Select country...</option>
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>{c.name} ({c.currency})</option>
            ))}
          </select>
        </div>

        {selectedCountry && (
          <div className="settings-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, cursor: "default" }}>
            <label style={{ fontSize: 13, color: "var(--text-muted)" }}>Mobile Network</label>
            <select
              value={preferences.mobileNetwork ?? ""}
              onChange={(e) => handleNetworkChange(e.target.value)}
              disabled={saving}
              style={{
                background: "var(--surface-2)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 14,
                fontFamily: "var(--font-body)",
              }}
            >
              <option value="">Select network...</option>
              {selectedCountry.networks.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}

        {/* Security */}
        <div className="wh-section-header" style={{ marginTop: 24 }}>
          <span className="wh-section-title">Security</span>
        </div>

        <SecuritySettings />

        {/* Sign Out */}
        <div style={{ marginTop: 32 }}>
          <button className="settings-item settings-danger" onClick={logout}>
            <span className="settings-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </span>
            <span className="settings-item-label">Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
