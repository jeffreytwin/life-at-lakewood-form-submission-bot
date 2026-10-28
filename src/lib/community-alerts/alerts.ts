// Community Alerts as the Hub shows and works them (Jeff, 2026-10-17): an
// open alert stays open until a person marks its settled to-do list
// complete (Jeff, 2026-10-28: "a button to officially mark it as
// complete"), or dismisses it with a reason. Closed ones are kept, and can
// be reopened.

import { supabase } from "@/lib/supabase/client";
import { failedAt as failed } from "@/lib/shared/describe-error";
import {
  checklistFor,
  LEGACY_DOMAIN,
  progressOf,
  type AlertKind,
  type ChecklistItem,
  type ItemState,
} from "@/lib/community-alerts/checklists";

export type AlertStatus = "open" | "done" | "dismissed";

interface AlertRow {
  id: string;
  kind: AlertKind;
  status: AlertStatus;
  name: string;
  detail: Record<string, unknown> & { site?: string };
  dismissed_reason: string | null;
  resolved_at: string | null;
  created_at: string;
  ca_alert_items?: ItemState[];
}

export interface AlertView {
  id: string;
  kind: AlertKind;
  status: AlertStatus;
  name: string;
  detail: AlertRow["detail"];
  dismissedReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
  items: (ChecklistItem & { state: ItemState | null })[];
  progress: { settled: number; total: number; complete: boolean };
}

export type Outcome = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };

const ALERT_COLUMNS = "id, kind, status, name, detail, dismissed_reason, resolved_at, created_at";
const ITEM_COLUMNS = "item_key, done_at, by_hand, not_applicable, choice, note";

function itemsOf(alert: Pick<AlertRow, "kind" | "detail">): ChecklistItem[] {
  // A school zones alert's to-do is the village's static page, while it names other schools.
  const staticPage = alert.detail?.source === "page" || Boolean(alert.detail?.staticPage);
  return checklistFor(alert.kind, { legacySite: alert.detail?.site === LEGACY_DOMAIN, staticPage });
}

/** An alert with its to-do list in order, each item beside what was done about it. Pure; exported for tests. */
export function viewOf(alert: AlertRow): AlertView {
  const states = alert.ca_alert_items ?? [];
  const byKey = new Map(states.map((s) => [s.item_key, s]));
  const items = itemsOf(alert);
  return {
    id: alert.id,
    kind: alert.kind,
    status: alert.status,
    name: alert.name,
    detail: alert.detail ?? {},
    dismissedReason: alert.dismissed_reason,
    createdAt: alert.created_at,
    resolvedAt: alert.resolved_at,
    items: items.map((i) => ({ ...i, state: byKey.get(i.key) ?? null })),
    progress: progressOf(items, states),
  };
}

/** The open alerts, newest first; or the closed ones, most recently closed first. */
export async function listAlerts(scope: "open" | "closed", limit = 100): Promise<AlertView[]> {
  let query = supabase.from("ca_alerts").select(`${ALERT_COLUMNS}, ca_alert_items(${ITEM_COLUMNS})`);
  query =
    scope === "open"
      ? query.eq("status", "open").order("created_at", { ascending: false })
      : query.neq("status", "open").order("resolved_at", { ascending: false });
  const { data, error } = await query.limit(limit);
  if (error) throw failed("reading the community alerts", error);
  return ((data ?? []) as unknown as AlertRow[]).map(viewOf);
}

/** How many alerts are open, for the menu's badge. */
export async function countOpen(): Promise<number> {
  const { count, error } = await supabase.from("ca_alerts").select("id", { count: "exact", head: true }).eq("status", "open");
  if (error) throw failed("counting the open community alerts", error);
  return count ?? 0;
}

