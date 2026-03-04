"use client";

import { useEffect, useState } from "react";

interface AuditEvent {
  id: string;
  lead_id: string | null;
  routing_attempt_id: string | null;
  event_type: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

const eventColors: Record<string, string> = {
  lead_received: "#60a5fa",
  scoring_completed: "#818cf8",
  sms_sent: "#4f8ff7",
  sms_received: "#a78bfa",
  followup_sent: "#fbbf24",
  escalated: "#f97316",
  accepted: "#34d399",
  declined: "#f87171",
  sf_updated: "#2dd4bf",
  error: "#ef4444",
  manual_fallback: "#ef4444",
};

const eventTypes = [
  "all",
  "lead_received",
  "sms_sent",
  "sms_received",
  "followup_sent",
  "escalated",
  "accepted",
  "declined",
  "manual_fallback",
  "error",
];

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/internal/audit?event_type=${filter}&limit=100`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setEvents(data.events);
          setTotal(data.total);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [filter]);

  return (
    <>
      <div className="page-header">
        <h2>Audit Log</h2>
        <p>Complete history of all routing events and actions</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>{total} events</h3>
          <select
            className="form-input"
            style={{ width: "auto" }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {eventTypes.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "All events" : t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <div className="empty-state">
            <h3>Error</h3>
            <p>{error}</p>
          </div>
        ) : loading ? (
          <div className="empty-state">
            <p>Loading...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">&#9776;</div>
            <h3>No events found</h3>
            <p>Audit events will appear here as the system processes leads.</p>
          </div>
        ) : (
          <div>
            {events.map((event) => (
              <div className="timeline-item" key={event.id}>
                <div
                  className="timeline-dot"
                  style={{
                    background:
                      eventColors[event.event_type] ?? "var(--text-muted)",
                  }}
                />
                <div className="timeline-content">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <span className="timeline-event">
                        {event.event_type.replace(/_/g, " ")}
                      </span>
                      {event.lead_id && (
                        <span
                          className="text-muted text-sm font-mono"
                          style={{ marginLeft: 8 }}
                        >
                          lead: {event.lead_id.slice(0, 8)}...
                        </span>
                      )}
                    </div>
                    <span className="timeline-time">
                      {new Date(event.created_at).toLocaleString()}
                    </span>
                  </div>
                  {event.details && (
                    <div className="timeline-details">
                      {Object.entries(event.details).map(([k, v]) => (
                        <span key={k} style={{ marginRight: 16 }}>
                          <span style={{ color: "var(--text-muted)" }}>
                            {k}:
                          </span>{" "}
                          {String(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
