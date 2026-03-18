"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { emitLeadEvent } from "@/lib/lead-events";

type EmailDraftStatus = "drafted" | "approved" | "sent" | "discarded";
type TrainingCategory =
  | "initial_inquiry"
  | "follow_up"
  | "scheduling"
  | "agent_handoff"
  | "pricing"
  | "objection"
  | "general";

interface AgentInfo {
  id: string;
  name: string;
  email: string | null;
}

interface AgentOption {
  id: string;
  name: string;
  email: string | null;
}

interface EmailDraft {
  id: string;
  thread_id: string | null;
  email_account_id: string | null;
  provider_draft_id: string | null;
  status: EmailDraftStatus;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  cc_emails: string[];
  agent_handoff_id: string | null;
  agents: AgentInfo | null;
  is_simulation: boolean;
  simulation_input: Record<string, unknown> | null;
  sent_body_text: string | null;
  was_changed: boolean;
  agent_handoff_transferred: boolean;
  created_at: string;
  edited_at: string | null;
  approved_at: string | null;
  sent_at: string | null;
}

interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  from_email: string | null;
  to_email: string | null;
  subject: string | null;
  body_text: string | null;
  received_at: string | null;
  created_at: string;
}

const STATUS_OPTIONS: { key: EmailDraftStatus; label: string }[] = [
  { key: "drafted", label: "Drafts" },
  { key: "sent", label: "Sent" },
];

const STATUS_COLORS: Record<EmailDraftStatus, string> = {
  drafted: "#4f8ff7",
  approved: "#34d399",
  sent: "#34d399",
  discarded: "#f87171",
};

const CATEGORY_OPTIONS: { key: TrainingCategory; label: string }[] = [
  { key: "initial_inquiry", label: "Initial Inquiry" },
  { key: "follow_up", label: "Follow Up" },
  { key: "scheduling", label: "Scheduling" },
  { key: "agent_handoff", label: "Agent Handoff" },
  { key: "pricing", label: "Pricing" },
  { key: "objection", label: "Objection Handling" },
  { key: "general", label: "General" },
];

const POLL_INTERVAL_MS = 15_000;

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

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

/**
 * Strip quoted reply text from a sent email body for display.
 */
function stripQuotedText(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^On .+ wrote:\s*$/.test(line.trim())) break;
    if (/^-{3,}\s*(Original Message|Forwarded message)/i.test(line.trim())) break;
    if (/^_{3,}/.test(line.trim())) break;
    if (line.trim().startsWith(">")) continue;
    result.push(line);
  }
  return result.join("\n").trim();
}

