import { useState, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { ActionPanel } from "../components/ActionPanel";
import { ApiForm } from "../components/ApiForm";
import { JsonViewer } from "../components/JsonViewer";
import { Spinner } from "../components/Spinner";
import type { GroupAccount } from "../lib/types";

export function GroupsPage() {
  const { request } = useApi();
  const [groups, setGroups] = useState<GroupAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<GroupAccount | null>(null);

  // Create
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createMembers, setCreateMembers] = useState("");

  // Actions
  const [groupId, setGroupId] = useState("");
  const [addMember, setAddMember] = useState("");
  const [removeMember, setRemoveMember] = useState("");

  // Pay
  const [payTo, setPayTo] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payToken, setPayToken] = useState("");

  // Deposit
  const [depositAmount, setDepositAmount] = useState("");
  const [depositToken, setDepositToken] = useState("");

  // Transfer admin
  const [newAdmin, setNewAdmin] = useState("");

  // Balance
  const [balanceTokens, setBalanceTokens] = useState("");

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const data = await request<GroupAccount[]>("/groups");
      setGroups(data);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Group Accounts</h1>
        <p>Shared wallets with admin/member roles, on-chain smart contracts</p>
      </div>

      <ActionPanel title="List Groups" method="GET" path="/api/groups">
        <button className="btn-exo btn-primary btn-sm" onClick={fetchGroups} disabled={loading}>
          {loading ? <Spinner /> : "Refresh"}
        </button>
        {groups.length > 0 && (
          <div className="data-list" style={{ marginTop: 12 }}>
            {groups.map((g) => (
              <div key={g.id} className="data-list-item" onClick={() => { setSelected(g); setGroupId(g.id); }}>
                <div><strong>{g.name}</strong></div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>{g.id.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        )}
        {selected && <JsonViewer data={selected} label="Selected Group" />}
      </ActionPanel>

      <ActionPanel title="Create Group" method="POST" path="/api/groups">
        <ApiForm
          onSubmit={async () => {
            const members = createMembers.split(",").map((s) => s.trim()).filter(Boolean);
            const data = await request("/groups", {
              method: "POST",
              body: {
                name: createName,
                description: createDesc || undefined,
                members,
              },
            });
            fetchGroups();
            return data;
          }}
          submitLabel="Create Group"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input className="input-exo" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Savings Group" />
            </div>
            <div className="form-group">
              <label>Description (optional)</label>
              <input className="input-exo" value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Members (comma-separated usernames or 0x addresses)</label>
            <input className="input-exo" value={createMembers} onChange={(e) => setCreateMembers(e.target.value)} placeholder="alice, 0x123..." />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Get Group Details" method="GET" path="/api/groups/:id">
        <ApiForm onSubmit={() => request(`/groups/${groupId}`)} submitLabel="Get Group">
          <div className="form-group">
            <label>Group ID</label>
            <input className="input-exo" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Get Members" method="GET" path="/api/groups/:id/members">
        <ApiForm onSubmit={() => request(`/groups/${groupId}/members`)} submitLabel="Get Members">
          <div className="form-group">
            <label>Group ID</label>
            <input className="input-exo" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="uuid" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Add Member" method="POST" path="/api/groups/:id/members">
        <ApiForm
          onSubmit={async () => {
            const data = await request(`/groups/${groupId}/members`, {
              method: "POST",
              body: { member: addMember },
            });
            return data;
          }}
          submitLabel="Add Member"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Group ID</label>
              <input className="input-exo" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="form-group">
              <label>Member (username or 0x address)</label>
              <input className="input-exo" value={addMember} onChange={(e) => setAddMember(e.target.value)} placeholder="alice" />
            </div>
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Remove Member" method="DELETE" path="/api/groups/:id/members/:identifier">
        <ApiForm
          onSubmit={() => request(`/groups/${groupId}/members/${removeMember}`, { method: "DELETE" })}
          submitLabel="Remove Member"
          submitVariant="danger"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Group ID</label>
              <input className="input-exo" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="form-group">
              <label>Member Identifier</label>
              <input className="input-exo" value={removeMember} onChange={(e) => setRemoveMember(e.target.value)} />
            </div>
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Pay from Group" method="POST" path="/api/groups/:id/pay">
        <ApiForm
          onSubmit={() =>
            request(`/groups/${groupId}/pay`, {
              method: "POST",
              body: { to: payTo, amount: payAmount, token: payToken || undefined },
            })
          }
          submitLabel="Pay"
        >
          <div className="form-group">
            <label>Group ID</label>
            <input className="input-exo" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="uuid" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>To Address</label>
              <input className="input-exo" value={payTo} onChange={(e) => setPayTo(e.target.value)} placeholder="0x..." />
            </div>
            <div className="form-group">
              <label>Amount</label>
              <input className="input-exo" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="1000000" />
            </div>
          </div>
          <div className="form-group">
            <label>Token (optional)</label>
            <input className="input-exo" value={payToken} onChange={(e) => setPayToken(e.target.value)} placeholder="usdc" />
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Deposit to Group" method="POST" path="/api/groups/:id/deposit">
        <ApiForm
          onSubmit={() =>
            request(`/groups/${groupId}/deposit`, {
              method: "POST",
              body: { amount: depositAmount, token: depositToken || undefined },
            })
          }
          submitLabel="Deposit"
        >
          <div className="form-group">
            <label>Group ID</label>
            <input className="input-exo" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="uuid" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Amount</label>
              <input className="input-exo" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="1000000" />
            </div>
            <div className="form-group">
              <label>Token (optional)</label>
              <input className="input-exo" value={depositToken} onChange={(e) => setDepositToken(e.target.value)} placeholder="usdc" />
            </div>
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Transfer Admin" method="POST" path="/api/groups/:id/transfer-admin">
        <ApiForm
          onSubmit={() =>
            request(`/groups/${groupId}/transfer-admin`, {
              method: "POST",
              body: { newAdmin },
            })
          }
          submitLabel="Transfer"
          submitVariant="danger"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Group ID</label>
              <input className="input-exo" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="form-group">
              <label>New Admin (username or address)</label>
              <input className="input-exo" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} />
            </div>
          </div>
        </ApiForm>
      </ActionPanel>

      <ActionPanel title="Group Balance" method="GET" path="/api/groups/:id/balance">
        <ApiForm
          onSubmit={() =>
            request(`/groups/${groupId}/balance`, {
              query: balanceTokens ? { tokens: balanceTokens } : undefined,
            })
          }
          submitLabel="Get Balance"
        >
          <div className="form-row">
            <div className="form-group">
              <label>Group ID</label>
              <input className="input-exo" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="form-group">
              <label>Token Addresses (comma-separated, optional)</label>
              <input className="input-exo" value={balanceTokens} onChange={(e) => setBalanceTokens(e.target.value)} placeholder="0x...,0x..." />
            </div>
          </div>
        </ApiForm>
      </ActionPanel>
    </div>
  );
}
