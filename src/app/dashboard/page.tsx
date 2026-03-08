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

interface QuietHoursState {
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
}

export default function DashboardOverview() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leadDist, setLeadDist] = useState<LeadDistribution | null>(null);
  const [leadDistLoading, setLeadDistLoading] = useState(true);
  const [quietHours, setQuietHours] = useState<QuietHoursState | null>(null);
  const [qhBusy, setQhBusy] = useState(false);
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
    fetch("/api/internal/stats")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setStats(data);
      })
      .catch((e) => setError(e.message));

    refreshLeadDist();
    fetch("/api/internal/settings")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.quiet_hours_enabled === "boolean") {
          setQuietHours({
            quiet_hours_enabled: data.quiet_hours_enabled,
            quiet_hours_start: data.quiet_hours_start ?? "21:00",
            quiet_hours_end: data.quiet_hours_end ?? "08:30",
          });
        }
      })
      .catch(() => {});
  }, [refreshLeadDist]);

  // Auto-refresh the hand raise distribution every 5 minutes
  useEffect(() => {
    const interval = setInterval(refreshLeadDist, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshLeadDist]);

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

  async function updateQuietHoursTime(field: "quiet_hours_start" | "quiet_hours_end", value: string) {
    if (!quietHours) return;
    setQhBusy(true);
    try {
      const res = await fetch("/api/internal/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json();
      if (data.quiet_hours_start && data.quiet_hours_end) {
        setQuietHours((prev) => prev && {
          ...prev,
          quiet_hours_start: data.quiet_hours_start,
          quiet_hours_end: data.quiet_hours_end,
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

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Form Submissions</div>
          <div className="stat-value">{stats.totalLeads}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Agents</div>
          <div className="stat-value">{stats.activeAgents}</div>
          <div className="stat-sub">{stats.totalAgents} total</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Locations</div>
          <div className="stat-value">{stats.totalLocations}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Accepted Form Submissions</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>
            {stats.statusCounts.accepted ?? 0}
          </div>
          <div className="stat-sub">
            {stats.statusCounts.manual ?? 0} manual fallbacks
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
                    <th>Form</th>
                    <th>Status</th>
                    <th>Time</th>
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
                        {lead.form_name ?? "-"}
                      </td>
                      <td>
                        <span
                          className={`badge ${statusBadge[lead.routing_status] ?? "badge-muted"}`}
                        >
                          {formatStatus(lead.routing_status)}
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

        <ResponseTimeChart />
      </div>

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
                <label className="text-sm text-muted" htmlFor="qh-end">End:</label>
                <input
                  id="qh-end"
                  type="time"
                  className="form-input"
                  style={{ width: "auto", fontSize: 13, padding: "4px 8px" }}
                  value={quietHours.quiet_hours_end}
                  onChange={(e) => updateQuietHoursTime("quiet_hours_end", e.target.value)}
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

interface ResponseTimeData {
  dailyAverages: Array<{ date: string; avgMinutes: number; count: number }>;
  overallAvgMinutes: number;
  totalResponses: number;
}

const RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "3d", label: "Last 3 Days" },
  { value: "7d", label: "Last 7 Days" },
  { value: "14d", label: "Last 14 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "all", label: "All Time" },
];

function formatAvgLabel(minutes: number): string {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hrs = Math.floor(minutes / 60);
  const rem = Math.round(minutes % 60);
  return rem === 0 ? `${hrs}h` : `${hrs}h ${rem}m`;
}

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

  const chartHeight = 180;
  const barColor = "#60a5fa";

  return (
    <div className="card">
      <div className="card-header">
        <h3>Avg Response Time</h3>
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
      ) : !data || data.totalResponses === 0 ? (
        <div className="empty-state" style={{ padding: "32px 20px" }}>
          <p>No agent responses in this period</p>
        </div>
      ) : (
        <div style={{ padding: "12px 20px 20px" }}>
          {/* Overall stat */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: "var(--text-heading)" }}>
              {formatAvgLabel(data.overallAvgMinutes)}
            </span>
            <span className="text-muted text-sm">
              avg across {data.totalResponses} response{data.totalResponses !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Bar chart */}
          {data.dailyAverages.length > 1 ? (
            <ResponseTimeBarChart
              dailyAverages={data.dailyAverages}
              chartHeight={chartHeight}
              barColor={barColor}
            />
          ) : data.dailyAverages.length === 1 ? (
            <div className="text-muted text-sm" style={{ textAlign: "center", padding: "20px 0" }}>
              {formatAvgLabel(data.dailyAverages[0].avgMinutes)} avg on{" "}
              {new Date(data.dailyAverages[0].date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              {" "}({data.dailyAverages[0].count} response{data.dailyAverages[0].count !== 1 ? "s" : ""})
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ResponseTimeBarChart({
  dailyAverages,
  chartHeight,
  barColor,
}: {
  dailyAverages: ResponseTimeData["dailyAverages"];
  chartHeight: number;
  barColor: string;
}) {
  const maxMinutes = Math.max(...dailyAverages.map((d) => d.avgMinutes), 1);
  // Round ceiling to a nice number
  const yCeil = maxMinutes <= 10
    ? Math.ceil(maxMinutes / 2) * 2
    : maxMinutes <= 60
      ? Math.ceil(maxMinutes / 10) * 10
      : Math.ceil(maxMinutes / 30) * 30;

  const tickCount = Math.min(5, yCeil);
  const tickStep = yCeil / tickCount;
  const ticks: number[] = [];
  for (let i = 0; i <= tickCount; i++) ticks.push(Math.round(i * tickStep));

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
                {formatAvgLabel(tick)}
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
          {dailyAverages.map((d) => {
            const pct = (d.avgMinutes / yCeil) * 100;
            return (
              <div
                key={d.date}
                title={`${d.date}: ${formatAvgLabel(d.avgMinutes)} avg (${d.count} responses)`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  flex: 1,
                  maxWidth: 48,
                  height: "100%",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--text-heading)",
                    marginBottom: 2,
                  }}
                >
                  {formatAvgLabel(d.avgMinutes)}
                </span>
                <div
                  style={{
                    width: "55%",
                    minWidth: 18,
                    height: `${Math.max(pct, 2)}%`,
                    background: barColor,
                    borderRadius: "3px 3px 0 0",
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
          marginLeft: 84,
          marginRight: 12,
          marginTop: 6,
        }}
      >
        {dailyAverages.map((d) => {
          const dt = new Date(d.date + "T12:00:00");
          return (
            <div
              key={d.date}
              style={{
                flex: 1,
                maxWidth: 48,
                textAlign: "center",
                fontSize: 10,
                color: "var(--text-muted)",
                lineHeight: 1.3,
              }}
            >
              {dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

