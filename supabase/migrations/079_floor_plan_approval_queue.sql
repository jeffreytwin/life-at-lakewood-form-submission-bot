-- 079: approvals the server finishes on its own (Jeff, 2026-10-10: "Let the
-- server finish the run itself").
--
-- Approve, Approve selected and Approve All mark a plan's rows "approving"
-- and answer at once; a worker on the server writes them to Wix one plan at
-- a time, started by the click and carried on every minute by a cron
-- (approvals.ts). The page no longer sends what did not fit in one
-- request's time, so closing it stops nothing.

-- When the person asked: the worker writes plans in that order, and a row
-- it had claimed when its function was cut off is known as its own.
ALTER TABLE fp_pending_changes ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz;
-- Not before this: a plan whose pictures Wix is still fetching waits a minute.
ALTER TABLE fp_pending_changes ADD COLUMN IF NOT EXISTS approve_after timestamptz;
CREATE INDEX IF NOT EXISTS fp_pending_changes_approving_idx
  ON fp_pending_changes (approval_requested_at, created_at) WHERE status = 'approving';

-- One worker at a time, so two never write the same plan or both run into
-- Wix's rate limit; held past the run while Wix asks for a wait.
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS fp_approve_lock_until timestamptz;
