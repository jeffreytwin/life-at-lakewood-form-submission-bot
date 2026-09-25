// A connection's run, held so that only one runs at a time and so that the
// Builder Connections page can tell it is running after whoever pressed
// Run has left (Jeff, 2026-09-25). The mark is fp_builder_communities.
// run_started_at: set when a run starts, cleared when it ends. A function
// lives five minutes at most, so a mark older than that is a run that was
// cut off, and the sync tick clears it (sweepCutOffRuns).

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { runConnection, type RunResult } from "@/lib/floorplans/sync";
import { RUN_HELD_MS, runGoing } from "@/lib/floorplans/run-state";

/** Take the connection for one run. False when another run has it. */
export async function holdRun(connectionId: string): Promise<boolean> {
  const now = Date.now();
  const cutOff = new Date(now - RUN_HELD_MS).toISOString();
  const { data, error } = await supabase
    .from("fp_builder_communities")
    .update({ run_started_at: new Date(now).toISOString() })
    .eq("id", connectionId)
    .or(`run_started_at.is.null,run_started_at.lt.${cutOff}`)
    .select("id");
  if (error) throw new Error(`hold run: ${error.message}`);
  return (data ?? []).length > 0;
}

async function letGo(connectionId: string): Promise<void> {
  const { error } = await supabase.from("fp_builder_communities").update({ run_started_at: null }).eq("id", connectionId);
  if (error) logger.error("Floor plan run mark not cleared", { connectionId, error: error.message });
}

/** A run of a connection already held (holdRun), let go of at the end however it went. */
export async function runHeld(connectionId: string): Promise<RunResult> {
  try {
    return await runConnection(connectionId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error("Connection run failed", { connectionId, error: detail });
    await supabase
      .from("fp_builder_communities")
      .update({ last_run_at: new Date().toISOString(), last_run_status: `error: ${detail}`.slice(0, 300) })
      .eq("id", connectionId);
    return { status: "failed", detail };
  } finally {
    await letGo(connectionId);
  }
}

/** One run of a connection, unless another run has it. */
export async function runOnce(connectionId: string): Promise<RunResult> {
  if (!(await holdRun(connectionId))) return { status: "skipped", detail: "already running" };
  return runHeld(connectionId);
}

/**
 * Runs that were cut off before they finished: the mark is cleared and
 * the connection says so. Its last run time stays, so a sync still owes
 * it a run and gives it one on a later tick.
 */
export async function sweepCutOffRuns(): Promise<number> {
  const cutOff = new Date(Date.now() - RUN_HELD_MS).toISOString();
  const { data } = await supabase
    .from("fp_builder_communities")
    .select("id, consecutive_failures")
    .lt("run_started_at", cutOff);
  for (const c of data ?? []) {
    await supabase
      .from("fp_builder_communities")
      .update({
        run_started_at: null,
        last_run_status: "cut off: the run was still going when its five minutes ran out",
        consecutive_failures: (c.consecutive_failures ?? 0) + 1,
      })
      .eq("id", c.id)
      .lt("run_started_at", cutOff);
    logger.warn("Floor plan run was cut off", { connectionId: c.id });
  }
  return (data ?? []).length;
}

/** Whether a run of this connection is going now: Reset and Remove wait for it. */
export async function runIsGoing(connectionId: string): Promise<boolean> {
  const { data } = await supabase.from("fp_builder_communities").select("run_started_at").eq("id", connectionId).maybeSingle();
  return runGoing(data?.run_started_at as string | null | undefined);
}
