"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { formatStatus } from "@/lib/shared/status-display";

interface LeadDistEntry {
  agentName: string;
  leadCount: number;
}

interface LeadDistribution {
  distribution: LeadDistEntry[];
  asOf: string | null;
}

interface Stats {
  totalLeads: number;
  totalAgents: number;
  activeAgents: number;
  totalLocations: number;
  avgAcceptanceMinutes: number | null;
  statusCounts: Record<string, number>;
  recentLeads: Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    routing_status: string;
    created_at: string;
    form_name: string | null;
    agents: { name: string } | null;
  }>;
  recentEvents: Array<{
    id: string;
    event_type: string;
    details: Record<string, unknown> | null;
    created_at: string;
  }>;
}

interface EmailHubStats {
  avgResponseTimeMinutes: number | null;
  sentEmails: number;
  recentEmails: {
    id: string;
    status: string;
    subject: string | null;
    created_at: string;
    sent_at: string | null;
    approved_at: string | null;
    agent_handoff_transferred: boolean;
    sender_name: string | null;
  }[];
}

const statusBadge: Record<string, string> = {
  pending: "badge-warning",
  routing: "badge-info",
  accepted: "badge-success",
  owned_by_other: "badge-muted",
  failed: "badge-danger",
  manual: "badge-danger",
  bad_data: "badge-purple",
};

const EMAIL_STATUS_COLORS: Record<string, string> = {
  drafted: "#4f8ff7",
  approved: "#34d399",
  sent: "#34d399",
  discarded: "#f87171",
};

function formatEmailRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-US", { timeZone: "America/New_York" });
}

interface QuietHoursState {
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  quiet_hours_end_weekday: string;
  quiet_hours_end_weekend: string;
}

