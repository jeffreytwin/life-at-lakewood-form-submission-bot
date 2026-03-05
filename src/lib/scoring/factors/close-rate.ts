import type { Agent } from "@/lib/supabase/types";
import {
  DEFAULT_CLOSE_RATE,
  MAX_EXPECTED_CLOSE_RATE,
} from "@/lib/shared/constants";

export function scoreCloseRate(agent: Agent): number {
  const trailing = agent.close_rate_trailing_12m;

  // New agents with no data get a default middle score
  if (trailing === 0) {
    return DEFAULT_CLOSE_RATE;
  }

  // Normalize against max expected rate, cap at 1.0
  return Math.min(trailing / MAX_EXPECTED_CLOSE_RATE, 1.0);
}
