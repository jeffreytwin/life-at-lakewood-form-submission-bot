"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Agent, AgentGender, Location, PriceRange, UnavailabilityWindow } from "@/lib/supabase/types";
import {
  PRICE_RANGE_LABELS,
  ALL_PRICE_RANGES,
  DAY_LABELS,
} from "@/lib/supabase/types";
import {
  getDisplayAgent,
  getCharacter,
  ALL_DAYS,
  ALL_CHARACTER_IDS,
  DEFAULT_SCHEDULE,
  setCachedSchedule,
  type CharacterId,
  type CharacterSchedule,
  type DayKey,
} from "@/lib/bot-characters";
import { useActiveCharacter } from "@/lib/bot-characters/use-active-character";

type AgentForm = {
  name: string;
  phone: string;
  email: string;
  salesforce_user_id: string;
  gender: AgentGender | "";
  is_frontlines: boolean;
  is_active: boolean;
  location_specialties: string[];
  monthly_lead_goal_min: number;
  monthly_lead_goal_max: number;
  daily_lead_max: number;
  unavailability_windows: UnavailabilityWindow[];
  price_ranges: PriceRange[];
  send_draft_success_texts: boolean;
  draft_success_phone: string;
};

const emptyAgent: AgentForm = {
  name: "",
  phone: "",
  email: "",
  salesforce_user_id: "",
  gender: "",
  is_frontlines: false,
  is_active: true,
  location_specialties: [],
  monthly_lead_goal_min: 5,
  monthly_lead_goal_max: 15,
  daily_lead_max: 5,
  unavailability_windows: [],
  price_ranges: [...ALL_PRICE_RANGES],
  send_draft_success_texts: false,
  draft_success_phone: "",
};

function formatPhone(raw: string | null): string {
  if (!raw) return "-";
  const digits = raw.replace(/\D/g, "");
  // Handle +1XXXXXXXXXX or 1XXXXXXXXXX or XXXXXXXXXX
  const national = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  if (national.length === 10) {
    return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  }
  return raw; // fallback to raw if not 10 digits
}

type SortKey = "is_active" | "name" | "locations" | "price_ranges" | "close_rate" | "goal" | "today" | "handraises" | "is_preferred";
type SortDir = "asc" | "desc";

function getAgentSortValue(agent: Agent, key: SortKey, handRaiseCounts?: Record<string, number>, dailyCounts?: Record<string, number>): string | number | boolean {
  switch (key) {
    case "is_active": return agent.is_active ? 1 : 0;
    case "name": return agent.name.toLowerCase();
    case "locations": return agent.location_specialties.length > 0 ? agent.location_specialties.join(", ").toLowerCase() : "zzz all";
    case "price_ranges": return !agent.price_ranges || agent.price_ranges.length === 0 ? "zzz all" : agent.price_ranges.map((r) => PRICE_RANGE_LABELS[r]).join(", ").toLowerCase();
    case "close_rate": return agent.is_frontlines ? -1 : agent.close_rate_trailing_12m;
    case "goal": return agent.is_frontlines ? -1 : agent.monthly_lead_goal_min;
    case "today": return agent.is_frontlines ? -1 : (dailyCounts?.[agent.id] ?? 0);
    case "handraises": return handRaiseCounts?.[agent.name] ?? 0;
    case "is_preferred": return agent.is_preferred ? 1 : 0;
    default: return "";
  }
}

function sortAgents(agents: Agent[], key: SortKey, dir: SortDir, handRaiseCounts?: Record<string, number>, dailyCounts?: Record<string, number>): Agent[] {
  return [...agents].sort((a, b) => {
    const aVal = getAgentSortValue(a, key, handRaiseCounts, dailyCounts);
    const bVal = getAgentSortValue(b, key, handRaiseCounts, dailyCounts);
    if (aVal < bVal) return dir === "asc" ? -1 : 1;
    if (aVal > bVal) return dir === "asc" ? 1 : -1;
    return 0;
  });
}

const DAY_LABEL_BY_KEY: Record<DayKey, string> = {
  sunday: "Sunday",
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
};

const CHARACTER_LABEL_BY_ID: Record<CharacterId, string> = {
  snake: "Solid Snake",
  ocelot: "Revolver Ocelot",
  liquid: "Liquid Snake",
};

