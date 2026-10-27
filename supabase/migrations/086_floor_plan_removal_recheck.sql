-- 086: removals held for a re-check (Jeff, 2026-10-27). A run that would
-- queue a bunch of removals at once, the way a page that drew only part of
-- its list does, queues none of them: the plans it missed are held here and
-- the connection is run again once removal_recheck_at has come
-- (removal-recheck.ts). What that run still misses is queued for removal.

ALTER TABLE fp_builder_communities ADD COLUMN IF NOT EXISTS removals_held text[];
ALTER TABLE fp_builder_communities ADD COLUMN IF NOT EXISTS removal_recheck_at timestamptz;
