"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ALL_TRAINING_CATEGORIES,
  TRAINING_CATEGORY_LABELS,
} from "@/lib/supabase/types";
import type { TrainingCategory, TrainingExample } from "@/lib/supabase/types";

const CATEGORY_COLORS: Record<TrainingCategory, string> = {
  initial_inquiry: "#4f8ff7",
  follow_up: "#34d399",
  scheduling: "#fbbf24",
  agent_handoff: "#f87171",
  pricing: "#a78bfa",
  objection: "#fb923c",
  general: "#8b8fa3",
};

interface EmailAccount {
  id: string;
  email_address: string;
  display_name: string | null;
}

interface FormState {
  email_address: string;
  category: TrainingCategory;
  inbound_email: string;
  ideal_response: string;
  context_notes: string;
}

const EMPTY_FORM: FormState = {
  email_address: "",
  category: "general",
  inbound_email: "",
  ideal_response: "",
  context_notes: "",
};

export default function TrainingDataPage() {
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [examples, setExamples] = useState<TrainingExample[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterEmail, setFilterEmail] = useState<string>("");
  const [filterCategories, setFilterCategories] = useState<TrainingCategory[]>(
    []
  );

  // Form / modal
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // Add email modal
  const [showAddEmail, setShowAddEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newEmailName, setNewEmailName] = useState("");
  const [addingEmail, setAddingEmail] = useState(false);

  // Expanded cards
  const [expandedInbound, setExpandedInbound] = useState<Set<string>>(
    new Set()
  );
  const [expandedResponse, setExpandedResponse] = useState<Set<string>>(
    new Set()
  );

  const fetchEmailAccounts = useCallback(() => {
    fetch("/api/internal/email-hub/accounts")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setEmailAccounts(data);
        }
      });
  }, []);

  const fetchExamples = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterEmail) params.set("email_address", filterEmail);
    if (filterCategories.length === 1)
      params.set("category", filterCategories[0]);
    const qs = params.toString();
    fetch(`/api/internal/email-hub/training${qs ? `?${qs}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          // Client-side filter if multiple categories selected
          if (filterCategories.length > 1) {
            setExamples(
              data.filter((e: TrainingExample) =>
                filterCategories.includes(e.category)
              )
            );
          } else {
            setExamples(data);
          }
        }
      })
      .finally(() => setLoading(false));
  }, [filterEmail, filterCategories]);

  useEffect(() => {
    fetchEmailAccounts();
  }, [fetchEmailAccounts]);

  useEffect(() => {
    fetchExamples();
  }, [fetchExamples]);

  function toggleCategory(cat: TrainingCategory) {
    setFilterCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  function openAddForm() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function openEditForm(example: TrainingExample) {
    setEditingId(example.id);
    setForm({
      email_address: example.email_address ?? "",
      category: example.category,
      inbound_email: example.inbound_email,
      ideal_response: example.ideal_response,
      context_notes: example.context_notes ?? "",
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  }

  async function handleSave() {
    if (!form.inbound_email.trim() || !form.ideal_response.trim()) {
      alert("Inbound email and ideal response are required.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        email_address: form.email_address || null,
        category: form.category,
        inbound_email: form.inbound_email,
        ideal_response: form.ideal_response,
        context_notes: form.context_notes || null,
      };

      if (editingId) {
        const res = await fetch(
          `/api/internal/email-hub/training/${editingId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to update");
        }
      } else {
        const res = await fetch("/api/internal/email-hub/training", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create");
        }
      }

      closeForm();
      fetchExamples();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this training example?")) return;
    try {
      const res = await fetch(`/api/internal/email-hub/training/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete");
      }
      fetchExamples();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleAddEmail() {
    if (!newEmail.includes("@")) {
      alert("Please enter a valid email address.");
      return;
    }
    setAddingEmail(true);
    try {
      const res = await fetch("/api/internal/email-hub/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_address: newEmail.trim().toLowerCase(),
          display_name: newEmailName.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add email");
      setShowAddEmail(false);
      setNewEmail("");
      setNewEmailName("");
      fetchEmailAccounts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to add email");
    } finally {
      setAddingEmail(false);
    }
  }

  function toggleExpand(
    set: Set<string>,
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string
  ) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  function truncate(text: string, max: number) {
    if (text.length <= max) return text;
    return text.slice(0, max) + "...";
  }

  function emailLabel(emailAddress: string | null): string {
    if (!emailAddress) return "All Emails";
    return emailAddress;
  }

  return (
    <>
      <div className="page-header">
        <h2>Training Data</h2>
        <p>
          Upload email examples to teach the AI how Lynn responds to different
          types of inquiries.
        </p>
      </div>

      {/* Top bar: filters + add button */}
      <div
        className="card"
        style={{ marginBottom: 20, padding: "16px 20px" }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 16,
          }}
        >
          {/* Email filter */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label
              className="text-sm"
              style={{ color: "#8b8fa3", whiteSpace: "nowrap" }}
            >
              Email:
            </label>
            <select
              className="form-input"
              value={filterEmail}
              onChange={(e) => setFilterEmail(e.target.value)}
              style={{ minWidth: 220 }}
            >
              <option value="">All Emails</option>
              {emailAccounts.map((acct) => (
                <option key={acct.id} value={acct.email_address}>
                  {acct.email_address}
                </option>
              ))}
            </select>
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Add email button */}
          <button
            className="btn btn-secondary"
            onClick={() => setShowAddEmail(true)}
            style={{ fontSize: 12 }}
          >
            + Add Email
          </button>

          {/* Add example button */}
          <button className="btn btn-primary" onClick={openAddForm}>
            + Add Example
          </button>
        </div>

        {/* Category pills */}
        <div style={{ marginTop: 12 }}>
          <PillSelector
            items={ALL_TRAINING_CATEGORIES.map((cat) => ({
              key: cat,
              label: TRAINING_CATEGORY_LABELS[cat],
            }))}
            selected={filterCategories}
            onToggle={(key) => toggleCategory(key as TrainingCategory)}
          />
        </div>
      </div>

      {/* Add Email modal */}
      {showAddEmail && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAddEmail(false);
              setNewEmail("");
              setNewEmailName("");
            }
          }}
        >
          <div
            className="card"
            style={{ width: "100%", maxWidth: 450 }}
          >
            <div className="card-header">
              <h3>Add Email Address</h3>
            </div>
            <div className="form-group">
              <label>Email Address</label>
              <input
                className="form-input"
                type="email"
                placeholder="lynn@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>
                Display Name{" "}
                <span className="text-muted text-sm">(optional)</span>
              </label>
              <input
                className="form-input"
                type="text"
                placeholder="Lynn Brown - Community Name"
                value={newEmailName}
                onChange={(e) => setNewEmailName(e.target.value)}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 12,
              }}
            >
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowAddEmail(false);
                  setNewEmail("");
                  setNewEmailName("");
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleAddEmail}
                disabled={addingEmail || !newEmail.includes("@")}
              >
                {addingEmail ? "Adding..." : "Add Email"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form modal overlay */}
      {showForm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeForm();
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: 700,
              maxHeight: "90vh",
              overflow: "auto",
            }}
          >
            <div className="card-header">
              <h3>{editingId ? "Edit Training Example" : "Add Training Example"}</h3>
            </div>

            <div className="form-group">
              <label>Email</label>
              <select
                className="form-input"
                value={form.email_address}
                onChange={(e) =>
                  setForm({ ...form, email_address: e.target.value })
                }
              >
                <option value="">All Emails (global)</option>
                {emailAccounts.map((acct) => (
                  <option key={acct.id} value={acct.email_address}>
                    {acct.email_address}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Category</label>
              <select
                className="form-input"
                value={form.category}
                onChange={(e) =>
                  setForm({
                    ...form,
                    category: e.target.value as TrainingCategory,
                  })
                }
              >
                {ALL_TRAINING_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {TRAINING_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Inbound Email</label>
              <textarea
                className="form-input"
                rows={6}
                value={form.inbound_email}
                onChange={(e) =>
                  setForm({ ...form, inbound_email: e.target.value })
                }
                placeholder="Paste the incoming email text here..."
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
            </div>

            <div className="form-group">
              <label>Ideal Response</label>
              <textarea
                className="form-input"
                rows={6}
                value={form.ideal_response}
                onChange={(e) =>
                  setForm({ ...form, ideal_response: e.target.value })
                }
                placeholder="Paste Lynn's ideal response here..."
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
            </div>

            <div className="form-group">
              <label>
                Context Notes{" "}
                <span className="text-muted text-sm">(optional)</span>
              </label>
              <textarea
                className="form-input"
                rows={3}
                value={form.context_notes}
                onChange={(e) =>
                  setForm({ ...form, context_notes: e.target.value })
                }
                placeholder="Any additional context about this example..."
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 12,
              }}
            >
              <button className="btn btn-secondary" onClick={closeForm}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Update Example"
                    : "Save Example"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Examples list */}
      {loading ? (
        <div className="card">
          <div className="empty-state">
            <p className="text-muted">Loading training examples...</p>
          </div>
        </div>
      ) : examples.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">&#128218;</div>
            <h3>No training examples yet</h3>
            <p>
              Add email examples to teach the AI how Lynn responds to different
              types of inquiries.
            </p>
            <button
              className="btn btn-primary"
              onClick={openAddForm}
              style={{ marginTop: 12 }}
            >
              + Add First Example
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="text-muted text-sm">
            {examples.length} example{examples.length !== 1 ? "s" : ""}
          </p>
          {examples.map((ex) => {
            const catColor = CATEGORY_COLORS[ex.category] || "#8b8fa3";
            const inboundExpanded = expandedInbound.has(ex.id);
            const responseExpanded = expandedResponse.has(ex.id);

            return (
              <div className="card" key={ex.id} style={{ padding: "16px 20px" }}>
                {/* Card top row: badge, email, actions */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
                  {/* Category badge */}
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: 20,
                      fontSize: 11,
                      fontWeight: 600,
                      background: `${catColor}22`,
                      color: catColor,
                      border: `1px solid ${catColor}44`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {TRAINING_CATEGORY_LABELS[ex.category]}
                  </span>

                  {/* Email address */}
                  <span className="text-muted text-sm">
                    {emailLabel(ex.email_address)}
                  </span>

                  {/* Spacer */}
                  <div style={{ flex: 1 }} />

                  {/* Actions */}
                  <button
                    className="btn btn-secondary"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={() => openEditForm(ex)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{
                      padding: "4px 10px",
                      fontSize: 12,
                      color: "#f87171",
                      borderColor: "#f8717133",
                    }}
                    onClick={() => handleDelete(ex.id)}
                  >
                    Delete
                  </button>
                </div>

                {/* Inbound email */}
                <div style={{ marginBottom: 10 }}>
                  <div
                    className="text-sm"
                    style={{
                      color: "#8b8fa3",
                      marginBottom: 4,
                      fontWeight: 600,
                    }}
                  >
                    Inbound Email
                  </div>
                  <div
                    style={{
                      background: "#111318",
                      borderRadius: 6,
                      padding: "10px 12px",
                      fontSize: 13,
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      color: "#e4e6ed",
                    }}
                  >
                    {inboundExpanded
                      ? ex.inbound_email
                      : truncate(ex.inbound_email, 150)}
                    {ex.inbound_email.length > 150 && (
                      <button
                        onClick={() =>
                          toggleExpand(
                            expandedInbound,
                            setExpandedInbound,
                            ex.id
                          )
                        }
                        style={{
                          background: "none",
                          border: "none",
                          color: "#4f8ff7",
                          cursor: "pointer",
                          fontSize: 12,
                          marginLeft: 4,
                          padding: 0,
                        }}
                      >
                        {inboundExpanded ? "Show less" : "Show more"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Ideal response */}
                <div style={{ marginBottom: ex.context_notes ? 10 : 0 }}>
                  <div
                    className="text-sm"
                    style={{
                      color: "#8b8fa3",
                      marginBottom: 4,
                      fontWeight: 600,
                    }}
                  >
                    Ideal Response
                  </div>
                  <div
                    style={{
                      background: "#111318",
                      borderRadius: 6,
                      padding: "10px 12px",
                      fontSize: 13,
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      color: "#e4e6ed",
                    }}
                  >
                    {responseExpanded
                      ? ex.ideal_response
                      : truncate(ex.ideal_response, 150)}
                    {ex.ideal_response.length > 150 && (
                      <button
                        onClick={() =>
                          toggleExpand(
                            expandedResponse,
                            setExpandedResponse,
                            ex.id
                          )
                        }
                        style={{
                          background: "none",
                          border: "none",
                          color: "#4f8ff7",
                          cursor: "pointer",
                          fontSize: 12,
                          marginLeft: 4,
                          padding: 0,
                        }}
                      >
                        {responseExpanded ? "Show less" : "Show more"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Context notes */}
                {ex.context_notes && (
                  <div>
                    <div
                      className="text-sm"
                      style={{
                        color: "#8b8fa3",
                        marginBottom: 4,
                        fontWeight: 600,
                      }}
                    >
                      Context Notes
                    </div>
                    <div
                      className="text-sm"
                      style={{
                        color: "#e4e6ed",
                        opacity: 0.8,
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {ex.context_notes}
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

function PillSelector({
  items,
  selected,
  onToggle,
  color = "#34d399",
}: {
  items: { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {items.map((item) => {
        const sel = selected.includes(item.key);
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onToggle(item.key)}
            style={{
              padding: "5px 12px",
              borderRadius: 20,
              border: "2px solid",
              borderColor: sel ? color : "#2a2e3a",
              background: sel ? `${color}22` : "transparent",
              color: sel ? color : "#8b8fa3",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: sel ? 600 : 400,
            }}
          >
            {sel ? "\u2713 " : ""}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
