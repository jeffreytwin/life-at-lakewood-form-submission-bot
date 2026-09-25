-- 075: runs that go on without the page that asked for them (Jeff,
-- 2026-09-25: "when I click 'Run' and navigate away, will it still run?").
--
-- A Run answers at once and carries on in the background; the Builder
-- Connections page reads whether a connection is running from here, so a
-- person who left and came back sees it. The same mark keeps two runs of
-- one connection from overlapping — a Run pressed while the sync is on it.
-- A mark older than any function lives (five minutes) is a run that was
-- cut off, and the next tick clears it (nightly.ts).
ALTER TABLE fp_builder_communities ADD COLUMN IF NOT EXISTS run_started_at timestamptz;

-- One sync tick at a time: the tick runs every minute and works for up to
-- four, and "Sync now" starts one of its own.
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS fp_tick_lock_until timestamptz;
