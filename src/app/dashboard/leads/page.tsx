"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { formatStatus } from "@/lib/shared/status-display";
import { suppressNextSoundForLead } from "@/components/StatusSoundMonitor";
import { emitLeadEvent } from "@/lib/lead-events";

interface Lead {
  id: string;
  salesforce_record_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  form_name: string | null;
  village: string | null;
  price: string | null;
  floor_plan: string | null;
  home_type: string | null;
  property_address: string | null;
  builder: string | null;
  timeline: string | null;
  message: string | null;
  url: string | null;
  routing_status: string;
  created_at: string;
  final_agent: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  routing_attempts: Array<{
    id: string;
    agent_id: string;
    agent: { id: string; name: string } | null;
    attempt_number: number;
    status: string;
    agent_response: string | null;
    score_snapshot: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
  }>;
}

interface LocationOption {
  id: string;
  name: string;
}

const statusBadge: Record<string, string> = {
  pending: "badge-warning",
  routing: "badge-info",
  accepted: "badge-success",
  owned_by_other: "badge-muted",
  failed: "badge-danger",
  manual: "badge-danger",
  bad_data: "badge-muted",
};

const attemptStatusBadge: Record<string, string> = {
  sms_sent: "badge-info",
  followup_sent: "badge-warning",
  accepted: "badge-success",
  declined: "badge-danger",
  timed_out: "badge-muted",
  error: "badge-danger",
};

const attemptStatusLabel: Record<string, string> = {
  sms_sent: "sms_sent",
  followup_sent: "followup_sent",
  accepted: "accepted",
  declined: "declined",
  timed_out: "Did Not Respond",
  error: "error",
};

function formatResponseTime(createdAt: string, updatedAt: string, status: string): string {
  // Only show response time for statuses that represent an agent response
  if (status !== "accepted" && status !== "declined") return "-";
  const diffMs = new Date(updatedAt).getTime() - new Date(createdAt).getTime();
  if (diffMs < 0) return "-";
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hrs}h` : `${hrs}h ${rem}m`;
}

function formatPhone(raw: string | null): string {
  if (!raw) return "-";
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  if (national.length === 10) {
    return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  }
  return raw;
}

type SortKey = "name" | "form" | "location" | "value" | "status" | "attempts" | "received" | "assigned";
type SortDir = "asc" | "desc";

function getLeadSortValue(lead: Lead, key: SortKey): string | number {
  switch (key) {
    case "name": return `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.toLowerCase().trim();
    case "form": return (lead.form_name ?? "").toLowerCase();
    case "location": return (lead.location?.name ?? lead.village ?? "").toLowerCase();
    case "value": return lead.price ?? "";
    case "status": return lead.routing_status;
    case "attempts": return lead.routing_attempts?.length ?? 0;
    case "received": return new Date(lead.created_at).getTime();
    case "assigned": return (lead.final_agent?.name ?? "").toLowerCase();
    default: return "";
  }
}

