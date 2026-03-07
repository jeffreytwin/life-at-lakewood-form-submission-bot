"use client";

import { Fragment, useEffect, useState } from "react";

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
    attempt_number: number;
    status: string;
    agent_response: string | null;
    score_snapshot: Record<string, unknown> | null;
    created_at: string;
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
};

const attemptStatusBadge: Record<string, string> = {
  sms_sent: "badge-info",
  followup_sent: "badge-warning",
  accepted: "badge-success",
  declined: "badge-danger",
  timed_out: "badge-muted",
  error: "badge-danger",
};

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

  useEffect(() => {
    setLoading(true);
    fetch(`/api/internal/leads?status=${statusFilter}&location=${locationFilter}&limit=50`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setLeads(data.leads);
          setTotal(data.total);
          if (data.locations) setLocations(data.locations);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [statusFilter, locationFilter]);

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
              <option value="owned_by_other">Owned by Other</option>
              <option value="manual">Manual</option>
              <option value="failed">Failed</option>
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
                        <span
                          className={`badge ${statusBadge[lead.routing_status] ?? "badge-muted"}`}
                        >
                          {lead.routing_status}
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
                        <td colSpan={9} style={{ padding: "0 12px 16px 42px" }}>
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
                                      <th>Status</th>
                                      <th>Response</th>
                                      <th>Score</th>
                                      <th>Time</th>
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
                                          <td>
                                            <span
                                              className={`badge ${attemptStatusBadge[attempt.status] ?? "badge-muted"}`}
                                            >
                                              {attempt.status}
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
