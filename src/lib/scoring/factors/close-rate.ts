import type { Agent } from "@/lib/supabase/types";
import {
  DEFAULT_CLOSE_RATE,
  MAX_EXPECTED_CLOSE_RATE,
} from "@/lib/shared/constants";

/**
 * Floor for close rate scoring. Agents with very low close rates
 * still get a minimum score so they aren't completely shut out of
 * lead distribution. 0.15 ≈ equivalent to a ~4.5% close rate.
 */
const CLOSE_RATE_SCORE_FLOOR = 0.15;

export function scoreCloseRate(agent: Agent): number {
  const trailing = agent.close_rate_trailing_12m;

  // New agents with no data get a default middle score
  if (trailing === 0) {
    return DEFAULT_CLOSE_RATE;
  }

  // Normalize against max expected rate, cap at 1.0, floor at minimum
  const raw = Math.min(trailing / MAX_EXPECTED_CLOSE_RATE, 1.0);
  return Math.max(raw, CLOSE_RATE_SCORE_FLOOR);
}
