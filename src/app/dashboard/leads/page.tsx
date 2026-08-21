"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { formatStatus } from "@/lib/shared/status-display";
import { formatDateTimeET, formatTimeET } from "@/lib/shared/format-date";
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
  final_agent: {
    id: string;
    name: string;
    phone?: string | null;
    is_active?: boolean;
    is_frontlines?: boolean;
  } | null;
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

interface AgentOption {
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
  bad_data: "badge-purple",
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
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [expandedLead, setExpandedLead] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("received");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [textingId, setTextingId] = useState<string | null>(null);
  const [textedIds, setTextedIds] = useState<Set<string>>(new Set());
  const [doningId, setDoningId] = useState<string | null>(null);
  const [badDataId, setBadDataId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [notifyingId, setNotifyingId] = useState<string | null>(null);
  const [notifiedIds, setNotifiedIds] = useState<Set<string>>(new Set());

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset to first page when filters change
  useEffect(() => {
    setPage(0);
  }, [statusFilter, locationFilter, agentFilter]);

  const fetchLeads = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const params = new URLSearchParams({
          status: statusFilter,
          location: locationFilter,
          agent: agentFilter,
          limit: String(pageSize),
          offset: String(page * pageSize),
        });
        if (debouncedSearch) params.set("search", debouncedSearch);
        const r = await fetch(`/api/internal/leads?${params}`);
        const data = await r.json();
        if (data.error) {
          setError(data.error);
        } else {
          setLeads(data.leads);
          setTotal(data.total);
          if (data.locations) setLocations(data.locations);
          if (data.agents) setAgents(data.agents);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [statusFilter, locationFilter, agentFilter, debouncedSearch, page]
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

  async function handleRetry(leadId: string) {
    setRetryingId(leadId);
    try {
      const r = await fetch(`/api/internal/leads/${leadId}/retry`, {
        method: "POST",
      });
      const data = await r.json();
      if (data.error) {
        alert(`Retry failed: ${data.error}`);
      } else {
        // Optimistically reflect the new state; refresh shortly to pick up real status.
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId ? { ...l, routing_status: "routing" } : l
          )
        );
        fetchLeads(false);
      }
    } catch {
      alert("Network error retrying routing");
    } finally {
      setRetryingId(null);
    }
  }

