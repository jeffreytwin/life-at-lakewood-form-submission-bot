"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import type { Location } from "@/lib/supabase/types";

type SimMode = "single" | "bulk" | "30day";

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
  dailyCapped?: boolean;
  scores: SimScore[];
}

interface SimResponse {
  results: SimResult[];
  summary: Record<string, number>;
  unassigned: number;
}

interface LeadDecision {
  index: number;
  time: string;
  location: string;
  price: string;
  assignedAgent: string | null;
  assignedAgentId: string | null;
  totalScore: number | null;
  specialtyBonus: number | null;
  monthlyCapMult: number | null;
  dailyCapped: boolean;
  factors: Record<string, number> | null;
}

interface DaySummary {
  day: number;
  date: string;
  dayOfWeek: string;
  leadsAssigned: number;
  leadsUnassigned: number;
  agentBreakdown: Record<string, number>;
  overflowCount: number;
  leadDecisions: LeadDecision[];
}

interface ThirtyDayResponse {
  mode: "30day";
  days: DaySummary[];
  summary: Record<string, number>;
  totalAssigned: number;
  totalUnassigned: number;
  totalOverflow: number;
  totalLeads: number;
}

const PRICE_OPTIONS = [
  "",
  "$150,000 - $250,000",
  "$250,000 - $500,000",
  "$500,000 - $750,000",
  "$750,000 - $1,000,000",
  "$1,000,000 - $1,500,000",
  "$1,500,000+",
];

