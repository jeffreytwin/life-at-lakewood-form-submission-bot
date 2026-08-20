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
      email_accounts: {
        Row: EmailAccount;
        Insert: Omit<EmailAccount, "id" | "created_at">;
        Update: Partial<Omit<EmailAccount, "id" | "created_at">>;
      };
      email_threads: {
        Row: EmailThread;
        Insert: Omit<EmailThread, "id" | "created_at">;
        Update: Partial<Omit<EmailThread, "id" | "created_at">>;
      };
      email_messages: {
        Row: EmailMessage;
        Insert: Omit<EmailMessage, "id" | "created_at">;
        Update: Partial<Omit<EmailMessage, "id" | "created_at">>;
      };
      email_drafts: {
        Row: EmailDraft;
        Insert: Omit<EmailDraft, "id" | "created_at">;
        Update: Partial<Omit<EmailDraft, "id" | "created_at">>;
      };
      training_examples: {
        Row: TrainingExample;
        Insert: Omit<TrainingExample, "id" | "created_at">;
        Update: Partial<Omit<TrainingExample, "id" | "created_at">>;
      };
      draft_feedback: {
        Row: DraftFeedback;
        Insert: Omit<DraftFeedback, "id" | "created_at">;
        Update: Partial<Omit<DraftFeedback, "id" | "created_at">>;
      };
      email_hub_settings: {
        Row: EmailHubSettings;
        Insert: Omit<EmailHubSettings, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<EmailHubSettings, "id" | "created_at" | "updated_at">>;
      };
      salesforce_contacts: {
        Row: SalesforceContact;
        Insert: Omit<SalesforceContact, "id" | "created_at">;
        Update: Partial<Omit<SalesforceContact, "id" | "created_at">>;
      };
    };
  };
}

export interface Location {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  photo_url: string | null;
  photo_thumb_url: string | null;
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

export type AgentGender = "male" | "female";

export interface Agent {
  id: string;
  salesforce_user_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  gender: AgentGender | null;
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
  is_preferred: boolean;
  send_draft_success_texts: boolean;
  draft_success_phone: string | null;
  photo_url: string | null;
  photo_thumb_url: string | null;
  created_at: string;
  updated_at: string;
}

/** Global scoring factor keys (location/price/availability/daily cap are hard filters) */
export type ScoringFactorKey = "close_rate" | "lead_load";

/** Default global weights: must sum to 100 */
export const DEFAULT_GLOBAL_WEIGHTS: Record<ScoringFactorKey, number> = {
  close_rate: 60,
  lead_load: 40,
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
  salesforce_owner_id: string | null;
  is_master_agent_owned: boolean;
  previous_agent_offboarded: string | null;
  raw_payload: Record<string, unknown> | null;
  arrived_during_quiet_hours: boolean;
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
  | "manual"
  | "bad_data";

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
  | "manual_fallback"
  | "routing_stopped"
  | "text_me_sent"
  | "lead_done_manually"
  | "lead_marked_bad_data"
  | "manual_retry"
  | "owner_notified";

export interface AuditLogEntry {
  id: string;
  lead_id: string | null;
  routing_attempt_id: string | null;
  event_type: AuditEventType;
  details: Record<string, unknown> | null;
  created_at: string;
}

// ============================================================
// EMAIL HUB TYPES
// ============================================================

export type EmailProvider = "gmail" | "outlook";

export interface GmailCredentials {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
  scope: string;
}

export interface EmailAccount {
  id: string;
  location_id: string | null;
  email_address: string;
  provider: EmailProvider;
  display_name: string | null;
  credentials: GmailCredentials | null;
  is_active: boolean;
  last_synced_at: string | null;
  sync_history_id: string | null;
  sent_sync_history_id: string | null;
  watch_expiration: string | null;
  created_at: string;
}

export interface EmailThread {
  id: string;
  email_account_id: string;
  provider_thread_id: string | null;
  subject: string | null;
  sender_email: string | null;
  sender_name: string | null;
  salesforce_lead_id: string | null;
  lead_status: string | null;
  location_id: string | null;
  last_message_at: string | null;
  is_active: boolean;
  created_at: string;
}

export type EmailDirection = "inbound" | "outbound";

export interface EmailMessage {
  id: string;
  thread_id: string;
  provider_message_id: string | null;
  direction: EmailDirection;
  from_email: string | null;
  to_email: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string | null;
  created_at: string;
}

export type EmailDraftStatus = "drafted" | "approved" | "sent" | "discarded";

export interface EmailDraft {
  id: string;
  thread_id: string | null;
  email_account_id: string | null;
  provider_draft_id: string | null;
  status: EmailDraftStatus;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  cc_emails: string[];
  agent_handoff_id: string | null;
  model_used: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  is_simulation: boolean;
  simulation_input: Record<string, unknown> | null;
  created_at: string;
  edited_at: string | null;
  approved_at: string | null;
  sent_at: string | null;
  sent_body_text: string | null;
  was_changed: boolean;
  agent_handoff_transferred: boolean;
  agent_handoff_transferred_at: string | null;
}

export type TrainingCategory =
  | "initial_inquiry"
  | "follow_up"
  | "scheduling"
  | "agent_handoff"
  | "pricing"
  | "objection"
  | "general";

export const TRAINING_CATEGORY_LABELS: Record<TrainingCategory, string> = {
  initial_inquiry: "Initial Inquiry",
  follow_up: "Follow Up",
  scheduling: "Scheduling",
  agent_handoff: "Agent Handoff",
  pricing: "Pricing",
  objection: "Objection Handling",
  general: "General",
};

export const ALL_TRAINING_CATEGORIES: TrainingCategory[] = [
  "initial_inquiry",
  "follow_up",
  "scheduling",
  "agent_handoff",
  "pricing",
  "objection",
  "general",
];

export interface TrainingExample {
  id: string;
  location_id: string | null;
  email_address: string | null;
  category: TrainingCategory;
  inbound_email: string;
  ideal_response: string;
  context_notes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface DraftFeedback {
  id: string;
  draft_id: string;
  rating: number;
  feedback_notes: string | null;
  edited_version: string | null;
  added_as_training: boolean;
  created_at: string;
}

export interface EmailHubSettings {
  id: string;
  location_id: string;
  auto_notify_lynn: boolean;
  inherit_training_from: string | null;
  polling_interval_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface SalesforceContact {
  id: string;
  salesforce_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  company: string | null;
  lead_status: string | null;
  lead_source: string | null;
  property_interest: string | null;
  budget: string | null;
  timeline: string | null;
  location_name: string | null;
  is_active: boolean;
  synced_at: string;
  created_at: string;
}
