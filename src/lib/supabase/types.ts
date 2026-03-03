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
  availability_windows: AvailabilityWindow[] | null;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityWindow {
  day: number; // 0 = Sunday, 6 = Saturday
  start: string; // "08:00"
  end: string; // "19:00"
}

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
  location_match: number;
  close_rate: number;
  lead_load: number;
  lead_value: number;
  availability: number;
  optimal_load: number;
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
