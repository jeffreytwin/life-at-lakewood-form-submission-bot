// Nightly sync orchestration, driven by a frequent cron tick.
//
// The tick fires every 15 minutes; this decides whether it's time to run
// (Hub-configurable: enabled flag + hour in ET, stored on system_settings),
// processes nightly-eligible connections in time-budgeted batches (a cycle
// resumes across ticks until every connection is covered), and sends the
// digest SMS when the cycle completes.
//
// Eligibility: connection active, builder active, and onboarded_at set —
// i.e. the connection has succeeded at least one manual run. New builders
// never reach automation without passing through human review first.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { runConnection } from "@/lib/floorplans/sync";

const TICK_BUDGET_MS = 240_000; // leave headroom under the function limit

interface NightlyState {
  cycleDate?: string; // ET date the current/last cycle belongs to
  startedAt?: string;
  completedAt?: string;
  ran?: number;
  failed?: number;
}

function etParts(now = new Date()): { date: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10) % 24,
  };
}

async function sendDigest(phone: string, message: string) {
  try {
    const { getTwilioClient, getTwilioPhoneNumber } = await import("@/lib/twilio/client");
    await getTwilioClient().messages.create({
      to: phone,
      from: getTwilioPhoneNumber(),
      body: message,
    });
  } catch (error) {
    logger.error("Floor plan digest SMS failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function runNightlyTick(): Promise<Record<string, unknown>> {
  const { data: settings, error } = await supabase
    .from("system_settings")
    .select("fp_nightly_enabled, fp_nightly_hour, fp_digest_phone, fp_nightly_state")
    .eq("id", 1)
    .single();
  if (error || !settings) return { skipped: "no settings row" };
  if (!settings.fp_nightly_enabled) return { skipped: "nightly disabled" };

  const { date: today, hour } = etParts();
  const state = (settings.fp_nightly_state ?? {}) as NightlyState;

  if (state.cycleDate === today && state.completedAt) {
    return { skipped: "already completed today" };
  }
  const cycleInProgress = state.cycleDate === today && state.startedAt;
  if (!cycleInProgress && hour < settings.fp_nightly_hour) {
    return { skipped: `waiting for ${settings.fp_nightly_hour}:00 ET` };
  }

  const startedAt = cycleInProgress ? state.startedAt! : new Date().toISOString();
  if (!cycleInProgress) {
    await supabase
      .from("system_settings")
      .update({ fp_nightly_state: { cycleDate: today, startedAt, ran: 0, failed: 0 } })
      .eq("id", 1);
    logger.info("Floor plan nightly cycle starting", { today, hour });
  }

  // Connections still needing a run this cycle.
  const { data: pending } = await supabase
    .from("fp_builder_communities")
    .select("id, last_run_at, fp_builders:builder_id(active)")
    .eq("active", true)
    .not("onboarded_at", "is", null)
    .or(`last_run_at.is.null,last_run_at.lt.${startedAt}`);
  const todo = (pending ?? []).filter(
    (c) => (c.fp_builders as unknown as { active: boolean } | null)?.active
  );

  let ran = state.ran ?? 0;
  let failed = state.failed ?? 0;
  const deadline = Date.now() + TICK_BUDGET_MS;
  let processed = 0;

  for (const conn of todo) {
    if (Date.now() > deadline) break;
    const result = await runConnection(conn.id);
    processed += 1;
    ran += 1;
    if (result.status === "failed") failed += 1;
  }

  const remaining = todo.length - processed;
  const nextState: NightlyState = { cycleDate: today, startedAt, ran, failed };

  if (remaining <= 0) {
    nextState.completedAt = new Date().toISOString();
    const { count: pendingCount } = await supabase
      .from("fp_pending_changes")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    const { count: starredTouched } = await supabase
      .from("fp_follow_up_tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "open");
    const digest =
      `Floor plan sync: ${pendingCount ?? 0} changes awaiting review` +
      (starredTouched ? ` (${starredTouched} starred-plan follow-ups open)` : "") +
      `. Ran ${ran} connections${failed ? `, ${failed} failed` : ""}.`;
    logger.info("Floor plan nightly cycle complete", { ran, failed, pendingCount });
    if (settings.fp_digest_phone) await sendDigest(settings.fp_digest_phone, digest);
  }

  await supabase.from("system_settings").update({ fp_nightly_state: nextState }).eq("id", 1);
  return { processed, remaining: Math.max(0, remaining), ran, failed, complete: remaining <= 0 };
}
