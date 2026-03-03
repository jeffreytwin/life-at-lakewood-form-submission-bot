-- Life at Lakewood Form Submission Bot - Initial Schema
-- Run this in the Supabase SQL editor after creating a new project

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- LOCATIONS
-- Dynamically managed - add new locations via admin API
-- ============================================================
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AGENTS
-- Sales agent configuration and performance data
-- ============================================================
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  salesforce_user_id TEXT UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  is_frontlines BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  close_rate_trailing_12m DECIMAL DEFAULT 0,
  close_rate_all_time DECIMAL DEFAULT 0,
  location_specialties TEXT[] DEFAULT '{}',
  monthly_lead_goal_min INTEGER DEFAULT 20,
  monthly_lead_goal_max INTEGER DEFAULT 30,
  optimal_load_factor DECIMAL DEFAULT 1.0,
  availability_windows JSONB, -- null = always available during business hours
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- LEADS
-- Each form submission received from Zapier
-- ============================================================
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  salesforce_record_id TEXT,
  location_id UUID REFERENCES locations(id),
  form_name TEXT,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  floor_plan TEXT,
  village TEXT,
  price TEXT,
  home_type TEXT,
  property_address TEXT,
  url TEXT,
  builder TEXT,
  timeline TEXT,
  message TEXT,
  owner_name TEXT,
  raw_payload JSONB,
  routing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (routing_status IN ('pending', 'routing', 'accepted', 'owned_by_other', 'failed', 'manual')),
  final_agent_id UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ROUTING ATTEMPTS
-- Each attempt to offer a lead to a specific agent
-- ============================================================
CREATE TABLE routing_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'sms_sent'
    CHECK (status IN ('sms_sent', 'followup_sent', 'accepted', 'declined', 'timed_out', 'error')),
  expires_at TIMESTAMPTZ,
  twilio_message_sid TEXT,
  agent_response TEXT,
  score_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Critical index: powers the cron timeout checker
CREATE INDEX idx_routing_active
  ON routing_attempts (status, expires_at)
  WHERE status IN ('sms_sent', 'followup_sent');

-- Index for looking up active routing by lead
CREATE INDEX idx_routing_by_lead ON routing_attempts (lead_id, status);

-- ============================================================
-- MONTHLY LEAD COUNTS
-- Denormalized for fast scoring reads
-- ============================================================
CREATE TABLE monthly_lead_counts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  year_month TEXT NOT NULL, -- '2026-03'
  lead_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (agent_id, year_month)
);

-- ============================================================
-- SCORING WEIGHTS
-- Single row, configurable via admin API
-- ============================================================
CREATE TABLE scoring_weights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_match INTEGER NOT NULL DEFAULT 25,
  close_rate INTEGER NOT NULL DEFAULT 20,
  lead_load INTEGER NOT NULL DEFAULT 20,
  lead_value INTEGER NOT NULL DEFAULT 15,
  availability INTEGER NOT NULL DEFAULT 10,
  optimal_load INTEGER NOT NULL DEFAULT 10
);

-- Insert default weights
INSERT INTO scoring_weights (location_match, close_rate, lead_load, lead_value, availability, optimal_load)
VALUES (25, 20, 20, 15, 10, 10);

-- ============================================================
-- AUDIT LOG
-- Immutable log of all system events
-- ============================================================
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id),
  routing_attempt_id UUID REFERENCES routing_attempts(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'lead_received', 'scoring_completed', 'sms_sent', 'sms_received',
      'followup_sent', 'escalated', 'accepted', 'declined',
      'sf_updated', 'error', 'manual_fallback'
    )),
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_by_lead ON audit_log (lead_id, created_at);

-- ============================================================
-- UPDATED_AT TRIGGER
-- Auto-update updated_at on row changes
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER routing_attempts_updated_at
  BEFORE UPDATE ON routing_attempts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
