-- Track Salesforce lead status updates (Nurture Active / Disqualified) sent via Zapier
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS lead_status_update TEXT;
COMMENT ON COLUMN email_drafts.lead_status_update IS 'Salesforce status update sent: nurture_active or disqualified';
