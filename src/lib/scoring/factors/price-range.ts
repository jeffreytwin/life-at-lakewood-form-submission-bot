import type { Agent, PriceRange } from "@/lib/supabase/types";
import type { ScoringContext } from "../types";

/**
 * Parse a price string like "$500,000 - $600,000" or "$450,000" into a numeric midpoint.
 */
export function parsePriceToMidpoint(priceStr: string): number | null {
  const numbers = priceStr.match(/[\d,]+/g);
  if (!numbers || numbers.length === 0) return null;

  const values = numbers
    .map((n) => parseInt(n.replace(/,/g, ""), 10))
    .filter((n) => !isNaN(n));
  if (values.length === 0) return null;

  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Map a dollar amount to a price range bucket */
export function priceToBucket(price: number): PriceRange {
  if (price < 500_000) return "under_500k";
  if (price <= 1_000_000) return "500k_to_1m";
  return "1m_plus";
}

/**
 * Hard filter: returns true if the agent accepts leads in the
 * lead's price range. Agents with no price_ranges set (null/empty)
 * accept all price ranges.
 */
export function agentMatchesPriceRange(
  agent: Agent,
  context: ScoringContext
): boolean {
  const ranges = agent.price_ranges;

  // No price ranges configured = accepts all
  if (!ranges || ranges.length === 0) return true;

  const priceStr = context.lead.price;
  if (!priceStr) return true; // No price data on lead, allow

  const midpoint = parsePriceToMidpoint(priceStr);
  if (midpoint === null) return true; // Unparseable price, allow

  const bucket = priceToBucket(midpoint);
  return ranges.includes(bucket);
}
