-- Add missing event types to audit_log CHECK constraint
-- These event types are used by the stop, text-me, done, and bad-data endpoints
-- but were never added to the database constraint, causing silent audit log failures.

ALTER TABLE audit_log
  DROP CONSTRAINT audit_log_event_type_check;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_event_type_check
  CHECK (event_type IN (
    'lead_received', 'scoring_completed', 'sms_sent', 'sms_received',
    'followup_sent', 'escalated', 'accepted', 'declined',
    'sf_updated', 'error', 'manual_fallback',
    'routing_stopped', 'text_me_sent', 'lead_done_manually', 'lead_marked_bad_data'
  ));
