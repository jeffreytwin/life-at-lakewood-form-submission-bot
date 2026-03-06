"use client";

import { useEffect, useState } from "react";

export default function WeightsPage() {
  const [closeRate, setCloseRate] = useState(60);
  const [closeRateInput, setCloseRateInput] = useState("60");
  const [savedCloseRate, setSavedCloseRate] = useState(60);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const leadLoad = 100 - closeRate;
  const hasChanges = closeRate !== savedCloseRate;

  useEffect(() => {
    fetch("/api/internal/weights", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          const cr = data.close_rate ?? 60;
          setCloseRate(cr);
          setCloseRateInput(String(cr));
          setSavedCloseRate(cr);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  function handleCloseRateChange(raw: string) {
    setCloseRateInput(raw);
    const num = parseInt(raw, 10);
    if (!isNaN(num)) {
      setCloseRate(Math.min(100, Math.max(0, num)));
    }
  }

  async function handleSave() {
    // Normalize the input before saving (replaces onBlur normalization
    // which caused a React re-render that swallowed the first click)
    const num = parseInt(closeRateInput, 10);
    const val = isNaN(num) ? 0 : Math.min(100, Math.max(0, num));
    const finalLeadLoad = 100 - val;
    setCloseRate(val);
    setCloseRateInput(String(val));

    setSaving(true);
    try {
      const res = await fetch("/api/internal/weights", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ close_rate: val, lead_load: finalLeadLoad }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSavedCloseRate(data.close_rate);
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
          Balance how much close rate vs distribution goals affects agent scoring.
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
            <h3>Weight Balance</h3>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? "Saving..." : saved ? "Saved!" : "Save Changes"}
            </button>
          </div>

          <div style={{ padding: "8px 0 24px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 20,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Distribute to Highest Close-Rate Performers</div>
                <div className="text-muted text-sm">
                  Trailing 12-month performance
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="text"
                  inputMode="numeric"
                  className="form-input font-mono"
                  value={closeRateInput}
                  onChange={(e) => handleCloseRateChange(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  style={{
                    width: 64,
                    textAlign: "center",
                    fontSize: 20,
                    fontWeight: 700,
                    padding: "4px 8px",
                    color: "#34d399",
                  }}
                />
                <span style={{ fontSize: 18, fontWeight: 600, color: "#34d399" }}>%</span>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  Hit Agent Distribution Goals
                </div>
                <div className="text-muted text-sm">
                  Monthly count relative to agent&apos;s goal range
                </div>
              </div>
              <div
                className="font-mono"
                style={{ fontSize: 24, fontWeight: 700, color: "#fbbf24" }}
              >
                {leadLoad}%
              </div>
            </div>
          </div>

          {/* Visual bar */}
          <div
            style={{
              display: "flex",
              height: 32,
              borderRadius: "var(--radius)",
              overflow: "hidden",
              gap: 2,
            }}
          >
            {closeRate > 0 && (
              <div
                style={{
                  flex: closeRate,
                  background: "#34d399",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#fff",
                }}
              >
                {closeRate >= 15 ? `Close Rate ${closeRate}%` : `${closeRate}%`}
              </div>
            )}
            {leadLoad > 0 && (
              <div
                style={{
                  flex: leadLoad,
                  background: "#fbbf24",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#fff",
                }}
              >
                {leadLoad >= 15 ? `Dist. Goals ${leadLoad}%` : `${leadLoad}%`}
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: 24,
              padding: "12px 16px",
              background: "#1a1d27",
              borderRadius: "var(--radius)",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            <strong style={{ color: "var(--text)" }}>Hard Filters</strong> (agents
            must pass all to be eligible):
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              <li>
                <strong>Location</strong> &mdash; Agent specialties must match
                the hand raise&apos;s location
              </li>
              <li>
                <strong>Price Range</strong> &mdash; Agent must accept the
                hand raise&apos;s price bracket
              </li>
              <li>
                <strong>Availability</strong> &mdash; Agent must not be in an
                unavailability window
              </li>
              <li>
                <strong>Daily Hand Raise Cap</strong> &mdash; Agents under their cap
                are preferred; overflow only when all eligible agents have hit
                their cap
              </li>
            </ul>
            <br />
            <strong style={{ color: "var(--text)" }}>Score Modifiers</strong> (applied
            after weighted scoring):
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              <li>
                <strong>Specialty Bonus</strong> &mdash; Up to 1.15x multiplier for
                agents with a specific area match (vs generalists who accept
                all locations). Scales with Close Rate weight &mdash; at 100%
                Distribution Goals the bonus is disabled so it can&apos;t overpower
                fair distribution
              </li>
              <li>
                <strong>Monthly Over-Cap Penalty</strong> &mdash; 0.4x
                multiplier when an agent exceeds their monthly max goal;
                not a hard stop, but heavily favors agents still below
                their minimum target
              </li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
