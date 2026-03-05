import type { Agent } from "@/lib/supabase/types";
import type { ScoringContext } from "../types";

/**
 * Hard filter: returns true if the agent's location specialties
 * match the lead's location or village. Agents without any
 * specialties are considered a match (they take all locations).
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
  const leadVillage = context.lead.village?.toLowerCase().trim() ?? "";

  // If we have no location info at all, allow the agent
  if (!leadLocation && !leadVillage) return true;

  const lowerSpecialties = specialties.map((s) => s.toLowerCase().trim());

  for (const specialty of lowerSpecialties) {
    if (
      (leadLocation && specialty === leadLocation) ||
      (leadVillage && specialty === leadVillage)
    ) {
      return true;
    }
  }

  // LWR agents can also take Parrish leads
  if (
    leadLocation.includes("parrish") &&
    lowerSpecialties.some((s) => s.includes("lakewood"))
  ) {
    return true;
  }

  return false;
}
