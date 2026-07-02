-- Nightly floor plan sync: schedule settings + onboarding gate.
-- A connection only becomes nightly-eligible after its first successful
-- manual run (onboarded_at) — every builder passes through human review
-- before automation covers it.
-- (Applied to production 2026-07-02 via MCP.)
ALTER TABLE fp_builder_communities ADD COLUMN onboarded_at TIMESTAMPTZ;

ALTER TABLE system_settings ADD COLUMN fp_nightly_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE system_settings ADD COLUMN fp_nightly_hour INTEGER NOT NULL DEFAULT 2
  CHECK (fp_nightly_hour BETWEEN 0 AND 23);
ALTER TABLE system_settings ADD COLUMN fp_digest_phone TEXT;
ALTER TABLE system_settings ADD COLUMN fp_nightly_state JSONB NOT NULL DEFAULT '{}'::jsonb;