async function readAlert(id: string): Promise<AlertRow | null> {
  const { data, error } = await supabase
    .from("ca_alerts")
    .select(`${ALERT_COLUMNS}, ca_alert_items(${ITEM_COLUMNS})`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw failed("reading the alert", error);
  return (data as unknown as AlertRow | null) ?? null;
}

/**
 * Closes an open alert as done, once a person says so. Only when every
 * item is done or not applicable: a settled list is never closed for them.
 */
export async function completeAlert(id: string): Promise<Outcome> {
  const alert = await readAlert(id);
  if (!alert || alert.status !== "open") return { ok: false, status: 404, error: "No open alert by that id" };
  // A school zones alert with no list is done once its page names the schools the zones do.
  const levels = (alert.detail as { levels?: { page: string; proposed: string }[] }).levels;
  const schoolsMatch = alert.kind === "school_zones" && Array.isArray(levels) && !levels.some((l) => l.proposed && l.page !== l.proposed);
  if (!viewOf(alert).progress.complete && !schoolsMatch) return { ok: false, status: 409, error: "Every item has to be done or N/A first" };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("ca_alerts")
    .update({ status: "done", resolved_at: now, updated_at: now })
    .eq("id", id)
    .eq("status", "open")
    .select("id");
  if (error) throw failed("completing the alert", error);
  if (!data?.length) return { ok: false, status: 404, error: "No open alert by that id" };
  return { ok: true };
}

export interface ItemChange {
  done?: boolean;
  notApplicable?: boolean;
  choice?: string;
  note?: string | null;
}

/**
 * A person working an item: checking it (with an answer, where it asks
 * for one), unchecking it, marking it not applicable, or writing a note.
 * Unchecking a self-checking item hands it back to the Hub's check.
 */
export async function changeItem(alertId: string, key: string, change: ItemChange): Promise<Outcome> {
  const alert = await readAlert(alertId);
  if (!alert) return { ok: false, status: 404, error: "No alert by that id" };
  if (alert.status !== "open") return { ok: false, status: 409, error: "This alert is closed; reopen it first" };
  const item = itemsOf(alert).find((i) => i.key === key);
  if (!item) return { ok: false, status: 400, error: `This alert has no item "${key}"` };

  const current = (alert.ca_alert_items ?? []).find((s) => s.item_key === key);
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { alert_id: alertId, item_key: key, updated_at: now };

  if (change.done === true) {
    if (item.choices) {
      if (!change.choice || !item.choices.some((c) => c.value === change.choice)) {
        return { ok: false, status: 400, error: `Pick one of: ${item.choices.map((c) => c.label).join(", ")}` };
      }
      row.choice = change.choice;
    }
    row.done_at = current?.done_at ?? now;
    row.by_hand = true;
  } else if (change.done === false) {
    row.done_at = null;
    row.choice = null;
    row.by_hand = false;
  }
  if (typeof change.notApplicable === "boolean") row.not_applicable = change.notApplicable;
  if (change.note !== undefined) row.note = change.note?.trim() ? change.note.trim().slice(0, 1000) : null;

  const { error } = await supabase.from("ca_alert_items").upsert(row, { onConflict: "alert_id,item_key" });
  if (error) throw failed(`saving the "${key}" item`, error);
  return { ok: true };
}

/** Closes an open alert without its list done. A reason is required: it is what History shows. */
export async function dismissAlert(id: string, reason: string): Promise<Outcome> {
  const why = reason.trim();
  if (!why) return { ok: false, status: 400, error: "Say why it is being dismissed" };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("ca_alerts")
    .update({ status: "dismissed", dismissed_reason: why.slice(0, 1000), resolved_at: now, updated_at: now })
    .eq("id", id)
    .eq("status", "open")
    .select("id");
  if (error) throw failed("dismissing the alert", error);
  if (!data?.length) return { ok: false, status: 404, error: "No open alert by that id" };
  return { ok: true };
}

/** Opens a closed alert again, its items as they were left. */
export async function reopenAlert(id: string): Promise<Outcome> {
  const { data, error } = await supabase
    .from("ca_alerts")
    .update({ status: "open", dismissed_reason: null, resolved_at: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .neq("status", "open")
    .select("id");
  // One open alert of a kind per neighborhood: a newer one is open already.
  if (error?.code === "23505") return { ok: false, status: 409, error: "A newer alert for this neighborhood is already open" };
  if (error) throw failed("reopening the alert", error);
  if (!data?.length) return { ok: false, status: 404, error: "No closed alert by that id" };
  return { ok: true };
}

/**
 * A self-checking item set to what the Hub sees, unless a person has
 * answered it by hand: their answer stands.
 */
export async function setSelfCheck(alertId: string, key: string, passes: boolean, choice: string | null): Promise<void> {
  const { data: current, error } = await supabase
    .from("ca_alert_items")
    .select("done_at, by_hand, not_applicable")
    .eq("alert_id", alertId)
    .eq("item_key", key)
    .maybeSingle();
  if (error) throw failed(`reading the alert's "${key}" item`, error);
  if (current?.by_hand || current?.not_applicable) return;
  if (Boolean(current?.done_at) === passes) return;
  const now = new Date().toISOString();
  const { error: writeError } = await supabase.from("ca_alert_items").upsert(
    {
      alert_id: alertId,
      item_key: key,
      done_at: passes ? now : null,
      by_hand: false,
      choice: passes ? choice : null,
      updated_at: now,
    },
    { onConflict: "alert_id,item_key" }
  );
  if (writeError) throw failed(`checking the alert's "${key}" item`, writeError);
}

/**
 * Closes an open new-neighborhood or announcement alert and keeps its name off every scan
 * of the site from now on (Jeff, 2026-10-17: a neighborhood "flagged as
 * 'ignore'"). The reason is optional; Ignored is the reason enough.
 */
export async function ignoreAlert(id: string, reason: string): Promise<Outcome> {
  const { data: alert, error } = await supabase
    .from("ca_alerts")
    .select("id, kind, status, site_id, subject_key, name")
    .eq("id", id)
    .maybeSingle();
  if (error) throw failed("reading the alert", error);
  if (!alert || alert.status !== "open") return { ok: false, status: 404, error: "No open alert by that id" };
  if (!["new_neighborhood", "announcement"].includes(alert.kind) || !alert.site_id || !alert.subject_key) {
    return { ok: false, status: 400, error: "Only a new neighborhood or an announcement can be ignored" };
  }
  const why = reason.trim().slice(0, 1000) || null;
  const { error: ignoreError } = await supabase
    .from("ca_ignored_neighborhoods")
    .upsert({ site_id: alert.site_id, name_key: alert.subject_key, name: alert.name, reason: why }, { onConflict: "site_id,name_key" });
  if (ignoreError) throw failed("ignoring the neighborhood", ignoreError);
  return dismissAlert(id, why ? `Ignored: ${why}` : "Ignored");
}

export interface IgnoredNeighborhood {
  id: string;
  name: string;
  site: string | null;
  reason: string | null;
  createdAt: string;
}

export async function listIgnored(): Promise<IgnoredNeighborhood[]> {
  const { data, error } = await supabase
    .from("ca_ignored_neighborhoods")
    .select("id, name, reason, created_at, fp_sites:site_id(domain)")
    .order("created_at", { ascending: false });
  if (error) throw failed("reading the ignored neighborhoods", error);
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    site: (r.fp_sites as unknown as { domain: string } | null)?.domain ?? null,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

/** Lets an ignored name be raised again by the next scan that finds homes in it. */
export async function unignore(id: string): Promise<Outcome> {
  const { data, error } = await supabase.from("ca_ignored_neighborhoods").delete().eq("id", id).select("id");
  if (error) throw failed("un-ignoring the neighborhood", error);
  if (!data?.length) return { ok: false, status: 404, error: "No ignored neighborhood by that id" };
  return { ok: true };
}
