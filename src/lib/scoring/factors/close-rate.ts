import type { Agent } from "@/lib/supabase/types";
import {
  DEFAULT_CLOSE_RATE,
  MAX_EXPECTED_CLOSE_RATE,
  CLOSE_RATE_TRAILING_WEIGHT,
  CLOSE_RATE_ALLTIME_WEIGHT,
} from "@/lib/shared/constants";

export function scoreCloseRate(agent: Agent): number {
  const trailing = agent.close_rate_trailing_12m;
  const allTime = agent.close_rate_all_time;

  // New agents with no data get a default middle score
  if (trailing === 0 && allTime === 0) {
    return DEFAULT_CLOSE_RATE;
  }

  const blended =
    trailing * CLOSE_RATE_TRAILING_WEIGHT + allTime * CLOSE_RATE_ALLTIME_WEIGHT;

  // Normalize against max expected rate, cap at 1.0
  return Math.min(blended / MAX_EXPECTED_CLOSE_RATE, 1.0);
}
