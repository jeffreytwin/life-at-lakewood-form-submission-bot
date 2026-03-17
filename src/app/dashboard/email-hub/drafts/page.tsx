"use client";

import { useEffect, useState, useCallback } from "react";

type EmailDraftStatus = "drafted" | "edited" | "sent" | "discarded";
type TrainingCategory =
  | "initial_inquiry"
  | "follow_up"
  | "scheduling"
  | "agent_handoff"
  | "pricing"
  | "objection"
  | "general";

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
  model_used: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  is_simulation: boolean;
  simulation_input: Record<string, unknown> | null;
  sent_body_text: string | null;
  was_changed: boolean;
  created_at: string;
  edited_at: string | null;
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

const STATUS_OPTIONS: { key: EmailDraftStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "drafted", label: "Drafted" },
  { key: "edited", label: "Edited" },
  { key: "sent", label: "Sent" },
  { key: "discarded", label: "Discarded" },
];

const STATUS_COLORS: Record<EmailDraftStatus, string> = {
  drafted: "#4f8ff7",
  edited: "#fbbf24",
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

export default function EmailDraftsPage() {
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<EmailDraftStatus | "all">("all");
  const [showSimulations] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Thread messages for the expanded draft
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  // Feedback state
  const [feedbackDraftId, setFeedbackDraftId] = useState<string | null>(null);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  // Approve state
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveResult, setApproveResult] = useState<string | null>(null);

  // Add to training state
  const [trainingDraftId, setTrainingDraftId] = useState<string | null>(null);
  const [trainingCategory, setTrainingCategory] = useState<TrainingCategory>("general");
  const [addingToTraining, setAddingToTraining] = useState(false);

  const fetchDrafts = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    params.set("is_simulation", String(showSimulations));
    params.set("limit", "50");

    fetch(`/api/internal/email-hub/drafts?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setDrafts(data);
        } else {
          setError(data.error ?? "Failed to load drafts");
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [statusFilter, showSimulations]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

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
      setFeedbackDraftId(null);
      setThreadMessages([]);
      setTrainingDraftId(null);
    } else {
      setExpandedId(id);
      setEditingId(null);
      setFeedbackDraftId(null);
      setTrainingDraftId(null);
      loadThreadMessages(id);
    }
  }

  function startEditing(draft: EmailDraft) {
    setEditingId(draft.id);
    setEditText(draft.body_text ?? "");
  }

  function cancelEditing() {
    setEditingId(null);
    setEditText("");
  }

  async function saveEdit(draft: EmailDraft) {
    setSaving(true);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body_text: editText,
          status: "edited" as EmailDraftStatus,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save");
      }
      setEditingId(null);
      setEditText("");
      fetchDrafts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function startFeedback(draftId: string) {
    setFeedbackDraftId(draftId);
    setFeedbackRating(0);
    setFeedbackNotes("");
  }

  async function submitFeedback(draftId: string) {
    if (feedbackRating < 1 || feedbackRating > 5) {
      alert("Please select a rating from 1 to 5.");
      return;
    }
    setSubmittingFeedback(true);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: feedbackRating,
          feedback_notes: feedbackNotes || null,
          edited_version: editingId === draftId ? editText : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to submit feedback");
      }
      setFeedbackDraftId(null);
      setFeedbackRating(0);
      setFeedbackNotes("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Feedback submission failed");
    } finally {
      setSubmittingFeedback(false);
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
      if (data.sms_sent) {
        const successCount = data.results.filter(
          (r: { success: boolean }) => r.success
        ).length;
        setApproveResult(
          `Approved! SMS sent to ${successCount} agent${successCount !== 1 ? "s" : ""}.`
        );
      } else {
        setApproveResult(data.message ?? "Approved (no SMS recipients configured).");
      }
      fetchDrafts();
    } catch (e) {
      setApproveResult(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setApprovingId(null);
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

  const filteredDrafts = drafts;

  return (
    <>
      <div className="page-header">
        <h2>Email Drafts</h2>
        <p>Review, edit, and provide feedback on AI-generated email drafts.</p>
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
              {statusFilter !== "all"
                ? `No drafts with status "${statusFilter}". Try changing the filter.`
                : "AI-generated email drafts will appear here once the system processes inbound emails."}
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredDrafts.map((draft) => {
            const isExpanded = expandedId === draft.id;
            const isEditing = editingId === draft.id;
            const isFeedback = feedbackDraftId === draft.id;
            const statusColor = STATUS_COLORS[draft.status];
            const tokenCount =
              (draft.prompt_tokens ?? 0) + (draft.completion_tokens ?? 0);

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
                    {draft.status}
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

                  {/* Meta info */}
                  <span className="text-muted text-sm" style={{ flexShrink: 0 }}>
                    {formatRelativeDate(draft.created_at)}
                  </span>

                  {draft.model_used && (
                    <span
                      className="text-sm font-mono"
                      style={{
                        color: "#8b8fa3",
                        flexShrink: 0,
                      }}
                    >
                      {draft.model_used}
                    </span>
                  )}

                  {tokenCount > 0 && (
                    <span
                      className="text-sm font-mono"
                      style={{
                        color: "#8b8fa3",
                        flexShrink: 0,
                      }}
                    >
                      {tokenCount.toLocaleString()} tok
                    </span>
                  )}
                </div>

                {/* Expanded view */}
                {isExpanded && (
                  <div
                    style={{
                      borderTop: "1px solid #2a2e3a",
                      padding: "16px",
                    }}
                  >
                    {/* Thread messages */}
                    {loadingThread ? (
                      <div style={{ marginBottom: 16 }}>
                        <p className="text-muted text-sm">Loading conversation...</p>
                      </div>
                    ) : threadMessages.length > 0 ? (
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
                    ) : null}

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

                    {/* Draft body */}
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
                        {draft.status === "sent" ? "Sent Response" : "Draft Body"}
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
                          {draft.status === "sent"
                            ? (draft.sent_body_text ?? draft.body_text ?? "(empty)")
                            : (draft.body_text ?? "(empty)")}
                        </div>
                      )}
                    </div>

                    {/* Was changed indicator for sent drafts */}
                    {draft.status === "sent" && draft.was_changed && (
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
                      }}
                    >
                      {draft.status !== "sent" && !isEditing && (
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
                      {(draft.status === "drafted" || draft.status === "edited") && (
                        <button
                          className="btn btn-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            approveDraft(draft.id);
                          }}
                          disabled={approvingId === draft.id}
                          style={{
                            background: "#34d399",
                            borderColor: "#34d399",
                            color: "#111318",
                            fontWeight: 600,
                          }}
                        >
                          {approvingId === draft.id ? "Approving..." : "Approve"}
                        </button>
                      )}
                      {draft.status === "sent" && (
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
                      {!isFeedback && (
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            startFeedback(draft.id);
                          }}
                        >
                          Give Feedback
                        </button>
                      )}
                    </div>

                    {/* Approve result banner */}
                    {approveResult && expandedId === draft.id && (
                      <div
                        style={{
                          marginTop: 12,
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

                    {/* Add to training form */}
                    {trainingDraftId === draft.id && (
                      <div
                        style={{
                          marginTop: 16,
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

                    {/* Inline feedback form */}
                    {isFeedback && (
                      <div
                        style={{
                          marginTop: 16,
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
                          Rate this draft
                        </label>

                        {/* Star rating */}
                        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onClick={() => setFeedbackRating(star)}
                              style={{
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                fontSize: 24,
                                color:
                                  star <= feedbackRating ? "#fbbf24" : "#2a2e3a",
                                padding: "0 2px",
                                transition: "color 0.15s",
                              }}
                            >
                              &#9733;
                            </button>
                          ))}
                          {feedbackRating > 0 && (
                            <span
                              className="text-muted text-sm"
                              style={{ marginLeft: 8, alignSelf: "center" }}
                            >
                              {feedbackRating}/5
                            </span>
                          )}
                        </div>

                        {/* Notes */}
                        <div className="form-group" style={{ marginBottom: 12 }}>
                          <label className="text-sm text-muted">
                            Notes (optional)
                          </label>
                          <textarea
                            className="form-input"
                            value={feedbackNotes}
                            onChange={(e) => setFeedbackNotes(e.target.value)}
                            placeholder="What could be improved?"
                            rows={3}
                            style={{
                              width: "100%",
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
                            onClick={() => setFeedbackDraftId(null)}
                            disabled={submittingFeedback}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-primary"
                            onClick={() => submitFeedback(draft.id)}
                            disabled={submittingFeedback || feedbackRating < 1}
                          >
                            {submittingFeedback ? "Submitting..." : "Submit Feedback"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Meta details row */}
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
                        ID:{" "}
                        <span className="font-mono">{draft.id.slice(0, 8)}...</span>
                      </span>
                      {draft.thread_id && (
                        <span>
                          Thread:{" "}
                          <span className="font-mono">
                            {draft.thread_id.slice(0, 8)}...
                          </span>
                        </span>
                      )}
                      <span>
                        Created: {new Date(draft.created_at).toLocaleString()}
                      </span>
                      {draft.edited_at && (
                        <span>
                          Edited: {new Date(draft.edited_at).toLocaleString()}
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
