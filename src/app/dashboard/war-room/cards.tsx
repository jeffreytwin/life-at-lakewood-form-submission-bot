"use client";

import { useState } from "react";
import { emitLeadEvent } from "@/lib/lead-events";
import {
  GOAL_LABELS,
  GOAL_METRICS,
  PERIOD_LABELS,
  addDays,
  easternDate,
  shortDate,
  type GoalMetric,
  type GoalProgress,
  type GoalTarget,
  type PeriodTotals,
  type StatusPeriod,
} from "@/lib/war-room/metrics";
import type { TaskPriority, WarRoomTask } from "@/lib/war-room/store";
import { ChecklistIcon, GoalIcon, SignalIcon, TargetIcon } from "./icons";

// ============================================================
// FORMATTING
// ============================================================

/** $2.50M, $700K, $950 */
export function money(n: number): string {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}K`;
  return `${sign}$${Math.round(a)}`;
}

const isMoney = (m: GoalMetric) => m !== "transactions";
const fmtGoal = (m: GoalMetric, n: number) => (isMoney(m) ? money(n) : Math.round(n).toLocaleString());
const pct = (x: number) => `${Math.round(x * 100)}%`;

const SAMPLE_TITLE = "Sample numbers until the Salesforce and ad-spend Zaps are connected";

function SampleChip({ show }: { show: boolean }) {
  return show ? (
    <span className="wr-sample" title={SAMPLE_TITLE}>
      Sample data
    </span>
  ) : null;
}

// ============================================================
// BIG GOALS
// ============================================================

export function GoalsCard({
  year,
  goals,
  targets,
  sample,
  loading,
  onSaved,
}: {
  year: number;
  goals: GoalProgress[];
  targets: GoalTarget[];
  sample: boolean;
  loading: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="card wr-card">
      <div className="wr-card-head">
        <span className="wr-card-icon">
          <TargetIcon />
        </span>
        <h3>Big Goals ({year})</h3>
        <SampleChip show={sample} />
        <button className="btn btn-secondary btn-sm wr-head-btn" onClick={() => setEditing(true)} disabled={loading}>
          ✎ Edit Goals
        </button>
      </div>
      {loading ? (
        <div className="wr-empty">Loading…</div>
      ) : goals.length === 0 ? (
        <div className="wr-empty">
          No goals set for {year}.{" "}
          <button className="wr-link" onClick={() => setEditing(true)}>
            Set them
          </button>
        </div>
      ) : (
        <ul className="wr-goals">
          {goals.map((g) => (
            <GoalRow key={g.metric} goal={g} />
          ))}
        </ul>
      )}
      {editing && (
        <EditGoalsModal
          year={year}
          targets={targets}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
    </section>
  );
}

const PACE_TEXT = { ahead: "Ahead of pace", on_pace: "On pace", behind: "Behind pace" } as const;

function GoalRow({ goal: g }: { goal: GoalProgress }) {
  const fill = Math.min(1, g.progress);
  const stretchNote = g.stretchTarget ? ` (stretch ${fmtGoal(g.metric, g.stretchTarget)})` : "";
  return (
    <li className={`wr-goal wr-pace-${g.pace}`}>
      <span className="wr-goal-icon">
        <GoalIcon metric={g.metric} />
      </span>
      <div className="wr-goal-body">
        <div className="wr-goal-top">
          <div>
            <div className="wr-goal-label">{g.label}</div>
            <div className="wr-goal-sub">
              Goal {fmtGoal(g.metric, g.target)}
              {stretchNote}
            </div>
          </div>
          <div className="wr-goal-nums">
            <strong>{fmtGoal(g.metric, g.actual)}</strong> / {fmtGoal(g.metric, g.target)}
          </div>
        </div>
        <div
          className="wr-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(g.progress * 100)}
          aria-label={`${g.label}: ${pct(g.progress)} of goal`}
        >
          <div className="wr-bar-fill" style={{ width: `${fill * 100}%` }} />
          {g.expected > 0 && g.expected < 1 && (
            <div className="wr-bar-pace" style={{ left: `${g.expected * 100}%` }} title={`Today's pace mark: ${pct(g.expected)} of the year is gone`} />
          )}
        </div>
        <div className="wr-goal-foot">
          <span className="wr-pace-text">
            {PACE_TEXT[g.pace]} · on track for {fmtGoal(g.metric, g.projected)}
          </span>
          <span className="wr-goal-pct">{pct(g.progress)}</span>
        </div>
      </div>
    </li>
  );
}

