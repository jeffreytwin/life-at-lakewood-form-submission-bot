-- 087: a note on a queued change for the person who reviews it (Jeff,
-- 2026-10-27). Removals a run held as suspicious and a re-check an hour
-- later still found missing reach the queue with it: the system has
-- double-checked them, and they are worth a look before approval
-- (removal-recheck.ts).

ALTER TABLE fp_pending_changes ADD COLUMN IF NOT EXISTS review_flag text;
