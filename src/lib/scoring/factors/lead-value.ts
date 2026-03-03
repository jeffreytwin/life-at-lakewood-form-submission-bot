import type { Agent } from "@/lib/supabase/types";
import type { ScoringContext } from "../types";
import { LEAD_VALUE_CLOSE_MATCH_THRESHOLD } from "@/lib/shared/constants";

/**
 * Parse a price string like "$500,000 - $600,000" or "$450,000" into a numeric midpoint.
 */
function parsePriceToMidpoint(priceStr: string): number | null {
  const numbers = priceStr.match(/[\d,]+/g);
  if (!numbers || numbers.length === 0) return null;

  const values = numbers.map((n) => parseInt(n.replace(/,/g, ""), 10)).filter((n) => !isNaN(n));
  if (values.length === 0) return null;

  // If range, return midpoint. If single value, return it.
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function scoreLeadValue(agent: Agent, context: ScoringContext): number {
  const priceStr = context.lead.price;
  if (!priceStr) return 0.5; // No price data, neutral score

  const leadPrice = parsePriceToMidpoint(priceStr);
  if (leadPrice === null) return 0.5;

  // For now all agents handle all price ranges equally
  // This can be refined when agent price preferences are added
  // Basic logic: higher-value leads slightly favor agents with better close rates
  // For MVP, return a neutral-high score
  return 0.7;
}

// Exported for testing
export { parsePriceToMidpoint };
