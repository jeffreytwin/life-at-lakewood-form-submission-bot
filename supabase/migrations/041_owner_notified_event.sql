-- Frontlines can now text the former owner of a lead whose agent has left the
-- active roster, from the dashboard. That action needs its own audit event so
-- it is distinguishable from routing's own outbound texts.
--
-- The list below also captures 'manual_retry', which exists in the deployed
-- constraint but was never written into a migration, so a rebuild from this
-- directory would silently reject every retry's audit row.

ALTER TABLE audit_log
  DROP CONSTRAINT audit_log_event_type_check;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_event_type_check
  CHECK (event_type IN (
    'lead_received', 'scoring_completed', 'sms_sent', 'sms_received',
    'followup_sent', 'escalated', 'accepted', 'declined',
    'sf_updated', 'error', 'manual_fallback',
    'routing_stopped', 'text_me_sent', 'lead_done_manually', 'lead_marked_bad_data',
    'manual_retry', 'owner_notified'
  ));
