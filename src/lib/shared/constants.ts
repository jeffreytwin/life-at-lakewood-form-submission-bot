// Routing timeouts
export const ROUTING_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
export const MAX_ESCALATION_ATTEMPTS = 5;

// Scoring defaults
export const DEFAULT_CLOSE_RATE = 0.5; // For agents with no data
export const MAX_EXPECTED_CLOSE_RATE = 0.30; // Normalization ceiling

// Location specialty bonus: multiplier for agents with a specific area match
// vs generalists (no specialties = match all). 1.15 = 15% boost for specialists.
export const SPECIALTY_BONUS_MULTIPLIER = 1.15;

// Monthly over-cap penalty: multiplier applied when agent exceeds monthly_lead_goal_max
// At max_goal, score is multiplied by this. Further over = even lower (floor 0.1).
export const MONTHLY_OVER_CAP_MULTIPLIER = 0.4;

// Lead value scoring
export const LEAD_VALUE_CLOSE_MATCH_THRESHOLD = 100_000; // Within $100K = 0.5 score

// Form names
export const FORM_NAMES = [
  "Lot Availability",
  "Floor Plan",
  "Property Listing",
  "Builder Interest",
  "Contact Us",
  "Realtor Connect",
] as const;

export type FormName = (typeof FORM_NAMES)[number];
