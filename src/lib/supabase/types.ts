export interface Database {
  public: {
    Tables: {
      locations: {
        Row: Location;
        Insert: Omit<Location, "id" | "created_at">;
        Update: Partial<Omit<Location, "id" | "created_at">>;
      };
      agents: {
        Row: Agent;
        Insert: Omit<Agent, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Agent, "id" | "created_at" | "updated_at">>;
      };
      leads: {
        Row: Lead;
        Insert: Omit<Lead, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Lead, "id" | "created_at" | "updated_at">>;
      };
      routing_attempts: {
        Row: RoutingAttempt;
        Insert: Omit<RoutingAttempt, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<RoutingAttempt, "id" | "created_at" | "updated_at">>;
      };
      monthly_lead_counts: {
        Row: MonthlyLeadCount;
        Insert: Omit<MonthlyLeadCount, "id">;
        Update: Partial<Omit<MonthlyLeadCount, "id">>;
      };
      scoring_weights: {
        Row: ScoringWeights;
        Insert: Omit<ScoringWeights, "id">;
        Update: Partial<Omit<ScoringWeights, "id">>;
      };
      audit_log: {
        Row: AuditLogEntry;
        Insert: Omit<AuditLogEntry, "id" | "created_at">;
        Update: never;
      };
    };
  };
}

export interface Location {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
}

/** Predefined price range buckets in ~$250K increments */
export type PriceRange =
  | "under_250k"
  | "250k_to_500k"
  | "500k_to_750k"
  | "750k_to_1m"
  | "1m_to_1_5m"
  | "1_5m_plus";

export const PRICE_RANGE_LABELS: Record<PriceRange, string> = {
  under_250k: "Under $250K",
  "250k_to_500k": "$250K - $500K",
  "500k_to_750k": "$500K - $750K",
  "750k_to_1m": "$750K - $1M",
  "1m_to_1_5m": "$1M - $1.5M",
  "1_5m_plus": "$1.5M+",
};

export const ALL_PRICE_RANGES: PriceRange[] = [
  "under_250k",
  "250k_to_500k",
  "500k_to_750k",
  "750k_to_1m",
  "1m_to_1_5m",
  "1_5m_plus",
];

export interface UnavailabilityWindow {
  day: number; // 0 = Sunday, 6 = Saturday
  start: string; // "08:00"
  end: string; // "17:00"
}

export const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface Agent {
  id: string;
  salesforce_user_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  is_frontlines: boolean;
  is_active: boolean;
  close_rate_trailing_12m: number;
  close_rate_all_time: number;
  location_specialties: string[];
  monthly_lead_goal_min: number;
  monthly_lead_goal_max: number;
  optimal_load_factor: number;
  daily_lead_max: number;
  unavailability_windows: UnavailabilityWindow[] | null;
  price_ranges: PriceRange[] | null;
  created_at: string;
  updated_at: string;
}

/** Global scoring factor keys (location/price/availability are hard filters) */
export type ScoringFactorKey = "close_rate" | "lead_load" | "daily_load";

/** Default global weights: must sum to 100 */
export const DEFAULT_GLOBAL_WEIGHTS: Record<ScoringFactorKey, number> = {
  close_rate: 50,
  lead_load: 30,
  daily_load: 20,
};

export interface Lead {
  id: string;
  salesforce_record_id: string | null;
  location_id: string | null;
  form_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  floor_plan: string | null;
  village: string | null;
  price: string | null;
  home_type: string | null;
  property_address: string | null;
  url: string | null;
  builder: string | null;
  timeline: string | null;
  message: string | null;
  owner_name: string | null;
  raw_payload: Record<string, unknown> | null;
  routing_status: RoutingStatus;
  final_agent_id: string | null;
  created_at: string;
  updated_at: string;
}

export type RoutingStatus =
  | "pending"
  | "routing"
  | "accepted"
  | "owned_by_other"
  | "failed"
  | "manual";

export interface RoutingAttempt {
  id: string;
  lead_id: string;
  agent_id: string;
  attempt_number: number;
  status: RoutingAttemptStatus;
  expires_at: string | null;
  twilio_message_sid: string | null;
  agent_response: string | null;
  score_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type RoutingAttemptStatus =
  | "sms_sent"
  | "followup_sent"
  | "accepted"
  | "declined"
  | "timed_out"
  | "error";

export interface MonthlyLeadCount {
  id: string;
  agent_id: string;
  year_month: string;
  lead_count: number;
}

export interface ScoringWeights {
  id: string;
  close_rate: number;
  lead_load: number;
  daily_load: number;
}

export type AuditEventType =
  | "lead_received"
  | "scoring_completed"
  | "sms_sent"
  | "sms_received"
  | "followup_sent"
  | "escalated"
  | "accepted"
  | "declined"
  | "sf_updated"
  | "error"
  | "manual_fallback";

export interface AuditLogEntry {
  id: string;
  lead_id: string | null;
  routing_attempt_id: string | null;
  event_type: AuditEventType;
  details: Record<string, unknown> | null;
  created_at: string;
}