export default function DashboardOverview() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leadDist, setLeadDist] = useState<LeadDistribution | null>(null);
  const [leadDistLoading, setLeadDistLoading] = useState(true);
  const [emailStats, setEmailStats] = useState<EmailHubStats | null>(null);
  const [quietHours, setQuietHours] = useState<QuietHoursState | null>(null);
  const [qhBusy, setQhBusy] = useState(false);
  const [metricsDays, setMetricsDays] = useState(7);

  const refreshEmailStats = useCallback(() => {
    fetch(`/api/internal/email-hub/stats?days=${metricsDays}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setEmailStats(data);
      })
      .catch(() => {});
  }, [metricsDays]);

  const refreshStats = useCallback(() => {
    fetch(`/api/internal/stats?days=${metricsDays}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setStats(data);
      })
      .catch((e) => setError(e.message));
  }, [metricsDays]);

  const refreshLeadDist = useCallback(() => {
    setLeadDistLoading(true);
    fetch("/api/internal/lead-distribution")
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setLeadDist(data);
      })
      .catch(() => {})
      .finally(() => setLeadDistLoading(false));
  }, []);

  useEffect(() => {
    refreshStats();
    refreshLeadDist();
    refreshEmailStats();
    fetch("/api/internal/settings")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.quiet_hours_enabled === "boolean") {
          setQuietHours({
            quiet_hours_enabled: data.quiet_hours_enabled,
            quiet_hours_start: data.quiet_hours_start ?? "21:00",
            quiet_hours_end: data.quiet_hours_end ?? "08:30",
            quiet_hours_end_weekday: data.quiet_hours_end_weekday ?? "06:30",
            quiet_hours_end_weekend: data.quiet_hours_end_weekend ?? "08:30",
          });
        }
      })
      .catch(() => {});
  }, [refreshStats, refreshLeadDist, refreshEmailStats]);

  // Auto-refresh the hand raise distribution every 5 minutes
  useEffect(() => {
    const interval = setInterval(refreshLeadDist, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshLeadDist]);

  // Auto-refresh stats (including recent form submissions) every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refreshStats();
      refreshEmailStats();
    }, 30 * 1000);
    return () => clearInterval(interval);
  }, [refreshStats, refreshEmailStats]);

  async function toggleQuietHours() {
    if (!quietHours) return;
    setQhBusy(true);
    try {
      const res = await fetch("/api/internal/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quiet_hours_enabled: !quietHours.quiet_hours_enabled,
        }),
      });
      const data = await res.json();
      if (typeof data.quiet_hours_enabled === "boolean") {
        setQuietHours((prev) => prev && { ...prev, quiet_hours_enabled: data.quiet_hours_enabled });
      }
    } catch {
      alert("Failed to update quiet hours");
    } finally {
      setQhBusy(false);
    }
  }

  async function updateQuietHoursTime(field: "quiet_hours_start" | "quiet_hours_end" | "quiet_hours_end_weekday" | "quiet_hours_end_weekend", value: string) {
    if (!quietHours) return;
    setQhBusy(true);
    try {
      const res = await fetch("/api/internal/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json();
      if (data.quiet_hours_start) {
        setQuietHours((prev) => prev && {
          ...prev,
          quiet_hours_start: data.quiet_hours_start,
          quiet_hours_end: data.quiet_hours_end,
          quiet_hours_end_weekday: data.quiet_hours_end_weekday ?? prev.quiet_hours_end_weekday,
          quiet_hours_end_weekend: data.quiet_hours_end_weekend ?? prev.quiet_hours_end_weekend,
        });
      }
    } catch {
      alert("Failed to update quiet hours");
    } finally {
      setQhBusy(false);
    }
  }

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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 8 }}>
        <select
          className="form-input"
          style={{ width: "auto", fontSize: 12, padding: "4px 8px" }}
          value={metricsDays}
          onChange={(e) => setMetricsDays(Number(e.target.value))}
        >
          <option value={1}>Today</option>
          <option value={3}>Last 3 Days</option>
          <option value={7}>Last 7 Days</option>
          <option value={14}>Last 14 Days</option>
          <option value={30}>Last 30 Days</option>
        </select>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Accepted Form Submissions</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>
            {stats.statusCounts.accepted ?? 0}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Time to Form Acceptance</div>
          <div className="stat-value">
            {stats.avgAcceptanceMinutes !== null
              ? formatTimeExact(stats.avgAcceptanceMinutes)
              : "-"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sent Emails</div>
          <div className="stat-value" style={{ color: "#4f8ff7" }}>
            {emailStats?.sentEmails ?? 0}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Email Response Time</div>
          <div className="stat-value">
            {emailStats?.avgResponseTimeMinutes != null
              ? emailStats.avgResponseTimeMinutes < 60
                ? `${emailStats.avgResponseTimeMinutes}m`
                : emailStats.avgResponseTimeMinutes < 1440
                  ? `${Math.round(emailStats.avgResponseTimeMinutes / 60)}h`
                  : `${Math.round(emailStats.avgResponseTimeMinutes / 1440)}d`
              : "—"}
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header">
          <h3>Overall Hand Raise Distribution This Month</h3>
          {leadDist?.asOf && (
            <span className="text-muted text-sm">
              As of{" "}
              {new Date(leadDist.asOf).toLocaleString("en-US", {
                timeZone: "America/New_York",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })}
            </span>
          )}
        </div>
        {leadDistLoading && !leadDist ? (
          <div className="empty-state" style={{ padding: "32px 20px" }}>
            <p>Loading from Salesforce...</p>
          </div>
        ) : !leadDist ? (
          <div className="empty-state" style={{ padding: "32px 20px" }}>
            <p>
              Could not load lead distribution data.
            </p>
          </div>
        ) : leadDist.distribution.length === 0 ? (
          <div className="empty-state" style={{ padding: "32px 20px" }}>
            <p>No form submissions this month yet</p>
          </div>
        ) : (
          <LeadDistributionChart data={leadDist.distribution} />
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Recent Form Submissions</h3>
          </div>
          {stats.recentLeads.length === 0 ? (
            <div className="empty-state">
              <p>No form submissions yet</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Assigned To</th>
                    <th>Status</th>
                    <th className="hide-mobile">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentLeads.map((lead) => (
                    <tr
                      key={lead.id}
                      onClick={() => router.push("/dashboard/leads")}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        {lead.first_name} {lead.last_name}
                      </td>
                      <td className="text-muted text-sm">
                        {lead.agents?.name ?? "-"}
                      </td>
                      <td>
                        <span
                          className={`badge ${statusBadge[lead.routing_status] ?? "badge-muted"}`}
                        >
                          {formatStatus(lead.routing_status)}
                        </span>
                      </td>
                      <td className="text-muted text-sm font-mono hide-mobile">
                        {new Date(lead.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <ResponseTimeChart />
      </div>

      {/* Recent Emails */}
      {emailStats && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <h3>Recent Emails</h3>
          </div>
          {emailStats.recentEmails.length === 0 ? (
            <div className="empty-state">
              <p>No recent emails</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {emailStats.recentEmails.map((email) => (
                    <tr
                      key={email.id}
                      onClick={() => router.push("/dashboard/email-hub/drafts")}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ whiteSpace: "nowrap" }}>
                        {email.sender_name ?? "-"}
                      </td>
                      <td
                        style={{
                          maxWidth: 300,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {email.subject ?? "Untitled"}
                      </td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 10,
                            fontSize: 11,
                            fontWeight: 600,
                            background: `${EMAIL_STATUS_COLORS[email.status] ?? "#8b8fa3"}22`,
                            color: EMAIL_STATUS_COLORS[email.status] ?? "#8b8fa3",
                            border: `1px solid ${EMAIL_STATUS_COLORS[email.status] ?? "#8b8fa3"}44`,
                            textTransform: "capitalize",
                          }}
                        >
                          {email.status}
                        </span>
                      </td>
                      <td className="text-muted text-sm">
                        {formatEmailRelativeDate(email.sent_at ?? email.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {quietHours && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <h3>Night Mode (Quiet Hours)</h3>
            <button
              className={`btn btn-sm ${quietHours.quiet_hours_enabled ? "btn-danger" : "btn-primary"}`}
              onClick={toggleQuietHours}
              disabled={qhBusy}
            >
              {qhBusy ? "..." : quietHours.quiet_hours_enabled ? "Disable" : "Enable"}
            </button>
          </div>
          <div style={{ padding: "16px 20px" }}>
            <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
              During quiet hours, form submissions are still assigned and the agent
              receives an SMS, but the follow-up sequence is deferred until the
              morning. Agents can still reply YES/NO at any time.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: quietHours.quiet_hours_enabled ? "var(--success)" : "var(--text-muted)",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-heading)" }}>
                  {quietHours.quiet_hours_enabled ? "Active" : "Disabled"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label className="text-sm text-muted" htmlFor="qh-start">Start:</label>
                <input
                  id="qh-start"
                  type="time"
                  className="form-input"
                  style={{ width: "auto", fontSize: 13, padding: "4px 8px" }}
                  value={quietHours.quiet_hours_start}
                  onChange={(e) => updateQuietHoursTime("quiet_hours_start", e.target.value)}
                  disabled={qhBusy}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label className="text-sm text-muted" htmlFor="qh-end-weekday">End (Mon-Fri):</label>
                <input
                  id="qh-end-weekday"
                  type="time"
                  className="form-input"
                  style={{ width: "auto", fontSize: 13, padding: "4px 8px" }}
                  value={quietHours.quiet_hours_end_weekday}
                  onChange={(e) => updateQuietHoursTime("quiet_hours_end_weekday", e.target.value)}
                  disabled={qhBusy}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label className="text-sm text-muted" htmlFor="qh-end-weekend">End (Sat-Sun):</label>
                <input
                  id="qh-end-weekend"
                  type="time"
                  className="form-input"
                  style={{ width: "auto", fontSize: 13, padding: "4px 8px" }}
                  value={quietHours.quiet_hours_end_weekend}
                  onChange={(e) => updateQuietHoursTime("quiet_hours_end_weekend", e.target.value)}
                  disabled={qhBusy}
                />
              </div>
              <span className="text-muted text-sm">(Eastern Time)</span>
            </div>
          </div>
        </div>
      )}

    </>
  );
}

/* ── Bar Chart Component ─────────────────────────────────────── */

function LeadDistributionChart({ data }: { data: LeadDistEntry[] }) {
  const maxCount = Math.max(...data.map((d) => d.leadCount), 1);
  // Round the y-axis ceiling up to the nearest multiple of 5
  const yCeil = Math.ceil(maxCount / 5) * 5;
  const ticks: number[] = [];
  for (let i = 0; i <= yCeil; i += 5) ticks.push(i);

  const barColor = "#4ade80"; // green matching the Salesforce report
  const chartHeight = 220;

  return (
    <div style={{ position: "relative" }}>
      {/* Y-axis labels + grid lines */}
      <div
        style={{
          position: "relative",
          marginLeft: 40,
          marginRight: 12,
          height: chartHeight,
        }}
      >
        {ticks.map((tick) => {
          const bottom = (tick / yCeil) * 100;
          return (
            <div key={tick} style={{ position: "absolute", bottom: `${bottom}%`, left: -40, right: 0 }}>
              <span
                className="text-muted"
                style={{
                  position: "absolute",
                  left: 0,
                  top: -7,
                  fontSize: 11,
                  width: 30,
                  textAlign: "right",
                }}
              >
                {tick}
              </span>
              <div
                style={{
                  marginLeft: 36,
                  borderTop: "1px solid var(--border)",
                  opacity: tick === 0 ? 0.6 : 0.3,
                }}
              />
            </div>
          );
        })}

        {/* Bars */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-around",
            height: "100%",
            marginLeft: 36,
            position: "relative",
            zIndex: 1,
          }}
        >
          {data.map((d) => {
            const pct = (d.leadCount / yCeil) * 100;
            return (
              <div
                key={d.agentName}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  flex: 1,
                  maxWidth: 64,
                  height: "100%",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-heading)",
                    marginBottom: 4,
                  }}
                >
                  {d.leadCount}
                </span>
                <div
                  style={{
                    width: "60%",
                    minWidth: 28,
                    height: `${pct}%`,
                    background: barColor,
                    borderRadius: "4px 4px 0 0",
                    transition: "height 0.3s ease",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* X-axis labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          marginLeft: 76,
          marginRight: 12,
          marginTop: 8,
        }}
      >
        {data.map((d) => (
          <div
            key={d.agentName}
            style={{
              flex: 1,
              maxWidth: 64,
              textAlign: "center",
              fontSize: 11,
              color: "var(--text-muted)",
              lineHeight: 1.3,
              overflow: "hidden",
            }}
          >
            {d.agentName.split(" ").map((part, i) => (
              <div key={i}>{part}</div>
            ))}
          </div>
        ))}
      </div>

      <div
        className="text-muted"
        style={{ textAlign: "center", fontSize: 11, marginTop: 12 }}
      >
        Lead Owner
      </div>
    </div>
  );
}

/* ── Response Time Chart Component ──────────────────────────── */

interface AgentStat {
  agentName: string;
  avgMinutes: number;
  responseCount: number;
  nonResponseCount: number;
}

interface ResponseTimeData {
  agentStats: AgentStat[];
  overallAvgMinutes: number;
  totalResponses: number;
  totalNonResponses: number;
}

const RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "3d", label: "Last 3 Days" },
  { value: "7d", label: "Last 7 Days" },
  { value: "14d", label: "Last 14 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "all", label: "All Time" },
];

function formatTimeExact(minutes: number): string {
  if (minutes === 0) return "0s";
  const totalSeconds = Math.round(minutes * 60);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (rm === 0) return `${h}h`;
  return `${h}h ${rm}m`;
}

const SLOW_THRESHOLD = 3; // minutes

function ResponseTimeChart() {
  const [data, setData] = useState<ResponseTimeData | null>(null);
  const [range, setRange] = useState("7d");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/internal/response-times?range=${range}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setData(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [range]);

  const chartHeight = 220;

  return (
    <div className="card">
      <div className="card-header">
        <h3>Average Response Time</h3>
        <select
          className="form-input"
          style={{ width: "auto", fontSize: 12, padding: "4px 8px" }}
          value={range}
          onChange={(e) => setRange(e.target.value)}
        >
          {RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {loading && !data ? (
        <div className="empty-state" style={{ padding: "32px 20px" }}>
          <p>Loading...</p>
        </div>
      ) : !data || (data.totalResponses === 0 && data.totalNonResponses === 0) ? (
        <div className="empty-state" style={{ padding: "32px 20px" }}>
          <p>No routing attempts in this period</p>
        </div>
      ) : (
        <div style={{ padding: "12px 20px 20px" }}>
          {/* Overall stat */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: data.overallAvgMinutes >= SLOW_THRESHOLD ? "#eab308" : "var(--text-heading)" }}>
              {formatTimeExact(data.overallAvgMinutes)}
            </span>
            <span className="text-muted text-sm">
              avg across {data.totalResponses} response{data.totalResponses !== 1 ? "s" : ""}
            </span>
            {data.totalNonResponses > 0 && (
              <span style={{ fontSize: 12, color: "#f87171" }}>
                {data.totalNonResponses} missed
              </span>
            )}
          </div>

          {/* Per-agent bar chart */}
          {data.agentStats.length > 0 && (
            <ResponseTimeAgentChart
              agentStats={data.agentStats}
              chartHeight={chartHeight}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ResponseTimeAgentChart({
  agentStats,
  chartHeight,
}: {
  agentStats: AgentStat[];
  chartHeight: number;
}) {
  // Filter to agents that have at least one response for the bar heights
  const maxMinutes = Math.max(...agentStats.map((a) => a.avgMinutes), 1);
  // Round ceiling to a nice number
  const yCeil = maxMinutes <= 5
    ? Math.ceil(maxMinutes)
    : maxMinutes <= 10
      ? Math.ceil(maxMinutes / 2) * 2
      : maxMinutes <= 60
        ? Math.ceil(maxMinutes / 10) * 10
        : Math.ceil(maxMinutes / 30) * 30;

  const tickCount = Math.min(5, Math.max(2, yCeil));
  const tickStep = yCeil / tickCount;
  const ticks: number[] = [];
  for (let i = 0; i <= tickCount; i++) ticks.push(Math.round(i * tickStep * 10) / 10);

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          position: "relative",
          marginLeft: 44,
          marginRight: 12,
          height: chartHeight,
        }}
      >
        {/* Y-axis labels + grid */}
        {ticks.map((tick) => {
          const bottom = (tick / yCeil) * 100;
          return (
            <div key={tick} style={{ position: "absolute", bottom: `${bottom}%`, left: -44, right: 0 }}>
              <span
                className="text-muted"
                style={{
                  position: "absolute",
                  left: 0,
                  top: -7,
                  fontSize: 10,
                  width: 36,
                  textAlign: "right",
                }}
              >
                {formatTimeExact(tick)}
              </span>
              <div
                style={{
                  marginLeft: 40,
                  borderTop: "1px solid var(--border)",
                  opacity: tick === 0 ? 0.6 : 0.3,
                }}
              />
            </div>
          );
        })}

        {/* Bars */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-around",
            height: "100%",
            marginLeft: 40,
            position: "relative",
            zIndex: 1,
          }}
        >
          {agentStats.map((a) => {
            const pct = a.responseCount > 0 ? (a.avgMinutes / yCeil) * 100 : 0;
            const isSlow = a.avgMinutes >= SLOW_THRESHOLD;
            const barColor = isSlow ? "#eab308" : "#60a5fa";

            return (
              <div
                key={a.agentName}
                title={`${a.agentName}: ${formatTimeExact(a.avgMinutes)} avg (${a.responseCount} responses, ${a.nonResponseCount} missed)`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  flex: 1,
                  maxWidth: 64,
                  height: "100%",
                }}
              >
                {a.responseCount > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: isSlow ? "#eab308" : "var(--text-heading)",
                      marginBottom: 2,
                    }}
                  >
                    {formatTimeExact(a.avgMinutes)}
                  </span>
                )}
                <div
                  style={{
                    width: "60%",
                    minWidth: 28,
                    height: `${Math.max(pct, a.responseCount > 0 ? 2 : 0)}%`,
                    background: barColor,
                    borderRadius: "4px 4px 0 0",
                    transition: "height 0.3s ease",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* X-axis: agent names + non-response count */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          marginLeft: 84,
          marginRight: 12,
          marginTop: 8,
        }}
      >
        {agentStats.map((a) => (
          <div
            key={a.agentName}
            style={{
              flex: 1,
              maxWidth: 64,
              textAlign: "center",
              fontSize: 11,
              color: "var(--text-muted)",
              lineHeight: 1.3,
              overflow: "hidden",
            }}
          >
            {a.agentName.split(" ").map((part, i) => (
              <div key={i}>{part}</div>
            ))}
            {a.nonResponseCount > 0 && (
              <div style={{ fontSize: 10, color: "#f87171", marginTop: 2 }}>
                {a.nonResponseCount} missed
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

