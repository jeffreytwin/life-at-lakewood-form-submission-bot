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

  // Unavailability windows are defined in Eastern time, so we must
  // convert the current time to Eastern before comparing.
  const now = context.currentTime;
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const dayStr = etParts.find((p) => p.type === "weekday")?.value ?? "";
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const currentDay = dayMap[dayStr] ?? now.getDay();
  const hourStr = etParts.find((p) => p.type === "hour")?.value ?? "00";
  const minStr = etParts.find((p) => p.type === "minute")?.value ?? "00";
  const currentTime = `${hourStr}:${minStr}`;

  for (const window of windows) {
    if (window.day === currentDay) {
      if (currentTime >= window.start && currentTime < window.end) {
        return false; // Currently in an unavailable window
      }
    }
  }

  return true; // Not in any unavailability window
}