function EditGoalsModal({
  year,
  targets,
  onClose,
  onSaved,
}: {
  year: number;
  targets: GoalTarget[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = Object.fromEntries(
    GOAL_METRICS.map((m) => {
      const t = targets.find((x) => x.metric === m);
      return [m, { target: t ? String(t.target) : "", stretch: t?.stretchTarget ? String(t.stretchTarget) : "" }];
    }),
  ) as Record<GoalMetric, { target: string; stretch: string }>;
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (s: string) => Number(s.replace(/[$,\s]/g, ""));

  async function save() {
    const goals: GoalTarget[] = [];
    for (const m of GOAL_METRICS) {
      const v = values[m];
      if (v.target.trim() === "") continue;
      const target = num(v.target);
      const stretch = v.stretch.trim() === "" ? null : num(v.stretch);
      if (!(target > 0) || (stretch !== null && !(stretch > 0))) {
        setError(`${GOAL_LABELS[m]}: enter a number above zero, or leave it blank`);
        return;
      }
      goals.push({ metric: m, target, stretchTarget: stretch });
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/internal/war-room/goals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, goals }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${year} goals`}>
        <h3>{year} Goals</h3>
        <p className="text-muted text-sm" style={{ marginTop: -12, marginBottom: 16 }}>
          Dollar goals in whole dollars (2800000). Leave a goal blank to remove it.
        </p>
        {GOAL_METRICS.map((m) => (
          <div className="form-row" key={m}>
            <div className="form-group">
              <label htmlFor={`goal-${m}`}>{GOAL_LABELS[m]}</label>
              <input
                id={`goal-${m}`}
                className="form-input"
                inputMode="numeric"
                value={values[m].target}
                placeholder={isMoney(m) ? "Dollars" : "Closings"}
                onChange={(e) => setValues({ ...values, [m]: { ...values[m], target: e.target.value } })}
              />
            </div>
            <div className="form-group">
              <label htmlFor={`stretch-${m}`}>Stretch (optional)</label>
              <input
                id={`stretch-${m}`}
                className="form-input"
                inputMode="numeric"
                value={values[m].stretch}
                onChange={(e) => setValues({ ...values, [m]: { ...values[m], stretch: e.target.value } })}
              />
            </div>
          </div>
        ))}
        {error && <div className="wr-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Goals"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CURRENT OBJECTIVES (TO-DOS)
// ============================================================

/** Open tasks shown before "View all". */
const TASKS_SHOWN = 7;

const PRIORITY_LABEL: Record<TaskPriority, string> = { high: "High", medium: "Medium", low: "Low" };

export function TasksCard({ tasks, now, onChange }: { tasks: WarRoomTask[] | null; now: Date; onChange: () => Promise<void> | void }) {
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A checkbox flips at once; the list catches up when the save lands.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  const today = easternDate(now);
  const list = tasks ?? [];
  const isDone = (t: WarRoomTask) => optimistic[t.id] ?? t.doneAt !== null;
  const visible = showAll ? list : list.slice(0, TASKS_SHOWN);

  async function send(id: string, method: "PATCH" | "DELETE", body?: object) {
    setBusy(id);
    setError(null);
    try {
      const r = await fetch(`/api/internal/war-room/tasks/${id}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      await onChange();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setOptimistic((o) => {
        const rest = { ...o };
        delete rest[id];
        return rest;
      });
      setBusy(null);
    }
  }

  async function toggle(t: WarRoomTask) {
    const done = !isDone(t);
    setOptimistic((o) => ({ ...o, [t.id]: done }));
    const ok = await send(t.id, "PATCH", { done });
    if (ok && done) emitLeadEvent({ type: "war_room_task_done", leadName: t.title });
  }

  function remove(t: WarRoomTask) {
    if (!window.confirm(`Delete "${t.title}"?`)) return;
    send(t.id, "DELETE");
  }

  return (
    <section className="card wr-card">
      <div className="wr-card-head">
        <span className="wr-card-icon">
          <ChecklistIcon />
        </span>
        <h3>Current Objectives</h3>
        <button className="btn btn-primary btn-sm wr-head-btn" onClick={() => setAdding((a) => !a)}>
          {adding ? "Cancel" : "+ Add Task"}
        </button>
      </div>

      {adding && (
        <AddTaskForm
          today={today}
          onAdded={async () => {
            setAdding(false);
            await onChange();
          }}
        />
      )}
      {error && <div className="wr-error">{error}</div>}

      {tasks === null ? (
        <div className="wr-empty">Loading…</div>
      ) : list.length === 0 ? (
        <div className="wr-empty">No tasks yet. Add the first objective.</div>
      ) : (
        <ul className="wr-tasks">
          {visible.map((t) => {
            const done = isDone(t);
            const overdue = !done && t.dueDate !== null && t.dueDate < today;
            return (
              <li key={t.id} className={`wr-task${done ? " wr-task-done" : ""}`}>
                <input
                  type="checkbox"
                  className="wr-check"
                  checked={done}
                  disabled={busy === t.id}
                  onChange={() => toggle(t)}
                  aria-label={`Mark "${t.title}" ${done ? "not done" : "done"}`}
                />
                <span className="wr-task-title">{t.title}</span>
                <span className={`wr-task-due${overdue ? " wr-overdue" : ""}`} title={overdue ? "Overdue" : undefined}>
                  {t.dueDate ? (t.dueDate === today ? "Today" : shortDate(t.dueDate)) : ""}
                </span>
                <span className={`wr-chip ${done ? "wr-chip-done" : `wr-chip-${t.priority}`}`}>
                  {done ? "Complete" : PRIORITY_LABEL[t.priority]}
                </span>
                <button className="wr-task-del" onClick={() => remove(t)} disabled={busy === t.id} aria-label={`Delete "${t.title}"`} title="Delete">
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {list.length > TASKS_SHOWN && (
        <button className="wr-link wr-view-all" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show fewer" : `View all ${list.length} tasks →`}
        </button>
      )}
    </section>
  );
}

function AddTaskForm({ today, onAdded }: { today: string; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(addDays(today, 7));
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/internal/war-room/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), dueDate: dueDate || null, priority }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form className="wr-add-task" onSubmit={submit}>
      <input
        className="form-input wr-add-title"
        placeholder="What needs doing?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        maxLength={300}
        aria-label="Task"
      />
      <input className="form-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" />
      <select className="form-input" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} aria-label="Priority">
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <button className="btn btn-primary btn-sm" type="submit" disabled={saving || !title.trim()}>
        {saving ? "Adding…" : "Add"}
      </button>
      {error && <div className="wr-error wr-add-error">{error}</div>}
    </form>
  );
}

// ============================================================
// MISSION STATUS
// ============================================================

export function StatusCard({
  totals,
  period,
  onPeriod,
  sample,
}: {
  totals: PeriodTotals | null;
  period: StatusPeriod;
  onPeriod: (p: StatusPeriod) => void;
  sample: boolean;
}) {
  const tiles: { label: string; value: string; tone?: string; title?: string }[] = totals
    ? [
        { label: "Contracts", value: totals.contracts.toLocaleString() },
        { label: "Closings", value: totals.closings.toLocaleString() },
        { label: "Pre-Split", value: money(totals.preSplit), tone: "green" },
        { label: "Post-Split", value: money(totals.postSplit), tone: "green" },
        { label: "Ad Spend", value: money(totals.adSpend), tone: "violet" },
        {
          label: "ROAS",
          value: totals.roas === null ? "—" : `${totals.roas.toFixed(1)}x`,
          tone: "green",
          title: "Pre-split revenue ÷ ad spend for the period",
        },
      ]
    : [];
  return (
    <section className="card wr-card">
      <div className="wr-card-head">
        <span className="wr-card-icon">
          <SignalIcon />
        </span>
        <h3>Mission Status</h3>
        <SampleChip show={sample} />
        <select
          className="form-input wr-period"
          value={period}
          onChange={(e) => onPeriod(e.target.value as StatusPeriod)}
          aria-label="Period"
        >
          {(Object.keys(PERIOD_LABELS) as StatusPeriod[]).map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </select>
      </div>
      {!totals ? (
        <div className="wr-empty">Loading…</div>
      ) : (
        <>
          <div className="wr-tiles">
            {tiles.map((t) => (
              <div key={t.label} className="wr-tile" title={t.title}>
                <div className="wr-tile-label">{t.label}</div>
                <div className={`wr-tile-value${t.tone ? ` wr-tile-${t.tone}` : ""}`}>{t.value}</div>
              </div>
            ))}
          </div>
          <div className="wr-status-foot">
            Profit {money(totals.profit)} for the period, after ad spend and other expenses.
            {sample && " Real numbers arrive with the Salesforce and ad-spend Zaps."}
          </div>
        </>
      )}
    </section>
  );
}
