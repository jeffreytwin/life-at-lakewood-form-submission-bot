"use client";

import { useEffect, useState } from "react";

interface Stats {
  totalLeads: number;
  totalAgents: number;
  activeAgents: number;
  totalLocations: number;
  statusCounts: Record<string, number>;
  recentLeads: Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    routing_status: string;
    created_at: string;
    form_name: string | null;
  }>;
  recentEvents: Array<{
    id: string;
    event_type: string;
    details: Record<string, unknown> | null;
    created_at: string;
  }>;
}

const statusBadge: Record<string, string> = {
  pending: "badge-warning",
  routing: "badge-info",
  accepted: "badge-success",
  owned_by_other: "badge-muted",
  failed: "badge-danger",
  manual: "badge-danger",
};

const eventColors: Record<string, string> = {
  lead_received: "#60a5fa",
  sms_sent: "#4f8ff7",
  sms_received: "#a78bfa",
  followup_sent: "#fbbf24",
  escalated: "#f97316",
  accepted: "#34d399",
  declined: "#f87171",
  manual_fallback: "#ef4444",
  error: "#ef4444",
};

export default function DashboardOverview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/internal/stats")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setStats(data);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <>
        <div className="page-header">
          <h2>Dashboard</h2>
          <p>System overview and recent activity</p>
        </div>
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">!</div>
            <h3>Connection Error</h3>
            <p>
              Could not connect to the database. Make sure your Supabase
              environment variables are configured in <code>.env.local</code>.
            </p>
            <pre
              style={{
                marginTop: 12,
                padding: 12,
                background: "var(--bg-input)",
                borderRadius: "var(--radius)",
                fontSize: 12,
                textAlign: "left",
                maxWidth: 400,
                margin: "12px auto 0",
              }}
            >
              {`NEXT_PUBLIC_SUPABASE_URL=your-url
SUPABASE_SERVICE_ROLE_KEY=your-key`}
            </pre>
          </div>
        </div>
      </>
    );
  }

  if (!stats) {
    return (
      <>
        <div className="page-header">
          <h2>Dashboard</h2>
          <p>Loading...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>System overview and recent activity</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Leads</div>
          <div className="stat-value">{stats.totalLeads}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Agents</div>
          <div className="stat-value">{stats.activeAgents}</div>
          <div className="stat-sub">{stats.totalAgents} total</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Locations</div>
          <div className="stat-value">{stats.totalLocations}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Accepted</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>
            {stats.statusCounts.accepted ?? 0}
          </div>
          <div className="stat-sub">
            {stats.statusCounts.manual ?? 0} manual fallbacks
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Recent Leads</h3>
          </div>
          {stats.recentLeads.length === 0 ? (
            <div className="empty-state">
              <p>No leads yet</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Form</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentLeads.map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        {lead.first_name} {lead.last_name}
                      </td>
                      <td className="text-muted text-sm">
                        {lead.form_name ?? "-"}
                      </td>
                      <td>
                        <span
                          className={`badge ${statusBadge[lead.routing_status] ?? "badge-muted"}`}
                        >
                          {lead.routing_status}
                        </span>
                      </td>
                      <td className="text-muted text-sm font-mono">
                        {new Date(lead.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Recent Activity</h3>
          </div>
          {stats.recentEvents.length === 0 ? (
            <div className="empty-state">
              <p>No activity yet</p>
            </div>
          ) : (
            <div>
              {stats.recentEvents.map((event) => (
                <div className="timeline-item" key={event.id}>
                  <div
                    className="timeline-dot"
                    style={{
                      background:
                        eventColors[event.event_type] ?? "var(--text-muted)",
                    }}
                  />
                  <div className="timeline-content">
                    <div className="timeline-event">
                      {event.event_type.replace(/_/g, " ")}
                    </div>
                    {event.details && (
                      <div className="timeline-details">
                        {Object.entries(event.details)
                          .filter(([k]) => k !== "leadId" && k !== "routingAttemptId")
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" | ")}
                      </div>
                    )}
                    <div className="timeline-time">
                      {new Date(event.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
