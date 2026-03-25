"use client";

import { useState, useEffect, useCallback } from "react";
import type { Location } from "@/lib/supabase/types";

interface DraftResponse {
  draft_id: string;
  body_text: string;
  model_used: string;
  prompt_tokens: number;
  completion_tokens: number;
}

export default function EmailSimulatePage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [senderName, setSenderName] = useState("");
  const [budget, setBudget] = useState("");
  const [timeline, setTimeline] = useState("");
  const [interests, setInterests] = useState("");
  const [inboundEmail, setInboundEmail] = useState("");

  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [error, setError] = useState("");

  // Feedback state
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [editedVersion, setEditedVersion] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const fetchLocations = useCallback(() => {
    fetch("/api/internal/locations")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const active = data.filter((l: Location) => l.is_active);
          setLocations(active);
          if (active.length > 0 && !locationId) {
            setLocationId(active[0].id);
          }
        }
      });
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const selectedLocation = locations.find((l) => l.id === locationId);

  async function generateDraft() {
    setRunning(true);
    setDraft(null);
    setError("");
    setRating(0);
    setHoverRating(0);
    setFeedbackNotes("");
    setEditedVersion("");
    setFeedbackSubmitted(false);

    try {
      const res = await fetch("/api/internal/email-hub/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location_id: locationId,
          location_name: selectedLocation?.name ?? "",
          inbound_email: inboundEmail,
          sender_name: senderName,
          lead_info: {
            name: senderName,
            budget,
            timeline,
            interests,
            message: inboundEmail,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Simulation failed");
      setDraft(data);
      setEditedVersion(data.body_text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Simulation failed";
      setError(msg);
      alert(msg);
    } finally {
      setRunning(false);
    }
  }

  async function submitFeedback() {
    if (!draft || rating === 0) return;
    setSubmittingFeedback(true);

    try {
      const res = await fetch(
        `/api/internal/email-hub/drafts/${draft.draft_id}/feedback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating,
            feedback_notes: feedbackNotes,
            edited_version:
              editedVersion !== draft.body_text ? editedVersion : undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit feedback");
      setFeedbackSubmitted(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to submit feedback");
    } finally {
      setSubmittingFeedback(false);
    }
  }

  const canGenerate =
    locationId && inboundEmail.trim().length > 0 && senderName.trim().length > 0;

  return (
    <>
      <div className="page-header">
        <h2>Simulate Email</h2>
        <p>
          Test AI-generated email responses without connecting to real inboxes.
          Compose a mock inbound email and see how the AI responds.
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: "12px 16px",
            marginBottom: 16,
            background: "rgba(248, 113, 113, 0.1)",
            border: "1px solid rgba(248, 113, 113, 0.3)",
            borderRadius: 8,
            color: "#f87171",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div className="grid-2">
        {/* Left: Compose */}
        <div className="card">
          <div className="card-header">
            <h3>Compose Mock Email</h3>
          </div>

          <div className="form-group">
            <label>Location</label>
            <select
              className="form-input"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Sender Name</label>
            <input
              className="form-input"
              type="text"
              placeholder="John Smith"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: "block",
                marginBottom: 8,
                fontSize: 13,
                fontWeight: 600,
                color: "#e4e6ed",
              }}
            >
              Lead Info
            </label>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "12px",
                background: "rgba(79, 143, 247, 0.05)",
                borderRadius: 8,
                border: "1px solid rgba(79, 143, 247, 0.1)",
              }}
            >
              <div className="form-group" style={{ margin: 0 }}>
                <label className="text-sm">Budget</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="$500,000 - $750,000"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="text-sm">Timeline</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Next 3-6 months"
                  value={timeline}
                  onChange={(e) => setTimeline(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="text-sm">Interests</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Waterfront, golf course, gated community"
                  value={interests}
                  onChange={(e) => setInterests(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="form-group">
            <label>Inbound Email</label>
            <textarea
              className="form-input"
              rows={8}
              placeholder="Type the email from the prospective buyer..."
              value={inboundEmail}
              onChange={(e) => setInboundEmail(e.target.value)}
              style={{ resize: "vertical" }}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary"
              onClick={generateDraft}
              disabled={running || !canGenerate}
              style={{
                width: "100%",
                justifyContent: "center",
                padding: "12px 16px",
              }}
            >
              {running ? "Generating..." : "Generate Draft"}
            </button>
          </div>

          <p
            className="text-muted"
            style={{ fontSize: 11, marginTop: 12, textAlign: "center" }}
          >
            No emails sent. AI draft only. Safe for production.
          </p>
        </div>

        {/* Right: Result */}
        <div>
          {!draft ? (
            <div className="card">
              <div className="empty-state">
                <img
                  src="/otocon-email-simulation.gif"
                  alt="Otocon"
                  style={{
                    width: 230,
                    height: "auto",
                    imageRendering: "pixelated",
                  }}
                />
                <h3>Ready to simulate</h3>
                <p>
                  Compose a mock inbound email and generate an AI draft
                  response. No real emails will be sent.
                </p>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-header">
                <h3>AI-Generated Draft</h3>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    className="text-sm"
                    style={{
                      padding: "2px 8px",
                      background: "rgba(79, 143, 247, 0.15)",
                      borderRadius: 4,
                      color: "#4f8ff7",
                    }}
                  >
                    {draft.model_used}
                  </span>
                  <span className="text-muted text-sm font-mono">
                    {draft.prompt_tokens} prompt + {draft.completion_tokens}{" "}
                    completion tokens
                  </span>
                </div>
              </div>

              {/* Draft body */}
              <div
                style={{
                  padding: 16,
                  background: "#111318",
                  borderRadius: 8,
                  marginBottom: 20,
                  whiteSpace: "pre-wrap",
                  fontSize: 13,
                  lineHeight: 1.7,
                  color: "#e4e6ed",
                  border: "1px solid #2a2e3a",
                }}
              >
                {draft.body_text}
              </div>

              {/* Rating */}
              {!feedbackSubmitted ? (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#e4e6ed",
                      }}
                    >
                      Rate this draft
                    </label>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRating(star)}
                          onMouseEnter={() => setHoverRating(star)}
                          onMouseLeave={() => setHoverRating(0)}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontSize: 28,
                            color:
                              star <= (hoverRating || rating)
                                ? "#fbbf24"
                                : "#2a2e3a",
                            padding: "2px 4px",
                            transition: "color 0.15s",
                          }}
                        >
                          &#9733;
                        </button>
                      ))}
                      {rating > 0 && (
                        <span
                          className="text-muted text-sm"
                          style={{ alignSelf: "center", marginLeft: 8 }}
                        >
                          {rating}/5
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Feedback Notes</label>
                    <textarea
                      className="form-input"
                      rows={3}
                      placeholder="Optional notes about the draft quality..."
                      value={feedbackNotes}
                      onChange={(e) => setFeedbackNotes(e.target.value)}
                      style={{ resize: "vertical" }}
                    />
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <button
                      className="btn btn-primary"
                      onClick={submitFeedback}
                      disabled={submittingFeedback || rating === 0}
                      style={{
                        width: "100%",
                        justifyContent: "center",
                        padding: "12px 16px",
                      }}
                    >
                      {submittingFeedback
                        ? "Submitting..."
                        : "Submit Feedback"}
                    </button>
                  </div>
                </>
              ) : (
                <div
                  style={{
                    padding: "16px",
                    background: "rgba(52, 211, 153, 0.1)",
                    border: "1px solid rgba(52, 211, 153, 0.3)",
                    borderRadius: 8,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 20, marginBottom: 4 }}>&#10003;</div>
                  <div
                    style={{
                      fontWeight: 600,
                      color: "#34d399",
                      fontSize: 14,
                    }}
                  >
                    Feedback submitted
                  </div>
                  <p
                    className="text-muted text-sm"
                    style={{ margin: "4px 0 0" }}
                  >
                    Rating: {rating}/5
                    {feedbackNotes && " | Notes recorded"}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
