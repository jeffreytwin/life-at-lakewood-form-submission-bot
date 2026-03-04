"use client";

import { useEffect, useState, useCallback } from "react";
import type { Agent, Location, ScoringFactorKey, PriceRange } from "@/lib/supabase/types";
import {
  DEFAULT_SCORING_PRIORITY,
  RANK_WEIGHTS,
  PRICE_RANGE_LABELS,
  ALL_PRICE_RANGES,
} from "@/lib/supabase/types";

const FACTOR_LABELS: Record<ScoringFactorKey, { label: string; desc: string }> = {
  close_rate: {
    label: "Close Rate",
    desc: "Agent's blended close rate performance",
  },
  lead_load: {
    label: "Lead Load",
    desc: "Monthly lead count relative to goal range",
  },
  availability: {
    label: "Availability",
    desc: "Whether agent is within working hours",
  },
};

type AgentForm = {
  name: string;
  phone: string;
  email: string;
  salesforce_user_id: string;
  is_frontlines: boolean;
  is_active: boolean;
  location_specialties: string[];
  monthly_lead_goal_min: number;
  monthly_lead_goal_max: number;
  availability_windows: Agent["availability_windows"];
  scoring_priority: ScoringFactorKey[];
  price_ranges: PriceRange[];
};

const emptyAgent: AgentForm = {
  name: "",
  phone: "",
  email: "",
  salesforce_user_id: "",
  is_frontlines: false,
  is_active: true,
  location_specialties: [],
  monthly_lead_goal_min: 5,
  monthly_lead_goal_max: 15,
  availability_windows: null,
  scoring_priority: [...DEFAULT_SCORING_PRIORITY],
  price_ranges: [...ALL_PRICE_RANGES],
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form, setForm] = useState(emptyAgent);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const fetchData = useCallback(() => {
    Promise.all([
      fetch("/api/internal/agents").then((r) => r.json()),
      fetch("/api/internal/locations").then((r) => r.json()),
    ])
      .then(([agentsData, locationsData]) => {
        if (Array.isArray(agentsData)) setAgents(agentsData);
        else setError(agentsData.error ?? "Failed to load agents");
        if (Array.isArray(locationsData)) setLocations(locationsData);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isFrontlines = editing?.is_frontlines ?? form.is_frontlines;

  function openAdd() {
    setEditing(null);
    setForm(emptyAgent);
    setShowModal(true);
  }

  function openEdit(agent: Agent) {
    setEditing(agent);
    setForm({
      name: agent.name,
      phone: agent.phone,
      email: agent.email ?? "",
      salesforce_user_id: agent.salesforce_user_id ?? "",
      is_frontlines: agent.is_frontlines,
      is_active: agent.is_active,
      location_specialties: agent.location_specialties,
      monthly_lead_goal_min: agent.monthly_lead_goal_min,
      monthly_lead_goal_max: agent.monthly_lead_goal_max,
      availability_windows: agent.availability_windows,
      scoring_priority: agent.scoring_priority ?? [...DEFAULT_SCORING_PRIORITY],
      price_ranges: agent.price_ranges ?? [...ALL_PRICE_RANGES],
    });
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true);
    const payload = {
      ...form,
      email: form.email || null,
      salesforce_user_id: form.salesforce_user_id || null,
    };

    try {
      if (editing) {
        const res = await fetch("/api/internal/agents", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editing.id, ...payload }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
      } else {
        const res = await fetch("/api/internal/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json()).error);
      }
      setShowModal(false);
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleLocation(locName: string) {
    setForm((prev) => {
      const has = prev.location_specialties.includes(locName);
      return {
        ...prev,
        location_specialties: has
          ? prev.location_specialties.filter((l) => l !== locName)
          : [...prev.location_specialties, locName],
      };
    });
  }

  function togglePriceRange(range: PriceRange) {
    setForm((prev) => {
      const has = prev.price_ranges.includes(range);
      return {
        ...prev,
        price_ranges: has
          ? prev.price_ranges.filter((r) => r !== range)
          : [...prev.price_ranges, range],
      };
    });
  }

  function movePriority(fromIndex: number, toIndex: number) {
    setForm((prev) => {
      const newPriority = [...prev.scoring_priority];
      const [moved] = newPriority.splice(fromIndex, 1);
      newPriority.splice(toIndex, 0, moved);
      return { ...prev, scoring_priority: newPriority };
    });
  }

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h2>Agents</h2>
          <p>Loading...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>Agents</h2>
        <p>Manage sales agents, locations, and scoring priorities</p>
      </div>

      {error ? (
        <div className="card">
          <div className="empty-state">
            <h3>Error</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <h3>{agents.length} agents</h3>
            <button className="btn btn-primary" onClick={openAdd}>
              + Add Agent
            </button>
          </div>
          {agents.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">&#9786;</div>
              <h3>No agents yet</h3>
              <p>Add your first sales agent to get started.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Locations</th>
                    <th>Price Ranges</th>
                    <th>Close Rate (12m)</th>
                    <th>Lead Goal</th>
                    <th>Role</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.id}>
                      <td>
                        <span
                          className={`status-dot ${agent.is_active ? "active" : "inactive"}`}
                        />
                        {agent.is_active ? "Active" : "Inactive"}
                      </td>
                      <td style={{ fontWeight: 600 }}>{agent.name}</td>
                      <td className="font-mono text-sm">{agent.phone}</td>
                      <td className="text-sm">
                        {agent.location_specialties.length > 0
                          ? agent.location_specialties.join(", ")
                          : "All"}
                      </td>
                      <td className="text-sm">
                        {!agent.price_ranges || agent.price_ranges.length === 0
                          ? "All"
                          : agent.price_ranges
                              .map((r) => PRICE_RANGE_LABELS[r])
                              .join(", ")}
                      </td>
                      <td className="font-mono">
                        {agent.is_frontlines
                          ? "-"
                          : `${(agent.close_rate_trailing_12m * 100).toFixed(1)}%`}
                      </td>
                      <td className="font-mono">
                        {agent.is_frontlines
                          ? "-"
                          : `${agent.monthly_lead_goal_min}-${agent.monthly_lead_goal_max}`}
                      </td>
                      <td>
                        {agent.is_frontlines ? (
                          <span className="badge badge-info">Frontlines</span>
                        ) : (
                          "Agent"
                        )}
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => openEdit(agent)}
                        >
                          {agent.is_frontlines ? "View" : "Edit"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {isFrontlines
                ? "Frontlines Agent"
                : editing
                  ? "Edit Agent"
                  : "Add Agent"}
            </h3>

            {isFrontlines && (
              <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
                The frontlines agent receives manual fallback notifications.
                Scoring configuration does not apply.
              </p>
            )}

            <div className="form-row">
              <div className="form-group">
                <label>Name *</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="John Smith"
                  readOnly={isFrontlines}
                />
              </div>
              <div className="form-group">
                <label>Phone *</label>
                <input
                  className="form-input"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+19415551234"
                  readOnly={isFrontlines}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Email</label>
                <input
                  className="form-input"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="agent@example.com"
                  readOnly={isFrontlines}
                />
              </div>
              <div className="form-group">
                <label>Salesforce User ID</label>
                <input
                  className="form-input"
                  value={form.salesforce_user_id}
                  onChange={(e) =>
                    setForm({ ...form, salesforce_user_id: e.target.value })
                  }
                  readOnly={isFrontlines}
                />
              </div>
            </div>

            {/* Everything below is hidden for frontlines agents */}
            {!isFrontlines && (
              <>
                {/* Close Rates (read-only) */}
                {editing && (
                  <div className="form-row">
                    <div className="form-group">
                      <label>Close Rate 12m (from Salesforce)</label>
                      <div
                        className="form-input font-mono"
                        style={{
                          background: "var(--bg-input, #111318)",
                          opacity: 0.7,
                          cursor: "default",
                        }}
                      >
                        {(editing.close_rate_trailing_12m * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Close Rate All-Time (from Salesforce)</label>
                      <div
                        className="form-input font-mono"
                        style={{
                          background: "var(--bg-input, #111318)",
                          opacity: 0.7,
                          cursor: "default",
                        }}
                      >
                        {(editing.close_rate_all_time * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                )}

                {/* Location Multi-Select */}
                <div className="form-group">
                  <label>Locations</label>
                  <p className="text-muted text-sm" style={{ margin: "4px 0 8px" }}>
                    Only receives leads from selected locations. Leave empty for all.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {locations
                      .filter((loc) => loc.is_active)
                      .map((loc) => {
                        const selected = form.location_specialties.includes(loc.name);
                        return (
                          <button
                            key={loc.id}
                            type="button"
                            onClick={() => toggleLocation(loc.name)}
                            style={{
                              padding: "6px 14px",
                              borderRadius: 20,
                              border: "2px solid",
                              borderColor: selected ? "#34d399" : "#2a2e3a",
                              background: selected
                                ? "rgba(52, 211, 153, 0.15)"
                                : "transparent",
                              color: selected ? "#34d399" : "#8b8fa3",
                              cursor: "pointer",
                              fontSize: 13,
                              fontWeight: selected ? 600 : 400,
                              transition: "all 0.15s",
                            }}
                          >
                            {selected ? "\u2713 " : ""}{loc.name}
                          </button>
                        );
                      })}
                    {locations.filter((l) => l.is_active).length === 0 && (
                      <span className="text-muted text-sm">
                        No locations configured. Add locations first.
                      </span>
                    )}
                  </div>
                </div>

                {/* Price Range Multi-Select */}
                <div className="form-group">
                  <label>Price Ranges</label>
                  <p className="text-muted text-sm" style={{ margin: "4px 0 8px" }}>
                    Only receives leads in selected price ranges. Leave empty for all.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {ALL_PRICE_RANGES.map((range) => {
                      const selected = form.price_ranges.includes(range);
                      return (
                        <button
                          key={range}
                          type="button"
                          onClick={() => togglePriceRange(range)}
                          style={{
                            padding: "6px 14px",
                            borderRadius: 20,
                            border: "2px solid",
                            borderColor: selected ? "#4f8ff7" : "#2a2e3a",
                            background: selected
                              ? "rgba(79, 143, 247, 0.15)"
                              : "transparent",
                            color: selected ? "#4f8ff7" : "#8b8fa3",
                            cursor: "pointer",
                            fontSize: 13,
                            fontWeight: selected ? 600 : 400,
                            transition: "all 0.15s",
                          }}
                        >
                          {selected ? "\u2713 " : ""}{PRICE_RANGE_LABELS[range]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Monthly Lead Goal Min</label>
                    <input
                      className="form-input"
                      type="number"
                      value={form.monthly_lead_goal_min}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          monthly_lead_goal_min: parseInt(e.target.value, 10) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Monthly Lead Goal Max</label>
                    <input
                      className="form-input"
                      type="number"
                      value={form.monthly_lead_goal_max}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          monthly_lead_goal_max: parseInt(e.target.value, 10) || 0,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="form-group" style={{ display: "flex", gap: 16 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) =>
                        setForm({ ...form, is_active: e.target.checked })
                      }
                    />
                    Active
                  </label>
                </div>

                {/* Drag-to-Rank Scoring Priority */}
                <div className="form-group">
                  <label>Scoring Priority</label>
                  <p className="text-muted text-sm" style={{ margin: "4px 0 8px" }}>
                    Drag to reorder. Top factor = {RANK_WEIGHTS[0]}% weight, bottom = {RANK_WEIGHTS[RANK_WEIGHTS.length - 1]}%.
                    Location and price range are hard filters (not ranked).
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {form.scoring_priority.map((factorKey, index) => (
                      <div
                        key={factorKey}
                        draggable
                        onDragStart={() => setDragIndex(index)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (dragIndex !== null && dragIndex !== index) {
                            movePriority(dragIndex, index);
                            setDragIndex(index);
                          }
                        }}
                        onDragEnd={() => setDragIndex(null)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 14px",
                          background:
                            dragIndex === index
                              ? "rgba(79, 143, 247, 0.1)"
                              : "transparent",
                          border: "1px solid",
                          borderColor:
                            dragIndex === index ? "#4f8ff7" : "#2a2e3a",
                          borderRadius: 6,
                          cursor: "grab",
                          userSelect: "none",
                          transition: "all 0.15s",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#8b8fa3",
                            minWidth: 20,
                          }}
                        >
                          #{index + 1}
                        </span>
                        <span style={{ fontSize: 16, color: "#8b8fa3" }}>
                          &#9776;
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>
                            {FACTOR_LABELS[factorKey].label}
                          </div>
                          <div style={{ fontSize: 11, color: "#8b8fa3" }}>
                            {FACTOR_LABELS[factorKey].desc}
                          </div>
                        </div>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#4f8ff7",
                            minWidth: 36,
                            textAlign: "right",
                          }}
                        >
                          {RANK_WEIGHTS[index]}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowModal(false)}
              >
                {isFrontlines ? "Close" : "Cancel"}
              </button>
              {!isFrontlines && (
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={saving || !form.name || !form.phone}
                >
                  {saving ? "Saving..." : editing ? "Update" : "Create"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
