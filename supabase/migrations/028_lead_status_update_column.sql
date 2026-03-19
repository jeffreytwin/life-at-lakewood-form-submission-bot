-- Add lead_status_update column to email_drafts for tracking
-- Nurture Active / Disqualified status updates sent to Salesforce via Zapier.
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS lead_status_update text DEFAULT NULL;
