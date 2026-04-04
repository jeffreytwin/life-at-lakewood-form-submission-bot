import type { Agent } from "@/lib/supabase/types";
import type { ScoringContext } from "../types";

/**
 * Hard filter: returns true if the agent's location specialties
 * match the lead's location. Agents without any specialties are
 * considered a match (they take all locations).
 *
 * Uses exact case-insensitive equality (not substring matching)
 * to prevent cross-location false positives.
 */
export function agentMatchesLocation(
  agent: Agent,
  context: ScoringContext
): boolean {
  const specialties = agent.location_specialties;

  // Agents with no specialties match everything
  if (!specialties || specialties.length === 0) return true;

  const leadLocation = context.locationName?.toLowerCase().trim() ?? "";

  // If we have no location info at all, allow the agent
  if (!leadLocation) return true;

  const lowerSpecialties = specialties.map((s) => s.toLowerCase().trim());

  if (lowerSpecialties.includes(leadLocation)) {
    return true;
  }

  return false;
}