export default function SimulatePage() {
  const router = useRouter();
  const [mode, setMode] = useState<SimMode>("single");
  const [locations, setLocations] = useState<Location[]>([]);

  // Single lead form
  const [singleForm, setSingleForm] = useState({
    location: "",
    price: "$500,000 - $750,000",
    simulateAt: "", // ISO datetime-local string for availability testing
  });

  // Bulk form
  const [bulkCount, setBulkCount] = useState(50);
  const [bulkLocations, setBulkLocations] = useState<string[]>([]);
  const [bulkPrices, setBulkPrices] = useState<string[]>([...PRICE_OPTIONS]);

  // 30-day form
  const [leadsPerDay, setLeadsPerDay] = useState(5);
  const [thirtyDayLocations, setThirtyDayLocations] = useState<string[]>([]);
  const [thirtyDayPrices, setThirtyDayPrices] = useState<string[]>([...PRICE_OPTIONS]);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimResponse | null>(null);
  const [thirtyDayResult, setThirtyDayResult] = useState<ThirtyDayResponse | null>(null);
  const [expandedLead, setExpandedLead] = useState<number | null>(null);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);

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
    setThirtyDayResult(null);
    setExpandedLead(null);
    setExpandedDay(null);

    try {
      let body;

      if (mode === "30day") {
        body = {
          mode: "30day",
          leadsPerDay,
          locations: thirtyDayLocations,
          prices: thirtyDayPrices,
        };
      } else if (mode === "single") {
        body = {
          leads: [{
            location: singleForm.location,
            village: "",
            price: singleForm.price,
          }],
          ...(singleForm.simulateAt ? { simulateAt: singleForm.simulateAt } : {}),
        };
      } else {
        const locs =
          bulkLocations.length > 0
            ? bulkLocations
            : locations.map((l) => l.name);
        const leads = Array.from({ length: bulkCount }, () => ({
          location: locs[Math.floor(Math.random() * locs.length)],
          village: "",
          price: bulkPrices[Math.floor(Math.random() * bulkPrices.length)],
        }));
        body = { leads };
      }

      const res = await fetch("/api/internal/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.mode === "30day") {
        setThirtyDayResult(data);
      } else {
        setResult(data);
      }
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

  function toggle30DayLocation(name: string) {
    setThirtyDayLocations((prev) =>
      prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name]
    );
  }

  function toggle30DayPrice(price: string) {
    setThirtyDayPrices((prev) =>
      prev.includes(price) ? prev.filter((p) => p !== price) : [...prev, price]
    );
  }

  const totalAssigned = result
    ? Object.values(result.summary).reduce((a, b) => a + b, 0)
    : 0;

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

  return (
    <>
      <div className="page-header">
        <button
          onClick={() => router.push("/dashboard/simulation")}
          className="back-btn"
        >
          ← Back to Simulation
        </button>
        <h2>Simulation</h2>
        <p>
          Test routing configurations without sending SMS or writing to the
          database. All times use Eastern (New York) timezone.
        </p>
      </div>

      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["single", "bulk", "30day"] as const).map((m) => (
          <button
            key={m}
            className={`btn ${mode === m ? "btn-primary" : "btn-secondary"}`}
            onClick={() => {
              setMode(m);
              setResult(null);
              setThirtyDayResult(null);
            }}
          >
            {m === "single" ? "Single Form Submission" : m === "bulk" ? "Bulk" : "30-Day"}
          </button>
        ))}
      </div>

      <div className="grid-2">
        {/* Left: Configuration */}
        <div className="card">
          <div className="card-header">
            <h3>
              {mode === "single"
                ? "Form Submission Details"
                : mode === "bulk"
                  ? "Batch Configuration"
                  : "30-Day Configuration"}
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
                <label>Price</label>
                <select
                  className="form-input"
                  value={singleForm.price}
                  onChange={(e) =>
                    setSingleForm({ ...singleForm, price: e.target.value })
                  }
                >
                  {PRICE_OPTIONS.map((p) => (
                    <option key={p || "__blank"} value={p}>
                      {p || "(Blank)"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Date &amp; Time (ET)</label>
                <p className="text-muted text-sm" style={{ margin: "4px 0 8px" }}>
                  Test agent availability windows at a specific date/time. Leave empty for now.
                </p>
                <input
                  className="form-input"
                  type="datetime-local"
                  value={singleForm.simulateAt}
                  onChange={(e) =>
                    setSingleForm({ ...singleForm, simulateAt: e.target.value })
                  }
                />
              </div>
            </>
          ) : mode === "bulk" ? (
            <>
              <div className="form-group">
                <label>Number of Hand Raises</label>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  max={500}
                  value={bulkCount || ""}
                  onChange={(e) =>
                    setBulkCount(
                      e.target.value === "" ? 1 : Math.min(500, Math.max(1, parseInt(e.target.value, 10)))
                    )
                  }
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <div className="form-group">
                <label>Locations</label>
                <p className="text-muted text-sm" style={{ margin: "4px 0 8px" }}>
                  Leave empty for all locations.
                </p>
                <PillSelector
                  items={locations.map((l) => ({ key: l.name, label: l.name }))}
                  selected={bulkLocations}
                  onToggle={toggleBulkLocation}
                />
              </div>
              <div className="form-group">
                <label>Price ranges</label>
                <PillSelector
                  items={PRICE_OPTIONS.map((p) => ({ key: p, label: p || "(Blank)" }))}
                  selected={bulkPrices}
                  onToggle={toggleBulkPrice}
                  color="#4f8ff7"
                />
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label>Hand Raises per day</label>
                <p className="text-muted text-sm" style={{ margin: "4px 0 8px" }}>
                  Simulates this many hand raises each day for 30 days. Random times
                  between 7 AM - 8 PM ET. Daily caps reset each day.
                </p>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  max={50}
                  value={leadsPerDay || ""}
                  onChange={(e) =>
                    setLeadsPerDay(
                      e.target.value === "" ? 1 : Math.min(50, Math.max(1, parseInt(e.target.value, 10)))
                    )
                  }
                  onFocus={(e) => e.target.select()}
                  style={{ maxWidth: 120 }}
                />
              </div>
              <div className="form-group">
                <label>Locations</label>
                <p className="text-muted text-sm" style={{ margin: "4px 0 8px" }}>
                  Leave empty for all locations.
                </p>
                <PillSelector
                  items={locations.map((l) => ({ key: l.name, label: l.name }))}
                  selected={thirtyDayLocations}
                  onToggle={toggle30DayLocation}
                />
              </div>
              <div className="form-group">
                <label>Price ranges</label>
                <PillSelector
                  items={PRICE_OPTIONS.map((p) => ({ key: p, label: p || "(Blank)" }))}
                  selected={thirtyDayPrices}
                  onToggle={toggle30DayPrice}
                  color="#4f8ff7"
                />
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
                  ? "Simulate Form Submission"
                  : mode === "bulk"
                    ? `Simulate ${bulkCount} Hand Raises`
                    : `Simulate 30 Days (${leadsPerDay * 30} hand raises)`}
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
          {!result && !thirtyDayResult ? (
            <div className="card">
              <div className="empty-state">
                <img
                  src="/otocon-form-simulation.gif"
                  alt="Otocon"
                  style={{
                    width: 299,
                    height: "auto",
                    imageRendering: "pixelated",
                  }}
                />
                <h3>Ready to simulate</h3>
                <p>
                  Configure your parameters and run the simulation. This is a
                  dry run using your current agent configuration.
                </p>
              </div>
            </div>
          ) : thirtyDayResult ? (
            <ThirtyDayResults
              data={thirtyDayResult}
              expandedDay={expandedDay}
              onToggleDay={(d) =>
                setExpandedDay(expandedDay === d ? null : d)
              }
            />
          ) : result ? (
            <BulkResults
              result={result}
              totalAssigned={totalAssigned}
              expandedLead={expandedLead}
              onToggleLead={(i) =>
                setExpandedLead(expandedLead === i ? null : i)
              }
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

function ThirtyDayResults({
  data,
  expandedDay,
  onToggleDay,
}: {
  data: ThirtyDayResponse;
  expandedDay: number | null;
  onToggleDay: (day: number) => void;
}) {
  // Collect all agent names for columns
  const allAgents = Object.keys(data.summary).sort(
    (a, b) => data.summary[b] - data.summary[a]
  );

  return (
    <>
      {/* Overall summary */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>30-Day Summary</h3>
          <span className="text-muted text-sm">
            {data.totalLeads} hand raises / {data.totalAssigned} assigned /{" "}
            {data.totalUnassigned} unassigned
            {data.totalOverflow > 0 &&
              ` / ${data.totalOverflow} overflow (assigned despite all eligible agents hitting daily cap)`}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "0 0 8px",
          }}
        >
          {allAgents.map((name) => {
            const count = data.summary[name];
            const pct = ((count / data.totalLeads) * 100).toFixed(1);
            return (
              <div
                key={name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 120, fontWeight: 600, fontSize: 13 }}>
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
                  style={{ minWidth: 60, textAlign: "right", fontSize: 13 }}
                >
                  {count} ({pct}%)
                </div>
              </div>
            );
          })}
          {data.totalUnassigned > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                    width: `${((data.totalUnassigned / data.totalLeads) * 100).toFixed(1)}%`,
                    height: "100%",
                    background: "#f87171",
                    borderRadius: 4,
                    minWidth: 4,
                  }}
                />
              </div>
              <div
                className="font-mono"
                style={{ minWidth: 60, textAlign: "right", fontSize: 13 }}
              >
                {data.totalUnassigned}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Day-by-day table */}
      <div className="card">
        <div className="card-header">
          <h3>Day-by-Day Breakdown</h3>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Day</th>
                <th>Date</th>
                <th>Day of Week</th>
                <th>Assigned</th>
                <th>Unassigned</th>
                <th title="Hand raises assigned when all eligible agents had already hit their daily cap">Overflow</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((day) => (
                <Fragment key={day.day}>
                  <tr
                    onClick={() => onToggleDay(day.day)}
                    style={{
                      cursor: "pointer",
                      background:
                        day.dayOfWeek === "Saturday" ||
                        day.dayOfWeek === "Sunday"
                          ? "rgba(251, 191, 36, 0.05)"
                          : undefined,
                    }}
                  >
                    <td style={{ fontSize: 10 }}>
                      {expandedDay === day.day ? "\u25BC" : "\u25B6"}
                    </td>
                    <td className="font-mono text-sm">{day.day}</td>
                    <td className="text-sm">{day.date}</td>
                    <td className="text-sm">
                      {day.dayOfWeek}
                      {(day.dayOfWeek === "Saturday" ||
                        day.dayOfWeek === "Sunday") && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            color: "#fbbf24",
                          }}
                        >
                          weekend
                        </span>
                      )}
                    </td>
                    <td className="font-mono" style={{ color: "#34d399" }}>
                      {day.leadsAssigned}
                    </td>
                    <td
                      className="font-mono"
                      style={{
                        color: day.leadsUnassigned > 0 ? "#f87171" : undefined,
                      }}
                    >
                      {day.leadsUnassigned}
                    </td>
                    <td
                      className="font-mono"
                      style={{
                        color: day.overflowCount > 0 ? "#fbbf24" : undefined,
                      }}
                    >
                      {day.overflowCount}
                    </td>
                  </tr>
                  {expandedDay === day.day && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{
                          padding: "8px 16px",
                          background: "#111318",
                        }}
                      >
                        <div style={{ fontSize: 12 }}>
                          <strong>Agent breakdown:</strong>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                              marginTop: 8,
                              marginBottom: 16,
                            }}
                          >
                            {Object.entries(day.agentBreakdown)
                              .sort((a, b) => b[1] - a[1])
                              .map(([name, count]) => (
                                <div
                                  key={name}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                  }}
                                >
                                  <div
                                    style={{
                                      minWidth: 120,
                                      fontWeight: 600,
                                    }}
                                  >
                                    {name}
                                  </div>
                                  <div
                                    style={{
                                      flex: 1,
                                      height: 14,
                                      background: "#1a1d27",
                                      borderRadius: 3,
                                      overflow: "hidden",
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: `${(
                                          (count /
                                            (day.leadsAssigned +
                                              day.leadsUnassigned)) *
                                          100
                                        ).toFixed(0)}%`,
                                        height: "100%",
                                        background: "#4f8ff7",
                                        borderRadius: 3,
                                        minWidth: 4,
                                      }}
                                    />
                                  </div>
                                  <div
                                    className="font-mono"
                                    style={{ minWidth: 30, fontSize: 11 }}
                                  >
                                    {count}
                                  </div>
                                </div>
                              ))}
                            {Object.keys(day.agentBreakdown).length === 0 && (
                              <span className="text-muted">
                                No agents matched any hand raises this day
                              </span>
                            )}
                          </div>

                          <strong>Form-by-form decisions:</strong>
                          <table style={{ width: "100%", marginTop: 8 }}>
                            <thead>
                              <tr>
                                <th style={{ fontSize: 11 }}>Time (ET)</th>
                                <th style={{ fontSize: 11 }}>Location</th>
                                <th style={{ fontSize: 11 }}>Price</th>
                                <th style={{ fontSize: 11 }}>Assigned To</th>
                                <th style={{ fontSize: 11 }}>Score</th>
                                <th style={{ fontSize: 11 }}>Spec.</th>
                                <th style={{ fontSize: 11 }}>Mo. Cap</th>
                              </tr>
                            </thead>
                            <tbody>
                              {day.leadDecisions.map((ld) => (
                                <tr key={ld.index}>
                                  <td
                                    className="font-mono"
                                    style={{ fontSize: 11 }}
                                  >
                                    {ld.time}
                                  </td>
                                  <td style={{ fontSize: 11 }}>
                                    {ld.location}
                                  </td>
                                  <td style={{ fontSize: 11 }}>{ld.price}</td>
                                  <td
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 600,
                                      color: ld.assignedAgent
                                        ? undefined
                                        : "#f87171",
                                    }}
                                  >
                                    {ld.assignedAgent ?? "No match"}
                                    {ld.dailyCapped && (
                                      <span
                                        style={{
                                          marginLeft: 4,
                                          fontSize: 9,
                                          color: "#fbbf24",
                                        }}
                                      >
                                        overflow
                                      </span>
                                    )}
                                  </td>
                                  <td
                                    className="font-mono"
                                    style={{ fontSize: 11 }}
                                  >
                                    {ld.totalScore != null
                                      ? ld.totalScore.toFixed(2)
                                      : "-"}
                                  </td>
                                  <td
                                    className="font-mono"
                                    style={{
                                      fontSize: 11,
                                      color:
                                        ld.specialtyBonus != null &&
                                        ld.specialtyBonus > 1
                                          ? "#34d399"
                                          : undefined,
                                    }}
                                  >
                                    {ld.specialtyBonus != null
                                      ? `${ld.specialtyBonus.toFixed(2)}x`
                                      : "-"}
                                  </td>
                                  <td
                                    className="font-mono"
                                    style={{
                                      fontSize: 11,
                                      color:
                                        ld.monthlyCapMult != null &&
                                        ld.monthlyCapMult < 1
                                          ? "#fbbf24"
                                          : undefined,
                                    }}
                                  >
                                    {ld.monthlyCapMult != null
                                      ? `${ld.monthlyCapMult.toFixed(2)}x`
                                      : "-"}
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
  );
}

