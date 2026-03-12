import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { ActionPanel } from "../components/ActionPanel";
import { ApiForm } from "../components/ApiForm";
import { JsonViewer } from "../components/JsonViewer";
import { useAuth } from "../context/AuthContext";
import type { OnboardResult, ProfileWithWallets, ResolvedUsername } from "../lib/types";

export function OnboardingPage() {
  const { request } = useApi();
  const { refreshProfile } = useAuth();
  const [username, setUsername] = useState("");
  const [resolveUser, setResolveUser] = useState("");

  return (
    <div>
      <div className="page-header">
        <h1>Onboarding</h1>
        <p>Create profile, manage username, resolve usernames</p>
      </div>

      <ActionPanel title="Create Profile" method="POST" path="/api/onboard">
        <ApiForm
          onSubmit={async () => {
            const data = await request<OnboardResult>("/onboard", {
              method: "POST",
              body: { chainId: 8453 },
            });
            await refreshProfile();
            return data;
          }}
          submitLabel="Onboard"
        >
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
            Creates 3 wallets (user, server, agent) and a user profile. Idempotent -- safe to call multiple times.
          </p>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Get Profile" method="GET" path="/api/profile">
        <ApiForm
          onSubmit={() => request<ProfileWithWallets>("/profile")}
          submitLabel="Fetch Profile"
        >
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Retrieves current user profile with wallet details.
          </p>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Get Wallet Addresses" method="GET" path="/api/profile/wallets">
        <ApiForm
          onSubmit={() => request<Record<string, string>>("/profile/wallets")}
          submitLabel="Fetch Addresses"
        >
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Returns just the wallet addresses (user, server, agent).
          </p>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Set Username" method="PUT" path="/api/profile/username">
        <ApiForm
          onSubmit={async () => {
            const data = await request<ProfileWithWallets>("/profile/username", {
              method: "PUT",
              body: { username },
            });
            await refreshProfile();
            return data;
          }}
          submitLabel="Set Username"
        >
          <div className="form-group">
            <label>Username (3-20 chars, lowercase alphanumeric + underscore)</label>
            <input
              className="input-exo"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="my_username"
              pattern="^[a-z0-9_]{3,20}$"
            />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Resolve Username" method="GET" path="/api/profile/resolve/:username">
        <ApiForm
          onSubmit={() => request<ResolvedUsername>(`/profile/resolve/${resolveUser}`)}
          submitLabel="Resolve"
        >
          <div className="form-group">
            <label>Username to resolve</label>
            <input
              className="input-exo"
              value={resolveUser}
              onChange={(e) => setResolveUser(e.target.value)}
              placeholder="some_user"
            />
          </div>
        </ApiForm>
      </ActionPanel>
    </div>
  );
}
