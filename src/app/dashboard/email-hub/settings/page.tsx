"use client";

export default function EmailHubSettingsPage() {
  return (
    <>
      <div className="page-header">
        <h2>Email Hub Settings</h2>
        <p>Configure email inboxes, notification preferences, and AI behavior.</p>
      </div>

      {/* Connected Inboxes */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>Connected Inboxes</h3>
        </div>
        <div className="empty-state">
          <div className="empty-icon">&#9993;</div>
          <h3>No inboxes connected yet</h3>
          <p>Gmail and Outlook integration coming soon.</p>
          <button
            className="btn btn-primary"
            disabled
            style={{ marginTop: 12, opacity: 0.5, cursor: "not-allowed" }}
          >
            Connect Inbox
          </button>
          <p className="text-muted text-sm" style={{ marginTop: 8 }}>
            Coming soon
          </p>
        </div>
      </div>

      {/* Notification Preferences */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>Notification Preferences</h3>
        </div>
        <div style={{ padding: "16px" }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "not-allowed",
                opacity: 0.5,
                fontSize: 14,
                color: "#e4e6ed",
              }}
            >
              <input type="checkbox" disabled checked={false} />
              Auto-notify Lynn Brown when drafts are ready
            </label>
            <span
              className="text-muted text-sm"
              style={{
                display: "inline-block",
                marginTop: 6,
                marginLeft: 28,
              }}
            >
              Coming soon
            </span>
          </div>
        </div>
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
