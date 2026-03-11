-- Add 'rejected' to lead routing_status and add rejection_reason column
-- This supports the lead quality gate that filters bad submissions before routing.

-- 1. Drop existing constraint and add new one with 'rejected'
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_routing_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_routing_status_check
  CHECK (routing_status IN ('pending', 'routing', 'accepted', 'owned_by_other', 'failed', 'manual', 'bad_data', 'rejected'));

-- 2. Add rejection_reason column (nullable, only set when routing_status = 'rejected')
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rejection_reason TEXT[];

-- 3. Add 'lead_rejected' to the audit log event types
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_event_type_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_event_type_check
  CHECK (event_type IN (
    'lead_received', 'scoring_completed', 'sms_sent', 'sms_received',
    'followup_sent', 'escalated', 'accepted', 'declined',
    'sf_updated', 'error', 'manual_fallback', 'routing_stopped',
    'text_me_sent', 'lead_done_manually', 'lead_marked_bad_data',
    'lead_rejected'
  ));

-- 4. Index for quickly excluding rejected leads from dashboard queries
CREATE INDEX IF NOT EXISTS idx_leads_rejected ON leads (routing_status) WHERE routing_status = 'rejected';
