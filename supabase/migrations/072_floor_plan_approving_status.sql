-- 072: "approving" is a status a pending change can hold.
--
-- Server-side approvals lock every row of a plan as "approving" before the
-- writes start, so the queue shows it locked and a second request cannot
-- edit or reject it mid-write (changes/bulk, approving.ts). The status
-- check from 036 never learned the word, so that lock was rejected with a
-- check violation and Approve All failed for every plan — 400 from
-- PostgREST, "Internal server error" in the Hub (Jeff, 2026-09-21).
ALTER TABLE fp_pending_changes DROP CONSTRAINT IF EXISTS fp_pending_changes_status_check;
ALTER TABLE fp_pending_changes ADD CONSTRAINT fp_pending_changes_status_check
  CHECK (status IN ('pending', 'approving', 'approved', 'rejected', 'synced_draft', 'synced', 'failed'));
