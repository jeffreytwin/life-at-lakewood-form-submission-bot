// Whether a connection's run is going, from the mark it leaves
// (fp_builder_communities.run_started_at; runs.ts). Pure, so the Builder
// Connections page reads it the same way the server does.

/** Longer than any function lives (maxDuration 300s): a mark this old is a run that was cut off. */
export const RUN_HELD_MS = 320_000;

/** Whether a mark says a run is going now. */
export function runGoing(startedAt: string | null | undefined, now = Date.now()): boolean {
  if (!startedAt) return false;
  const at = Date.parse(startedAt);
  return Number.isFinite(at) && now - at < RUN_HELD_MS;
}
