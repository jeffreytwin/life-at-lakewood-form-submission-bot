import type { Agent, UnavailabilityWindow } from "@/lib/supabase/types";
import type { ScoringContext } from "../types";

/**
 * Hard filter: returns true if the agent is currently available.
 *
 * Agents are available by default. They become unavailable only during
 * the time windows they explicitly mark as unavailable.
 */
export function agentIsAvailable(agent: Agent, context: ScoringContext): boolean {
  const windows = agent.unavailability_windows as UnavailabilityWindow[] | null;

  // No unavailability windows = always available
  if (!windows || windows.length === 0) {
    return true;
  }

  const now = context.currentTime;
  const currentDay = now.getDay(); // 0 = Sunday
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;

  for (const window of windows) {
    if (window.day === currentDay) {
      if (currentTime >= window.start && currentTime < window.end) {
        return false; // Currently in an unavailable window
      }
    }
  }

  return true; // Not in any unavailability window
}
