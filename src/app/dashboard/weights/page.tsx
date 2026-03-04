"use client";

import { useEffect, useState } from "react";

interface Weights {
  id: string;
  location_match: number;
  close_rate: number;
  lead_load: number;
  lead_value: number;
  availability: number;
  optimal_load: number;
}

const weightLabels: Record<string, { label: string; desc: string }> = {
  location_match: {
    label: "Location Match",
    desc: "How well the agent's specialties match the lead's location",
  },
  close_rate: {
    label: "Close Rate",
    desc: "Agent's blended 12-month and all-time close rate performance",
  },
  lead_load: {
    label: "Lead Load",
    desc: "Monthly lead count relative to agent's goal range",
  },
  lead_value: {
    label: "Lead Value",
    desc: "Lead price/value matching (currently neutral placeholder)",
  },
  availability: {
    label: "Availability",
    desc: "Whether the agent is within their working hours",
  },
  optimal_load: {
    label: "Optimal Load",
    desc: "Cap adjustment for agents with custom load factors",
  },
};

const weightKeys = [
  "location_match",
  "close_rate",
  "lead_load",
  "lead_value",
  "availability",
  "optimal_load",
] as const;

export default function WeightsPage() {
  const [weights, setWeights] = useState<Weights | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/internal/weights")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setWeights(data);
          setDraft({
            location_match: data.location_match,
            close_rate: data.close_rate,
            lead_load: data.lead_load,
            lead_value: data.lead_value,
            availability: data.availability,
            optimal_load: data.optimal_load,
          });
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const sum = Object.values(draft).reduce((a, b) => a + b, 0);
  const isValid = sum === 100;
  const hasChanges =
    weights &&
    weightKeys.some(
      (k) => draft[k] !== weights[k as keyof Weights]
    );

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/internal/weights", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setWeights(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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
          <h2>Scoring Weights</h2>
          <p>Loading...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>Scoring Weights</h2>
        <p>
          Adjust how much each factor contributes to agent scoring. Weights must
          sum to 100.
        </p>
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
            <h3>Weight Configuration</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                className="font-mono"
                style={{
                  color: isValid ? "var(--success)" : "var(--danger)",
                  fontWeight: 600,
                }}
              >
                Total: {sum}/100
              </span>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || !isValid || !hasChanges}
              >
                {saving ? "Saving..." : saved ? "Saved!" : "Save Changes"}
              </button>
            </div>
          </div>

          {weightKeys.map((key) => (
            <div className="weight-row" key={key}>
              <div className="weight-label">
                <div>{weightLabels[key].label}</div>
                <div className="text-muted text-sm">
                  {weightLabels[key].desc}
                </div>
              </div>
              <input
                type="range"
                className="weight-slider"
                min={0}
                max={100}
                value={draft[key] ?? 0}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [key]: parseInt(e.target.value, 10),
                  })
                }
              />
              <div className="weight-value">{draft[key] ?? 0}%</div>
            </div>
          ))}

          <div className="mt-4">
            <h4
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 12,
              }}
            >
              Visual Breakdown
            </h4>
            <div
              style={{
                display: "flex",
                height: 32,
                borderRadius: "var(--radius)",
                overflow: "hidden",
                gap: 2,
              }}
            >
              {weightKeys.map((key, i) => {
                const colors = [
                  "#4f8ff7",
                  "#34d399",
                  "#fbbf24",
                  "#f97316",
                  "#a78bfa",
                  "#f87171",
                ];
                const val = draft[key] ?? 0;
                if (val === 0) return null;
                return (
                  <div
                    key={key}
                    style={{
                      flex: val,
                      background: colors[i],
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#fff",
                      minWidth: val > 5 ? 0 : undefined,
                    }}
                    title={`${weightLabels[key].label}: ${val}%`}
                  >
                    {val >= 10 ? `${val}%` : ""}
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                gap: 16,
                marginTop: 8,
                flexWrap: "wrap",
              }}
            >
              {weightKeys.map((key, i) => {
                const colors = [
                  "#4f8ff7",
                  "#34d399",
                  "#fbbf24",
                  "#f97316",
                  "#a78bfa",
                  "#f87171",
                ];
                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                    }}
                  >
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: colors[i],
                      }}
                    />
                    {weightLabels[key].label}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
