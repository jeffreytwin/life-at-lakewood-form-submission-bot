-- Listings engine: dismissable errors and change-log indexes.
-- (Applied to production 2026-09-15 via the Supabase MCP.)
--
-- The Hub's Errors panel lists error events until someone dismisses them;
-- dismissed_at records that. The indexes serve the Change Log's per-run
-- lookups (run_key), the newest-first listing and the nightly retention
-- purge (at), which the original schema only covered per site.

ALTER TABLE ls_sync_events ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ls_sync_events_open_errors
  ON ls_sync_events (at DESC)
  WHERE level = 'error' AND dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ls_sync_events_run_key_at
  ON ls_sync_events (run_key, at DESC);

CREATE INDEX IF NOT EXISTS idx_ls_sync_events_at
  ON ls_sync_events (at DESC);
