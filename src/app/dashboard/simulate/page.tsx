"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import type { Location } from "@/lib/supabase/types";

type SimMode = "single" | "bulk";

interface SimScore {
  agentName: string;
  agentId: string;
  totalScore: number;
  factors: Record<string, number>;
  filtered: boolean;
  filterReason?: string;
}

interface SimResult {
  leadIndex: number;
  lead: { location: string; village: string; price: string };
  assignedAgent: string | null;
  assignedAgentId: string | null;
  scores: SimScore[];
}

interface SimResponse {
  results: SimResult[];
  summary: Record<string, number>;
  unassigned: number;
}

const PRICE_OPTIONS = [
  "$250,000 - $350,000",
  "$350,000 - $500,000",
  "$500,000 - $750,000",
  "$750,000 - $1,000,000",
  "$1,000,000 - $1,500,000",
  "$1,500,000+",
];

export default function SimulatePage() {
  const [mode, setMode] = useState<SimMode>("single");
  const [locations, setLocations] = useState<Location[]>([]);

  // Single lead form
  const [singleForm, setSingleForm] = useState({
    location: "",
    village: "",
    price: "$450,000 - $550,000",
  });

  // Bulk form
  const [bulkCount, setBulkCount] = useState(50);
  const [bulkLocations, setBulkLocations] = useState<string[]>([]);
  const [bulkPrices, setBulkPrices] = useState<string[]>([...PRICE_OPTIONS]);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimResponse | null>(null);
  const [expandedLead, setExpandedLead] = useState<number | null>(null);

  const fetchLocations = useCallback(() => {
    fetch("/api/internal/locations")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const active = data.filter((l: Location) => l.is_active);
          setLocations(active);
          if (active.length > 0 && !singleForm.location) {
            setSingleForm((f) => ({ ...f, location: active[0].name }));
          }
        }
      });
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  async function runSimulation() {
    setRunning(true);
    setResult(null);
    setExpandedLead(null);

    let leads;
    if (mode === "single") {
      leads = [singleForm];
    } else {
      // Generate random leads
      const locs =
        bulkLocations.length > 0
          ? bulkLocations
          : locations.map((l) => l.name);
      leads = Array.from({ length: bulkCount }, () => ({
        location: locs[Math.floor(Math.random() * locs.length)],
        village: "",
        price: bulkPrices[Math.floor(Math.random() * bulkPrices.length)],
      }));
    }

    try {
      const res = await fetch("/api/internal/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setRunning(false);
    }
  }

  function toggleBulkLocation(name: string) {
    setBulkLocations((prev) =>
      prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name]
    );
  }

  function toggleBulkPrice(price: string) {
    setBulkPrices((prev) =>
      prev.includes(price) ? prev.filter((p) => p !== price) : [...prev, price]
    );
  }

  const totalAssigned = result
    ? Object.values(result.summary).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <>
      <div className="page-header">
        <h2>Simulation</h2>
        <p>
          Test routing configurations without sending SMS or writing to the
          database. Results use your current agent settings.
        </p>
      </div>

      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button
          className={`btn ${mode === "single" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => {
            setMode("single");
            setResult(null);
          }}
        >
          Single Lead
        </button>
        <button
          className={`btn ${mode === "bulk" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => {
            setMode("bulk");
            setResult(null);
          }}
        >
          Bulk Simulation
        </button>
      </div>

      <div className="grid-2">
        {/* Left: Configuration */}
        <div className="card">
          <div className="card-header">
            <h3>
              {mode === "single" ? "Lead Details" : "Batch Configuration"}
            </h3>
          </div>

          {mode === "single" ? (
            <>
              <div className="form-group">
                <label>Location</label>
                <select
                  className="form-input"
                  value={singleForm.location}
                  onChange={(e) =>
                    setSingleForm({ ...singleForm, location: e.target.value })
                  }
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.name}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Village (optional)</label>
                <input
                  className="form-input"
                  value={singleForm.village}
                  onChange={(e) =>
                    setSingleForm({ ...singleForm, village: e.target.value })
                  }
                  placeholder="e.g. Waterside"
                />
              </div>
              <div className="form-group">
                <label>Price</label>
                <select
                  className="form-input"
                  value={singleForm.price}
                  onChange={(e) =>
                    setSingleForm({ ...singleForm, price: e.target.value })
                  }
                >
                  {PRICE_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label>Number of leads</label>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  max={500}
                  value={bulkCount}
                  onChange={(e) =>
                    setBulkCount(
                      Math.min(
                        500,
                        Math.max(1, parseInt(e.target.value) || 1)
                      )
                    )
                  }
                />
              </div>

              <div className="form-group">
                <label>Locations to include</label>
                <p
                  className="text-muted text-sm"
                  style={{ margin: "4px 0 8px" }}
                >
                  Leave empty to randomly distribute across all locations.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {locations.map((loc) => {
                    const selected = bulkLocations.includes(loc.name);
                    return (
                      <button
                        key={loc.id}
                        type="button"
                        onClick={() => toggleBulkLocation(loc.name)}
                        style={{
                          padding: "5px 12px",
                          borderRadius: 20,
                          border: "2px solid",
                          borderColor: selected ? "#34d399" : "#2a2e3a",
                          background: selected
                            ? "rgba(52, 211, 153, 0.15)"
                            : "transparent",
                          color: selected ? "#34d399" : "#8b8fa3",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: selected ? 600 : 400,
                        }}
                      >
                        {selected ? "\u2713 " : ""}
                        {loc.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="form-group">
                <label>Price ranges to include</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {PRICE_OPTIONS.map((price) => {
                    const selected = bulkPrices.includes(price);
                    return (
                      <button
                        key={price}
                        type="button"
                        onClick={() => toggleBulkPrice(price)}
                        style={{
                          padding: "5px 12px",
                          borderRadius: 20,
                          border: "2px solid",
                          borderColor: selected ? "#4f8ff7" : "#2a2e3a",
                          background: selected
                            ? "rgba(79, 143, 247, 0.15)"
                            : "transparent",
                          color: selected ? "#4f8ff7" : "#8b8fa3",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: selected ? 600 : 400,
                        }}
                      >
                        {selected ? "\u2713 " : ""}
                        {price}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary"
              onClick={runSimulation}
              disabled={running}
              style={{
                width: "100%",
                justifyContent: "center",
                padding: "12px 16px",
              }}
            >
              {running
                ? "Running..."
                : mode === "single"
                  ? "Simulate Lead"
                  : `Simulate ${bulkCount} Leads`}
            </button>
          </div>

          <p
            className="text-muted"
            style={{ fontSize: 11, marginTop: 12, textAlign: "center" }}
          >
            No SMS sent. No database writes. Safe for production.
          </p>
        </div>

        {/* Right: Results */}
        <div>
          {!result ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-icon">&#9889;</div>
                <h3>Ready to simulate</h3>
                <p>
                  Configure your lead parameters and run the simulation. This is
                  a dry run using your current agent configuration.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Summary card */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <h3>Distribution Summary</h3>
                  <span className="text-muted text-sm">
                    {totalAssigned} assigned / {result.unassigned} unassigned
                  </span>
                </div>

                {Object.keys(result.summary).length === 0 ? (
                  <p className="text-muted" style={{ padding: 16 }}>
                    No agents matched any leads. Check location and price range
                    filters.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      padding: "0 0 8px",
                    }}
                  >
                    {Object.entries(result.summary)
                      .sort((a, b) => b[1] - a[1])
                      .map(([name, count]) => {
                        const pct = (
                          (count / result.results.length) *
                          100
                        ).toFixed(1);
                        return (
                          <div
                            key={name}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                            }}
                          >
                            <div
                              style={{
                                minWidth: 120,
                                fontWeight: 600,
                                fontSize: 13,
                              }}
                            >
                              {name}
                            </div>
                            <div
                              style={{
                                flex: 1,
                                height: 20,
                                background: "#1a1d27",
                                borderRadius: 4,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${pct}%`,
                                  height: "100%",
                                  background: "#4f8ff7",
                                  borderRadius: 4,
                                  minWidth: count > 0 ? 4 : 0,
                                }}
                              />
                            </div>
                            <div
                              className="font-mono"
                              style={{
                                minWidth: 60,
                                textAlign: "right",
                                fontSize: 13,
                              }}
                            >
                              {count} ({pct}%)
                            </div>
                          </div>
                        );
                      })}
                    {result.unassigned > 0 && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <div
                          style={{
                            minWidth: 120,
                            fontWeight: 600,
                            fontSize: 13,
                            color: "#f87171",
                          }}
                        >
                          Unassigned
                        </div>
                        <div
                          style={{
                            flex: 1,
                            height: 20,
                            background: "#1a1d27",
                            borderRadius: 4,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${((result.unassigned / result.results.length) * 100).toFixed(1)}%`,
                              height: "100%",
                              background: "#f87171",
                              borderRadius: 4,
                              minWidth: 4,
                            }}
                          />
                        </div>
                        <div
                          className="font-mono"
                          style={{
                            minWidth: 60,
                            textAlign: "right",
                            fontSize: 13,
                          }}
                        >
                          {result.unassigned} (
                          {(
                            (result.unassigned / result.results.length) *
                            100
                          ).toFixed(1)}
                          %)
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Individual lead results */}
              <div className="card">
                <div className="card-header">
                  <h3>Lead-by-Lead Results</h3>
                </div>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 30 }}></th>
                        <th>#</th>
                        <th>Location</th>
                        <th>Price</th>
                        <th>Assigned To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.results.map((r) => (
                        <Fragment key={r.leadIndex}>
                          <tr
                            onClick={() =>
                              setExpandedLead(
                                expandedLead === r.leadIndex
                                  ? null
                                  : r.leadIndex
                              )
                            }
                            style={{ cursor: "pointer" }}
                          >
                            <td style={{ fontSize: 10 }}>
                              {expandedLead === r.leadIndex
                                ? "\u25BC"
                                : "\u25B6"}
                            </td>
                            <td className="font-mono text-sm">
                              {r.leadIndex + 1}
                            </td>
                            <td className="text-sm">{r.lead.location}</td>
                            <td className="text-sm">{r.lead.price}</td>
                            <td style={{ fontWeight: 600 }}>
                              {r.assignedAgent ?? (
                                <span style={{ color: "#f87171" }}>
                                  No match
                                </span>
                              )}
                            </td>
                          </tr>
                          {expandedLead === r.leadIndex && (
                            <tr>
                              <td
                                colSpan={5}
                                style={{
                                  padding: "8px 16px",
                                  background: "#111318",
                                }}
                              >
                                <div style={{ fontSize: 12 }}>
                                  <strong>All agents scored:</strong>
                                  <table
                                    style={{ width: "100%", marginTop: 8 }}
                                  >
                                    <thead>
                                      <tr>
                                        <th style={{ fontSize: 11 }}>Agent</th>
                                        <th style={{ fontSize: 11 }}>
                                          Status
                                        </th>
                                        <th style={{ fontSize: 11 }}>Score</th>
                                        <th style={{ fontSize: 11 }}>
                                          Close Rate
                                        </th>
                                        <th style={{ fontSize: 11 }}>
                                          Lead Load
                                        </th>
                                        <th style={{ fontSize: 11 }}>
                                          Availability
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {r.scores.map((s) => (
                                        <tr
                                          key={s.agentId}
                                          style={{
                                            opacity: s.filtered ? 0.5 : 1,
                                          }}
                                        >
                                          <td
                                            style={{
                                              fontSize: 12,
                                              fontWeight:
                                                s.agentId ===
                                                r.assignedAgentId
                                                  ? 700
                                                  : 400,
                                            }}
                                          >
                                            {s.agentName}
                                            {s.agentId ===
                                              r.assignedAgentId && " \u2190"}
                                          </td>
                                          <td style={{ fontSize: 12 }}>
                                            {s.filtered ? (
                                              <span
                                                style={{ color: "#f87171" }}
                                              >
                                                {s.filterReason}
                                              </span>
                                            ) : (
                                              <span
                                                style={{ color: "#34d399" }}
                                              >
                                                Eligible
                                              </span>
                                            )}
                                          </td>
                                          <td
                                            className="font-mono"
                                            style={{ fontSize: 12 }}
                                          >
                                            {s.filtered
                                              ? "-"
                                              : s.totalScore.toFixed(1)}
                                          </td>
                                          <td
                                            className="font-mono"
                                            style={{ fontSize: 12 }}
                                          >
                                            {s.filtered
                                              ? "-"
                                              : (
                                                  s.factors.close_rate ?? 0
                                                ).toFixed(2)}
                                          </td>
                                          <td
                                            className="font-mono"
                                            style={{ fontSize: 12 }}
                                          >
                                            {s.filtered
                                              ? "-"
                                              : (
                                                  s.factors.lead_load ?? 0
                                                ).toFixed(2)}
                                          </td>
                                          <td
                                            className="font-mono"
                                            style={{ fontSize: 12 }}
                                          >
                                            {s.filtered
                                              ? "-"
                                              : (
                                                  s.factors.availability ?? 0
                                                ).toFixed(2)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