function BulkResults({
  result,
  totalAssigned,
  expandedLead,
  onToggleLead,
}: {
  result: SimResponse;
  totalAssigned: number;
  expandedLead: number | null;
  onToggleLead: (i: number) => void;
}) {
  return (
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
            No agents matched any hand raises. Check location, price range, and
            availability filters.
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
                      style={{ minWidth: 120, fontWeight: 600, fontSize: 13 }}
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
                      style={{ minWidth: 60, textAlign: "right", fontSize: 13 }}
                    >
                      {count} ({pct}%)
                    </div>
                  </div>
                );
              })}
            {result.unassigned > 0 && (
              <div
                style={{ display: "flex", alignItems: "center", gap: 12 }}
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
                  style={{ minWidth: 60, textAlign: "right", fontSize: 13 }}
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

      {/* Lead-by-lead */}
      <div className="card">
        <div className="card-header">
          <h3>Form-by-Form Results</h3>
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
                    onClick={() => onToggleLead(r.leadIndex)}
                    style={{ cursor: "pointer" }}
                  >
                    <td style={{ fontSize: 10 }}>
                      {expandedLead === r.leadIndex ? "\u25BC" : "\u25B6"}
                    </td>
                    <td className="font-mono text-sm">{r.leadIndex + 1}</td>
                    <td className="text-sm">{r.lead.location}</td>
                    <td className="text-sm">{r.lead.price}</td>
                    <td style={{ fontWeight: 600 }}>
                      {r.assignedAgent ? (
                        <>
                          {r.assignedAgent}
                          {r.dailyCapped && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 10,
                                color: "#fbbf24",
                              }}
                            >
                              overflow
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{ color: "#f87171" }}>No match</span>
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
                          <table style={{ width: "100%", marginTop: 8 }}>
                            <thead>
                              <tr>
                                <th style={{ fontSize: 11 }}>Agent</th>
                                <th style={{ fontSize: 11 }}>Status</th>
                                <th style={{ fontSize: 11 }}>Score</th>
                                <th style={{ fontSize: 11 }}>Close Rate</th>
                                <th style={{ fontSize: 11 }}>Dist. Goals</th>
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
                                        s.agentId === r.assignedAgentId
                                          ? 700
                                          : 400,
                                    }}
                                  >
                                    {s.agentName}
                                    {s.agentId === r.assignedAgentId &&
                                      " \u2190"}
                                  </td>
                                  <td style={{ fontSize: 12 }}>
                                    {s.filtered ? (
                                      <span style={{ color: "#f87171" }}>
                                        {s.filterReason}
                                      </span>
                                    ) : (
                                      <span style={{ color: "#34d399" }}>
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
                                      : (s.factors.close_rate ?? 0).toFixed(2)}
                                  </td>
                                  <td
                                    className="font-mono"
                                    style={{ fontSize: 12 }}
                                  >
                                    {s.filtered
                                      ? "-"
                                      : (s.factors.lead_load ?? 0).toFixed(2)}
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
  );
}