function DayScheduleRow({
  day,
  value,
  onChange,
}: {
  day: DayKey;
  value: CharacterId;
  onChange: (id: CharacterId) => void;
}) {
  const character = getCharacter(value);
  return (
    <>
      <label htmlFor={`schedule-${day}`} style={{ fontSize: 13, fontWeight: 500 }}>
        {DAY_LABEL_BY_KEY[day]}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            overflow: "hidden",
            background: "var(--bg-input)",
            border: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <img
            src={character.gifs.standing}
            alt={character.displayName}
            style={{ width: "100%", height: "100%", objectFit: "cover", imageRendering: "pixelated" }}
          />
        </div>
        <select
          id={`schedule-${day}`}
          value={value}
          onChange={(e) => onChange(e.target.value as CharacterId)}
          style={{
            background: "var(--bg-input)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "4px 8px",
            fontSize: 13,
            color: "var(--accent)",
            fontWeight: 500,
            maxWidth: 220,
          }}
        >
          {ALL_CHARACTER_IDS.map((id) => (
            <option key={id} value={id} style={{ color: "var(--accent)" }}>
              {CHARACTER_LABEL_BY_ID[id]}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form, setForm] = useState(emptyAgent);
  const [saving, setSaving] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [handRaiseCounts, setHandRaiseCounts] = useState<Record<string, number>>({});
  const [dailyCounts, setDailyCounts] = useState<Record<string, number>>({});
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Bot character schedule editor
  const activeCharacter = useActiveCharacter();
  const [schedule, setSchedule] = useState<CharacterSchedule>(DEFAULT_SCHEDULE);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleStatus, setScheduleStatus] = useState<string | null>(null);

  // Load the current schedule from the settings endpoint once on mount.
  useEffect(() => {
    fetch("/api/internal/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data?.bot_character_schedule && typeof data.bot_character_schedule === "object") {
          setSchedule({ ...DEFAULT_SCHEDULE, ...data.bot_character_schedule });
        }
        setScheduleLoaded(true);
      })
      .catch(() => setScheduleLoaded(true));
  }, []);

  async function saveSchedule() {
    setScheduleSaving(true);
    setScheduleStatus(null);
    try {
      const res = await fetch("/api/internal/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_character_schedule: schedule }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setScheduleStatus(`Failed: ${data.error ?? res.statusText}`);
      } else {
        // Update the in-process cache so RoutingToggle/SpeechBubble pick up the
        // new schedule without a page refresh.
        setCachedSchedule(schedule);
        setScheduleStatus("Saved");
        setTimeout(() => setScheduleStatus(null), 2500);
      }
    } catch (err) {
      setScheduleStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScheduleSaving(false);
    }
  }

  function resetSchedule() {
    setSchedule({ ...DEFAULT_SCHEDULE });
  }

  const fetchData = useCallback(() => {
    Promise.all([
      fetch("/api/internal/agents").then((r) => r.json()),
      fetch("/api/internal/locations").then((r) => r.json()),
      fetch("/api/internal/lead-distribution").then((r) => r.json()),
      fetch("/api/internal/daily-counts").then((r) => r.json()),
    ])
      .then(([agentsData, locationsData, distData, dailyData]) => {
        if (Array.isArray(agentsData)) setAgents(agentsData);
        else setError(agentsData.error ?? "Failed to load agents");
        if (Array.isArray(locationsData)) setLocations(locationsData);
        if (distData?.distribution) {
          const counts: Record<string, number> = {};
          for (const entry of distData.distribution) {
            counts[entry.agentName] = entry.leadCount;
          }
          setHandRaiseCounts(counts);
        }
        if (dailyData?.dailyCounts) {
          setDailyCounts(dailyData.dailyCounts);
        }
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
  // Active non-frontlines agents must have full contact + Salesforce info so
  // lead routing and Salesforce ownership transfer work correctly.
  const requiresFullProfile = form.is_active && !isFrontlines;
  const missingRequiredFields =
    requiresFullProfile &&
    (!form.name.trim() ||
      !form.phone.trim() ||
      !form.email.trim() ||
      !form.salesforce_user_id.trim());

  // Split agents into active regular, inactive regular, and frontlines, then sort each group
  const activeRegularAgents = sortAgents(
    agents.filter((a) => !a.is_frontlines && a.is_active),
    sortKey,
    sortDir,
    handRaiseCounts,
    dailyCounts
  );
  const inactiveRegularAgents = sortAgents(
    agents.filter((a) => !a.is_frontlines && !a.is_active),
    sortKey,
    sortDir,
    handRaiseCounts,
    dailyCounts
  );
  const frontlinesAgents = sortAgents(
    agents.filter((a) => a.is_frontlines),
    sortKey,
    sortDir,
    handRaiseCounts,
    dailyCounts
  );

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function SortHeader({ label, sortKeyName, className, mobileLabel }: { label: string; sortKeyName: SortKey; className?: string; mobileLabel?: string }) {
    const active = sortKey === sortKeyName;
    return (
      <th
        className={className}
        onClick={() => handleSort(sortKeyName)}
        style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      >
        {mobileLabel ? (
          <>
            <span className="hide-mobile">{label}</span>
            <span className="show-mobile-only">{mobileLabel}</span>
          </>
        ) : (
          label
        )}{" "}
        <span style={{ opacity: active ? 1 : 0.3, fontSize: 10 }}>
          {active && sortDir === "desc" ? "\u25BC" : "\u25B2"}
        </span>
      </th>
    );
  }

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
      gender: agent.gender ?? "",
      is_frontlines: agent.is_frontlines,
      is_active: agent.is_active,
      location_specialties: agent.location_specialties,
      monthly_lead_goal_min: agent.monthly_lead_goal_min,
      monthly_lead_goal_max: agent.monthly_lead_goal_max,
      daily_lead_max: agent.daily_lead_max,
      unavailability_windows: agent.unavailability_windows ?? [],
      price_ranges: agent.price_ranges ?? [...ALL_PRICE_RANGES],
      send_draft_success_texts: agent.send_draft_success_texts ?? false,
      draft_success_phone: agent.draft_success_phone ?? "",
    });
    setShowModal(true);
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!editing || !e.target.files?.[0]) return;
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append("file", e.target.files[0]);
      formData.append("type", "agent");
      formData.append("id", editing.id);
      const res = await fetch("/api/internal/upload-photo", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Update local state
      setEditing({
        ...editing,
        photo_url: data.photo_url,
        photo_thumb_url: data.photo_thumb_url ?? null,
      });
      setAgents((prev) =>
        prev.map((a) =>
          a.id === editing.id
            ? {
                ...a,
                photo_url: data.photo_url,
                photo_thumb_url: data.photo_thumb_url ?? null,
              }
            : a
        )
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function handleSave() {
    if (requiresFullProfile) {
      const missing: string[] = [];
      if (!form.name.trim()) missing.push("Name");
      if (!form.phone.trim()) missing.push("Phone");
      if (!form.email.trim()) missing.push("Email");
      if (!form.salesforce_user_id.trim()) missing.push("Salesforce User ID");
      if (missing.length > 0) {
        alert(
          `Active agents require the following field${
            missing.length > 1 ? "s" : ""
          }: ${missing.join(", ")}.`
        );
        return;
      }
    }
    setSaving(true);
    const activeLocationNames = locations
      .filter((l) => l.is_active)
      .map((l) => l.name);
    const allLocationsSelected =
      activeLocationNames.length > 0 &&
      activeLocationNames.every((name) =>
        form.location_specialties.includes(name)
      );

    const payload = {
      ...form,
      location_specialties: allLocationsSelected ? [] : form.location_specialties,
      email: form.email || null,
      salesforce_user_id: form.salesforce_user_id || null,
      gender: form.gender || null,
      unavailability_windows:
        form.unavailability_windows.length > 0
          ? form.unavailability_windows
          : null,
      draft_success_phone: form.draft_success_phone || null,
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

  function addUnavailabilityWindow() {
    setForm((prev) => ({
      ...prev,
      unavailability_windows: [
        ...prev.unavailability_windows,
        { day: 1, start: "08:00", end: "17:00" },
      ],
    }));
  }

  function updateUnavailabilityWindow(
    index: number,
    field: keyof UnavailabilityWindow,
    value: string | number
  ) {
    setForm((prev) => {
      const updated = [...prev.unavailability_windows];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, unavailability_windows: updated };
    });
  }

  function removeUnavailabilityWindow(index: number) {
    setForm((prev) => ({
      ...prev,
      unavailability_windows: prev.unavailability_windows.filter(
        (_, i) => i !== index
      ),
    }));
  }

  async function togglePreferred(e: React.MouseEvent, agent: Agent) {
    e.stopPropagation(); // Don't open edit modal
    const newValue = !agent.is_preferred;
    // Optimistic update
    setAgents((prev) =>
      prev.map((a) => (a.id === agent.id ? { ...a, is_preferred: newValue } : a))
    );
    try {
      const res = await fetch("/api/internal/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: agent.id, is_preferred: newValue }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      // Sync with server response to avoid stale state
      const updated = await res.json();
      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, ...updated } : a))
      );
    } catch (err) {
      // Revert on failure
      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, is_preferred: !newValue } : a))
      );
      console.error("Failed to toggle preferred:", err);
    }
  }

  function renderAgentRow(agent: Agent) {
    const hrCount = handRaiseCounts[agent.name] ?? 0;
    const display = getDisplayAgent(agent);
    return (
      <tr key={agent.id} onClick={() => openEdit(agent)} style={{ cursor: "pointer" }}>
        <td>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              overflow: "hidden",
              background: "var(--bg-input)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              color: "var(--text-muted)",
            }}
          >
            {display.photo_url ? (
              <img
                src={display.photo_thumb_url ?? display.photo_url}
                alt={display.name}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              display.name.charAt(0).toUpperCase()
            )}
          </div>
        </td>
        <td className="hide-mobile">
          <span
            className={`status-dot ${agent.is_active ? "active" : "inactive"}`}
          />
          {agent.is_active ? "Active" : "Inactive"}
        </td>
        <td style={{ fontWeight: 600 }}>{display.name}</td>
        <td className="text-sm hide-mobile">
          {agent.location_specialties.length > 0
            ? agent.location_specialties.join(", ")
            : "All"}
        </td>
        <td className="text-sm hide-mobile">
          {!agent.price_ranges || agent.price_ranges.length === 0 ? (
            <span className="badge badge-muted">All</span>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {[...agent.price_ranges].sort((a, b) => ALL_PRICE_RANGES.indexOf(a) - ALL_PRICE_RANGES.indexOf(b)).map((r) => (
                <span key={r} className="badge badge-info">{PRICE_RANGE_LABELS[r]}</span>
              ))}
            </div>
          )}
        </td>
        <td className="font-mono hide-mobile">
          {agent.is_frontlines
            ? "-"
            : `${(agent.close_rate_trailing_12m * 100).toFixed(1)}%`}
        </td>
        <td className="font-mono hide-mobile">
          {agent.is_frontlines
            ? "-"
            : `${agent.monthly_lead_goal_min}-${agent.monthly_lead_goal_max}`}
        </td>
        <td className="font-mono hide-mobile">
          {agent.is_frontlines
            ? "-"
            : (() => {
                const todayCount = dailyCounts[agent.id] ?? 0;
                const max = agent.daily_lead_max;
                const atCap = max > 0 && todayCount >= max;
                return (
                  <span style={{ color: atCap ? "#f87171" : undefined }}>
                    {todayCount}{max > 0 ? ` / ${max}` : ""}
                  </span>
                );
              })()}
        </td>
        <td className="font-mono">{hrCount}</td>
        <td style={{ textAlign: "center" }}>
          <button
            type="button"
            onClick={(e) => togglePreferred(e, agent)}
            title={agent.is_preferred ? "Remove preference" : "Set as preferred for next form"}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
              borderRadius: 4,
              color: agent.is_preferred ? "#f59e0b" : "#3a3e4a",
              transition: "color 0.15s",
            }}
          >
            {agent.is_preferred ? "\u2605" : "\u2606"}
          </button>
        </td>
      </tr>
    );
  }

  function renderBotOnDutyRow(agent: Agent) {
    const display = getDisplayAgent(agent);
    return (
      <tr key={agent.id} onClick={() => openEdit(agent)} style={{ cursor: "pointer" }}>
        <td>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              overflow: "hidden",
              background: "var(--bg-input)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              color: "var(--text-muted)",
            }}
          >
            {display.photo_url ? (
              <img
                src={display.photo_thumb_url ?? display.photo_url}
                alt={display.name}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              display.name.charAt(0).toUpperCase()
            )}
          </div>
        </td>
        <td>
          <span
            className={`status-dot ${agent.is_active ? "active" : "inactive"}`}
          />
          {agent.is_active ? "Active" : "Inactive"}
        </td>
        <td style={{ fontWeight: 600 }}>{display.name}</td>
      </tr>
    );
  }

  function renderTableHead() {
    return (
      <thead>
        <tr>
          <th style={{ width: 50 }}>Photo</th>
          <SortHeader label="Status" sortKeyName="is_active" className="hide-mobile" />
          <SortHeader label="Name" sortKeyName="name" />
          <SortHeader label="Locations" sortKeyName="locations" className="hide-mobile" />
          <SortHeader label="Price Ranges" sortKeyName="price_ranges" className="hide-mobile" />
          <SortHeader label="Close Rate (12m)" sortKeyName="close_rate" className="hide-mobile" />
          <SortHeader label="Monthly Hand Raise Goal" sortKeyName="goal" className="hide-mobile" />
          <SortHeader label="Today" sortKeyName="today" className="hide-mobile" />
          <SortHeader label="Handraises This Month" sortKeyName="handraises" mobileLabel="Handraises" />
          <SortHeader label="Preferred" sortKeyName="is_preferred" />
        </tr>
      </thead>
    );
  }

  function renderBotOnDutyTableHead() {
    return (
      <thead>
        <tr>
          <th style={{ width: 50 }}>Photo</th>
          <SortHeader label="Status" sortKeyName="is_active" />
          <SortHeader label="Name" sortKeyName="name" />
        </tr>
      </thead>
    );
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
        <p>Manage sales agents, locations, and routing filters</p>
      </div>

      {error ? (
        <div className="card">
          <div className="empty-state">
            <h3>Error</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : (
        <>
          {/* Active Agents */}
          <div className="card">
            <div className="card-header">
              <h3>{activeRegularAgents.length} active agents</h3>
              <button className="btn btn-primary" onClick={openAdd}>
                + Add Agent
              </button>
            </div>
            {activeRegularAgents.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">&#9786;</div>
                <h3>No active agents</h3>
                <p>Add your first sales agent to get started.</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table>
                  {renderTableHead()}
                  <tbody>
                    {activeRegularAgents.map((agent) => renderAgentRow(agent))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Frontlines Agents */}
          {frontlinesAgents.length > 0 && (
            <div className="card" style={{ marginTop: 20 }}>
              <div className="card-header">
                <h3>Current Bot on Duty</h3>
              </div>
              <div className="table-wrapper">
                <table>
                  {renderBotOnDutyTableHead()}
                  <tbody>
                    {frontlinesAgents.map((agent) => renderBotOnDutyRow(agent))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Inactive Agents */}
          {inactiveRegularAgents.length > 0 && (
            <div className="card" style={{ marginTop: 20 }}>
              <div className="card-header">
                <h3>{inactiveRegularAgents.length} inactive agents</h3>
              </div>
              <div className="table-wrapper">
                <table>
                  {renderTableHead()}
                  <tbody>
                    {inactiveRegularAgents.map((agent) => renderAgentRow(agent))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
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

            {/* Photo upload (only when editing) */}
            {editing && (() => {
              // For the frontlines bot agent, swap the displayed photo + name
              // to whichever character is on duty today so the operator sees
              // who they're really staring at.
              const displayed = getDisplayAgent(editing);
              return (
              <div className="form-group" style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    overflow: "hidden",
                    background: "var(--bg-input)",
                    border: "2px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    color: "var(--text-muted)",
                    flexShrink: 0,
                  }}
                >
                  {displayed.photo_url ? (
                    <img
                      src={displayed.photo_url}
                      alt={displayed.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    displayed.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    style={{ display: "none" }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={uploadingPhoto}
                  >
                    {uploadingPhoto ? "Uploading..." : "Upload Photo"}
                  </button>
                </div>
              </div>
              );
            })()}

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
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {isFrontlines ? "Fallback Phone *" : "Phone *"}
                  {isFrontlines && (
                    <span
                      title="This should be your cell number in case you need to take on any form submissions manually"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        border: "1px solid var(--text-muted)",
                        fontSize: 11,
                        color: "var(--text-muted)",
                        cursor: "help",
                        flexShrink: 0,
                      }}
                    >
                      i
                    </span>
                  )}
                </label>
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
                <label>Email{requiresFullProfile ? " *" : ""}</label>
                <input
                  className="form-input"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="agent@example.com"
                />
              </div>
              {!isFrontlines && (
                <div className="form-group">
                  <label>Gender</label>
                  <select
                    className="form-input"
                    value={form.gender}
                    onChange={(e) => setForm({ ...form, gender: e.target.value as AgentGender | "" })}
                  >
                    <option value="">Not set</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Salesforce User ID{requiresFullProfile ? " *" : ""}
                  <span
                    title="Required for Salesforce lead ownership to transfer when this agent accepts a lead. To find it: in Salesforce, go to 'People', select the user, and copy the ID from the URL (the string after /lightning/r/User/ — starts with 005)."
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      border: "1px solid var(--text-muted)",
                      fontSize: 11,
                      color: "var(--text-muted)",
                      cursor: "help",
                      flexShrink: 0,
                    }}
                  >
                    i
                  </span>
                </label>
                <input
                  className="form-input"
                  value={form.salesforce_user_id}
                  onChange={(e) => setForm({ ...form, salesforce_user_id: e.target.value })}
                  placeholder="005..."
                />
              </div>
            </div>

            {/* Draft success text notifications (frontlines only) */}
            {isFrontlines && (
              <>
                <div className="form-group">
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={form.send_draft_success_texts}
                      onChange={(e) =>
                        setForm({ ...form, send_draft_success_texts: e.target.checked })
                      }
                    />
                    Send Draft Success Texts
                  </label>
                </div>

                <div className="form-group">
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    Email Draft Success Texts Phone
                    <span
                      title="This is the phone number that will receive draft completion texts."
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        border: "1px solid var(--text-muted)",
                        fontSize: 11,
                        color: "var(--text-muted)",
                        cursor: "help",
                        flexShrink: 0,
                      }}
                    >
                      i
                    </span>
                  </label>
                  <input
                    className="form-input"
                    value={form.draft_success_phone}
                    onChange={(e) => setForm({ ...form, draft_success_phone: e.target.value })}
                    placeholder="+19415551234"
                  />
                </div>
              </>
            )}

            {/* Everything below is hidden for frontlines agents */}
            {!isFrontlines && (
              <>
                {/* Close Rate (read-only) */}
                {editing && (
                  <div className="form-group">
                    <label>Close Rate 12m (from Salesforce)</label>
                    <div
                      className="form-input font-mono"
                      style={{
                        background: "var(--bg-input, #111318)",
                        opacity: 0.7,
                        cursor: "default",
                        maxWidth: 200,
                      }}
                    >
                      {(editing.close_rate_trailing_12m * 100).toFixed(1)}%
                    </div>
                  </div>
                )}

                {/* Location Multi-Select */}
                <div className="form-group">
                  <label>Locations</label>
                  <p className="text-muted text-sm" style={{ margin: "4px 0 8px" }}>
                    Only receives form submissions from selected locations. Leave empty for all.
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
                  {locations.filter((l) => l.is_active).length > 0 &&
                    locations
                      .filter((l) => l.is_active)
                      .every((l) => form.location_specialties.includes(l.name)) && (
                      <p className="text-muted text-sm" style={{ marginTop: 6 }}>
                        All locations selected &mdash; will be saved as &quot;All&quot; (no specialty bonus).
                      </p>
                    )}
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

                {/* Unavailability Windows */}
                <div className="form-group">
                  <label>Unavailable Times</label>
                  <p className="text-muted text-sm" style={{ margin: "4px 0 8px" }}>
                    Set times when this agent should NOT receive hand raises. Available by default.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {form.unavailability_windows.map((window, index) => (
                      <div
                        key={index}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "8px 12px",
                          background: "rgba(248, 113, 113, 0.08)",
                          border: "1px solid #2a2e3a",
                          borderRadius: 6,
                        }}
                      >
                        <select
                          className="form-input"
                          value={window.day}
                          onChange={(e) =>
                            updateUnavailabilityWindow(
                              index,
                              "day",
                              parseInt(e.target.value, 10)
                            )
                          }
                          style={{ flex: 1, minWidth: 0 }}
                        >
                          {DAY_LABELS.map((label, dayIndex) => (
                            <option key={dayIndex} value={dayIndex}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <input
                          className="form-input font-mono"
                          type="time"
                          value={window.start}
                          onChange={(e) =>
                            updateUnavailabilityWindow(index, "start", e.target.value)
                          }
                          style={{ width: 110 }}
                        />
                        <span className="text-muted" style={{ fontSize: 12 }}>to</span>
                        <input
                          className="form-input font-mono"
                          type="time"
                          value={window.end}
                          onChange={(e) =>
                            updateUnavailabilityWindow(index, "end", e.target.value)
                          }
                          style={{ width: 110 }}
                        />
                        <button
                          type="button"
                          onClick={() => removeUnavailabilityWindow(index)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#f87171",
                            cursor: "pointer",
                            fontSize: 18,
                            padding: "0 4px",
                            lineHeight: 1,
                          }}
                          title="Remove"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={addUnavailabilityWindow}
                      style={{ alignSelf: "flex-start" }}
                    >
                      + Add Unavailable Time
                    </button>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Monthly Hand Raise Goal Min</label>
                    <input
                      className="form-input"
                      type="number"
                      value={form.monthly_lead_goal_min || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          monthly_lead_goal_min: e.target.value === "" ? 0 : parseInt(e.target.value, 10),
                        })
                      }
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                  <div className="form-group">
                    <label>Monthly Hand Raise Goal Max</label>
                    <input
                      className="form-input"
                      type="number"
                      value={form.monthly_lead_goal_max || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          monthly_lead_goal_max: e.target.value === "" ? 0 : parseInt(e.target.value, 10),
                        })
                      }
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Daily Hand Raise Max</label>
                  <p className="text-muted text-sm" style={{ margin: "4px 0 8px" }}>
                    Soft cap on hand raises per day. Agent&apos;s score drops as they
                    approach this limit. Set to 0 to disable.
                  </p>
                  <input
                    className="form-input"
                    type="number"
                    min={0}
                    value={form.daily_lead_max || ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        daily_lead_max: e.target.value === "" ? 0 : parseInt(e.target.value, 10),
                      })
                    }
                    onFocus={(e) => e.target.select()}
                    style={{ maxWidth: 120 }}
                  />
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
              </>
            )}

            {isFrontlines && (
              <div className="form-group" style={{ marginTop: 24 }}>
                <h4 style={{ margin: "0 0 8px 0" }}>Bot Character Schedule</h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 0 }}>
                  Pick which character takes the watch each day (Eastern time).
                  Today is showing <strong>{activeCharacter.displayName}</strong>.
                </p>
                {!scheduleLoaded ? (
                  <p style={{ color: "var(--text-muted)" }}>Loading…</p>
                ) : (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "max-content 1fr",
                        gap: "8px 16px",
                        alignItems: "center",
                        maxWidth: 380,
                      }}
                    >
                      {ALL_DAYS.map((day) => (
                        <DayScheduleRow
                          key={day}
                          day={day}
                          value={schedule[day]}
                          onChange={(id) => setSchedule((prev) => ({ ...prev, [day]: id }))}
                        />
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={scheduleSaving}
                        onClick={saveSchedule}
                      >
                        {scheduleSaving ? "Saving…" : "Save schedule"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={scheduleSaving}
                        onClick={resetSchedule}
                        title="Reset to the built-in default schedule"
                      >
                        Reset to default
                      </button>
                      {scheduleStatus && (
                        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                          {scheduleStatus}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

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
                disabled={saving || !form.name.trim() || missingRequiredFields}
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