function sortLeads(leads: Lead[], key: SortKey, dir: SortDir): Lead[] {
  return [...leads].sort((a, b) => {
    const aVal = getLeadSortValue(a, key);
    const bVal = getLeadSortValue(b, key);
    if (aVal < bVal) return dir === "asc" ? -1 : 1;
    if (aVal > bVal) return dir === "asc" ? 1 : -1;
    return 0;
  });
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [expandedLead, setExpandedLead] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("received");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [textingId, setTextingId] = useState<string | null>(null);
  const [textedIds, setTextedIds] = useState<Set<string>>(new Set());
  const [doningId, setDoningId] = useState<string | null>(null);
  const [badDataId, setBadDataId] = useState<string | null>(null);

  const fetchLeads = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const r = await fetch(
          `/api/internal/leads?status=${statusFilter}&location=${locationFilter}&limit=50`
        );
        const data = await r.json();
        if (data.error) {
          setError(data.error);
        } else {
          setLeads(data.leads);
          setTotal(data.total);
          if (data.locations) setLocations(data.locations);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [statusFilter, locationFilter]
  );

  // Initial fetch on mount / filter change
  useEffect(() => {
    fetchLeads(true);
  }, [fetchLeads]);

  // Poll every 15s for live status updates
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    pollRef.current = setInterval(() => fetchLeads(false), 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchLeads]);

  async function handleStop(leadId: string) {
    setStoppingId(leadId);
    try {
      const r = await fetch(`/api/internal/leads/${leadId}/stop`, {
        method: "POST",
      });
      const data = await r.json();
      if (data.error) {
        alert(`Failed to stop: ${data.error}`);
      } else {
        // Suppress the monitor so it doesn't re-play the sound on next poll
        suppressNextSoundForLead(leadId);
        // Play the manual fallback sound immediately
        const audio = new Audio("/sounds/mgs - manual.mp3");
        audio.volume = 0.6;
        audio.play().catch(() => {});
        // Speech bubble
        const stopped = leads.find((l) => l.id === leadId);
        emitLeadEvent({
          type: "manual",
          leadName: [stopped?.first_name, stopped?.last_name].filter(Boolean).join(" ") || "Unknown",
        });
        // Optimistic update — swap status locally, then background-refresh
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId ? { ...l, routing_status: "manual" } : l
          )
        );
        fetchLeads(false);
      }
    } catch {
      alert("Network error stopping lead routing");
    } finally {
      setStoppingId(null);
    }
  }

  async function handleTextMe(leadId: string) {
    setTextingId(leadId);
    try {
      const r = await fetch(`/api/internal/leads/${leadId}/text-me`, {
        method: "POST",
      });
      const data = await r.json();
      if (data.error) {
        alert(`Failed to send: ${data.error}`);
      } else {
        // Play routing/codec sound + speech bubble
        const audio = new Audio("/sounds/mgs-codec.mp3");
        audio.volume = 0.6;
        audio.play().catch(() => {});
        const texted = leads.find((l) => l.id === leadId);
        emitLeadEvent({
          type: "text_me",
          leadName: [texted?.first_name, texted?.last_name].filter(Boolean).join(" ") || "Unknown",
        });
        setTextedIds((prev) => new Set(prev).add(leadId));
      }
    } catch {
      alert("Network error sending text");
    } finally {
      setTextingId(null);
    }
  }

  async function handleDone(leadId: string) {
    setDoningId(leadId);
    try {
      const r = await fetch(`/api/internal/leads/${leadId}/done`, {
        method: "POST",
      });
      const data = await r.json();
      if (data.error) {
        alert(`Failed: ${data.error}`);
      } else {
        suppressNextSoundForLead(leadId);
        // Play accepted sound + fireworks + speech bubble
        const audio = new Audio("/sounds/metal-gear-victory.mp3");
        audio.volume = 0.6;
        audio.play().catch(() => {});
        const done = leads.find((l) => l.id === leadId);
        emitLeadEvent({
          type: "done",
          leadName: [done?.first_name, done?.last_name].filter(Boolean).join(" ") || "Unknown",
        });
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId ? { ...l, routing_status: "accepted" } : l
          )
        );
        fetchLeads(false);
      }
    } catch {
      alert("Network error marking done");
    } finally {
      setDoningId(null);
    }
  }

  async function handleBadData(leadId: string) {
    setBadDataId(leadId);
    try {
      const r = await fetch(`/api/internal/leads/${leadId}/bad-data`, {
        method: "POST",
      });
      const data = await r.json();
      if (data.error) {
        alert(`Failed: ${data.error}`);
      } else {
        suppressNextSoundForLead(leadId);
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId ? { ...l, routing_status: "bad_data" } : l
          )
        );
        fetchLeads(false);
      }
    } catch {
      alert("Network error marking bad data");
    } finally {
      setBadDataId(null);
    }
  }

  const sortedLeads = sortLeads(leads, sortKey, sortDir);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "received" ? "desc" : "asc");
    }
  }

  function SortHeader({ label, sortKeyName }: { label: string; sortKeyName: SortKey }) {
    const active = sortKey === sortKeyName;
    return (
      <th
        onClick={() => handleSort(sortKeyName)}
        style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      >
        {label}{" "}
        <span style={{ opacity: active ? 1 : 0.3, fontSize: 10 }}>
          {active && sortDir === "desc" ? "\u25BC" : "\u25B2"}
        </span>
      </th>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>Form Submissions</h2>
        <p>Track incoming form submissions and their routing status</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>{total} form submissions</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select
              className="form-input"
              style={{ width: "auto" }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="routing">Routing</option>
              <option value="accepted">Accepted</option>
              <option value="owned_by_other">Already Owned</option>
              <option value="manual">Take Over</option>
              <option value="failed">Failed</option>
              <option value="bad_data">Bad Data</option>
            </select>
            <select
              className="form-input"
              style={{ width: "auto" }}
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
            >
              <option value="all">All locations</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
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
        ) : leads.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">&#9993;</div>
            <h3>No form submissions found</h3>
            <p>
              {statusFilter === "all" && locationFilter === "all"
                ? "Form submissions will appear here when they come in via Zapier webhook."
                : "No form submissions matching the selected filters."}
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <SortHeader label="Name" sortKeyName="name" />
                  <SortHeader label="Form" sortKeyName="form" />
                  <SortHeader label="Location" sortKeyName="location" />
                  <SortHeader label="Price" sortKeyName="value" />
                  <SortHeader label="Status" sortKeyName="status" />
                  <SortHeader label="Assigned To" sortKeyName="assigned" />
                  <SortHeader label="Attempts" sortKeyName="attempts" />
                  <SortHeader label="Received" sortKeyName="received" />
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map((lead) => (
                  <Fragment key={lead.id}>
                    <tr
                      onClick={() =>
                        setExpandedLead(
                          expandedLead === lead.id ? null : lead.id
                        )
                      }
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ width: 30, fontSize: 10 }}>
                        {expandedLead === lead.id ? "\u25BC" : "\u25B6"}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {lead.first_name} {lead.last_name}
                      </td>
                      <td className="text-sm text-muted">
                        {lead.form_name ?? "-"}
                      </td>
                      <td className="text-sm">
                        {lead.location?.name ?? lead.village ?? "-"}
                      </td>
                      <td className="text-sm font-mono">
                        {lead.price ?? "-"}
                      </td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span
                            className={`badge ${statusBadge[lead.routing_status] ?? "badge-muted"}`}
                          >
                            {formatStatus(lead.routing_status)}
                          </span>
                          {(lead.routing_status === "pending" ||
                            lead.routing_status === "routing") && (
                            <button
                              className="btn btn-primary btn-sm"
                              disabled={stoppingId === lead.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStop(lead.id);
                              }}
                            >
                              {stoppingId === lead.id ? "Stopping..." : "Stop"}
                            </button>
                          )}
                          {(lead.routing_status === "failed" || lead.routing_status === "manual") && (
                            <>
                              <button
                                className="btn btn-primary btn-sm"
                                disabled={textingId === lead.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTextMe(lead.id);
                                }}
                              >
                                {textingId === lead.id
                                  ? "..."
                                  : textedIds.has(lead.id)
                                    ? "Text Again"
                                    : "Text Me"}
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                disabled={doningId === lead.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDone(lead.id);
                                }}
                              >
                                {doningId === lead.id ? "..." : "Done"}
                              </button>
                            </>
                          )}
                          {lead.routing_status !== "bad_data" && (
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled={badDataId === lead.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleBadData(lead.id);
                              }}
                            >
                              {badDataId === lead.id ? "..." : "Bad Data"}
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="text-sm">
                        {lead.final_agent?.name ?? "-"}
                      </td>
                      <td className="font-mono">
                        {lead.routing_attempts?.length ?? 0}
                      </td>
                      <td className="text-muted text-sm font-mono">
                        {new Date(lead.created_at).toLocaleString()}
                      </td>
                    </tr>
                    {expandedLead === lead.id && (
                      <tr key={`${lead.id}-detail`}>
                        <td colSpan={10} style={{ padding: "0 12px 16px 42px" }}>
                          <div
                            style={{
                              background: "var(--bg-input)",
                              borderRadius: "var(--radius)",
                              padding: 16,
                            }}
                          >
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px", marginBottom: 12 }}>
                              <div>
                                <span className="text-muted text-sm">Email: </span>
                                {lead.email ?? "-"}
                              </div>
                              <div>
                                <span className="text-muted text-sm">Phone: </span>
                                {formatPhone(lead.phone)}
                              </div>
                              {lead.village && (
                                <div>
                                  <span className="text-muted text-sm">Neighborhood: </span>
                                  {lead.village}
                                </div>
                              )}
                              {lead.price && (
                                <div>
                                  <span className="text-muted text-sm">Price: </span>
                                  {lead.price}
                                </div>
                              )}
                              {lead.property_address && (
                                <div>
                                  <span className="text-muted text-sm">Property Address: </span>
                                  {lead.property_address}
                                </div>
                              )}
                              {lead.home_type && (
                                <div>
                                  <span className="text-muted text-sm">Home Type: </span>
                                  {lead.home_type}
                                </div>
                              )}
                              {lead.floor_plan && (
                                <div>
                                  <span className="text-muted text-sm">Floor Plan: </span>
                                  {lead.url ? (
                                    <a href={lead.url} target="_blank" rel="noopener noreferrer" className="text-sm">
                                      {lead.floor_plan}
                                    </a>
                                  ) : (
                                    lead.floor_plan
                                  )}
                                </div>
                              )}
                              {lead.builder && (
                                <div>
                                  <span className="text-muted text-sm">Builder: </span>
                                  {lead.builder}
                                </div>
                              )}
                              {lead.timeline && (
                                <div>
                                  <span className="text-muted text-sm">Timeline: </span>
                                  {lead.timeline}
                                </div>
                              )}
                              {lead.url && !lead.floor_plan && (
                                <div>
                                  <span className="text-muted text-sm">URL: </span>
                                  <a href={lead.url} target="_blank" rel="noopener noreferrer" className="text-sm">
                                    {lead.url}
                                  </a>
                                </div>
                              )}
                              {lead.message && (
                                <div style={{ gridColumn: "1 / -1" }}>
                                  <span className="text-muted text-sm">Message: </span>
                                  {lead.message}
                                </div>
                              )}
                            </div>

                            {lead.routing_attempts?.length > 0 && (
                              <>
                                <h4
                                  style={{
                                    fontSize: 12,
                                    color: "var(--text-muted)",
                                    textTransform: "uppercase",
                                    letterSpacing: 0.5,
                                    marginBottom: 8,
                                  }}
                                >
                                  Routing Attempts
                                </h4>
                                <table>
                                  <thead>
                                    <tr>
                                      <th>#</th>
                                      <th>Agent</th>
                                      <th>Status</th>
                                      <th>Response Message</th>
                                      <th>Score</th>
                                      <th>Initial Outreach</th>
                                      <th>Response Time</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {lead.routing_attempts
                                      .sort(
                                        (a, b) =>
                                          a.attempt_number - b.attempt_number
                                      )
                                      .map((attempt) => (
                                        <tr key={attempt.id}>
                                          <td className="font-mono">
                                            {attempt.attempt_number}
                                          </td>
                                          <td className="text-sm">
                                            {attempt.agent?.name ?? "-"}
                                          </td>
                                          <td>
                                            <span
                                              className={`badge ${attemptStatusBadge[attempt.status] ?? "badge-muted"}`}
                                            >
                                              {attemptStatusLabel[attempt.status] ?? attempt.status}
                                            </span>
                                          </td>
                                          <td className="text-sm">
                                            {attempt.agent_response ?? "-"}
                                          </td>
                                          <td className="font-mono text-sm">
                                            {attempt.score_snapshot
                                              ? (
                                                  attempt.score_snapshot as {
                                                    total?: number;
                                                  }
                                                ).total?.toFixed(3) ?? "-"
                                              : "-"}
                                          </td>
                                          <td className="text-muted text-sm font-mono">
                                            {new Date(
                                              attempt.created_at
                                            ).toLocaleTimeString()}
                                          </td>
                                          <td className="text-muted text-sm font-mono">
                                            {formatResponseTime(attempt.created_at, attempt.updated_at, attempt.status)}
                                          </td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
