"use client";

import { useEffect, useState, useCallback } from "react";

interface EmailAccount {
  id: string;
  email_address: string;
  display_name: string | null;
  provider: string;
  is_active: boolean;
  credentials: Record<string, unknown> | null;
  last_synced_at: string | null;
}

export default function EmailHubSettingsPage() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [oauthStatus, setOauthStatus] = useState<string | null>(null);
  const [showAddInbox, setShowAddInbox] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [addingInbox, setAddingInbox] = useState(false);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/internal/email-hub/accounts");
      const data = await res.json();
      setAccounts(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();

    // Check for OAuth callback result
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    if (oauth === "success") {
      const account = params.get("account");
      setOauthStatus(
        account
          ? `Gmail connected successfully for ${account}.`
          : "Gmail connected successfully!"
      );
      // Re-fetch accounts so the Connected badge appears immediately
      loadAccounts();
      window.history.replaceState({}, "", window.location.pathname);
    } else if (oauth === "denied") {
      setOauthStatus("Gmail connection was cancelled.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (oauth === "error") {
      const reason = params.get("reason");
      const detail = params.get("detail");
      setOauthStatus(
        reason === "storage_failed"
          ? `Gmail authenticated but failed to save credentials.${detail ? ` Error: ${detail}` : ""}`
          : "Gmail connection failed. Please try again."
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [loadAccounts]);

  const connectGmail = async (accountId: string) => {
    setConnecting(accountId);
    try {
      const res = await fetch(
        `/api/internal/email-hub/gmail/oauth?account_id=${accountId}`
      );
      const data = await res.json();
      if (data.url) {
        // Add state param for the callback to know which account
        const url = new URL(data.url);
        url.searchParams.set("state", accountId);
        window.location.href = url.toString();
      }
    } catch {
      setOauthStatus("Failed to start Gmail connection.");
      setConnecting(null);
    }
  };

  const disconnectInbox = async (accountId: string) => {
    if (!confirm("Are you sure you want to disconnect this inbox? You can reconnect it later.")) return;
    setDisconnecting(accountId);
    try {
      const res = await fetch(
        `/api/internal/email-hub/accounts/${accountId}/disconnect`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to disconnect");
      setOauthStatus("Inbox disconnected successfully.");
      loadAccounts();
    } catch (e) {
      setOauthStatus(e instanceof Error ? e.message : "Failed to disconnect inbox.");
    } finally {
      setDisconnecting(null);
    }
  };

  const addInbox = async () => {
    if (!newEmail || !newEmail.includes("@")) return;
    setAddingInbox(true);
    try {
      const res = await fetch("/api/internal/email-hub/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_address: newEmail,
          display_name: newDisplayName || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add inbox");
      setOauthStatus(`Inbox ${newEmail} added. Connect Gmail to start syncing.`);
      setNewEmail("");
      setNewDisplayName("");
      setShowAddInbox(false);
      loadAccounts();
    } catch (e) {
      setOauthStatus(e instanceof Error ? e.message : "Failed to add inbox.");
    } finally {
      setAddingInbox(false);
    }
  };

  const isConnected = (account: EmailAccount) => !!account.credentials;

  return (
    <>
      <div className="page-header">
        <h2>Email Hub Settings</h2>
        <p>Configure email inboxes, notification preferences, and AI behavior.</p>
      </div>

      {oauthStatus && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            padding: "12px 16px",
            background: oauthStatus.includes("success") ? "#0a2e1a" : "#2e1a0a",
            border: `1px solid ${oauthStatus.includes("success") ? "#1a5c35" : "#5c351a"}`,
          }}
        >
          <p style={{ margin: 0, color: "#e4e6ed" }}>{oauthStatus}</p>
        </div>
      )}

      {/* Connected Inboxes */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>Connected Inboxes</h3>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowAddInbox(!showAddInbox)}
          >
            {showAddInbox ? "Cancel" : "+ Add Inbox"}
          </button>
        </div>

        {showAddInbox && (
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-input)",
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 200 }}>
                <label>Email Address</label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="user@gmail.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 160 }}>
                <label>Display Name (optional)</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. Sales Team"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={addInbox}
                disabled={addingInbox || !newEmail.includes("@")}
                style={{ height: 36 }}
              >
                {addingInbox ? "Adding..." : "Add"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 16, color: "#9ca3af" }}>Loading accounts...</div>
        ) : accounts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">&#9993;</div>
            <h3>No inboxes configured</h3>
            <p>Click &quot;+ Add Inbox&quot; above to add an email account, then connect Gmail.</p>
          </div>
        ) : (
          <div style={{ padding: 0 }}>
            {accounts.map((account) => (
              <div
                key={account.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  borderBottom: "1px solid #1e2028",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: "#e4e6ed" }}>
                    {account.email_address}
                  </div>
                  <div
                    className="text-muted text-sm"
                    style={{ marginTop: 2 }}
                  >
                    {account.display_name ?? account.provider}
                    {account.last_synced_at && (
                      <>
                        {" "}
                        &middot; Last synced{" "}
                        {new Date(account.last_synced_at).toLocaleString()}
                      </>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {isConnected(account) ? (
                    <>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 12px",
                          borderRadius: 6,
                          background: "#0a2e1a",
                          color: "#4ade80",
                          fontSize: 13,
                          fontWeight: 500,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: "#4ade80",
                            display: "inline-block",
                          }}
                        />
                        Connected
                      </span>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => disconnectInbox(account.id)}
                        disabled={disconnecting === account.id}
                      >
                        {disconnecting === account.id ? "..." : "Disconnect"}
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-primary"
                      onClick={() => connectGmail(account.id)}
                      disabled={connecting === account.id}
                      style={{ fontSize: 13 }}
                    >
                      {connecting === account.id
                        ? "Redirecting..."
                        : "Connect Gmail"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Configuration */}
      <div className="card">
        <div className="card-header">
          <h3>AI Configuration</h3>
        </div>
        <div style={{ padding: "16px" }}>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label
              className="text-sm"
              style={{
                display: "block",
                fontWeight: 600,
                marginBottom: 6,
                color: "#e4e6ed",
              }}
            >
              Current Model
            </label>
            <div
              className="form-input font-mono"
              style={{
                display: "inline-block",
                background: "#111318",
                opacity: 0.7,
                cursor: "default",
                fontSize: 14,
              }}
            >
              Claude Sonnet 4
            </div>
          </div>
          <p className="text-muted text-sm">
            Model selection and parameter tuning coming soon.
          </p>
        </div>
      </div>
    </>
  );
}
