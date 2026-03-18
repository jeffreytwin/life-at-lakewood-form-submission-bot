"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface EmailHubStats {
  inboundThisMonth: number;
  avgResponseMinutes: number | null;
  responseCount: number;
  pendingDrafts: number;
  totalActiveThreads: number;
}

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

export default function EmailHubOverview() {
  const router = useRouter();
  const [stats, setStats] = useState<EmailHubStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/internal/email-hub/stats")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setStats(data);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60 * 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (error) {
    return (
      <>
        <div className="page-header">
          <h2>Email Hub</h2>
          <p>Overview</p>
        </div>
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">!</div>
            <h3>Error</h3>
            <p>{error}</p>
          </div>
        </div>
      </>
    );
  }

  if (!stats) {
    return (
      <>
        <div className="page-header">
          <h2>Email Hub</h2>
          <p>Loading...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>Email Hub</h2>
        <p>AI-powered email draft management overview</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Incoming Emails This Month</div>
          <div className="stat-value">{stats.inboundThisMonth}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Email Response Time</div>
          <div className="stat-value">
            {stats.avgResponseMinutes !== null
              ? formatTimeExact(stats.avgResponseMinutes)
              : "-"}
          </div>
          <div className="stat-sub">
            {stats.responseCount > 0
              ? `${stats.responseCount} response${stats.responseCount !== 1 ? "s" : ""} (excl. quiet hours)`
              : "No responses yet"}
          </div>
        </div>
        <div
          className="stat-card"
          style={{ cursor: "pointer" }}
          onClick={() => router.push("/dashboard/email-hub/drafts")}
        >
          <div className="stat-label">Pending Drafts</div>
          <div
            className="stat-value"
            style={{
              color:
                stats.pendingDrafts > 0 ? "var(--warning)" : "var(--success)",
            }}
          >
            {stats.pendingDrafts}
          </div>
          <div className="stat-sub">Awaiting review</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Threads</div>
          <div className="stat-value">{stats.totalActiveThreads}</div>
        </div>
      </div>
    </>
  );
}
