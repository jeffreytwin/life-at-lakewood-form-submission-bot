import type { Agent, AvailabilityWindow } from "@/lib/supabase/types";
import type { ScoringContext } from "../types";

export function scoreAvailability(agent: Agent, context: ScoringContext): number {
  const windows = agent.availability_windows as AvailabilityWindow[] | null;

  // Null windows = always available during business hours (default)
  if (!windows || windows.length === 0) {
    return 1.0;
  }

  const now = context.currentTime;
  const currentDay = now.getDay(); // 0 = Sunday
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;

  for (const window of windows) {
    if (window.day === currentDay) {
      if (currentTime >= window.start && currentTime <= window.end) {
        return 1.0;
      }
    }
  }

  return 0.0; // Outside all availability windows
}
