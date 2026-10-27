-- 086: removals checked again an hour later (Jeff, 2026-10-27). A run that
-- would queue a bunch of removals at once, the way a page that drew only
-- part of its list does, queues them flagged as suspicious (migration 087);
-- the plans it missed are remembered here and the connection is run again
-- once removal_recheck_at has come (removal-recheck.ts).

ALTER TABLE fp_builder_communities ADD COLUMN IF NOT EXISTS removals_held text[];
ALTER TABLE fp_builder_communities ADD COLUMN IF NOT EXISTS removal_recheck_at timestamptz;
