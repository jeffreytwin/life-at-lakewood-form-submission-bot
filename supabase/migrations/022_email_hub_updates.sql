-- 022: Email Hub updates
-- 1. Replace 'edited' status with 'approved' for email_drafts
-- 2. Add agent_handoff_transferred flag for tracking Zapier handoff transfers

-- Update the status check constraint to use 'approved' instead of 'edited'
ALTER TABLE email_drafts DROP CONSTRAINT IF EXISTS email_drafts_status_check;
ALTER TABLE email_drafts ADD CONSTRAINT email_drafts_status_check
  CHECK (status IN ('drafted', 'approved', 'sent', 'discarded'));

-- Migrate any existing 'edited' drafts to 'drafted'
UPDATE email_drafts SET status = 'drafted' WHERE status = 'edited';

-- Add approved_at timestamp
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Add agent handoff transfer tracking
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS agent_handoff_transferred boolean DEFAULT false;
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS agent_handoff_transferred_at timestamptz;
