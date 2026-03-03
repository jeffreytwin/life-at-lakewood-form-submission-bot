import type { Agent } from "@/lib/supabase/types";
import type { ScoringContext } from "../types";

export function scoreLocationMatch(agent: Agent, context: ScoringContext): number {
  const leadLocation = context.locationName?.toLowerCase() ?? "";
  const leadVillage = context.lead.village?.toLowerCase() ?? "";

  if (!leadLocation && !leadVillage) {
    return 0.5; // Unknown location
  }

  const specialties = agent.location_specialties.map((s) => s.toLowerCase());

  // Check if agent specializes in the lead's location or village
  for (const specialty of specialties) {
    if (
      leadLocation.includes(specialty) ||
      specialty.includes(leadLocation) ||
      leadVillage.includes(specialty) ||
      specialty.includes(leadVillage)
    ) {
      return 1.0;
    }
  }

  // LWR agents can also take Parrish leads
  if (
    leadLocation.includes("parrish") &&
    specialties.some((s) => s.includes("lakewood"))
  ) {
    return 0.8;
  }

  return 0.1; // No match
}
