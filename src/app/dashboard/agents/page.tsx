"use client";

import { useEffect, useState, useCallback } from "react";
import type { Agent } from "@/lib/supabase/types";

type AgentForm = {
  name: string;
  phone: string;
  email: string;
  salesforce_user_id: string;
  is_frontlines: boolean;
  is_active: boolean;
  close_rate_trailing_12m: number;
  close_rate_all_time: number;
  location_specialties: string[];
  monthly_lead_goal_min: number;
  monthly_lead_goal_max: number;
  optimal_load_factor: number;
  availability_windows: Agent["availability_windows"];
};

const emptyAgent: AgentForm = {
  name: "",
  phone: "",
  email: "",
  salesforce_user_id: "",
  is_frontlines: false,
  is_active: true,
  close_rate_trailing_12m: 0,
  close_rate_all_time: 0,
  location_specialties: [],
  monthly_lead_goal_min: 5,
  monthly_lead_goal_max: 15,
  optimal_load_factor: 1.0,
  availability_windows: null,
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form, setForm] = useState(emptyAgent);
  const [specialtiesText, setSpecialtiesText] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchAgents = useCallback(() => {
    fetch("/api/internal/agents")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAgents(data);
        else setError(data.error ?? "Failed to load");
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  function openAdd() {
    setEditing(null);
    setForm(emptyAgent);
    setSpecialtiesText("");
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
      close_rate_trailing_12m: agent.close_rate_trailing_12m,
      close_rate_all_time: agent.close_rate_all_time,
      location_specialties: agent.location_specialties,
      monthly_lead_goal_min: agent.monthly_lead_goal_min,
      monthly_lead_goal_max: agent.monthly_lead_goal_max,
      optimal_load_factor: agent.optimal_load_factor,
      availability_windows: agent.availability_windows,
    });
    setSpecialtiesText(agent.location_specialties.join(", "));
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true);
    const payload = {
      ...form,
      email: form.email || null,
      salesforce_user_id: form.salesforce_user_id || null,
      location_specialties: specialtiesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
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
      fetchAgents();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
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
        <p>Manage sales agents and their scoring parameters</p>
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
                    <th>Specialties</th>
                    <th>Close Rate (12m)</th>
                    <th>Lead Goal</th>
                    <th>Frontlines</th>
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
                          : "-"}
                      </td>
                      <td className="font-mono">
                        {(agent.close_rate_trailing_12m * 100).toFixed(1)}%
                      </td>
                      <td className="font-mono">
                        {agent.monthly_lead_goal_min}-
                        {agent.monthly_lead_goal_max}
                      </td>
                      <td>
                        {agent.is_frontlines ? (
                          <span className="badge badge-info">Yes</span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => openEdit(agent)}
                        >
                          Edit
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
            <h3>{editing ? "Edit Agent" : "Add Agent"}</h3>

            <div className="form-row">
              <div className="form-group">
                <label>Name *</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="John Smith"
                />
              </div>
              <div className="form-group">
                <label>Phone *</label>
                <input
                  className="form-input"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+19415551234"
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
                />
              </div>
            </div>

            <div className="form-group">
              <label>Location Specialties (comma-separated)</label>
              <input
                className="form-input"
                value={specialtiesText}
                onChange={(e) => setSpecialtiesText(e.target.value)}
                placeholder="Lakewood Ranch, Parrish"
              />
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

            <div className="form-row">
              <div className="form-group">
                <label>Close Rate 12m</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  value={form.close_rate_trailing_12m}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      close_rate_trailing_12m: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="form-group">
                <label>Close Rate All-Time</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  value={form.close_rate_all_time}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      close_rate_all_time: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Optimal Load Factor</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.1"
                  value={form.optimal_load_factor}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      optimal_load_factor: parseFloat(e.target.value) || 1.0,
                    })
                  }
                />
              </div>
              <div className="form-group" style={{ display: "flex", alignItems: "end", gap: 16 }}>
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
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.is_frontlines}
                    onChange={(e) =>
                      setForm({ ...form, is_frontlines: e.target.checked })
                    }
                  />
                  Frontlines
                </label>
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || !form.name || !form.phone}
              >
                {saving ? "Saving..." : editing ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