  /**
   * Text the lead's owner when that owner is off the active roster. Routing
   * skips them on purpose, so this is a deliberate reach-out. The lead stays
   * in "manual" either way — Retry and Done remain available afterwards.
   */
  async function handleNotifyOwner(leadId: string) {
    setNotifyingId(leadId);
    try {
      const r = await fetch(`/api/internal/leads/${leadId}/notify-owner`, {
        method: "POST",
      });
      const data = await r.json();
      if (data.error) {
        alert(`Failed to notify: ${data.error}`);
      } else {
        setNotifiedIds((prev) => new Set(prev).add(leadId));
      }
    } catch {
      alert("Network error notifying owner");
    } finally {
      setNotifyingId(null);
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
    const confirmed = window.confirm(
      "Are you sure you want to update this lead to 'Bad Data'? It will mark the lead as bogus, erase the handraise data and will no longer be counted toward the agent's daily or monthly counts."
    );
    if (!confirmed) return;

    setBadDataId(leadId);
    try {
      const r = await fetch(`/api/internal/leads/${leadId}/bad-data`, {
        method: "POST",
      });
      const data = await r.json();
      if (data.error) {
        alert(`Failed to mark bad data: ${data.error}`);
      } else {
        suppressNextSoundForLead(leadId);
        const audio = new Audio("/sounds/metal-gear-alert.mp3");
        audio.volume = 0.6;
        audio.play().catch(() => {});
        const marked = leads.find((l) => l.id === leadId);
        emitLeadEvent({
          type: "bad_data",
          leadName: [marked?.first_name, marked?.last_name].filter(Boolean).join(" ") || "Unknown",
        });
        // Optimistic update — attempts are erased server-side too
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId
              ? { ...l, routing_status: "bad_data", routing_attempts: [] }
              : l
          )
        );
        fetchLeads(false);
      }
    } catch {
      alert("Network error marking lead as bad data");
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

  function SortHeader({ label, sortKeyName, className }: { label: string; sortKeyName: SortKey; className?: string }) {
    const active = sortKey === sortKeyName;
    return (
      <th
        className={className}
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              className="form-input"
              style={{ width: 220 }}
              type="text"
              placeholder="Search name, email, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
            <select
              className="form-input"
              style={{ width: "auto" }}
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
            >
              <option value="all">All agents</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
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
          <>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <SortHeader label="Name" sortKeyName="name" />
                  <SortHeader label="Form" sortKeyName="form" className="hide-mobile" />
                  <SortHeader label="Location" sortKeyName="location" className="hide-mobile" />
                  <SortHeader label="Price" sortKeyName="value" className="hide-mobile" />
                  <SortHeader label="Status" sortKeyName="status" />
                  <SortHeader label="Assigned To" sortKeyName="assigned" />
                  <SortHeader label="Attempts" sortKeyName="attempts" className="hide-mobile" />
                  <SortHeader label="Received" sortKeyName="received" className="hide-mobile" />
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
                      <td className="text-sm text-muted hide-mobile">
                        {lead.form_name ?? "-"}
                      </td>
                      <td className="text-sm hide-mobile">
                        {lead.location?.name ?? lead.village ?? "-"}
                      </td>
                      <td className="text-sm font-mono hide-mobile">
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
                              {lead.final_agent &&
                                lead.final_agent.is_active === false &&
                                !lead.final_agent.is_frontlines &&
                                lead.final_agent.phone && (
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    disabled={notifyingId === lead.id}
                                    title={`${lead.final_agent.name} is no longer on the active roster. Routing did not text them.`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleNotifyOwner(lead.id);
                                    }}
                                  >
                                    {notifyingId === lead.id
                                      ? "..."
                                      : notifiedIds.has(lead.id)
                                        ? `Notify ${lead.final_agent.name} Again`
                                        : `Notify ${lead.final_agent.name}`}
                                  </button>
                                )}
                              <button
                                className="btn btn-secondary btn-sm"
                                disabled={retryingId === lead.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRetry(lead.id);
                                }}
                              >
                                {retryingId === lead.id ? "..." : "Retry"}
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
                              <button
                                className="btn btn-danger btn-sm"
                                disabled={badDataId === lead.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleBadData(lead.id);
                                }}
                              >
                                {badDataId === lead.id ? "..." : "Bad Data"}
                              </button>
                            </>
                          )}
                        </span>
                      </td>
                      <td className="text-sm">
                        {lead.final_agent?.name ?? "-"}
                      </td>
                      <td className="font-mono hide-mobile">
                        {lead.routing_attempts?.length ?? 0}
                      </td>
                      <td className="text-muted text-sm font-mono hide-mobile">
                        {formatDateTimeET(lead.created_at)}
                      </td>
                    </tr>
                    {expandedLead === lead.id && (
                      <tr key={`${lead.id}-detail`}>
                        <td colSpan={10} className="lead-detail-cell">
                          <div
                            style={{
                              background: "var(--bg-input)",
                              borderRadius: "var(--radius)",
                              padding: 16,
                            }}
                          >
                            <div className="lead-detail-grid">
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
                                      <th className="hide-mobile">Response Message</th>
                                      <th className="hide-mobile">Score</th>
                                      <th className="hide-mobile">Initial Outreach</th>
                                      <th className="hide-mobile">Response Time</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {lead.routing_attempts
                                      .sort(
                                        (a, b) =>
                                          new Date(a.created_at).getTime() -
                                          new Date(b.created_at).getTime()
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
                                          <td className="text-sm hide-mobile">
                                            {attempt.agent_response ?? "-"}
                                          </td>
                                          <td className="font-mono text-sm hide-mobile">
                                            {attempt.score_snapshot
                                              ? (
                                                  attempt.score_snapshot as {
                                                    total?: number;
                                                  }
                                                ).total?.toFixed(3) ?? "-"
                                              : "-"}
                                          </td>
                                          <td className="text-muted text-sm font-mono hide-mobile">
                                            {formatTimeET(attempt.created_at)}
                                          </td>
                                          <td className="text-muted text-sm font-mono hide-mobile">
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
          {total > pageSize && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                borderTop: "1px solid var(--border)",
              }}
            >
              <span className="text-sm text-muted">
                Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={(page + 1) * pageSize >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
          </>
        )}
      </div>
    </>
  );
}
