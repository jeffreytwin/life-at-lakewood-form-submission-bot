/**
 * The War Room's rows (Jeff, 2026-11-07): the year's goals and the to-do
 * list, in wr_goals and wr_tasks (migration 091).
 */

import { supabase } from "@/lib/supabase/client";
import { GOAL_METRICS, type GoalMetric, type GoalTarget } from "./metrics";

export type TaskPriority = "high" | "medium" | "low";

export interface WarRoomTask {
  id: string;
  title: string;
  dueDate: string | null;
  priority: TaskPriority;
  doneAt: string | null;
  createdAt: string;
}

/** Finished tasks stay on the list this long, struck through. */
const DONE_VISIBLE_DAYS = 14;

interface TaskRow {
  id: string;
  title: string;
  due_date: string | null;
  priority: TaskPriority;
  done_at: string | null;
  created_at: string;
}

const toTask = (r: TaskRow): WarRoomTask => ({
  id: r.id,
  title: r.title,
  dueDate: r.due_date,
  priority: r.priority,
  doneAt: r.done_at,
  createdAt: r.created_at,
});

export async function getGoals(year: number): Promise<GoalTarget[]> {
  const { data, error } = await supabase.from("wr_goals").select("metric, target, stretch_target").eq("year", year);
  if (error) throw error;
  const byMetric = new Map((data ?? []).map((r) => [r.metric as GoalMetric, r]));
  // In metric order; a metric with no row has no goal yet and is left out.
  return GOAL_METRICS.flatMap((metric) => {
    const r = byMetric.get(metric);
    if (!r) return [];
    return [{ metric, target: Number(r.target), stretchTarget: r.stretch_target === null ? null : Number(r.stretch_target) }];
  });
}

/** Replace the year's goals: metrics not in `goals` are cleared. */
export async function saveGoals(year: number, goals: GoalTarget[]): Promise<void> {
  const now = new Date().toISOString();
  if (goals.length > 0) {
    const { error } = await supabase.from("wr_goals").upsert(
      goals.map((g) => ({ year, metric: g.metric, target: g.target, stretch_target: g.stretchTarget, updated_at: now })),
      { onConflict: "year,metric" },
    );
    if (error) throw error;
  }
  const cleared = GOAL_METRICS.filter((m) => !goals.some((g) => g.metric === m));
  if (cleared.length > 0) {
    const { error } = await supabase.from("wr_goals").delete().eq("year", year).in("metric", cleared);
    if (error) throw error;
  }
}

/** Open tasks by due date (undated last), then recently finished ones. */
export async function listTasks(): Promise<WarRoomTask[]> {
  const since = new Date(Date.now() - DONE_VISIBLE_DAYS * 86_400_000).toISOString();
  const [open, done] = await Promise.all([
    supabase
      .from("wr_tasks")
      .select("*")
      .is("done_at", null)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase.from("wr_tasks").select("*").gte("done_at", since).order("done_at", { ascending: false }),
  ]);
  if (open.error) throw open.error;
  if (done.error) throw done.error;
  return [...(open.data ?? []), ...(done.data ?? [])].map(toTask);
}

export async function createTask(t: { title: string; dueDate: string | null; priority: TaskPriority }): Promise<WarRoomTask> {
  const { data, error } = await supabase
    .from("wr_tasks")
    .insert({ title: t.title, due_date: t.dueDate, priority: t.priority })
    .select("*")
    .single();
  if (error) throw error;
  return toTask(data);
}

export async function updateTask(
  id: string,
  change: { done?: boolean; title?: string; dueDate?: string | null; priority?: TaskPriority },
): Promise<WarRoomTask | null> {
  const row: Record<string, unknown> = {};
  if (change.done !== undefined) row.done_at = change.done ? new Date().toISOString() : null;
  if (change.title !== undefined) row.title = change.title;
  if (change.dueDate !== undefined) row.due_date = change.dueDate;
  if (change.priority !== undefined) row.priority = change.priority;
  const { data, error } = await supabase.from("wr_tasks").update(row).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  return data ? toTask(data) : null;
}

export async function deleteTask(id: string): Promise<boolean> {
  const { data, error } = await supabase.from("wr_tasks").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** UTC instant of midnight Eastern on `date` ("2026-11-07"). */
export function easternMidnight(date: string): string {
  // 05:00 UTC is midnight or 1 a.m. Eastern: before a 2 a.m. clock change,
  // so the offset read there is the one midnight had.
  const probe = new Date(`${date}T05:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value; // "GMT-5"
  const hours = Number(offset?.replace("GMT", "") || "-5");
  return new Date(Date.parse(`${date}T00:00:00Z`) - hours * 3_600_000).toISOString();
}

/** Form submissions since midnight Eastern, not counting ones marked bad data. */
export async function countLeadsToday(today: string): Promise<number> {
  const { count, error } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", easternMidnight(today))
    .neq("routing_status", "bad_data");
  if (error) throw error;
  return count ?? 0;
}
