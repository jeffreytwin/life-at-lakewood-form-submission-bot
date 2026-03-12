-- Email Hub: AI-powered email draft management
-- Adds tables for inbox monitoring, conversation tracking, AI drafting, and training data

-- ============================================================
-- EMAIL ACCOUNTS
-- Inbox configurations for Gmail and Outlook
-- ============================================================
CREATE TABLE email_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID REFERENCES locations(id),
  email_address TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook')),
  display_name TEXT,
  credentials JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_email_accounts_address ON email_accounts (email_address);

-- ============================================================
-- EMAIL THREADS
-- Conversation threads from monitored inboxes
-- ============================================================
CREATE TABLE email_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_account_id UUID NOT NULL REFERENCES email_accounts(id),
  provider_thread_id TEXT,
  subject TEXT,
  sender_email TEXT,
  sender_name TEXT,
  salesforce_lead_id TEXT,
  lead_status TEXT,
  location_id UUID REFERENCES locations(id),
  last_message_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_threads_account ON email_threads (email_account_id, last_message_at DESC);
CREATE INDEX idx_email_threads_sender ON email_threads (sender_email);

-- ============================================================
-- EMAIL MESSAGES
-- Individual messages within threads
-- ============================================================
CREATE TABLE email_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID NOT NULL REFERENCES email_threads(id),
  provider_message_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_email TEXT,
  to_email TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_messages_thread ON email_messages (thread_id, received_at);

-- ============================================================
-- EMAIL DRAFTS
-- AI-generated draft responses
-- ============================================================
CREATE TABLE email_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID REFERENCES email_threads(id),
  email_account_id UUID REFERENCES email_accounts(id),
  provider_draft_id TEXT,
  status TEXT NOT NULL DEFAULT 'drafted'
    CHECK (status IN ('drafted', 'edited', 'sent', 'discarded')),
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  cc_emails TEXT[] DEFAULT '{}',
  agent_handoff_id UUID REFERENCES agents(id),
  model_used TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  is_simulation BOOLEAN NOT NULL DEFAULT false,
  simulation_input JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);

CREATE INDEX idx_email_drafts_status ON email_drafts (status, created_at DESC);
CREATE INDEX idx_email_drafts_thread ON email_drafts (thread_id);
CREATE INDEX idx_email_drafts_provider ON email_drafts (provider_draft_id) WHERE provider_draft_id IS NOT NULL;

-- ============================================================
-- TRAINING EXAMPLES
-- Per-location email response examples for AI few-shot prompting
-- ============================================================
CREATE TABLE training_examples (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID REFERENCES locations(id),
  category TEXT NOT NULL CHECK (category IN (
    'initial_inquiry', 'follow_up', 'scheduling',
    'agent_handoff', 'pricing', 'objection', 'general'
  )),
  inbound_email TEXT NOT NULL,
  ideal_response TEXT NOT NULL,
  context_notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_training_examples_location ON training_examples (location_id, category)
  WHERE is_active = true;

-- ============================================================
-- DRAFT FEEDBACK
-- Ratings and notes on AI-generated drafts
-- ============================================================
CREATE TABLE draft_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  draft_id UUID NOT NULL REFERENCES email_drafts(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback_notes TEXT,
  edited_version TEXT,
  added_as_training BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_draft_feedback_draft ON draft_feedback (draft_id);

-- ============================================================
-- EMAIL HUB SETTINGS
-- Per-location configuration for the email hub
-- ============================================================
CREATE TABLE email_hub_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID NOT NULL REFERENCES locations(id) UNIQUE,
  auto_notify_lynn BOOLEAN NOT NULL DEFAULT false,
  inherit_training_from UUID REFERENCES locations(id),
  polling_interval_seconds INTEGER NOT NULL DEFAULT 180,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER email_hub_settings_updated_at
  BEFORE UPDATE ON email_hub_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
