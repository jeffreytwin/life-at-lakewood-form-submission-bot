"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface EmailHubStats {
  totalDrafts: number;
  approvedDrafts: number;
  sentEmails: number;
  pendingDrafts: number;
  agentHandoffs: number;
  dailyGraph: { date: string; drafted: number; sent: number }[];
  recentEmails: {
    id: string;
    status: string;
    subject: string | null;
    created_at: string;
    sent_at: string | null;
    approved_at: string | null;
    agent_handoff_transferred: boolean;
  }[];
  agentHandoffGraph: { agentName: string; handoffs: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  drafted: "#4f8ff7",
  approved: "#34d399",
  sent: "#34d399",
  discarded: "#f87171",
};

function formatRelativeDate(dateStr: string): string {
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
  return date.toLocaleDateString();
}

export default function EmailHubOverview() {
  const router = useRouter();
  const [stats, setStats] = useState<EmailHubStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/internal/email-hub/stats")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setStats(data);
          setError(null);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h2>Email Hub Overview</h2>
          <p>Loading...</p>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="page-header">
          <h2>Email Hub Overview</h2>
          <p>Email performance and activity this month</p>
        </div>
        <div className="card">
          <div className="empty-state">
            <h3>Error</h3>
            <p>{error}</p>
          </div>
        </div>
      </>
    );
  }

  if (!stats) return null;

  return (
    <>
      <div className="page-header">
        <h2>Email Hub Overview</h2>
        <p>Email performance and activity this month</p>
      </div>

      {/* Stat cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Drafts Generated</div>
          <div className="stat-value">{stats.totalDrafts}</div>
          <div className="stat-sub">{stats.pendingDrafts} pending</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Approved Drafts</div>
          <div className="stat-value" style={{ color: "#34d399" }}>
            {stats.approvedDrafts}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sent Emails</div>
          <div className="stat-value" style={{ color: "#4f8ff7" }}>
            {stats.sentEmails}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Agent Handoffs</div>
          <div className="stat-value" style={{ color: "#a78bfa" }}>
            {stats.agentHandoffs}
          </div>
        </div>
      </div>

      {/* Daily drafts/sent graph */}
      <div className="card mb-4">
        <div className="card-header">
          <h3>Email Activity This Month</h3>
        </div>
        {stats.dailyGraph.length === 0 ? (
          <div className="empty-state" style={{ padding: "32px 20px" }}>
            <p>No email activity this month yet</p>
          </div>
        ) : (
          <DailyEmailChart data={stats.dailyGraph} />
        )}
      </div>

      <div className="grid-2">
        {/* Recent emails */}
        <div className="card">
          <div className="card-header">
            <h3>Recent Emails</h3>
          </div>
          {stats.recentEmails.length === 0 ? (
            <div className="empty-state" style={{ padding: "32px 20px" }}>
              <p>No emails yet</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentEmails.map((email) => (
                    <tr
                      key={email.id}
                      onClick={() => router.push("/dashboard/email-hub/drafts")}
                      style={{ cursor: "pointer" }}
                    >
                      <td
                        style={{
                          maxWidth: 250,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {email.subject ?? "Untitled"}
                        {email.agent_handoff_transferred && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              color: "#a78bfa",
                              fontWeight: 600,
                            }}
                          >
                            HANDOFF
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 10,
                            fontSize: 11,
                            fontWeight: 600,
                            background: `${STATUS_COLORS[email.status] ?? "#8b8fa3"}22`,
                            color: STATUS_COLORS[email.status] ?? "#8b8fa3",
                            border: `1px solid ${STATUS_COLORS[email.status] ?? "#8b8fa3"}44`,
                            textTransform: "capitalize",
                          }}
                        >
                          {email.status}
                        </span>
                      </td>
                      <td className="text-muted text-sm">
                        {formatRelativeDate(email.sent_at ?? email.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Agent handoffs graph */}
        <div className="card">
          <div className="card-header">
            <h3>Agent Handoffs This Month</h3>
          </div>
          {stats.agentHandoffGraph.length === 0 ? (
            <div className="empty-state" style={{ padding: "32px 20px" }}>
              <p>No agent handoffs this month</p>
            </div>
          ) : (
            <AgentHandoffChart data={stats.agentHandoffGraph} />
          )}
        </div>
      </div>
    </>
  );
}

/* ── Daily Email Activity Chart ──────────────────────────── */

function DailyEmailChart({
  data,
}: {
  data: { date: string; drafted: number; sent: number }[];
}) {
  const maxVal = Math.max(...data.map((d) => Math.max(d.drafted, d.sent)), 1);
  const yCeil = Math.ceil(maxVal / 5) * 5 || 5;
  const ticks: number[] = [];
  for (let i = 0; i <= yCeil; i += Math.max(1, Math.ceil(yCeil / 5))) ticks.push(i);

  const chartHeight = 200;
  const barWidth = Math.max(12, Math.min(32, 600 / data.length));

  return (
    <div style={{ padding: "12px 20px 20px" }}>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#4f8ff7", display: "inline-block" }} />
          Drafted
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#34d399", display: "inline-block" }} />
          Sent
        </span>
      </div>

      <div style={{ position: "relative" }}>
        <div
          style={{
            position: "relative",
            marginLeft: 36,
            marginRight: 12,
            height: chartHeight,
          }}
        >
          {/* Grid lines */}
          {ticks.map((tick) => {
            const bottom = (tick / yCeil) * 100;
            return (
              <div key={tick} style={{ position: "absolute", bottom: `${bottom}%`, left: -36, right: 0 }}>
                <span
                  className="text-muted"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: -7,
                    fontSize: 10,
                    width: 28,
                    textAlign: "right",
                  }}
                >
                  {tick}
                </span>
                <div
                  style={{
                    marginLeft: 32,
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
              marginLeft: 32,
              position: "relative",
              zIndex: 1,
              gap: 2,
            }}
          >
            {data.map((d) => {
              const draftPct = (d.drafted / yCeil) * 100;
              const sentPct = (d.sent / yCeil) * 100;
              return (
                <div
                  key={d.date}
                  title={`${d.date}: ${d.drafted} drafted, ${d.sent} sent`}
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: 1,
                    justifyContent: "center",
                    flex: 1,
                    maxWidth: barWidth * 2 + 4,
                    height: "100%",
                  }}
                >
                  <div
                    style={{
                      width: barWidth / 2,
                      height: `${Math.max(draftPct, d.drafted > 0 ? 2 : 0)}%`,
                      background: "#4f8ff7",
                      borderRadius: "3px 3px 0 0",
                      transition: "height 0.3s ease",
                    }}
                  />
                  <div
                    style={{
                      width: barWidth / 2,
                      height: `${Math.max(sentPct, d.sent > 0 ? 2 : 0)}%`,
                      background: "#34d399",
                      borderRadius: "3px 3px 0 0",
                      transition: "height 0.3s ease",
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* X-axis labels (show every few days to avoid crowding) */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-around",
            marginLeft: 68,
            marginRight: 12,
            marginTop: 6,
          }}
        >
          {data.map((d, i) => {
            const showLabel = data.length <= 10 || i % Math.ceil(data.length / 10) === 0;
            return (
              <div
                key={d.date}
                style={{
                  flex: 1,
                  maxWidth: barWidth * 2 + 4,
                  textAlign: "center",
                  fontSize: 10,
                  color: "var(--text-muted)",
                }}
              >
                {showLabel ? d.date.slice(5) : ""}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Agent Handoff Chart ────────────────────────────────── */

function AgentHandoffChart({
  data,
}: {
  data: { agentName: string; handoffs: number }[];
}) {
  const maxCount = Math.max(...data.map((d) => d.handoffs), 1);
  const yCeil = Math.ceil(maxCount / 5) * 5 || 5;
  const ticks: number[] = [];
  for (let i = 0; i <= yCeil; i += Math.max(1, Math.ceil(yCeil / 5))) ticks.push(i);

  const barColor = "#a78bfa";
  const chartHeight = 200;

  return (
    <div style={{ padding: "12px 20px 20px" }}>
      <div style={{ position: "relative" }}>
        <div
          style={{
            position: "relative",
            marginLeft: 36,
            marginRight: 12,
            height: chartHeight,
          }}
        >
          {ticks.map((tick) => {
            const bottom = (tick / yCeil) * 100;
            return (
              <div key={tick} style={{ position: "absolute", bottom: `${bottom}%`, left: -36, right: 0 }}>
                <span
                  className="text-muted"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: -7,
                    fontSize: 10,
                    width: 28,
                    textAlign: "right",
                  }}
                >
                  {tick}
                </span>
                <div
                  style={{
                    marginLeft: 32,
                    borderTop: "1px solid var(--border)",
                    opacity: tick === 0 ? 0.6 : 0.3,
                  }}
                />
              </div>
            );
          })}

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-around",
              height: "100%",
              marginLeft: 32,
              position: "relative",
              zIndex: 1,
            }}
          >
            {data.map((d) => {
              const pct = (d.handoffs / yCeil) * 100;
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
                    {d.handoffs}
                  </span>
                  <div
                    style={{
                      width: "60%",
                      minWidth: 28,
                      height: `${Math.max(pct, 2)}%`,
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
            marginLeft: 68,
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
      </div>
    </div>
  );
}
