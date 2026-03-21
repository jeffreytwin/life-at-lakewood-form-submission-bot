-- Prevent multiple active (drafted/approved) drafts for the same thread.
-- This closes a race condition where concurrent Zapier callbacks both see
-- "no drafts" and each generate one.

-- First, clean up any existing duplicates: keep the newest, discard the rest.
WITH ranked AS (
  SELECT
    id,
    thread_id,
    ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY created_at DESC) AS rn
  FROM email_drafts
  WHERE status IN ('drafted', 'approved')
)
UPDATE email_drafts
SET status = 'discarded'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Now create the partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_drafts_one_active_per_thread
  ON email_drafts (thread_id)
  WHERE status IN ('drafted', 'approved');
