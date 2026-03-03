// Routing timeouts
export const ROUTING_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
export const MAX_ESCALATION_ATTEMPTS = 5;

// Scoring defaults
export const DEFAULT_CLOSE_RATE = 0.5; // For agents with no data
export const MAX_EXPECTED_CLOSE_RATE = 0.30; // Normalization ceiling
export const CLOSE_RATE_TRAILING_WEIGHT = 0.7;
export const CLOSE_RATE_ALLTIME_WEIGHT = 0.3;

// Lead load scoring thresholds
export const LEAD_LOAD_FULL_SCORE_PCT = 0.5; // 1.0 score at 50% of min goal
export const LEAD_LOAD_ZERO_SCORE_PCT = 1.2; // 0.0 score at 120% of max goal

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
