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

interface MonthlyEntry {
  yearMonth: string;
  leadCount: number;
}

interface MonthlyLeads {
  months: MonthlyEntry[];
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
  const [monthlyLeads, setMonthlyLeads] = useState<MonthlyLeads | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(true);
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

  const refreshMonthlyLeads = useCallback(() => {
    setMonthlyLoading(true);
    fetch("/api/internal/leads-by-month")
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setMonthlyLeads(data);
      })
      .catch(() => {})
      .finally(() => setMonthlyLoading(false));
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
    refreshMonthlyLeads();

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
  }, [refreshLeadDist, refreshMonthlyLeads]);

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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            <button
              className="btn btn-secondary btn-sm"
              onClick={refreshLeadDist}
              disabled={leadDistLoading}
            >
              Refresh
            </button>
          </div>
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

        <div className="card">
          <div className="card-header">
            <h3>Hand Raises Generated by Month</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {monthlyLeads?.asOf && (
                <span className="text-muted text-sm">
                  As of{" "}
                  {new Date(monthlyLeads.asOf).toLocaleString("en-US", {
                    timeZone: "America/New_York",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </span>
              )}
              <button
                className="btn btn-secondary btn-sm"
                onClick={refreshMonthlyLeads}
                disabled={monthlyLoading}
              >
                Refresh
              </button>
            </div>
          </div>
          {monthlyLoading && !monthlyLeads ? (
            <div className="empty-state" style={{ padding: "32px 20px" }}>
              <p>Loading from Salesforce...</p>
            </div>
          ) : !monthlyLeads || monthlyLeads.months.length === 0 ? (
            <div className="empty-state" style={{ padding: "32px 20px" }}>
              <p>No monthly data yet</p>
            </div>
          ) : (
            <MonthlyLeadsChart data={monthlyLeads.months} />
          )}
        </div>
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

/* ── Monthly Leads Bar Chart ─────────────────────────────────── */

function formatMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function MonthlyLeadsChart({ data }: { data: MonthlyEntry[] }) {
  const maxCount = Math.max(...data.map((d) => d.leadCount), 1);
  const yCeil = Math.ceil(maxCount / 50) * 50;
  const ticks: number[] = [];
  for (let i = 0; i <= yCeil; i += 50) ticks.push(i);

  const barColor = "#4ade80";
  const chartHeight = 240;

  return (
    <div style={{ position: "relative", padding: "0 12px 12px" }}>
      {/* Y-axis label */}
      <div
        className="text-muted"
        style={{
          position: "absolute",
          left: -2,
          top: chartHeight / 2,
          transform: "rotate(-90deg)",
          transformOrigin: "center",
          fontSize: 11,
          whiteSpace: "nowrap",
        }}
      >
        Record Count
      </div>

      {/* Chart area */}
      <div
        style={{
          position: "relative",
          marginLeft: 50,
          marginRight: 12,
          height: chartHeight,
        }}
      >
        {ticks.map((tick) => {
          const bottom = (tick / yCeil) * 100;
          return (
            <div
              key={tick}
              style={{
                position: "absolute",
                bottom: `${bottom}%`,
                left: -40,
                right: 0,
              }}
            >
              <span
                className="text-muted"
                style={{
                  position: "absolute",
                  left: 0,
                  top: -7,
                  fontSize: 11,
                  width: 34,
                  textAlign: "right",
                }}
              >
                {tick}
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
          {data.map((d) => {
            const pct = (d.leadCount / yCeil) * 100;
            return (
              <div
                key={d.yearMonth}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  flex: 1,
                  maxWidth: 48,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: barColor,
                    marginBottom: 2,
                  }}
                >
                  {d.leadCount}
                </span>
                <div
                  style={{
                    width: "70%",
                    minWidth: 24,
                    height: `${pct}%`,
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
          marginLeft: 90,
          marginRight: 12,
          marginTop: 6,
        }}
      >
        {data.map((d) => (
          <div
            key={d.yearMonth}
            style={{
              flex: 1,
              maxWidth: 48,
              textAlign: "center",
              fontSize: 10,
              color: "var(--text-muted)",
              lineHeight: 1.2,
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              height: 80,
            }}
          >
            {formatMonthLabel(d.yearMonth)}
          </div>
        ))}
      </div>

      <div
        className="text-muted"
        style={{ textAlign: "center", fontSize: 11, marginTop: 8 }}
      >
        Date of Positive Response
      </div>
    </div>
  );
}