export default function EmailDraftsPage() {
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<EmailDraftStatus>("drafted");
  const [showSimulations] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Thread messages for the expanded draft
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editCcAgent, setEditCcAgent] = useState<AgentOption | null>(null);
  const [saving, setSaving] = useState(false);

  // Agents list for CC dropdown
  const [agents, setAgents] = useState<AgentOption[]>([]);

  // Approve state
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [approveResult, setApproveResult] = useState<string | null>(null);

  // Discard state
  const [discardingId, setDiscardingId] = useState<string | null>(null);

  // Add to training state
  const [trainingDraftId, setTrainingDraftId] = useState<string | null>(null);
  const [trainingCategory, setTrainingCategory] = useState<TrainingCategory>("general");
  const [addingToTraining, setAddingToTraining] = useState(false);

  // Agent handoff state
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [handoffResult, setHandoffResult] = useState<string | null>(null);

  // Regenerate state
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  // Feedback state
  const [feedbackDraftId, setFeedbackDraftId] = useState<string | null>(null);
  const [feedbackRating, setFeedbackRating] = useState(3);
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const fetchDrafts = useCallback(
    (isPolling = false) => {
      if (!isPolling) setLoading(true);
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("is_simulation", String(showSimulations));
      params.set("limit", "50");

      fetch(`/api/internal/email-hub/drafts?${params.toString()}`)
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setDrafts(data);
            // Update approved set from fetched data
            const newApproved = new Set(approvedIds);
            data.forEach((d: EmailDraft) => {
              if (d.status === "approved") newApproved.add(d.id);
            });
            setApprovedIds(newApproved);
          } else if (!isPolling) {
            setError(data.error ?? "Failed to load drafts");
          }
          if (!isPolling) setLoading(false);
        })
        .catch((e) => {
          if (!isPolling) {
            setError(e.message);
            setLoading(false);
          }
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusFilter, showSimulations]
  );

  // Initial fetch on filter change
  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  // Load agents for CC dropdown
  useEffect(() => {
    fetch("/api/internal/agents")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAgents(
            data
              .filter((a: AgentOption & { is_active: boolean }) => a.is_active && a.email)
              .map((a: AgentOption) => ({ id: a.id, name: a.name, email: a.email }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // Polling (15s interval)
  const fetchDraftsRef = useRef(fetchDrafts);
  fetchDraftsRef.current = fetchDrafts;
  useEffect(() => {
    const interval = setInterval(() => {
      fetchDraftsRef.current(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function loadThreadMessages(draftId: string) {
    setLoadingThread(true);
    setThreadMessages([]);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}`);
      const data = await res.json();
      setThreadMessages(data.thread_messages ?? []);
    } catch {
      // Thread loading is non-critical
    } finally {
      setLoadingThread(false);
    }
  }

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setEditingId(null);
      setThreadMessages([]);
      setTrainingDraftId(null);
      setFeedbackDraftId(null);
    } else {
      setExpandedId(id);
      setEditingId(null);
      setTrainingDraftId(null);
      setFeedbackDraftId(null);
      loadThreadMessages(id);
    }
  }

  function startEditing(draft: EmailDraft) {
    setEditingId(draft.id);
    setEditText(draft.body_text ?? "");
    // Restore existing CC agent if one was set
    if (draft.cc_emails.length > 0) {
      const existing = agents.find(
        (a) => a.email && draft.cc_emails.some((cc) => cc.toLowerCase() === a.email!.toLowerCase())
      );
      setEditCcAgent(existing ?? null);
    } else {
      setEditCcAgent(null);
    }
  }

  function cancelEditing() {
    setEditingId(null);
    setEditText("");
    setEditCcAgent(null);
  }

  async function saveEdit(draft: EmailDraft) {
    setSaving(true);
    try {
      const ccEmails = editCcAgent?.email ? [editCcAgent.email] : [];
      const res = await fetch(`/api/internal/email-hub/drafts/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body_text: editText, cc_emails: ccEmails }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save");
      }
      setEditingId(null);
      setEditText("");
      setEditCcAgent(null);
      fetchDrafts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function approveDraft(draftId: string) {
    setApprovingId(draftId);
    setApproveResult(null);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Approval failed");
      }
      // Mark as approved in local state
      setApprovedIds((prev) => new Set(prev).add(draftId));
      setApproveResult(
        "Approved! An SMS has been sent to frontlines to review and send."
      );

      // Play draft-approved sound
      const approvedAudio = new Audio("/sounds/draft-approved.wav");
      approvedAudio.volume = 0.6;
      approvedAudio.play().catch(() => {});

      // If SMS was sent to frontlines, play codec sound and have Snake speak
      if (data.sms_sent) {
        setTimeout(() => {
          const codecAudio = new Audio("/sounds/mgs-codec.mp3");
          codecAudio.volume = 0.6;
          codecAudio.play().catch(() => {});
          emitLeadEvent({ type: "email_draft_approved", leadName: "" });
        }, 1500);
      }

      fetchDrafts();
    } catch (e) {
      setApproveResult(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setApprovingId(null);
    }
  }

  async function discardDraft(draftId: string) {
    if (!confirm("Are you sure you want to discard this draft? This will also delete it from Gmail.")) return;
    setDiscardingId(draftId);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "discarded" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to discard");
      }
      fetchDrafts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Discard failed");
    } finally {
      setDiscardingId(null);
    }
  }

  async function addToTraining(draftId: string) {
    setAddingToTraining(true);
    try {
      const res = await fetch(
        `/api/internal/email-hub/drafts/${draftId}/add-to-training`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: trainingCategory }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to add to training");
      }
      setTrainingDraftId(null);
      alert("Added to training data successfully!");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to add to training");
    } finally {
      setAddingToTraining(false);
    }
  }

  async function triggerAgentHandoff(draftId: string) {
    const draft = drafts.find((d) => d.id === draftId);
    const agentName = draft?.agents?.name ?? "Agent";
    if (!confirm(`Transfer this lead to ${agentName} in Salesforce? This will update Salesforce via Zapier.`)) return;
    setHandoffId(draftId);
    setHandoffResult(null);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Handoff failed");
      }
      setHandoffResult("Agent handoff transferred successfully!");
      fetchDrafts();
    } catch (e) {
      setHandoffResult(e instanceof Error ? e.message : "Handoff failed");
    } finally {
      setHandoffId(null);
    }
  }

  async function regenerateDraft(draftId: string) {
    if (!confirm("Generate a new AI draft? This will replace the current draft text.")) return;
    setRegeneratingId(draftId);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Regeneration failed");
      }
      fetchDrafts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Regeneration failed");
    } finally {
      setRegeneratingId(null);
    }
  }

  async function submitFeedback(draftId: string) {
    setSubmittingFeedback(true);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: feedbackRating,
          feedback_notes: feedbackNotes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to submit feedback");
      }
      setFeedbackDraftId(null);
      setFeedbackRating(3);
      setFeedbackNotes("");
      alert("Feedback submitted! This helps improve future draft quality.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to submit feedback");
    } finally {
      setSubmittingFeedback(false);
    }
  }

  const filteredDrafts = drafts;

  // Reusable thread messages renderer (newest on top)
  function renderThreadMessages() {
    if (loadingThread) {
      return (
        <div style={{ marginBottom: 16 }}>
          <p className="text-muted text-sm">Loading conversation...</p>
        </div>
      );
    }
    if (threadMessages.length === 0) return null;
    return (
      <div style={{ marginBottom: 20 }}>
        <label
          className="text-sm"
          style={{
            display: "block",
            fontWeight: 600,
            marginBottom: 10,
            color: "#8b8fa3",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Conversation Thread
        </label>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxHeight: 400,
            overflowY: "auto",
            padding: "8px 0",
          }}
        >
          {threadMessages.map((msg) => {
            const isInbound = msg.direction === "inbound";
            return (
              <div
                key={msg.id}
                style={{
                  background: isInbound ? "#1a1d27" : "#1a2633",
                  border: `1px solid ${isInbound ? "#2a2e3a" : "#1e3a5f"}`,
                  borderRadius: 8,
                  padding: "10px 14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: isInbound ? "#f87171" : "#34d399",
                    }}
                  >
                    {isInbound ? "Inbound" : "Outbound"}{" "}
                    <span style={{ color: "#8b8fa3", fontWeight: 400 }}>
                      {msg.from_email ?? ""}
                    </span>
                  </span>
                  {msg.received_at && (
                    <span className="text-muted text-sm">
                      {formatRelativeDate(msg.received_at)}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "#e4e6ed",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.body_text ?? "(empty)"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>Email Drafts</h2>
        <p>Review, edit, and approve AI-generated email drafts.</p>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            padding: "12px 16px",
          }}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                className={`btn ${statusFilter === opt.key ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStatusFilter(opt.key)}
                style={{ padding: "6px 14px", fontSize: 13 }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error state */}
      {error ? (
        <div className="card">
          <div className="empty-state">
            <h3>Error</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : loading ? (
        <div className="card">
          <div className="empty-state">
            <p>Loading drafts...</p>
          </div>
        </div>
      ) : filteredDrafts.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">&#9993;</div>
            <h3>No drafts found</h3>
            <p>
              {statusFilter === "drafted"
                ? "No pending drafts. New drafts will appear here when emails are received."
                : "No sent emails found."}
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredDrafts.map((draft) => {
            const isExpanded = expandedId === draft.id;
            const isEditing = editingId === draft.id;
            const isApproved = draft.status === "approved" || approvedIds.has(draft.id);
            const statusColor = isApproved ? "#34d399" : STATUS_COLORS[draft.status];
            const isSent = draft.status === "sent";
            const displayStatus = isApproved ? "approved" : draft.status;

            // Agent handoff button: only show when there's an agent with CC
            const handoffAgent = draft.agents;
            const hasHandoffCc =
              handoffAgent?.email &&
              draft.cc_emails.some(
                (cc) => cc.toLowerCase() === handoffAgent.email!.toLowerCase()
              );

            return (
              <div className="card" key={draft.id} style={{ overflow: "hidden" }}>
                {/* Collapsed row */}
                <div
                  onClick={() => toggleExpand(draft.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 16px",
                    cursor: "pointer",
                    flexWrap: "wrap",
                  }}
                >
                  {/* Expand indicator */}
                  <span style={{ fontSize: 10, color: "#8b8fa3", flexShrink: 0 }}>
                    {isExpanded ? "\u25BC" : "\u25B6"}
                  </span>

                  {/* Status badge */}
                  <span
                    style={{
                      display: "inline-block",
                      padding: "3px 10px",
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 600,
                      background: `${statusColor}22`,
                      color: statusColor,
                      border: `1px solid ${statusColor}44`,
                      textTransform: "capitalize",
                      flexShrink: 0,
                    }}
                  >
                    {displayStatus}
                  </span>

                  {/* Subject */}
                  <span style={{ fontWeight: 600, fontSize: 14, flex: 1, minWidth: 0 }}>
                    {draft.is_simulation ? (
                      <span style={{ color: "#a78bfa" }}>Simulation Draft</span>
                    ) : (
                      draft.subject ?? "Untitled Draft"
                    )}
                  </span>

                  {/* Simulation input preview */}
                  {draft.is_simulation && draft.simulation_input && (
                    <span
                      className="text-muted text-sm"
                      style={{
                        maxWidth: 250,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flexShrink: 1,
                      }}
                    >
                      {truncate(
                        typeof draft.simulation_input.inbound_email === "string"
                          ? draft.simulation_input.inbound_email
                          : JSON.stringify(draft.simulation_input),
                        80
                      )}
                    </span>
                  )}

                  {/* Handoff badge for sent drafts */}
                  {isSent && draft.agent_handoff_transferred && (
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 10,
                        fontSize: 10,
                        fontWeight: 600,
                        background: "#a78bfa22",
                        color: "#a78bfa",
                        border: "1px solid #a78bfa44",
                        flexShrink: 0,
                      }}
                    >
                      Handed Off
                    </span>
                  )}

                  {/* Time */}
                  <span className="text-muted text-sm" style={{ flexShrink: 0 }}>
                    {formatRelativeDate(draft.created_at)}
                  </span>
                </div>

                {/* Expanded view */}
                {isExpanded && (
                  <div
                    style={{
                      borderTop: "1px solid #2a2e3a",
                      padding: "16px",
                    }}
                  >
                    {/* Simulation input */}
                    {draft.is_simulation && draft.simulation_input && (
                      <div style={{ marginBottom: 16 }}>
                        <label
                          className="text-sm"
                          style={{
                            display: "block",
                            fontWeight: 600,
                            marginBottom: 6,
                            color: "#a78bfa",
                          }}
                        >
                          Inbound Email (Simulation Input)
                        </label>
                        <div
                          style={{
                            background: "#111318",
                            border: "1px solid #2a2e3a",
                            borderRadius: 6,
                            padding: "12px 14px",
                            fontSize: 13,
                            lineHeight: 1.6,
                            color: "#e4e6ed",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            maxHeight: 200,
                            overflowY: "auto",
                          }}
                        >
                          {typeof draft.simulation_input.inbound_email === "string"
                            ? draft.simulation_input.inbound_email
                            : JSON.stringify(draft.simulation_input, null, 2)}
                        </div>
                      </div>
                    )}

                    {/* Draft/Sent body */}
                    <div style={{ marginBottom: 16 }}>
                      <label
                        className="text-sm"
                        style={{
                          display: "block",
                          fontWeight: 600,
                          marginBottom: 6,
                          color: "#e4e6ed",
                        }}
                      >
                        {isSent ? "Sent Response" : "Draft Body"}
                      </label>

                      {isEditing ? (
                        <div>
                          <textarea
                            className="form-input"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            style={{
                              width: "100%",
                              minHeight: 200,
                              fontFamily: "inherit",
                              fontSize: 13,
                              lineHeight: 1.6,
                              resize: "vertical",
                            }}
                          />
                          {/* CC an Agent */}
                          <div style={{ marginTop: 10 }}>
                            <label
                              className="text-sm"
                              style={{
                                display: "block",
                                fontWeight: 600,
                                marginBottom: 4,
                                color: "#8b8fa3",
                              }}
                            >
                              CC an Agent
                            </label>
                            {editCcAgent ? (
                              <div
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 8,
                                  padding: "6px 12px",
                                  borderRadius: 16,
                                  background: "#a78bfa22",
                                  border: "1px solid #a78bfa44",
                                  color: "#a78bfa",
                                  fontSize: 13,
                                  fontWeight: 600,
                                }}
                              >
                                {editCcAgent.name}
                                <button
                                  onClick={() => setEditCcAgent(null)}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: "#a78bfa",
                                    cursor: "pointer",
                                    padding: 0,
                                    fontSize: 16,
                                    lineHeight: 1,
                                  }}
                                  title="Remove"
                                >
                                  &times;
                                </button>
                              </div>
                            ) : (
                              <select
                                className="form-input"
                                value=""
                                onChange={(e) => {
                                  const agent = agents.find((a) => a.id === e.target.value);
                                  if (agent) setEditCcAgent(agent);
                                }}
                                style={{ width: "100%", fontSize: 13 }}
                              >
                                <option value="">Select an agent...</option>
                                {agents.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name} ({a.email})
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              marginTop: 10,
                              justifyContent: "flex-end",
                            }}
                          >
                            <button
                              className="btn btn-secondary"
                              onClick={cancelEditing}
                              disabled={saving}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn btn-primary"
                              onClick={() => saveEdit(draft)}
                              disabled={saving}
                            >
                              {saving ? "Saving..." : "Save"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            background: "#111318",
                            border: "1px solid #2a2e3a",
                            borderRadius: 6,
                            padding: "12px 14px",
                            fontSize: 13,
                            lineHeight: 1.6,
                            color: "#e4e6ed",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            maxHeight: 400,
                            overflowY: "auto",
                          }}
                        >
                          {isSent
                            ? stripQuotedText(draft.sent_body_text ?? draft.body_text ?? "(empty)")
                            : (draft.body_text ?? "(empty)")}
                        </div>
                      )}
                    </div>

                    {/* Was changed indicator for sent drafts */}
                    {isSent && draft.was_changed && (
                      <div
                        style={{
                          marginBottom: 12,
                          padding: "8px 12px",
                          background: "#fbbf2411",
                          border: "1px solid #fbbf2433",
                          borderRadius: 6,
                          fontSize: 12,
                          color: "#fbbf24",
                        }}
                      >
                        The sent version was modified from the original AI draft.
                      </div>
                    )}

                    {/* Action buttons */}
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                        marginBottom: 16,
                      }}
                    >
                      {/* Edit button - only for non-sent, non-discarded, non-approved drafts, hidden when editing */}
                      {!isSent && draft.status !== "discarded" && !isApproved && !isEditing && (
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing(draft);
                          }}
                        >
                          Edit Draft
                        </button>
                      )}

                      {/* Generate New Draft button - only for non-sent, non-discarded, non-approved drafts, hidden when editing */}
                      {!isSent && draft.status !== "discarded" && !isApproved && !isEditing && (
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            regenerateDraft(draft.id);
                          }}
                          disabled={regeneratingId === draft.id}
                          style={{
                            color: "#4f8ff7",
                            borderColor: "#4f8ff744",
                          }}
                        >
                          {regeneratingId === draft.id ? "Generating..." : "Generate New Draft"}
                        </button>
                      )}

                      {/* Give Feedback button - only for non-sent, non-discarded drafts, hidden when editing */}
                      {!isSent && draft.status !== "discarded" && !isEditing && (
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFeedbackDraftId(
                              feedbackDraftId === draft.id ? null : draft.id
                            );
                          }}
                          style={{
                            color: "#fbbf24",
                            borderColor: "#fbbf2444",
                          }}
                        >
                          Give Feedback
                        </button>
                      )}

                      {/* Approve button - hidden when editing or already approved */}
                      {draft.status === "drafted" && !isApproved && !isEditing && (
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            approveDraft(draft.id);
                          }}
                          disabled={approvingId === draft.id}
                        >
                          {approvingId === draft.id ? "Approving..." : "Approve"}
                        </button>
                      )}

                      {/* Green Approved indicator */}
                      {isApproved && !isSent && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 14px",
                            borderRadius: 6,
                            fontSize: 13,
                            fontWeight: 600,
                            background: "#34d39922",
                            color: "#34d399",
                            border: "1px solid #34d39944",
                          }}
                        >
                          <span style={{ fontSize: 16 }}>&#10003;</span>
                          Approved
                        </span>
                      )}

                      {/* Discard button - hidden when editing or approved */}
                      {!isSent && draft.status !== "discarded" && !isApproved && !isEditing && (
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            discardDraft(draft.id);
                          }}
                          disabled={discardingId === draft.id}
                          style={{
                            color: "#f87171",
                            borderColor: "#f8717144",
                          }}
                        >
                          {discardingId === draft.id ? "Discarding..." : "Discard"}
                        </button>
                      )}

                      {/* Add to Training (sent only) */}
                      {isSent && (
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTrainingDraftId(
                              trainingDraftId === draft.id ? null : draft.id
                            );
                          }}
                        >
                          Add to Training
                        </button>
                      )}

                      {/* Agent Handoff Transfer (sent only, not already transferred, only when CC includes agent) */}
                      {isSent && !draft.agent_handoff_transferred && hasHandoffCc && handoffAgent && (
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerAgentHandoff(draft.id);
                          }}
                          disabled={handoffId === draft.id}
                          style={{
                            color: "#a78bfa",
                            borderColor: "#a78bfa44",
                          }}
                        >
                          {handoffId === draft.id
                            ? "Transferring..."
                            : `Transfer to ${handoffAgent.name} in Salesforce`}
                        </button>
                      )}

                      {/* Already transferred indicator */}
                      {isSent && draft.agent_handoff_transferred && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 14px",
                            borderRadius: 6,
                            fontSize: 13,
                            fontWeight: 600,
                            background: "#a78bfa22",
                            color: "#a78bfa",
                            border: "1px solid #a78bfa44",
                          }}
                        >
                          <span style={{ fontSize: 16 }}>&#10003;</span>
                          Handed Off
                        </span>
                      )}
                    </div>

                    {/* Approve result banner */}
                    {approveResult && expandedId === draft.id && (
                      <div
                        style={{
                          marginBottom: 12,
                          padding: "10px 14px",
                          background: approveResult.startsWith("Approved")
                            ? "#34d39922"
                            : "#f8717122",
                          border: `1px solid ${approveResult.startsWith("Approved") ? "#34d39944" : "#f8717144"}`,
                          borderRadius: 6,
                          fontSize: 13,
                          color: approveResult.startsWith("Approved")
                            ? "#34d399"
                            : "#f87171",
                        }}
                      >
                        {approveResult}
                      </div>
                    )}

                    {/* Agent handoff result banner */}
                    {handoffResult && expandedId === draft.id && (
                      <div
                        style={{
                          marginBottom: 12,
                          padding: "10px 14px",
                          background: handoffResult.includes("successfully")
                            ? "#a78bfa22"
                            : "#f8717122",
                          border: `1px solid ${handoffResult.includes("successfully") ? "#a78bfa44" : "#f8717144"}`,
                          borderRadius: 6,
                          fontSize: 13,
                          color: handoffResult.includes("successfully")
                            ? "#a78bfa"
                            : "#f87171",
                        }}
                      >
                        {handoffResult}
                      </div>
                    )}

                    {/* Give Feedback form */}
                    {feedbackDraftId === draft.id && (
                      <div
                        style={{
                          marginBottom: 16,
                          padding: "14px 16px",
                          background: "#111318",
                          border: "1px solid #2a2e3a",
                          borderRadius: 6,
                        }}
                      >
                        <label
                          className="text-sm"
                          style={{
                            display: "block",
                            fontWeight: 600,
                            marginBottom: 10,
                            color: "#e4e6ed",
                          }}
                        >
                          Give Feedback on Draft Quality
                        </label>
                        <p
                          className="text-muted text-sm"
                          style={{ marginBottom: 12 }}
                        >
                          Rate this draft and leave comments to help the AI improve future drafts.
                        </p>
                        <div className="form-group" style={{ marginBottom: 12 }}>
                          <label className="text-sm text-muted">Rating (1-5)</label>
                          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                className="btn btn-secondary"
                                onClick={() => setFeedbackRating(n)}
                                style={{
                                  padding: "4px 12px",
                                  fontSize: 14,
                                  fontWeight: 600,
                                  background:
                                    feedbackRating === n ? "#fbbf2433" : undefined,
                                  color:
                                    feedbackRating === n ? "#fbbf24" : undefined,
                                  borderColor:
                                    feedbackRating === n ? "#fbbf2466" : undefined,
                                }}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="form-group" style={{ marginBottom: 12 }}>
                          <label className="text-sm text-muted">
                            Notes (what should be different?)
                          </label>
                          <textarea
                            className="form-input"
                            value={feedbackNotes}
                            onChange={(e) => setFeedbackNotes(e.target.value)}
                            placeholder="e.g., Too formal, should mention pricing earlier, needs warmer tone..."
                            style={{
                              width: "100%",
                              minHeight: 80,
                              fontFamily: "inherit",
                              fontSize: 13,
                              resize: "vertical",
                            }}
                          />
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            justifyContent: "flex-end",
                          }}
                        >
                          <button
                            className="btn btn-secondary"
                            onClick={() => {
                              setFeedbackDraftId(null);
                              setFeedbackNotes("");
                              setFeedbackRating(3);
                            }}
                            disabled={submittingFeedback}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-primary"
                            onClick={() => submitFeedback(draft.id)}
                            disabled={submittingFeedback}
                            style={{
                              background: "#fbbf24",
                              borderColor: "#fbbf24",
                              color: "#111318",
                            }}
                          >
                            {submittingFeedback ? "Submitting..." : "Submit Feedback"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Add to training form */}
                    {trainingDraftId === draft.id && (
                      <div
                        style={{
                          marginBottom: 16,
                          padding: "14px 16px",
                          background: "#111318",
                          border: "1px solid #2a2e3a",
                          borderRadius: 6,
                        }}
                      >
                        <label
                          className="text-sm"
                          style={{
                            display: "block",
                            fontWeight: 600,
                            marginBottom: 10,
                            color: "#e4e6ed",
                          }}
                        >
                          Add to Training Data
                        </label>
                        <p
                          className="text-muted text-sm"
                          style={{ marginBottom: 12 }}
                        >
                          This will save the inbound email and the sent response as a training example.
                        </p>
                        <div className="form-group" style={{ marginBottom: 12 }}>
                          <label className="text-sm text-muted">Category</label>
                          <select
                            className="form-input"
                            value={trainingCategory}
                            onChange={(e) =>
                              setTrainingCategory(e.target.value as TrainingCategory)
                            }
                            style={{ width: "100%", fontSize: 13 }}
                          >
                            {CATEGORY_OPTIONS.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            justifyContent: "flex-end",
                          }}
                        >
                          <button
                            className="btn btn-secondary"
                            onClick={() => setTrainingDraftId(null)}
                            disabled={addingToTraining}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-primary"
                            onClick={() => addToTraining(draft.id)}
                            disabled={addingToTraining}
                          >
                            {addingToTraining ? "Adding..." : "Add to Training"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Conversation thread (newest on top from API) */}
                    {renderThreadMessages()}

                    {/* Minimal meta row - just created & sent times */}
                    <div
                      className="text-sm text-muted"
                      style={{
                        marginTop: 14,
                        display: "flex",
                        gap: 16,
                        flexWrap: "wrap",
                      }}
                    >
                      <span>
                        Created: {new Date(draft.created_at).toLocaleString()}
                      </span>
                      {draft.approved_at && (
                        <span>
                          Approved: {new Date(draft.approved_at).toLocaleString()}
                        </span>
                      )}
                      {draft.sent_at && (
                        <span>
                          Sent: {new Date(draft.sent_at).toLocaleString()}
                        </span>
                      )}
                      {draft.cc_emails.length > 0 && (
                        <span>CC: {draft.cc_emails.join(", ")}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
