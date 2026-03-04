"use client";

import { useEffect, useState } from "react";

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
  routing_status: string;
  created_at: string;
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

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedLead, setExpandedLead] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/internal/leads?status=${statusFilter}&limit=50`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setLeads(data.leads);
          setTotal(data.total);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [statusFilter]);

  return (
    <>
      <div className="page-header">
        <h2>Leads</h2>
        <p>Track incoming leads and their routing status</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>{total} leads</h3>
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
            <h3>No leads found</h3>
            <p>
              {statusFilter === "all"
                ? "Leads will appear here when they come in via Zapier webhook."
                : `No leads with status "${statusFilter}".`}
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Form</th>
                  <th>Village</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <>
                    <tr
                      key={lead.id}
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
                      <td className="text-sm">{lead.village ?? "-"}</td>
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
                      <td className="font-mono">
                        {lead.routing_attempts?.length ?? 0}
                      </td>
                      <td className="text-muted text-sm font-mono">
                        {new Date(lead.created_at).toLocaleString()}
                      </td>
                    </tr>
                    {expandedLead === lead.id && (
                      <tr key={`${lead.id}-detail`}>
                        <td colSpan={8} style={{ padding: "0 12px 16px 42px" }}>
                          <div
                            style={{
                              background: "var(--bg-input)",
                              borderRadius: "var(--radius)",
                              padding: 16,
                            }}
                          >
                            <div className="grid-2" style={{ marginBottom: 12 }}>
                              <div>
                                <span className="text-muted text-sm">
                                  Email:{" "}
                                </span>
                                {lead.email ?? "-"}
                              </div>
                              <div>
                                <span className="text-muted text-sm">
                                  Phone:{" "}
                                </span>
                                {lead.phone ?? "-"}
                              </div>
                              <div>
                                <span className="text-muted text-sm">
                                  SF ID:{" "}
                                </span>
                                <span className="font-mono text-sm">
                                  {lead.salesforce_record_id ?? "-"}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted text-sm">
                                  Lead ID:{" "}
                                </span>
                                <span className="font-mono text-sm">
                                  {lead.id.slice(0, 8)}...
                                </span>
                              </div>
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
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
